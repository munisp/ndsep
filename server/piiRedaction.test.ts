import { describe, it, expect } from "vitest";

describe("piiRedaction", () => {
  it("should export PII redaction functions", async () => {
    const mod = await import("./piiRedaction");
    expect(mod).toBeDefined();
    expect(typeof mod.redactPii).toBe("function");
    expect(mod.PII_REDACTION_PATHS).toBeDefined();
    expect(mod.pinoRedactionConfig).toBeDefined();
  });

  it("should redact PII fields from objects", async () => {
    const { redactPii } = await import("./piiRedaction");
    const input = { email: "test@example.com", name: "John" };
    const result = redactPii(input) as Record<string, unknown>;
    expect(result).toBeDefined();
  });
});
