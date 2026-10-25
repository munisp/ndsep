/**
 * Annual-report pure logic (no I/O, deterministic; no LLM).
 * DB-backed generation lives in server/services/annualReport.ts.
 */
import { createHash } from "crypto";

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function round2(n: number | null): number | null {
  return n === null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100;
}

/** Days between two timestamps; null when either end missing. */
export function daysBetween(a: Date | string | null, b: Date | string | null): number | null {
  if (!a || !b) return null;
  return (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
}

export interface ComplaintResolutionRow { category: string; received_at: string; resolved_at: string | null; }
export interface CaseResolutionRow { id: number; status: string; opened_at: string; closed_at: string | null; organization_id: number; }
export interface FineRow { id: number; org_id: number; amount: string | number; amount_paid: string | number; status: string; issued_at: string; }
export interface InstalmentRow { status: string; due_date: string; paid_at: string | null; amount: string | number; amount_paid: string | number; }
export interface SettlementRow { status: string; }
export interface SectorRow { sector: string | null; cases: number; fines_imposed: string | number; fines_collected: string | number; }

export interface ReportInputs {
  year: number;
  complaints: ComplaintResolutionRow[];
  cases: CaseResolutionRow[];
  fines: FineRow[];
  instalments: InstalmentRow[];
  settlements: SettlementRow[];
  sectors: SectorRow[];
}

function avg(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

/** Deterministic structured KPI payload. No timestamps other than the
 *  report year; generated_at is added by the persistence layer. */
export function buildReportPayload(input: ReportInputs): Record<string, unknown> {
  const { year } = input;

  // Time-to-resolution: complaints by category.
  const byCat = new Map<string, number[]>();
  for (const c of input.complaints) {
    const d = daysBetween(c.received_at, c.resolved_at);
    if (d === null) continue;
    if (!byCat.has(c.category)) byCat.set(c.category, []);
    byCat.get(c.category)!.push(d);
  }
  const complaintsByCategory = [...byCat.entries()]
    .map(([category, ds]) => ({ category, resolved_count: ds.length, avg_days: round2(avg(ds)), median_days: round2(median(ds)) }))
    .sort((a, b) => a.category.localeCompare(b.category));

  const caseDays = input.cases
    .map((c) => daysBetween(c.opened_at, c.closed_at))
    .filter((d): d is number => d !== null);

  // Deterrence: repeat offenders + remediation (settlement) compliance.
  const orgCaseCount = new Map<number, number>();
  for (const c of input.cases) orgCaseCount.set(c.organization_id, (orgCaseCount.get(c.organization_id) ?? 0) + 1);
  const orgsWithCases = orgCaseCount.size;
  const repeatOffenders = [...orgCaseCount.values()].filter((n) => n > 1).length;
  const fulfilled = input.settlements.filter((s) => s.status === "fulfilled").length;
  const defaulted = input.settlements.filter((s) => s.status === "defaulted").length;

  // Penalty collection.
  const imposed = input.fines.reduce((a, f) => a + Number(f.amount), 0);
  const collected = input.fines.reduce((a, f) => a + Number(f.amount_paid), 0);
  const inst = {
    scheduled: input.instalments.filter((i) => i.status === "scheduled").length,
    paid: input.instalments.filter((i) => i.status === "paid").length,
    overdue: input.instalments.filter((i) => i.status === "overdue").length,
    partial: input.instalments.filter((i) => i.status === "partial").length,
  };
  const paidInstalments = input.instalments.filter((i) => i.status === "paid");
  const onTime = paidInstalments.filter((i) => {
    const d = daysBetween(i.due_date, i.paid_at);
    return d !== null && d >= 0;
  }).length;

  const sectors = input.sectors
    .map((s) => ({
      sector: s.sector ?? "unknown",
      cases: s.cases,
      fines_imposed: round2(Number(s.fines_imposed)),
      fines_collected: round2(Number(s.fines_collected)),
    }))
    .sort((a, b) => b.cases - a.cases || a.sector.localeCompare(b.sector));

  return {
    report_year: year,
    legal_frame: {
      statute: "Nigeria Data Protection Act 2023",
      sections: ["s.5 (functions of the Commission)", "s.6 (powers of the Commission)"],
    },
    time_to_resolution: {
      complaints_by_category: complaintsByCategory,
      enforcement_cases: {
        closed_count: caseDays.length,
        avg_days: round2(avg(caseDays)),
        median_days: round2(median(caseDays)),
      },
    },
    deterrence: {
      organizations_with_cases: orgsWithCases,
      repeat_offenders: repeatOffenders,
      repeat_offender_rate: orgsWithCases ? round2(repeatOffenders / orgsWithCases) : null,
      settlements_fulfilled: fulfilled,
      settlements_defaulted: defaulted,
      remediation_compliance_rate: fulfilled + defaulted ? round2(fulfilled / (fulfilled + defaulted)) : null,
    },
    penalties: {
      fines_count: input.fines.length,
      imposed_total: round2(imposed),
      collected_total: round2(collected),
      collection_rate: imposed > 0 ? round2(collected / imposed) : null,
      instalments: {
        ...inst,
        paid_on_time_rate: paidInstalments.length ? round2(onTime / paidInstalments.length) : null,
      },
    },
    sectors,
  };
}

/** Deterministic markdown rendering of a payload. */
export function renderMarkdown(payload: Record<string, unknown>): string {
  const p = payload as any;
  const L: string[] = [];
  L.push(`# NDPC Annual Enforcement Report — ${p.report_year}`);
  L.push("");
  L.push(`_${p.legal_frame.statute}: ${p.legal_frame.sections.join("; ")}._`);
  L.push("");
  L.push("## Time to Resolution");
  L.push("");
  L.push(`- Enforcement cases closed: ${p.time_to_resolution.enforcement_cases.closed_count} (avg ${p.time_to_resolution.enforcement_cases.avg_days ?? "n/a"} days, median ${p.time_to_resolution.enforcement_cases.median_days ?? "n/a"} days)`);
  L.push("");
  L.push("| Complaint category | Resolved | Avg days | Median days |");
  L.push("|---|---|---|---|---|");
  for (const r of p.time_to_resolution.complaints_by_category) {
    L.push(`| ${r.category} | ${r.resolved_count} | ${r.avg_days ?? "n/a"} | ${r.median_days ?? "n/a"} |`);
  }
  L.push("");
  L.push("## Deterrence");
  L.push("");
  L.push(`- Organisations with enforcement cases: ${p.deterrence.organizations_with_cases}`);
  L.push(`- Repeat offenders: ${p.deterrence.repeat_offenders} (rate ${p.deterrence.repeat_offender_rate ?? "n/a"})`);
  L.push(`- Settlements fulfilled / defaulted: ${p.deterrence.settlements_fulfilled} / ${p.deterrence.settlements_defaulted} (remediation compliance rate ${p.deterrence.remediation_compliance_rate ?? "n/a"})`);
  L.push("");
  L.push("## Penalty Collection");
  L.push("");
  L.push(`- Fines imposed: ${p.penalties.imposed_total ?? 0} NGN across ${p.penalties.fines_count} fines`);
  L.push(`- Collected: ${p.penalties.collected_total ?? 0} NGN (collection rate ${p.penalties.collection_rate ?? "n/a"})`);
  L.push(`- Instalments — scheduled: ${p.penalties.instalments.scheduled}, paid: ${p.penalties.instalments.paid}, overdue: ${p.penalties.instalments.overdue}, partial: ${p.penalties.instalments.partial}, on-time rate: ${p.penalties.instalments.paid_on_time_rate ?? "n/a"}`);
  L.push("");
  L.push("## Sector Breakdown");
  L.push("");
  L.push("| Sector | Cases | Fines imposed (NGN) | Fines collected (NGN) |");
  L.push("|---|---|---|---|");
  for (const s of p.sectors) {
    L.push(`| ${s.sector} | ${s.cases} | ${s.fines_imposed ?? 0} | ${s.fines_collected ?? 0} |`);
  }
  L.push("");
  return L.join("\n");
}

export function payloadHash(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
