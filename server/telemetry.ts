/**
 * OpenTelemetry Distributed Tracing — NDSEP Enhancement
 * Instruments the Express/tRPC server with OTLP trace export.
 * Covers HTTP requests, tRPC procedure calls, and DB queries.
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import type { IncomingMessage } from "http";
import { logger } from "./logger";

const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? "ndsep-api";
const SERVICE_VERSION = process.env.npm_package_version ?? "1.0.0";
const ENABLED = process.env.OTEL_ENABLED !== "false";

let sdk: NodeSDK | null = null;

/**
 * Initialise OpenTelemetry SDK.
 * Call this BEFORE any other imports to ensure auto-instrumentation works.
 */
export function initTelemetry(): void {
  if (!ENABLED) {
    logger.info("[telemetry] OpenTelemetry disabled (OTEL_ENABLED=false)");
    return;
  }

  const exporter = new OTLPTraceExporter({
    url: `${OTLP_ENDPOINT}/v1/traces`,
    headers: {},
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": SERVICE_NAME,
      "service.version": SERVICE_VERSION,
      "deployment.environment": process.env.NODE_ENV ?? "development",
    }),
    spanProcessor: new SimpleSpanProcessor(exporter),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req: IncomingMessage) => {
          const url = req.url ?? "";
          return url === "/health" || url.startsWith("/assets/") || url.startsWith("/favicon");
        },
      }),
      new ExpressInstrumentation(),
      new PgInstrumentation(),
    ],
  });

  sdk.start();
  logger.info(`[telemetry] OpenTelemetry SDK started → ${OTLP_ENDPOINT}`);

  process.on("SIGTERM", () => {
    sdk?.shutdown().then(() => logger.info("[telemetry] SDK shut down"));
  });
}

/**
 * Wrap an async function in a named span.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>
): Promise<T> {
  if (!ENABLED) return fn();
  const tracer = trace.getTracer(SERVICE_NAME);
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      if (err instanceof Error) span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Express middleware that adds trace context to every request.
 */
export function traceMiddleware() {
  return (_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    const span = trace.getActiveSpan();
    if (span) {
      const ctx = span.spanContext();
      res.setHeader("X-Trace-ID", ctx.traceId);
      res.setHeader("X-Span-ID", ctx.spanId);
    }
    next();
  };
}
