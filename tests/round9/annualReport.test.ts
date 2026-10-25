import { describe, it, expect } from "vitest";
import {
  median,
  round2,
  daysBetween,
  buildReportPayload,
  renderMarkdown,
  payloadHash,
  type ReportInputs,
} from "../../server/services/annualReportLogic";

describe("helpers", () => {
  it("median of odd/even/empty", () => {
    expect(median([1, 5, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it("round2 handles null and NaN", () => {
    expect(round2(1.006)).toBe(1.01);
    expect(round2(1.004)).toBe(1);
    expect(round2(null)).toBeNull();
    expect(round2(NaN)).toBeNull();
  });
  it("daysBetween", () => {
    expect(daysBetween("2026-01-01T00:00:00Z", "2026-01-11T00:00:00Z")).toBe(10);
    expect(daysBetween(null, "2026-01-01")).toBeNull();
  });
});

const fixture: ReportInputs = {
  year: 2026,
  complaints: [
    { category: "breach", received_at: "2026-01-01T00:00:00Z", resolved_at: "2026-01-11T00:00:00Z" },
    { category: "breach", received_at: "2026-01-01T00:00:00Z", resolved_at: "2026-01-21T00:00:00Z" },
    { category: "consent", received_at: "2026-02-01T00:00:00Z", resolved_at: null }, // unresolved: excluded
  ],
  cases: [
    { id: 1, status: "closed", opened_at: "2026-01-01T00:00:00Z", closed_at: "2026-03-02T00:00:00Z", organization_id: 10 },
    { id: 2, status: "closed", opened_at: "2026-02-01T00:00:00Z", closed_at: "2026-03-03T00:00:00Z", organization_id: 10 },
    { id: 3, status: "open", opened_at: "2026-02-15T00:00:00Z", closed_at: null, organization_id: 11 },
  ],
  fines: [
    { id: 1, org_id: 10, amount: "1000000", amount_paid: "1000000", status: "paid", issued_at: "2026-03-05T00:00:00Z" },
    { id: 2, org_id: 11, amount: "2000000", amount_paid: "500000", status: "partial", issued_at: "2026-03-10T00:00:00Z" },
  ],
  instalments: [
    { status: "paid", due_date: "2026-04-01T00:00:00Z", paid_at: "2026-03-30T00:00:00Z", amount: "250000", amount_paid: "250000" },
    { status: "paid", due_date: "2026-04-01T00:00:00Z", paid_at: "2026-04-05T00:00:00Z", amount: "250000", amount_paid: "250000" },
    { status: "overdue", due_date: "2026-05-01T00:00:00Z", paid_at: null, amount: "250000", amount_paid: "0" },
  ],
  settlements: [
    { status: "fulfilled" },
    { status: "fulfilled" },
    { status: "defaulted" },
    { status: "active" },
  ],
  sectors: [
    { sector: "banking", cases: 2, fines_imposed: "3000000", fines_collected: "1500000" },
    { sector: "telecom", cases: 1, fines_imposed: "0", fines_collected: "0" },
  ],
};

describe("buildReportPayload", () => {
  const p = buildReportPayload(fixture) as any;

  it("frames the statute (NDPA s.5/s.6)", () => {
    expect(p.report_year).toBe(2026);
    expect(p.legal_frame.statute).toContain("Nigeria Data Protection Act 2023");
    expect(p.legal_frame.sections.join(" ")).toMatch(/s\.5/);
    expect(p.legal_frame.sections.join(" ")).toMatch(/s\.6/);
  });

  it("computes complaint time-to-resolution per category (unresolved excluded)", () => {
    expect(p.time_to_resolution.complaints_by_category).toEqual([
      { category: "breach", resolved_count: 2, avg_days: 15, median_days: 15 },
    ]);
  });

  it("computes enforcement case resolution", () => {
    expect(p.time_to_resolution.enforcement_cases.closed_count).toBe(2);
    expect(p.time_to_resolution.enforcement_cases.avg_days).toBe(45);
  });

  it("computes deterrence metrics", () => {
    expect(p.deterrence.organizations_with_cases).toBe(2);
    expect(p.deterrence.repeat_offenders).toBe(1);
    expect(p.deterrence.repeat_offender_rate).toBe(0.5);
    expect(p.deterrence.remediation_compliance_rate).toBe(round2(2 / 3));
  });

  it("computes penalty collection + instalment performance", () => {
    expect(p.penalties.imposed_total).toBe(3000000);
    expect(p.penalties.collected_total).toBe(1500000);
    expect(p.penalties.collection_rate).toBe(0.5);
    expect(p.penalties.instalments).toMatchObject({ paid: 2, overdue: 1, paid_on_time_rate: 0.5 });
  });

  it("sorts sectors by case count", () => {
    expect(p.sectors.map((s: any) => s.sector)).toEqual(["banking", "telecom"]);
  });

  it("is deterministic (same input => same payload + hash)", () => {
    const p2 = buildReportPayload(fixture);
    expect(payloadHash(p2)).toBe(payloadHash(p));
  });
});

describe("renderMarkdown", () => {
  it("renders deterministic markdown with statutory framing and sections", () => {
    const p = buildReportPayload(fixture);
    const md = renderMarkdown(p);
    expect(md).toContain("# NDPC Annual Enforcement Report — 2026");
    expect(md).toContain("s.5");
    expect(md).toContain("| breach | 2 | 15 | 15 |");
    expect(md).toContain("Repeat offenders: 1 (rate 0.5)");
    expect(md).toContain("| banking | 2 | 3000000 | 1500000 |");
    // deterministic
    expect(renderMarkdown(buildReportPayload(fixture))).toBe(md);
  });
});
