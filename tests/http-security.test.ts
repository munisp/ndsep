import { describe, expect, it } from "vitest";
import { fallbackApiRateLimit } from "../server/httpSecurity";

describe("application fallback rate limiting", () => {
  it("rejects a client after its bounded window quota", () => {
    const now = Date.now();
    expect(fallbackApiRateLimit({ remoteAddress: "203.0.113.90", now, limit: 2, windowMs: 60_000 }).allowed).toBe(true);
    expect(fallbackApiRateLimit({ remoteAddress: "203.0.113.90", now: now + 1, limit: 2, windowMs: 60_000 }).allowed).toBe(true);
    expect(fallbackApiRateLimit({ remoteAddress: "203.0.113.90", now: now + 2, limit: 2, windowMs: 60_000 }).allowed).toBe(false);
  });
});
