import { createHmac } from "node:crypto";
import express, { type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getPool: vi.fn(() => undefined) }));
vi.mock("./logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("./middlewareIntegration", () => ({
  EVENTS: { ENFORCEMENT_PAYMENT: "enforcement.payment" },
  emitMutationEvent: vi.fn(),
}));

import { registerMojaloopCallbacks } from "./mojaloopCallback";

const SUBJECT = "CN=local-provider,O=NDSEP Test,C=NG";
const ATTESTATION = "gateway-attestation-" + "a".repeat(48);
const payload = JSON.stringify({
  transferId: "transfer-proxy-001",
  transferState: "COMMITTED",
});
const payloadSignature = createHmac(
  "sha256",
  "local-only-test-secret-change-this-to-32-plus-random-characters"
)
  .update(Buffer.from(payload))
  .digest("hex");

function backend(): express.Express {
  const app = express();
  registerMojaloopCallbacks(app);
  return app;
}

function simulatedIngress(options: {
  clientCertificateValid: boolean;
  injectTrustedHeaders: boolean;
}): express.Express {
  const app = express();
  app.use(express.raw({ type: "application/json" }));

  app.put(
    "/api/mojaloop/transfers/:transferId",
    (req: Request, res: Response) => {
      if (!options.clientCertificateValid) {
        res.status(495).json({ error: "mTLS client certificate required" });
        return;
      }

      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (
          ![
            "x-ndsep-mtls-verified",
            "x-ndsep-mtls-subject",
            "x-ndsep-mtls-issuer",
            "x-ndsep-mtls-serial",
            "x-ndsep-mtls-gateway-attestation",
            "x-forwarded-for",
            "x-real-ip",
          ].includes(name.toLowerCase()) &&
          typeof value === "string"
        ) {
          headers.set(name, value);
        }
      }

      if (options.injectTrustedHeaders) {
        headers.set("x-ndsep-mtls-verified", "SUCCESS");
        headers.set("x-ndsep-mtls-subject", SUBJECT);
        headers.set("x-ndsep-mtls-gateway-attestation", ATTESTATION);
      }
      headers.set("content-type", "application/json");
      headers.set("content-length", String(req.body.length));

      const target = backend();
      const forwarded = request(target)
        .put(req.originalUrl)
        .set(Object.fromEntries(headers));
      void forwarded
        .send(req.body.toString("utf8"))
        .then(forwardedResponse => {
          res.status(forwardedResponse.status).send(forwardedResponse.body);
        })
        .catch(() =>
          res.status(502).json({ error: "callback upstream unavailable" })
        );
    }
  );
  return app;
}

describe("Mojaloop callback simulated-Istio proxy integration", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MOJALOOP_CALLBACK_MTLS_SUBJECT_DN", SUBJECT);
    vi.stubEnv("MOJALOOP_CALLBACK_GATEWAY_ATTESTATION", ATTESTATION);
    vi.stubEnv(
      "MOJALOOP_CALLBACK_HMAC_SECRET",
      "local-only-test-secret-change-this-to-32-plus-random-characters"
    );
  });

  it("rejects a direct client pseudo-header and forwarded-IP spoof", async () => {
    const response = await request(backend())
      .put("/api/mojaloop/transfers/transfer-proxy-001")
      .set("content-type", "application/json")
      .set("x-ndsep-mtls-verified", "SUCCESS")
      .set("x-ndsep-mtls-subject", SUBJECT)
      .set("x-ndsep-mtls-gateway-attestation", "attacker-controlled-value")
      .set("x-forwarded-for", "10.0.0.1")
      .set("x-real-ip", "10.0.0.1")
      .send(payload);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: "Client certificate verification failed",
    });
  });

  it("rejects traffic at the proxy when no client certificate is presented", async () => {
    const response = await request(
      simulatedIngress({
        clientCertificateValid: false,
        injectTrustedHeaders: false,
      })
    )
      .put("/api/mojaloop/transfers/transfer-proxy-001")
      .set("content-type", "application/json")
      .send(payload);

    expect(response.status).toBe(495);
    expect(response.body).toEqual({
      error: "mTLS client certificate required",
    });
  });

  it("strips client headers and injects trusted identity after valid mTLS", async () => {
    const response = await request(
      simulatedIngress({
        clientCertificateValid: true,
        injectTrustedHeaders: true,
      })
    )
      .put("/api/mojaloop/transfers/transfer-proxy-001")
      .set("content-type", "application/json")
      .set("x-ndsep-mtls-verified", "FAILURE")
      .set("x-ndsep-mtls-subject", "CN=attacker,O=Unknown,C=NG")
      .set("x-forwarded-for", "203.0.113.99")
      .set("x-real-ip", "203.0.113.99")
      .set("x-mojaloop-event-id", "event-proxy-001")
      .set("x-mojaloop-signature", payloadSignature)
      .send(payload);

    // The proxy has passed the mTLS/header boundary; the backend then fails
    // closed at the next dependency boundary because no DB is configured.
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "Database unavailable" });
  });
});
