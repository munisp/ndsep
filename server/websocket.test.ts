import { describe, it, expect } from "vitest";

describe("websocket", () => {
  it("should export websocket broadcast function", async () => {
    const mod = await import("./websocket");
    expect(mod).toBeDefined();
    expect(typeof mod.broadcast === "function").toBe(true);
  });
});
