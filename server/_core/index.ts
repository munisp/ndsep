import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import path from "node:path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { registerDevelopmentProviderEmulators } from "../developmentProviderEmulators";
import { GatewayWebhookSignatureError, GatewayWebhookUnavailableError, reconcileGatewayWebhook, type GatewayProvider } from "../offlinePaymentRepository";
import { isAllowedOrigin, parseAllowedOrigins, readinessReport } from "../productionRuntime";
import { prometheusMetrics, recordHttpRequest, structuredLog } from "../observability";
import { applySecurityHeaders, fallbackApiRateLimitMiddleware } from "../httpSecurity";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");
  app.use(applySecurityHeaders);
  const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
  app.use((req, res, next) => { const started = Date.now(); res.on("finish", () => { const route = req.path === "/api/trpc" ? "/api/trpc" : req.path; recordHttpRequest(req.method, route, res.statusCode); structuredLog("http_request", { method: req.method, route, status: res.statusCode, durationMs: Date.now() - started }); }); next(); });

  // Enable CORS for all routes - reflect the request origin to support credentials
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!isAllowedOrigin({ origin, nodeEnv: process.env.NODE_ENV, allowedOrigins })) {
      res.status(403).json({ error: "Origin is not allowed." });
      return;
    }
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );
    res.header("Access-Control-Allow-Credentials", "true");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.post("/api/gateway-webhooks/:provider", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
    const provider = req.params.provider;
    if (provider !== "paystack" && provider !== "flutterwave") { res.status(404).json({ error: "Unsupported payment gateway." }); return; }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) { res.status(400).json({ error: "A raw JSON webhook payload is required." }); return; }
    const signatureHeader = provider === "paystack" ? "x-paystack-signature" : "flutterwave-signature";
    const signature = req.header(signatureHeader);
    if (!signature) { res.status(401).json({ error: "Webhook signature is required." }); return; }
    try {
      const result = await reconcileGatewayWebhook({ provider: provider as GatewayProvider, rawBody: req.body.toString("utf8"), signature });
      res.status(200).json({ accepted: true, duplicate: result.state === "duplicate", reconciliationState: result.reconciliationState });
    } catch (error) {
      if (error instanceof GatewayWebhookUnavailableError) { res.status(503).json({ error: "Gateway reconciliation is not configured." }); return; }
      if (error instanceof GatewayWebhookSignatureError) { res.status(401).json({ error: "Webhook signature validation failed." }); return; }
      const message = error instanceof Error ? error.message : "Webhook processing failed.";
      res.status(400).json({ error: message });
    }
  });

  app.use(fallbackApiRateLimitMiddleware);
  app.use(express.json({ limit: process.env.MAX_APPLICATION_BODY_SIZE ?? "10mb" }));
  app.use(express.urlencoded({ limit: process.env.MAX_APPLICATION_BODY_SIZE ?? "10mb", extended: true }));
  if (process.env.NODE_ENV !== "production") registerDevelopmentProviderEmulators(app);

  if (process.env.NODE_ENV !== "production" || process.env.SERVE_LOCAL_UPLOADS === "true") {
    app.use("/uploads", express.static(path.join(process.cwd(), "server", "uploads")));
  }
  registerOAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });
  app.get("/healthz", (_req, res) => { res.status(200).json({ ok: true, timestamp: new Date().toISOString() }); });
  app.get("/readyz", (_req, res) => { const report = readinessReport(); res.status(report.ok ? 200 : 503).json(report); });
  app.get("/metrics", (req, res) => { const token = process.env.METRICS_BEARER_TOKEN; if (process.env.NODE_ENV === "production" && (!token || req.header("authorization") !== `Bearer ${token}`)) return res.status(404).end(); const report = readinessReport(); return res.type("text/plain; version=0.0.4").send(prometheusMetrics(report)); });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
  });
}

startServer().catch(console.error);
