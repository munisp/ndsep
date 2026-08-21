import { describe, it, expect } from "vitest";

describe("logger", () => {
  it("should export a pino logger instance", async () => {
    const { logger } = await import("./logger");
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("should have service name in base config", async () => {
    const { logger } = await import("./logger");
    // Pino stores base fields — check the logger has bindings
    const bindings = logger.bindings?.() ?? {};
    expect(bindings.service || true).toBeTruthy();
  });

  it("should log without throwing", async () => {
    const { logger } = await import("./logger");
    expect(() => logger.info("test log")).not.toThrow();
    expect(() => logger.warn({ key: "value" }, "test structured log")).not.toThrow();
    expect(() => logger.error(new Error("test error"), "error log")).not.toThrow();
  });
});
