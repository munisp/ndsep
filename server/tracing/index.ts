/**
 * NDSEP Distributed Tracing — Full OpenTelemetry propagation
 *
 * Traces flow: Client → Express/tRPC → Rust/Python workers → DB → Response
 * W3C Trace Context headers propagated to all inter-service calls.
 * Integrates with Jaeger/Grafana Tempo for visualization.
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { trace, context, propagation, SpanKind, SpanStatusCode, type Span } from "@opentelemetry/api";
import { logger } from "../logger";

// ── Configuration ───────────────────────────────────────────────────────────

const OTLP_ENDPOINT = process.env.OTLP_ENDPOINT ?? "http://localhost:4318/v1/traces";
const SERVICE_NAME = "ndsep-api";
const SERVICE_VERSION = "1.0.0";

// ── SDK Initialization ──────────────────────────────────────────────────────

let sdk: NodeSDK | null = null;

export function initTracing(): void {
  if (sdk) return;

  // NodeSDK uses W3C Trace Context propagation by default

  sdk = new NodeSDK({
    resourceDetectors: [],
    serviceName: SERVICE_NAME,
    traceExporter: new OTLPTraceExporter({ url: OTLP_ENDPOINT }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-http": {
          ignoreIncomingRequestHook: (req) => {
            // Skip health checks and static assets
            const url = req.url ?? "";
            return url === "/health" || url.startsWith("/assets/");
          },
        },
        "@opentelemetry/instrumentation-pg": {
          enhancedDatabaseReporting: true,
        },
        "@opentelemetry/instrumentation-express": {
          enabled: true,
        },
      }),
    ],
  });

  try {
    sdk.start();
    logger.info({ endpoint: OTLP_ENDPOINT }, "OpenTelemetry tracing initialized");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: msg }, "Tracing init failed — traces disabled");
  }
}

// ── Tracer ──────────────────────────────────────────────────────────────────

const tracer = trace.getTracer(SERVICE_NAME, SERVICE_VERSION);

// ── Traced Fetch (propagates context to Rust/Python workers) ────────────────

export async function tracedFetch(
  url: string,
  options: RequestInit = {},
  spanName?: string,
): Promise<Response> {
  const name = spanName ?? `HTTP ${options.method ?? "GET"} ${new URL(url).pathname}`;

  return tracer.startActiveSpan(name, { kind: SpanKind.CLIENT }, async (span: Span) => {
    try {
      // Inject W3C trace context into outgoing headers
      const headers = new Headers(options.headers);
      const carrier: Record<string, string> = {};
      propagation.inject(context.active(), carrier);
      for (const [key, value] of Object.entries(carrier)) {
        headers.set(key, value);
      }

      span.setAttribute("http.url", url);
      span.setAttribute("http.method", options.method ?? "GET");

      const response = await fetch(url, { ...options, headers });

      span.setAttribute("http.status_code", response.status);
      if (response.status >= 400) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${response.status}` });
      }

      return response;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      span.setStatus({ code: SpanStatusCode.ERROR, message: msg });
      span.recordException(e instanceof Error ? e : new Error(msg));
      throw e;
    } finally {
      span.end();
    }
  });
}

// ── Traced DB Query ─────────────────────────────────────────────────────────

export async function tracedQuery<T>(
  name: string,
  queryFn: () => Promise<T>,
  attributes?: Record<string, string | number>,
): Promise<T> {
  return tracer.startActiveSpan(`db.${name}`, { kind: SpanKind.CLIENT }, async (span: Span) => {
    try {
      span.setAttribute("db.system", "postgresql");
      span.setAttribute("db.operation", name);
      if (attributes) {
        for (const [k, v] of Object.entries(attributes)) {
          span.setAttribute(k, v);
        }
      }

      const result = await queryFn();
      return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      span.setStatus({ code: SpanStatusCode.ERROR, message: msg });
      span.recordException(e instanceof Error ? e : new Error(msg));
      throw e;
    } finally {
      span.end();
    }
  });
}

// ── Traced Worker Call ──────────────────────────────────────────────────────

export async function tracedWorkerCall<T>(
  workerName: string,
  endpoint: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  return tracer.startActiveSpan(
    `worker.${workerName}.${endpoint}`,
    { kind: SpanKind.CLIENT },
    async (span: Span) => {
      try {
        span.setAttribute("worker.name", workerName);
        span.setAttribute("worker.endpoint", endpoint);

        const headers = new Headers({ "Content-Type": "application/json" });
        const carrier: Record<string, string> = {};
        propagation.inject(context.active(), carrier);
        for (const [key, value] of Object.entries(carrier)) {
          headers.set(key, value);
        }

        const opts: RequestInit = { method, headers };
        if (body) opts.body = JSON.stringify(body);

        const response = await fetch(endpoint, opts);
        span.setAttribute("http.status_code", response.status);

        const data = await response.json() as T;
        return data;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        span.setStatus({ code: SpanStatusCode.ERROR, message: msg });
        throw e;
      } finally {
        span.end();
      }
    },
  );
}

// ── Custom Span Creation ────────────────────────────────────────────────────

export function createSpan(name: string, fn: (span: Span) => void): void {
  tracer.startActiveSpan(name, (span: Span) => {
    try {
      fn(span);
    } finally {
      span.end();
    }
  });
}

// ── Shutdown ────────────────────────────────────────────────────────────────

export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    logger.info("Tracing shutdown complete");
  }
}
