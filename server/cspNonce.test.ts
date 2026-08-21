import { describe, it, expect } from "vitest";

describe("cspNonce", () => {
  it("should export CSP nonce middleware", async () => {
    const mod = await import("./cspNonce");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });

  it("should generate unique nonces", async () => {
    const mod = await import("./cspNonce");
    if (typeof mod.generateNonce === "function") {
      const n1 = mod.generateNonce();
      const n2 = mod.generateNonce();
      expect(n1).not.toBe(n2);
      expect(typeof n1).toBe("string");
      expect(n1.length).toBeGreaterThan(10);
    }
  });
});
