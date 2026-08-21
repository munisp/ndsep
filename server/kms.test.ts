import { describe, it, expect, beforeAll } from "vitest";

describe("kms", () => {
  beforeAll(() => {
    process.env.KMS_PROVIDER = "local";
    process.env.FIELD_ENCRYPTION_KEY = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  });

  it("should export KMS functions", async () => {
    const mod = await import("./kms");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });

  it("should encrypt data with local provider", async () => {
    const mod = await import("./kms");
    if (typeof mod.kmsEncrypt === "function") {
      const result = await mod.kmsEncrypt("test-data");
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
      expect(result).not.toBe("test-data");
    }
  });

  it("should decrypt data round-trip with local provider", async () => {
    const mod = await import("./kms");
    if (typeof mod.kmsEncrypt === "function" && typeof mod.kmsDecrypt === "function") {
      const encrypted = await mod.kmsEncrypt("round-trip-test");
      const decrypted = await mod.kmsDecrypt(encrypted);
      expect(decrypted).toBe("round-trip-test");
    }
  });
});
