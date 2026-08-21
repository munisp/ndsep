import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("envValidation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should not throw in development mode with dev defaults", async () => {
    process.env.NODE_ENV = "development";
    process.env.JWT_SECRET = "dev-secret";
    process.env.FIELD_ENCRYPTION_KEY = "0000000000000000000000000000000000000000000000000000000000000000";

    const { validateEnvironment } = await import("./envValidation");
    expect(() => validateEnvironment()).not.toThrow();
  });

  it("should throw in production mode with insecure JWT_SECRET", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "dev-secret";
    process.env.DATABASE_URL = "postgresql://real-server:5432/ndsep_db";
    process.env.FIELD_ENCRYPTION_KEY = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    const { validateEnvironment } = await import("./envValidation");
    expect(() => validateEnvironment()).toThrow(/FATAL/);
  });

  it("should throw in production when DATABASE_URL is empty", async () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "";
    process.env.JWT_SECRET = "a-secure-secret-that-is-at-least-32-chars-long";
    process.env.FIELD_ENCRYPTION_KEY = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    const { validateEnvironment } = await import("./envValidation");
    expect(() => validateEnvironment()).toThrow(/FATAL/);
  });

  it("should warn about sector API keys in dev mode", async () => {
    process.env.NODE_ENV = "development";
    process.env.NCC_API_KEY = "";
    process.env.NHIA_API_KEY = "";

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { validateEnvironment } = await import("./envValidation");
    validateEnvironment();
    consoleSpy.mockRestore();
  });
});
