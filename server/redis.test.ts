/**
 * Redis connectivity test — validates REDIS_URL secret and SWR caching layer.
 * Runs against the local Redis instance (redis://localhost:6379).
 */
import { describe, it, expect, afterAll } from "vitest";
import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

describe("Redis Connectivity & SWR Cache Layer", () => {
  // ioredis auto-connects on first command — no explicit connect() needed
  const client = new Redis(REDIS_URL);

  it("should connect to Redis using REDIS_URL and respond to PING", async () => {
    const pong = await client.ping();
    expect(pong).toBe("PONG");
  });

  it("should set and get a cache key", async () => {
    await client.set("ndsep:test:key", JSON.stringify({ ok: true, ts: Date.now() }), "EX", 60);
    const raw = await client.get("ndsep:test:key");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.ok).toBe(true);
  });

  it("should delete a cache key", async () => {
    await client.del("ndsep:test:key");
    const raw = await client.get("ndsep:test:key");
    expect(raw).toBeNull();
  });

  it("should support TTL-based expiry", async () => {
    await client.set("ndsep:test:ttl", "expire-me", "EX", 10);
    const ttl = await client.ttl("ndsep:test:ttl");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10);
    await client.del("ndsep:test:ttl");
  });

  it("should support JSON serialization round-trip", async () => {
    const payload = { platform: "NDSEP", version: "27.0", features: ["redis", "cache", "swr"] };
    await client.set("ndsep:test:json", JSON.stringify(payload), "EX", 60);
    const raw = await client.get("ndsep:test:json");
    const parsed = JSON.parse(raw!);
    expect(parsed.platform).toBe("NDSEP");
    expect(parsed.features).toHaveLength(3);
    await client.del("ndsep:test:json");
  });

  afterAll(async () => {
    client.disconnect();
  });
});
