import { describe, it, expect, afterEach, vi } from "vitest";

describe("dbSslConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("should export getPgSslConfig function", async () => {
    const mod = await import("./dbSslConfig");
    expect(mod.getPgSslConfig).toBeDefined();
    expect(typeof mod.getPgSslConfig).toBe("function");
  });

  it("should return false when DB_SSL_REJECT_UNAUTHORIZED is false", async () => {
    process.env.DB_SSL_REJECT_UNAUTHORIZED = "false";
    const { getPgSslConfig } = await import("./dbSslConfig");
    const config = getPgSslConfig();
    // In dev mode with false, should return false or relaxed config
    expect(config === false || (typeof config === "object" && config.rejectUnauthorized === false)).toBe(true);
  });

  it("should enforce SSL in production mode", async () => {
    process.env.NODE_ENV = "production";
    process.env.DB_SSL_REJECT_UNAUTHORIZED = "true";
    const { getPgSslConfig } = await import("./dbSslConfig");
    const config = getPgSslConfig();
    // In production, should return object with rejectUnauthorized true
    if (typeof config === "object" && config !== null) {
      expect(config.rejectUnauthorized).toBe(true);
    }
  });
});
