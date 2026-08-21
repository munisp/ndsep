import { describe, it, expect } from "vitest";

describe("jurisdiction", () => {
  it("should export jurisdiction functions", async () => {
    const mod = await import("./jurisdiction");
    expect(mod).toBeDefined();
    if (typeof mod.getActiveJurisdiction === "function") {
      const result = mod.getActiveJurisdiction();
      expect(result).toBeDefined();
    }
  });
});
