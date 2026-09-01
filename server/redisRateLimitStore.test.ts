import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

function restoreEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  vi.resetModules();
}

afterEach(restoreEnvironment);

describe("Redis rate-limit store configuration", () => {
  it("uses express-rate-limit's isolated memory store only in explicit test execution", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.REDIS_URL;
    const module = await import("./redisRateLimitStore");
    expect(module.redisRateLimitStore("ndsep:test:")).toBeUndefined();
  });

  it("rejects a non-test runtime without an explicit Redis endpoint", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.APP_ENV;
    delete process.env.REDIS_URL;
    await expect(import("./redisRateLimitStore")).rejects.toThrow("REDIS_URL is required for non-test rate limiting");
  });

  it("rejects production rate limiting without certificate-validated rediss configuration", async () => {
    process.env.NODE_ENV = "production";
    process.env.REDIS_URL = "redis://cache.internal:6379";
    process.env.REDIS_TLS = "false";
    await expect(import("./redisRateLimitStore")).rejects.toThrow("Production rate limiting requires REDIS_URL to use rediss://");
  });
});
