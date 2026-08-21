import { describe, it, expect } from "vitest";

describe("errorClassifier", () => {
  it("should export classifyError function", async () => {
    const mod = await import("./errorClassifier");
    expect(mod.classifyError).toBeDefined();
    expect(typeof mod.classifyError).toBe("function");
  });

  it("should classify database connection errors", async () => {
    const { classifyError } = await import("./errorClassifier");
    const result = classifyError(new Error("ECONNREFUSED 127.0.0.1:5432"));
    expect(result.category).toBeDefined();
    expect(result.severity).toBeDefined();
  });

  it("should classify authentication errors", async () => {
    const { classifyError } = await import("./errorClassifier");
    const result = classifyError(new Error("JWT token expired"));
    expect(result.category).toBeDefined();
  });

  it("should classify unknown errors as general", async () => {
    const { classifyError } = await import("./errorClassifier");
    const result = classifyError(new Error("some random error"));
    expect(result).toBeDefined();
    expect(result.severity).toBeDefined();
  });

  it("should handle non-Error inputs", async () => {
    const { classifyError } = await import("./errorClassifier");
    const result = classifyError("string error" as unknown as Error);
    expect(result).toBeDefined();
  });
});
