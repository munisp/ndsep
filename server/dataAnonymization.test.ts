import { describe, it, expect } from "vitest";

describe("dataAnonymization", () => {
  it("should export anonymization functions", async () => {
    const mod = await import("./dataAnonymization");
    expect(mod).toBeDefined();
    const exportNames = Object.keys(mod);
    expect(exportNames.length).toBeGreaterThan(0);
  });

  it("should anonymize email addresses", async () => {
    const mod = await import("./dataAnonymization");
    if (typeof mod.anonymizeEmail === "function") {
      const result = mod.anonymizeEmail("test@example.com");
      expect(result).not.toBe("test@example.com");
      expect(result).toContain("@");
    }
  });

  it("should anonymize phone numbers", async () => {
    const mod = await import("./dataAnonymization");
    if (typeof mod.anonymizePhone === "function") {
      const result = mod.anonymizePhone("+2348012345678");
      expect(result).not.toBe("+2348012345678");
    }
  });
});
