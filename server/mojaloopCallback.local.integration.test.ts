import express from "express";
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

const payload = Buffer.from(
  JSON.stringify({
    transferId: "transfer-local-001",
    transferState: "COMMITTED",
  })
);

function appForProduction() {
  const app = express();
  registerMojaloopCallbacks(app);
  return app;
}

describe("Mojaloop callback local ingress-header integration", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "MOJALOOP_CALLBACK_MTLS_SUBJECT_DN",
      "CN=local-provider,O=NDSEP Test,C=NG"
    );
    vi.stubEnv(
      "MOJALOOP_CALLBACK_HMAC_SECRET",
      "local-only-test-secret-change-this-to-32-plus-random-characters"
    );
    vi.stubEnv(
      "MOJALOOP_CALLBACK_GATEWAY_ATTESTATION",
      "local-only-gateway-attestation-change-this-to-32-plus-random-characters"
    );
  });

  it("rejects a callback when ingress supplies no verified identity", async () => {
    const response = await request(appForProduction())
      .put("/api/mojaloop/transfers/transfer-local-001")
      .set("content-type", "application/json")
      .send(payload);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: "Client certificate verification failed",
    });
  });

  it("rejects client-supplied pseudo mTLS headers without a gateway trust boundary", async () => {
    const response = await request(appForProduction())
      .put("/api/mojaloop/transfers/transfer-local-001")
      .set("content-type", "application/json")
      .set("x-ndsep-mtls-verified", "SUCCESS")
      .set("x-ndsep-mtls-subject", "CN=local-provider,O=NDSEP Test,C=NG")
      .set("x-forwarded-for", "127.0.0.1")
      .set("x-real-ip", "127.0.0.1")
      .send(payload);

    // The caller supplied identity headers but not the secret-backed gateway
    // attestation. They must fail before body parsing, HMAC, or database access.
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: "Client certificate verification failed",
    });
  });

  it("rejects a certificate subject outside the configured allowlist", async () => {
    const response = await request(appForProduction())
      .put("/api/mojaloop/transfers/transfer-local-001")
      .set("content-type", "application/json")
      .set("x-ndsep-mtls-verified", "SUCCESS")
      .set("x-ndsep-mtls-subject", "CN=attacker,O=Unknown,C=NG")
      .send(payload);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: "Client certificate verification failed",
    });
  });
});
