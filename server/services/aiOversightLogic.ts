/**
 * AI runtime oversight — pure logic (no I/O).
 * 72h response clock for serious incidents, audit overdue computation and
 * material-change re-audit trigger decisions. Used by
 * server/routers/aiRuntimeOversight.ts.
 */

export const AI_SEVERITY_CLASSES = ["class_1_serious", "class_2_significant", "class_3_minor"] as const;
export type AiSeverityClass = (typeof AI_SEVERITY_CLASSES)[number];

export const SERIOUS_RESPONSE_HOURS = 72;

/** Serious (class_1) incidents get a 72h substantive-response clock,
 *  mirroring the breach-notification workflow. Lower classes: no clock. */
export function responseDueAt(severityClass: AiSeverityClass, reportedAt: Date): Date | null {
  if (severityClass !== "class_1_serious") return null;
  return new Date(reportedAt.getTime() + SERIOUS_RESPONSE_HOURS * 3600 * 1000);
}

export type IncidentSlaState = "no_clock" | "within_clock" | "due_soon" | "breached";

export function incidentSlaState(
  incident: { severity_class: string; response_due_at: Date | string | null; responded_at: Date | string | null; status: string },
  now: Date = new Date(),
): IncidentSlaState {
  if (!incident.response_due_at) return "no_clock";
  if (incident.responded_at || ["contained", "closed", "referred_enforcement"].includes(incident.status)) {
    const due = new Date(incident.response_due_at).getTime();
    const responded = incident.responded_at ? new Date(incident.responded_at).getTime() : due;
    return responded <= due ? "within_clock" : "breached";
  }
  const remainingMs = new Date(incident.response_due_at).getTime() - now.getTime();
  if (remainingMs < 0) return "breached";
  if (remainingMs <= 12 * 3600 * 1000) return "due_soon";
  return "within_clock";
}

/** An audit obligation is overdue when still due/submitted-past-due and the
 *  due date has passed. */
export function isAuditOverdue(
  audit: { due_date: Date | string; status: string },
  today: Date = new Date(),
): boolean {
  if (!["due", "submitted"].includes(audit.status)) return false;
  const due = new Date(audit.due_date);
  const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return due.getTime() < t.getTime();
}

export interface ReauditDecision {
  trigger: boolean;
  trigger_type: "model_version_change" | "model_hash_change" | null;
}

/** A material change is a change to the registered model version or model
 *  hash. Hash change dominates (weights may change without a version bump). */
export function materialChangeTrigger(
  current: { model_version: string | null; model_hash: string | null },
  next: { model_version?: string | null; model_hash?: string | null },
): ReauditDecision {
  if (next.model_hash !== undefined && next.model_hash !== null && next.model_hash !== current.model_hash) {
    return { trigger: true, trigger_type: "model_hash_change" };
  }
  if (next.model_version !== undefined && next.model_version !== null && next.model_version !== current.model_version) {
    return { trigger: true, trigger_type: "model_version_change" };
  }
  return { trigger: false, trigger_type: null };
}

export function formatIncidentRef(year: number, seq: number): string {
  return `AIRT-RT-${year}-${String(seq).padStart(5, "0")}`;
}

export function formatSystemRef(year: number, seq: number): string {
  return `AIRS-${year}-${String(seq).padStart(5, "0")}`;
}
