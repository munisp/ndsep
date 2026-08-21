import { describe, it, expect } from "vitest";

describe("csrf", () => {
  it("should export csrf middleware functions", async () => {
    const csrf = await import("./csrf");
    expect(csrf.csrfCookieMiddleware).toBeDefined();
    expect(typeof csrf.csrfCookieMiddleware).toBe("function");
    expect(csrf.csrfValidationMiddleware).toBeDefined();
    expect(typeof csrf.csrfValidationMiddleware).toBe("function");
  });
});
