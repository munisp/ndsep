/**
 * Public complaint portal — pure domain logic (no DB / no I/O).
 *
 * Extracted from server/routers/publicComplaints.ts so the status machine,
 * reference-code formatting, SLA clock and rate-limit primitives are unit
 * testable in isolation (tests/round8/publicComplaints.test.ts).
 */
import { createHash } from "crypto";

// ─── Categories (NDPA 2023 complaint typology) ───────────────────────────────
export const COMPLAINT_CATEGORIES = [
  "consent",
  "breach",
  "cross_border",
  "dark_pattern",
  "excessive_collection",
  "minors",
  "other",
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

// ─── Status machine ──────────────────────────────────────────────────────────
export const COMPLAINT_STATUSES = [
  "received",
  "acknowledged",
  "under_review",
  "linked_to_case",
  "resolved",
  "closed",
] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

/**
 * Allowed forward transitions. There is deliberately no backward edge: the
 * complaint lifecycle is one-way (mirrors the audit-trail expectation that a
 * complaint never "un-acknowledges"). Re-opening is modeled as a new
 * complaint referencing the old one, not a status regression.
 */
export const STATUS_TRANSITIONS: Record<ComplaintStatus, readonly ComplaintStatus[]> = {
  received: ["acknowledged"],
  acknowledged: ["under_review"],
  under_review: ["linked_to_case", "resolved"],
  linked_to_case: ["resolved"],
  resolved: ["closed"],
  closed: [],
};

export function canTransition(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return (STATUS_TRANSITIONS[from] ?? []).includes(to);
}

/** Column stamped when a complaint enters a status (null = no stamp). */
export function statusTimestampColumn(status: ComplaintStatus): string | null {
  switch (status) {
    case "received": return "received_at";
    case "acknowledged": return "acknowledged_at";
    case "under_review": return "under_review_at";
    case "linked_to_case": return "linked_at";
    case "resolved": return "resolved_at";
    case "closed": return "closed_at";
    default: return null;
  }
}

// ─── Reference codes ─────────────────────────────────────────────────────────
/** NDPC-CMP-YYYY-NNNNNN — sequence value zero-padded to 6 digits. */
export function formatReferenceCode(seqValue: number, date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const n = String(Math.trunc(seqValue)).padStart(6, "0");
  return `NDPC-CMP-${year}-${n}`;
}

const REFERENCE_CODE_RE = /^NDPC-CMP-\d{4}-\d{6}$/;
export function isValidReferenceCode(code: string): boolean {
  return REFERENCE_CODE_RE.test(code.trim().toUpperCase());
}

// ─── SLA clock (acknowledgement within 72 hours) ────────────────────────────
export const ACK_SLA_HOURS = 72;

export function computeAckSlaDueAt(receivedAt: Date = new Date()): Date {
  return new Date(receivedAt.getTime() + ACK_SLA_HOURS * 60 * 60 * 1000);
}

export type SlaState = "met" | "within_sla" | "breached";

/**
 * Acknowledgement SLA state. A complaint acknowledged before its due time has
 * "met" the SLA; one still unacknowledged is "within_sla" until the due time
 * passes, then "breached".
 */
export function ackSlaState(
  row: { status?: unknown; acknowledged_at?: unknown; ack_sla_due_at?: unknown },
  now: Date = new Date(),
): SlaState {
  const due = new Date(row.ack_sla_due_at as string | Date);
  if (row.acknowledged_at) {
    return new Date(row.acknowledged_at as string | Date) <= due ? "met" : "breached";
  }
  return now <= due ? "within_sla" : "breached";
}

export function slaHoursRemaining(
  row: { ack_sla_due_at?: unknown },
  now: Date = new Date(),
): number {
  return Math.round(((new Date(row.ack_sla_due_at as string | Date).getTime() - now.getTime()) / 3600000) * 10) / 10;
}

// ─── Rate limiting by IP hash ────────────────────────────────────────────────
/**
 * Salted SHA-256 of the client IP. The raw IP is PII and is never persisted;
 * the salted hash is stable per (IP, salt) so the hourly submission cap can
 * be enforced without storing the address itself.
 */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}|${ip.trim()}`).digest("hex");
}

/**
 * Sliding-window check: has this IP hash already hit the per-window cap?
 * `recentCount` = submissions from the hash inside the current window.
 */
export function isRateLimited(recentCount: number, maxPerWindow: number): boolean {
  return recentCount >= maxPerWindow;
}

// ─── Public tracking view ────────────────────────────────────────────────────
/**
 * Fields safe to expose on the public tracking endpoint: lifecycle + SLA
 * only, never complainant identity, officer assignment, case linkage detail
 * or IP hash.
 */
export function toPublicTrackingView<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  return {
    reference_code: row.reference_code,
    category: row.category,
    subject: row.subject,
    status: row.status,
    state: row.state ?? null,
    lga: row.lga ?? null,
    received_at: row.received_at ?? null,
    acknowledged_at: row.acknowledged_at ?? null,
    under_review_at: row.under_review_at ?? null,
    resolved_at: row.resolved_at ?? null,
    closed_at: row.closed_at ?? null,
    ack_sla_due_at: row.ack_sla_due_at ?? null,
    is_anonymous: row.is_anonymous ?? true,
  };
}

// ─── Duplicate merge guard ───────────────────────────────────────────────────
/** A complaint can only absorb merges while it is not itself merged away or closed. */
export function canMergeInto(target: { status: string; merged_into_id: number | null }): boolean {
  return target.merged_into_id == null && target.status !== "closed";
}

export function canBeMerged(source: { status: string; merged_into_id: number | null }): boolean {
  return source.merged_into_id == null && source.status !== "closed";
}
