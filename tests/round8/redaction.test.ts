/**
 * Round 8 — redaction rules engine tests (pure logic, no DB)
 * PII pattern redaction incl. Nigerian phone / BVN / NIN / NUBAN formats,
 * minor-protection initials, investigation-sensitive material, and map
 * separation guarantees.
 */
import { describe, it, expect } from "vitest";
import {
  redactPii,
  redactMinorNames,
  applyRedactionRules,
  toInitials,
} from "../../server/services/redaction";

describe("redactPii — email", () => {
  it("redacts email addresses and records them in the map", () => {
    const { redacted, map, rulesApplied } = redactPii("Contact the DPO at jane.doe@acme.ng for details.");
    expect(redacted).not.toContain("jane.doe@acme.ng");
    expect(redacted).toContain("[REDACTED:EMAIL#1]");
    expect(map).toHaveLength(1);
    expect(map[0]).toMatchObject({ type: "email", original: "jane.doe@acme.ng" });
    expect(rulesApplied).toContain("email");
  });
});

describe("redactPii — Nigerian phone formats", () => {
  it.each([
    ["08031234567", "local 0-prefix mobile"],
    ["07012345678", "local 070 mobile"],
    ["09123456789", "local 091 mobile"],
    ["+2348031234567", "+234 prefix"],
    ["+234 803 123 4567", "+234 with spaces"],
    ["234-803-123-4567", "234 with dashes"],
  ])("redacts %s (%s)", (phone) => {
    const { redacted, map } = redactPii(`Call ${phone} now.`);
    expect(redacted).not.toContain(phone.replace(/[\s-]/g, ""));
    expect(redacted).not.toContain(phone);
    expect(map.some((e) => e.type === "phone")).toBe(true);
  });

  it("redacts generic international numbers", () => {
    const { redacted, map } = redactPii("Dial +44 20 7946 0958 for the London office.");
    expect(redacted).not.toContain("7946");
    expect(map.some((e) => e.type === "phone")).toBe(true);
  });
});

describe("redactPii — BVN / NIN (11-digit identifiers)", () => {
  it("redacts a BVN with keyword context", () => {
    const { redacted, map } = redactPii("The complainant's BVN: 22145678901 was compromised.");
    expect(redacted).not.toContain("22145678901");
    expect(map.some((e) => e.type === "bvn_nin" && e.original === "22145678901")).toBe(true);
  });

  it("redacts an NIN with keyword context", () => {
    const { redacted, map } = redactPii("NIN 12345678901 appeared in the leaked dump.");
    expect(redacted).not.toContain("12345678901");
    expect(map.some((e) => e.type === "bvn_nin")).toBe(true);
  });

  it("redacts a bare 11-digit run (regulatory documents: overwhelmingly BVN/NIN)", () => {
    const { redacted, map } = redactPii("Identifier 98765432109 found in export.");
    expect(redacted).not.toContain("98765432109");
    expect(map.some((e) => e.type === "bvn_nin")).toBe(true);
  });
});

describe("redactPii — bank account numbers (10-digit NUBAN, context-gated)", () => {
  it("redacts a 10-digit account number with account context", () => {
    const { redacted, map } = redactPii("Refund was paid into account no. 0123456789 at Zenith Bank.");
    expect(redacted).not.toContain("0123456789");
    expect(map.some((e) => e.type === "account_number" && e.original === "0123456789")).toBe(true);
  });

  it("does NOT redact a bare 10-digit number without account context", () => {
    const { redacted } = redactPii("Reference 0123456789 relates to the gazette.");
    expect(redacted).toContain("0123456789");
  });
});

describe("redactPii — no false positives on clean regulatory text", () => {
  it("leaves NDPA citations, dates and short numbers intact", () => {
    const text =
      "Pursuant to NDPA 2023 s.48(2), the Commission issued Final Order NDPC/2024/042 on 12 March 2024 imposing a fine of N25,000,000.";
    const { redacted, map } = redactPii(text);
    expect(redacted).toBe(text);
    expect(map).toHaveLength(0);
  });
});

describe("minor protection — initials substitution", () => {
  it("toInitials converts full names", () => {
    expect(toInitials("Adaeze Okafor")).toBe("A.O.");
    expect(toInitials("Chinedu Musa Bello")).toBe("C.M.B.");
  });

  it("replaces listed minor names case-insensitively with word boundaries", () => {
    const { redacted, applied } = redactMinorNames(
      "The data subject, Adaeze Okafor, is 14. ADAEZE OKAFOR's school raised the complaint. Okafor alone is not enough.",
      ["Adaeze Okafor"]
    );
    expect(redacted).not.toMatch(/adaeze okafor/i);
    expect(redacted).toContain("A.O.");
    // Partial-name text ("Okafor alone") must survive — only full-name matches are replaced.
    expect(redacted).toContain("Okafor alone is not enough");
    expect(applied).toEqual([{ name: "Adaeze Okafor", initials: "A.O." }]);
  });
});

describe("applyRedactionRules — full pipeline", () => {
  it("applies PII + minor protection + investigation-sensitive rules and separates the map", () => {
    const raw =
      "Informant: Ngozi Eze reported that controller staff emailed bvn 22145678901 to dpo@fintech.ng from 08031234567. Minor Tunde Balogun was affected.";
    const result = applyRedactionRules(raw, {
      minorNames: ["Tunde Balogun"],
      investigationSensitive: true,
    });
    // No PII survives in the redacted text
    expect(result.redacted).not.toContain("22145678901");
    expect(result.redacted).not.toContain("dpo@fintech.ng");
    expect(result.redacted).not.toContain("08031234567");
    expect(result.redacted).not.toContain("Tunde Balogun");
    expect(result.redacted).toContain("T.B.");
    expect(result.redacted).not.toContain("Ngozi Eze");
    // Map holds the originals — stored separately from the redacted text
    const originals = result.map.map((e) => e.original);
    expect(originals).toContain("22145678901");
    expect(originals).toContain("dpo@fintech.ng");
    expect(originals).toContain("Tunde Balogun");
    expect(originals).toContain("Ngozi Eze");
    expect(result.rulesApplied).toEqual(
      expect.arrayContaining(["email", "phone_ng_intl", "bvn_nin", "minor_protection", "investigation_sensitive"])
    );
    expect(result.minorNamesApplied).toHaveLength(1);
    expect(result.investigationSensitiveApplied).toBe(true);
  });

  it("skips investigation-sensitive pass when the flag is false", () => {
    const raw = "Informant: Ngozi Eze gave a statement.";
    const result = applyRedactionRules(raw, { investigationSensitive: false });
    expect(result.redacted).toContain("Ngozi Eze");
    expect(result.investigationSensitiveApplied).toBe(false);
  });

  it("map tokens are unique and positional", () => {
    const result = redactPii("a@x.com then b@y.com then c@z.com");
    const tokens = result.map.map((e) => e.token);
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(tokens).toEqual(["[REDACTED:EMAIL#1]", "[REDACTED:EMAIL#2]", "[REDACTED:EMAIL#3]"]);
  });
});
