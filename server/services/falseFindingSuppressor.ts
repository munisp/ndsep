/**
 * False-finding suppression autonomy (round 12, wave 9 — roadmap §7, surface 'scan_findings')
 * ==========================================================================================
 * Auto-suppresses scan_findings that match an ALREADY-APPROVED
 * scan_suppressions pattern when the pattern's historical confirm-rate is
 * below 5% (i.e. ≥95% of human decisions on matching findings were
 * false-positive outcomes).
 *
 * Confirm-rate source, in order:
 *   1. decision_feedback surface='scan_findings' rows whose suggestion
 *      payload names the pattern (accept = confirmed real, reject = false
 *      positive; latest action per prediction_id);
 *   2. scan_findings status history for the pattern scope
 *      (confirmed = acknowledged/referred/resolved;
 *       false positive = dismissed/suppressed).
 * No decided history → pattern is NOT eligible (fail-safe).
 *
 * DUAL CONTROL IS NOT BYPASSED: this service never creates or approves
 * suppression patterns — new patterns still go through the two-human
 * complianceScanning.requestSuppression → approveSuppression flow. Only
 * patterns already approved by two humans (and unexpired) qualify, and only
 * at tier ≥ 2. Tier 1: sweep is a no-op (humans apply approved patterns via
 * approveSuppression's retro-apply).
 *
 * Tier ≥2 actions use the shared undo-window queue (autonomy_actions,
 * migration 0140): proposals are parked with a 24h undo deadline and executed
 * by executeDueAutonomyActions(); undo sets the finding status back from the
 * payload snapshot.
 *
 * Temporal wiring (workers/temporal workstream): schedule
 * `runFalseFindingSuppressionSweep()` periodically.
 */
import { getPool } from "../db";
import { getTier } from "./autonomyTiers";
import {
  createAutonomyAction,
  registerActionHandler,
  type AutonomyActionRow,
} from "./autonomyActions";

export const SCAN_FINDINGS_SURFACE = "scan_findings";
export const SUPPRESS_FINDING_ACTION = "suppress_finding";
/** Patterns confirmed real in <5% of decided history are auto-suppressible. */
export const CONFIRM_RATE_THRESHOLD = 0.05;

// ─── Pure decision helpers (unit-tested) ─────────────────────────────────────

/** scan_findings statuses that count as "confirmed real". */
export const CONFIRMING_STATUSES = ["acknowledged", "referred", "resolved"] as const;
/** scan_findings statuses that count as "false positive". */
export const FALSE_POSITIVE_STATUSES = ["dismissed", "suppressed"] as const;

/**
 * Confirm-rate from finding status history: confirmed / (confirmed + false
 * positive). Returns null when there is no decided history ('open' findings
 * carry no signal).
 */
export function confirmRateFromStatuses(statuses: string[]): number | null {
  let confirmed = 0;
  let falsePos = 0;
  for (const s of statuses) {
    if ((CONFIRMING_STATUSES as readonly string[]).includes(s)) confirmed += 1;
    else if ((FALSE_POSITIVE_STATUSES as readonly string[]).includes(s)) falsePos += 1;
  }
  const decided = confirmed + falsePos;
  return decided > 0 ? confirmed / decided : null;
}

/**
 * Confirm-rate from decision_feedback outcomes: accept = confirmed,
 * reject/edit = not-confirmed (rejected outright or needed correction).
 * Returns null when there are no decided rows.
 */
export function confirmRateFromFeedback(actions: string[]): number | null {
  let accept = 0;
  let decided = 0;
  for (const a of actions) {
    if (a === "ignore") continue;
    decided += 1;
    if (a === "accept") accept += 1;
  }
  return decided > 0 ? accept / decided : null;
}

/**
 * Eligibility gate: strictly below the 5% confirm threshold AND at least one
 * decided historical observation. Pure.
 */
export function isEligibleForAutoSuppress(confirmRate: number | null, threshold: number = CONFIRM_RATE_THRESHOLD): boolean {
  return confirmRate !== null && confirmRate < threshold;
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new Error("Database unavailable");
  const safeParams = params.map((p) =>
    Array.isArray(p) || (p !== null && typeof p === "object" && !(p instanceof Date))
      ? JSON.stringify(p)
      : p,
  );
  const result = await pool.query(query, safeParams);
  return result.rows ?? [];
}

