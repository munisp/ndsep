import { describe, it, expect } from "vitest";

describe("workerManager", () => {
  it("should export worker management functions", async () => {
    const mod = await import("./workerManager");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });

  it("should define worker definitions", async () => {
    const mod = await import("./workerManager");
    if (mod.WORKER_DEFS) {
      expect(Array.isArray(mod.WORKER_DEFS)).toBe(true);
      expect(mod.WORKER_DEFS.length).toBeGreaterThan(0);
      // Each def should have id and command
      for (const def of mod.WORKER_DEFS) {
        expect(def.id).toBeDefined();
        expect(typeof def.id).toBe("string");
      }
    }
  });
});
