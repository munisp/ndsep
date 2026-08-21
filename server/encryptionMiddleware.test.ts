import { describe, it, expect } from "vitest";

describe("encryptionMiddleware", () => {
  it("should export encryption middleware", async () => {
    const mod = await import("./encryptionMiddleware");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });
});
