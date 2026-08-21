import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function setProductionSecurityBaseline(): void {
  process.env.NODE_ENV = "production";
  process.env.JWT_SECRET = "a".repeat(48);
  process.env.FIELD_ENCRYPTION_KEY = "a".repeat(64);
  process.env.TERMII_API_KEY = "termii-real-secret";
  process.env.NDPC_PHONE_NUMBER = "+2348099999999";
  process.env.API_KEY_SALT = "a".repeat(48);
  process.env.WEBHOOK_SIGNING_SECRET = "a".repeat(48);
  process.env.MOJALOOP_CALLBACK_HMAC_SECRET = "a".repeat(48);
  process.env.MOJALOOP_CALLBACK_MTLS_SUBJECT_DN =
    "CN=mojaloop-production-client,O=Approved DFSP,C=NG";
  process.env.MOJALOOP_CALLBACK_GATEWAY_ATTESTATION = "a".repeat(48);
  process.env.FINANCIAL_OUTBOX_DISPATCHER_ENABLED = "true";
  process.env.APISIX_ADMIN_KEY = "a".repeat(48);
  process.env.DATABASE_URL =
    "postgresql://real-user:real-password@db.example.test:5432/ndsep";
}

describe("production Mojaloop mTLS environment startup gates", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    setProductionSecurityBaseline();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("fails startup when the callback HMAC secret is absent", async () => {
    delete process.env.MOJALOOP_CALLBACK_HMAC_SECRET;
    const { validateEnvironment } = await import("./envValidation");

    expect(() => validateEnvironment()).toThrow(
      /MOJALOOP_CALLBACK_HMAC_SECRET/
    );
  });

  it("fails startup when the subject-DN allowlist is absent", async () => {
    delete process.env.MOJALOOP_CALLBACK_MTLS_SUBJECT_DN;
    const { validateEnvironment } = await import("./envValidation");

    expect(() => validateEnvironment()).toThrow(
      /MOJALOOP_CALLBACK_MTLS_SUBJECT_DN/
    );
  });

  it("fails startup when the gateway attestation is absent", async () => {
    delete process.env.MOJALOOP_CALLBACK_GATEWAY_ATTESTATION;
    const { validateEnvironment } = await import("./envValidation");

    expect(() => validateEnvironment()).toThrow(
      /MOJALOOP_CALLBACK_GATEWAY_ATTESTATION/
    );
  });

  it("passes when all production callback security values are configured", async () => {
    const { validateEnvironment } = await import("./envValidation");

    expect(() => validateEnvironment()).not.toThrow();
  });
});
