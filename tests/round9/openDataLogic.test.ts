import { describe, it, expect } from "vitest";
import { kAnonymize, toCsv, accessorHash, bumpDatasetVersion, SUPPRESSED } from "../../server/services/openDataLogic";

describe("kAnonymize (k=5)", () => {
  const rows = [
    { category: "breach", state: "Lagos", month: "2026-01", count: 10 },
    { category: "consent", state: "Kano", month: "2026-01", count: 3 },
    { category: "other", state: "Oyo", month: "2026-01", count: 0 },
  ];
  it("suppresses cells with 0 < count < 5", () => {
    const out = kAnonymize(rows);
    expect(out[0].count).toBe(10);
    expect(out[1].count).toBe(SUPPRESSED);
    expect(out[2].count).toBe(0);
  });
  it("respects custom k and does not mutate input", () => {
    const out = kAnonymize(rows, 2);
    expect(out[1].count).toBe(3);
    expect(rows[1].count).toBe(3);
  });
  it("suppresses count exactly below k but keeps count == k", () => {
    const out = kAnonymize([{ category: "x", state: "s", month: "m", count: 5 }]);
    expect(out[0].count).toBe(5);
    expect(kAnonymize([{ category: "x", state: "s", month: "m", count: 4 }])[0].count).toBe(SUPPRESSED);
  });
});

describe("toCsv", () => {
  it("quotes values containing commas, quotes and newlines", () => {
    const csv = toCsv([{ a: "x,y", b: 'he said "hi"', c: null }], ["a", "b", "c"]);
    expect(csv).toBe('a,b,c\r\n"x,y","he said ""hi""",');
  });
  it("empty rows still produce header when given", () => {
    expect(toCsv([], ["a"])).toBe("a");
  });
});

describe("accessorHash", () => {
  it("is deterministic and salted", () => {
    expect(accessorHash("1.2.3.4", "s")).toBe(accessorHash("1.2.3.4", "s"));
    expect(accessorHash("1.2.3.4", "s")).not.toBe(accessorHash("1.2.3.4", "other"));
  });
  it("returns null for empty accessor and never returns raw input", () => {
    expect(accessorHash(null)).toBeNull();
    expect(accessorHash("1.2.3.4", "s")).not.toContain("1.2.3.4");
    expect(accessorHash("1.2.3.4", "s")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("bumpDatasetVersion", () => {
  it("appends changelog entry and increments version", () => {
    const next = bumpDatasetVersion({ version: 1, changelog: [] }, "admin", "initial refresh", new Date("2026-02-01T00:00:00Z"));
    expect(next.version).toBe(2);
    expect(next.changelog).toHaveLength(1);
    expect(next.changelog[0]).toMatchObject({ version: 2, changed_by: "admin", note: "initial refresh" });
  });
});