interface SuppressionRow {
  id: number;
  scope: "finding_type" | "tracker" | "target" | "finding";
  finding_type: string | null;
  tracker_name: string | null;
  target_id: number | null;
  finding_id: number | null;
}

function patternWhere(s: SuppressionRow, alias = ""): { clause: string; params: unknown[] } {
  const p = alias ? `${alias}.` : "";
  switch (s.scope) {
    case "finding_type":
      return { clause: `${p}finding_type = $1 AND ($2::bigint IS NULL OR ${p}target_id = $2)`, params: [s.finding_type, s.target_id ?? null] };
    case "tracker":
      return { clause: `${p}tracker_name = $1 AND ($2::bigint IS NULL OR ${p}target_id = $2)`, params: [s.tracker_name, s.target_id ?? null] };
    case "target":
      return { clause: `${p}target_id = $1`, params: [s.target_id] };
    case "finding":
      return { clause: `${p}id = $1`, params: [s.finding_id] };
  }
}

/** Confirm-rate for a pattern: decision_feedback first, status history fallback. */
async function patternConfirmRate(s: SuppressionRow): Promise<{ rate: number | null; source: "decision_feedback" | "status_history" | "none" }> {
  if (s.finding_type || s.tracker_name) {
    const fb = await exec(
      `SELECT action FROM (
         SELECT DISTINCT ON (prediction_id) action, created_at
         FROM decision_feedback
         WHERE surface = $1
         ORDER BY prediction_id, created_at DESC
       ) latest
       WHERE suggestion->>'finding_type' = $2 OR suggestion->>'tracker_name' = $3
       LIMIT 1000`,
      [SCAN_FINDINGS_SURFACE, s.finding_type ?? "\u0000", s.tracker_name ?? "\u0000"],
    );
    if (fb.length > 0) {
      return { rate: confirmRateFromFeedback(fb.map((r) => r.action as string)), source: "decision_feedback" };
    }
  }
  const { clause, params } = patternWhere(s);
  const rows = await exec(`SELECT status FROM scan_findings WHERE ${clause} LIMIT 2000`, params);
  if (rows.length === 0) return { rate: null, source: "none" };
  return { rate: confirmRateFromStatuses(rows.map((r) => r.status as string)), source: "status_history" };
}

async function hasOpenActionFor(findingId: number): Promise<boolean> {
  const rows = await exec(
    `SELECT 1 FROM autonomy_actions
     WHERE action_type = $1 AND status IN ('pending_undo', 'executed')
       AND (payload->>'finding_id')::bigint = $2
     LIMIT 1`,
    [SUPPRESS_FINDING_ACTION, findingId],
  );
  return rows.length > 0;
}

// ─── Sweep (Temporal-friendly; do NOT register schedules here) ───────────────

export interface SuppressionSweepResult {
  tier: number;
  approvedPatterns: number;
  eligiblePatterns: number;
  proposalsCreated: number;
  skippedExisting: number;
}

/**
 * Periodic sweep. Tier < 2: no-op (humans apply approved patterns through the
 * existing dual-control flow). Tier ≥ 2: park undo-windowed suppression
 * proposals for open findings matching approved, historically-false patterns.
 */
