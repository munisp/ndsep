import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateEnvironment } from "./envValidation";

const managedKeys = [
  "NODE_ENV",
  "JWT_SECRET",
  "FIELD_ENCRYPTION_KEY",
  "TERMII_API_KEY",
  "NDPC_PHONE_NUMBER",
  "API_KEY_SALT",
  "WEBHOOK_SIGNING_SECRET",
  "APISIX_ADMIN_KEY",
  "DATABASE_URL",
  "REDIS_URL",
  "WORKER_EVENT_HMAC_SECRET",
  "CORS_ORIGINS",
  "LAKEHOUSE_ENABLED",
  "LAKEHOUSE_CATALOG_URL",
  "LAKEHOUSE_S3_ACCESS_KEY",
  "LAKEHOUSE_S3_SECRET_KEY",
  "PERMIFY_ENABLED",
  "PERMIFY_URL",
  "PERMIFY_AUTH_TOKEN",
] as const;

const savedEnvironment = Object.fromEntries(
  managedKeys.map(key => [key, process.env[key]])
);
const root = resolve(import.meta.dirname, "..");

function applyProductionEnvironment(
  overrides: Record<string, string | undefined> = {}
) {
  const environment: Record<string, string> = {
    NODE_ENV: "production",
    JWT_SECRET: "j".repeat(32),
    FIELD_ENCRYPTION_KEY: "a".repeat(64),
    TERMII_API_KEY: "termii-production-api-key",
    NDPC_PHONE_NUMBER: "+2348012345679",
    API_KEY_SALT: "s".repeat(32),
    WEBHOOK_SIGNING_SECRET: "w".repeat(32),
    APISIX_ADMIN_KEY: "k".repeat(32),
    DATABASE_URL: "postgresql://ndsep@db.internal/ndsep",
    REDIS_URL: "rediss://cache.internal:6380",
    WORKER_EVENT_HMAC_SECRET: "h".repeat(32),
    CORS_ORIGINS: "https://ndsep.operations.gov.ng",
    LAKEHOUSE_ENABLED: "false",
    PERMIFY_ENABLED: "false",
  };
  for (const key of managedKeys) {
    const value = overrides[key] ?? environment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const key of managedKeys) {
    const value = savedEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("production environment hardening", () => {
  it("accepts a complete production baseline without contacting external services", () => {
    applyProductionEnvironment();
    expect(() => validateEnvironment()).not.toThrow();
  });

  it("rejects browser origins that are plaintext, local, credentialed, or path-bearing", () => {
    for (const origin of [
      "http://ndsep.operations.gov.ng",
      "https://localhost:3000",
      "https://user:pass@ndsep.operations.gov.ng",
      "https://ndsep.operations.gov.ng/api",
    ]) {
      applyProductionEnvironment({ CORS_ORIGINS: origin });
      expect(() => validateEnvironment()).toThrow(
        /CORS_ORIGINS: production origins must be explicit HTTPS origins/
      );
    }
  });

  it("rejects weak or absent signing material instead of accepting application defaults", () => {
    applyProductionEnvironment({
      API_KEY_SALT: "short",
      WEBHOOK_SIGNING_SECRET: "ndsep_webhook_signing_secret_2026_default",
    });
    expect(() => validateEnvironment()).toThrow(
      /API_KEY_SALT: API key hashing salt[\s\S]*WEBHOOK_SIGNING_SECRET: Webhook signature key/
    );
  });

  it("does not retain known development credentials in active runtime or worker-launch code", () => {
    const files = [
      "server/_core/env.ts",
      "server/workerManager.ts",
      "orchestration/python/dpco_analytics/service.py",
    ];
    const source = files
      .map(file => readFileSync(resolve(root, file), "utf8"))
      .join("\n");
    for (const insecureValue of [
      '"minioadmin"',
      '"TLtest_default_key_ndsep_2026"',
      '"ndsep_api_key_salt_2026_production_default"',
      '"ndsep_webhook_signing_secret_2026_default"',
      '"demo-ofac-key"',
      '"demo-nibss-key"',
      '"demo-cbn-key"',
    ]) {
      expect(source).not.toContain(insecureValue);
    }
  });

  it("keeps credential-dependent Lakehouse and SMS integrations disabled until explicitly enabled", () => {
    const environmentSource = readFileSync(
      resolve(root, "server/_core/env.ts"),
      "utf8"
    );
    const managerSource = readFileSync(
      resolve(root, "server/workerManager.ts"),
      "utf8"
    );
    const analyticsSource = readFileSync(
      resolve(root, "orchestration/python/dpco_analytics/service.py"),
      "utf8"
    );
    expect(environmentSource).toContain(
      'lakehouseEnabled: process.env.LAKEHOUSE_ENABLED === "true"'
    );
    expect(environmentSource).toContain(
      'termiiEnabled: process.env.TERMII_ENABLED === "true"'
    );
    expect(managerSource).toMatch(
      /LAKEHOUSE_ENABLED:\s*process\.env\.LAKEHOUSE_ENABLED === "true" \? "true" : "false"/
    );
    expect(analyticsSource).toContain(
      'LAKEHOUSE_ENABLED = os.getenv("LAKEHOUSE_ENABLED", "false").lower() == "true"'
    );
  });

  it("requires HTTPS catalog and non-default credentials when the lakehouse is enabled", () => {
    applyProductionEnvironment({
      LAKEHOUSE_ENABLED: "true",
      LAKEHOUSE_CATALOG_URL: "http://lakehouse.internal:8181",
      LAKEHOUSE_S3_ACCESS_KEY: "minioadmin",
      LAKEHOUSE_S3_SECRET_KEY: "minioadmin",
    });
    expect(() => validateEnvironment()).toThrow(
      /LAKEHOUSE_CATALOG_URL[\s\S]*LAKEHOUSE_S3_ACCESS_KEY[\s\S]*LAKEHOUSE_S3_SECRET_KEY/
    );
  });
});
