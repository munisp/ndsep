/**
 * Round-9 tests: keyed-HMAC flows (FIX 4, 5, 10).
 *
 * subject_ref / NIN lookup hashes are KEYED HMACs with a mandatory env key
 * (fail-closed in production); dev fallbacks are deterministic and are NEVER
 * derived from DATABASE_URL or other deployment material.
 */
import { describe, it, expect } from "vitest";
import {
  hmacSha256Hex,
  sha256Hex,
  requireHmacKey,
  ipHashSalt,
} from "../../server/services/complaintLogic";

describe("hmacSha256Hex / sha256Hex", () => {
  it("is deterministic and key-sensitive", () => {
    expect(hmacSha256Hex("k1", "value")).toBe(hmacSha256Hex("k1", "value"));
    expect(hmacSha256Hex("k1", "value")).not.toBe(hmacSha256Hex("k2", "value"));
    expect(hmacSha256Hex("k1", "value")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sha256Hex matches the legacy unkeyed form", () => {
    expect(sha256Hex("NDPC-CMP-2026-000001")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });
});

describe("requireHmacKey (fail-closed in production)", () => {
  it("returns the env key when set (>=16 chars)", () => {
    const r = requireHmacKey("a-very-real-production-key", "SUBJECT_HMAC_KEY", { nodeEnv: "production" });
    expect(r).toEqual({ key: "a-very-real-production-key", mode: "env" });
  });

  it("FAILS CLOSED in production when the key is missing or too short", () => {
    expect(() => requireHmacKey(undefined, "NIN_HMAC_KEY", { nodeEnv: "production" })).toThrow(/NIN_HMAC_KEY/);
    expect(() => requireHmacKey("", "NIN_HMAC_KEY", { nodeEnv: "production" })).toThrow();
    expect(() => requireHmacKey("short", "SUBJECT_HMAC_KEY", { nodeEnv: "production" })).toThrow(/SUBJECT_HMAC_KEY/);
  });

  it("dev fallback is deterministic and NOT derived from DATABASE_URL", () => {
    const a = requireHmacKey(undefined, "NIN_HMAC_KEY", { nodeEnv: "development", devSeed: "nin-identity" });
    const b = requireHmacKey(undefined, "NIN_HMAC_KEY", { nodeEnv: "development", devSeed: "nin-identity" });
    expect(a.mode).toBe("dev-fallback");
    expect(a.key).toBe(b.key);
    // The fallback must be stable regardless of any DATABASE_URL in the env.
    const withDb = requireHmacKey(undefined, "NIN_HMAC_KEY", { nodeEnv: "development", devSeed: "nin-identity" });
    process.env.DATABASE_URL = "postgres://different-host/db";
    const withoutSameDb = requireHmacKey(undefined, "NIN_HMAC_KEY", { nodeEnv: "development", devSeed: "nin-identity" });
    delete process.env.DATABASE_URL;
    expect(withDb.key).toBe(withoutSameDb.key);
  });

  it("distinct dev seeds produce distinct fallback keys", () => {
    const a = requireHmacKey(undefined, "A", { nodeEnv: "development", devSeed: "seed-a" });
    const b = requireHmacKey(undefined, "B", { nodeEnv: "development", devSeed: "seed-b" });
    expect(a.key).not.toBe(b.key);
  });
});

describe("ipHashSalt (mandatory env salt)", () => {
  it("fails closed in production when unset", () => {
    expect(() => ipHashSalt(undefined, "production")).toThrow(/COMPLAINT_IP_HASH_SALT/);
    expect(() => ipHashSalt("short", "production")).toThrow();
  });

  it("uses the env salt when present", () => {
    expect(ipHashSalt("production-salt-123", "production")).toBe("production-salt-123");
  });

  it("dev fallback is explicit", () => {
    expect(ipHashSalt(undefined, "development")).toBe("ndsep-dev-only-ip-salt");
  });
});