export async function runFalseFindingSuppressionSweep(opts: { actor?: string } = {}): Promise<SuppressionSweepResult> {
  const actor = opts.actor ?? "autonomy-engine";
  const tier = await getTier(SCAN_FINDINGS_SURFACE);
  const result: SuppressionSweepResult = { tier, approvedPatterns: 0, eligiblePatterns: 0, proposalsCreated: 0, skippedExisting: 0 };

  const suppressions = (await exec(
    `SELECT id, scope, finding_type, tracker_name, target_id, finding_id
     FROM scan_suppressions
     WHERE status = 'approved' AND (expires_at IS NULL OR expires_at > now())`,
  )) as SuppressionRow[];
  result.approvedPatterns = suppressions.length;
  if (tier < 2 || suppressions.length === 0) return result;

  for (const s of suppressions) {
    const { rate, source } = await patternConfirmRate(s);
    if (!isEligibleForAutoSuppress(rate)) continue;
    result.eligiblePatterns += 1;

    const { clause, params } = patternWhere(s);
    const openFindings = await exec(
      `SELECT id, status, suppression_id FROM scan_findings WHERE status = 'open' AND ${clause} LIMIT 500`,
      params,
    );
    for (const f of openFindings) {
      if (await hasOpenActionFor(Number(f.id))) { result.skippedExisting += 1; continue; }
      await createAutonomyAction({
        surface: SCAN_FINDINGS_SURFACE,
        actionType: SUPPRESS_FINDING_ACTION,
        actor,
        payload: {
          kind: SUPPRESS_FINDING_ACTION,
          finding_id: Number(f.id),
          suppression_id: Number(s.id),
          scope: s.scope,
          confirm_rate: rate,
          confirm_rate_source: source,
          reason: `auto-suppress: approved pattern #${s.id} (${s.scope}) with historical confirm-rate ${(Number(rate) * 100).toFixed(1)}% < ${CONFIRM_RATE_THRESHOLD * 100}%`,
          snapshot: { finding: { id: Number(f.id), status: f.status, suppression_id: f.suppression_id ?? null } },
        },
      });
      result.proposalsCreated += 1;
    }
  }
  return result;
}

// ─── Handler: execute + undo ─────────────────────────────────────────────────

function payloadIds(action: AutonomyActionRow): { findingId: number; suppressionId: number } {
  const p = action.payload ?? {};
  const findingId = Number(p.finding_id);
  const suppressionId = Number(p.suppression_id);
  if (!Number.isInteger(findingId) || findingId <= 0 || !Number.isInteger(suppressionId) || suppressionId <= 0) {
    throw new Error("suppress_finding payload missing finding_id/suppression_id");
  }
  return { findingId, suppressionId };
}

async function executeSuppression(action: AutonomyActionRow): Promise<Record<string, unknown>> {
  const { findingId, suppressionId } = payloadIds(action);
  // Re-validate at execution time: the pattern must STILL be approved and
  // unexpired (a human may have revoked it during the undo window), and the
  // finding must still be open.
  const sup = await exec(
    `SELECT id FROM scan_suppressions
     WHERE id = $1 AND status = 'approved' AND (expires_at IS NULL OR expires_at > now())`,
    [suppressionId],
  );
  if (!sup[0]) throw new Error(`suppression pattern ${suppressionId} no longer approved/active`);
  const rows = await exec(
    `UPDATE scan_findings SET status = 'suppressed', suppression_id = $1
     WHERE id = $2 AND status = 'open'
     RETURNING id`,
    [suppressionId, findingId],
  );
  if (!rows[0]) throw new Error(`finding ${findingId} no longer open`);
  return { suppressedFindingId: findingId, suppressionId };
}

async function undoSuppression(action: AutonomyActionRow, _actor: string): Promise<Record<string, unknown>> {
  const { findingId, suppressionId } = payloadIds(action);
  const snapshot = (action.payload.snapshot as any)?.finding ?? {};
  const restoredStatus = typeof snapshot.status === "string" && snapshot.status !== "suppressed" ? snapshot.status : "open";
  const rows = await exec(
    `UPDATE scan_findings SET status = $2, suppression_id = NULL
     WHERE id = $1 AND status = 'suppressed' AND suppression_id = $3
     RETURNING id`,
    [findingId, restoredStatus, suppressionId],
  );
  if (!rows[0]) throw new Error(`finding ${findingId} is no longer suppressed by pattern ${suppressionId} — nothing to restore`);
  return { restoredFindingId: findingId, restoredStatus };
}

registerActionHandler(SUPPRESS_FINDING_ACTION, { execute: executeSuppression, undo: undoSuppression });

/** Re-export the shared executor under the surface name the integrator expects. */
export { executeDueAutonomyActions as executeDueSuppressions } from "./autonomyActions";
