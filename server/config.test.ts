import { describe, it, expect } from "vitest";

describe("config", () => {
  it("should export configuration", async () => {
    const mod = await import("./config");
    expect(mod).toBeDefined();
  });
});
