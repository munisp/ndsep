/**
 * Autonomy action queue (round 12, wave 9 — roadmap §7)
 * ======================================================
 * Shared undo-window machinery for tier-2 auto-actions, backed by
 * `autonomy_actions` (migration 0140). Surface services
 * (duplicateMerge.ts, falseFindingSuppressor.ts) register a handler per
 * action_type and park proposals via createAutonomyAction(); the proposal is
 * executed by executeDueAutonomyActions() only after its undo_deadline
 * (default 24h) has passed, and can be undone by a human at any time via
 * undoAutonomyAction() (pending proposals are cancelled; executed ones are
 * restored from the before-state snapshot in payload).
 *
 * Every lifecycle transition is appended to the anti-wipe audit_ledger:
 *   autonomy.action_proposed / autonomy.action_executed /
 *   autonomy.action_undone / autonomy.action_expired
 *
 * FAIL-CLOSED: a handler that throws during execution leaves the underlying
 * entities untouched (handlers must validate applicability first) and the
 * proposal is marked 'expired' — never retried blindly.
 *
 * Temporal wiring (owned by the workers/temporal workstream — do NOT register
 * schedules here): schedule `runDuplicateMergeSweep`,
 * `runFalseFindingSuppressionSweep` and `executeDueAutonomyActions` (this
 * module) on a periodic cadence (e.g. every 15-60 min). All three are
 * idempotent and safe to run concurrently.
 */
import { getPool } from "../db";
import { logger } from "../logger";
import { appendLedger } from "../antiwipe/ledger";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AutonomyActionRow {
  id: string;
  surface: string;
  actionType: string;
  payload: Record<string, unknown>;
  undoDeadline: string;
  status: "pending_undo" | "executed" | "undone" | "expired";
  executedAt: string | null;
  undoneBy: string | null;
  createdAt: string;
}

export interface ActionHandler {
  /** Apply the action. MUST throw (leaving state untouched) if no longer applicable. */
  execute(action: AutonomyActionRow): Promise<Record<string, unknown> | void>;
  /** Restore the before-state snapshot from payload after execution. */
  undo(action: AutonomyActionRow, actor: string): Promise<Record<string, unknown> | void>;
}

const handlers = new Map<string, ActionHandler>();

/** Surface services register their execute/undo handlers at module load. */
export function registerActionHandler(actionType: string, handler: ActionHandler): void {
  handlers.set(actionType, handler);
}

export function undoWindowHours(): number {
  const v = parseFloat(process.env.AUTONOMY_UNDO_WINDOW_HOURS ?? "");
  return Number.isFinite(v) && v > 0 && v <= 24 * 30 ? v : 24;
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

function rowToAction(r: any): AutonomyActionRow {
  return {
    id: r.id as string,
    surface: r.surface as string,
    actionType: r.action_type as string,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    undoDeadline: r.undo_deadline,
    status: r.status,
    executedAt: r.executed_at ?? null,
    undoneBy: r.undone_by ?? null,
    createdAt: r.created_at,
  };
}

function ledger(action: string, payload: Record<string, unknown>, actor: string): void {
  appendLedger(action, payload, actor).catch((e: unknown) =>
    logger.warn({ err: e instanceof Error ? e.message : String(e), action }, "[autonomyActions] audit_ledger append failed"),
  );
}

// ─── Create ──────────────────────────────────────────────────────────────────

/** Park a tier-2 auto-action proposal with an undo window. Returns the row. */
export async function createAutonomyAction(opts: {
  surface: string;
  actionType: string;
  payload: Record<string, unknown>;
  undoWindowHrs?: number;
  actor?: string;
}): Promise<AutonomyActionRow> {
  const hours = opts.undoWindowHrs ?? undoWindowHours();
  const rows = await exec(
    `INSERT INTO autonomy_actions (surface, action_type, payload, undo_deadline)
     VALUES ($1, $2, $3::jsonb, now() + make_interval(hours => $4))
     RETURNING *`,
    [opts.surface, opts.actionType, opts.payload, hours],
  );
  const action = rowToAction(rows[0]);
  ledger("autonomy.action_proposed", {
    actionId: action.id,
    surface: action.surface,
    actionType: action.actionType,
    undoDeadline: action.undoDeadline,
  }, opts.actor ?? "autonomy-engine");
  return action;
}

// ─── Execute (after the undo deadline) ───────────────────────────────────────

export interface ExecuteDueResult {
  executed: number;
  expired: number;
  failed: number;
  details: Array<{ id: string; actionType: string; outcome: "executed" | "expired" | "failed"; note?: string }>;
}

/**
 * Execute every pending_undo action whose undo deadline has passed.
 * Temporal-friendly: export for the workers/temporal integrator.
 */
export async function executeDueAutonomyActions(opts: { limit?: number; actor?: string } = {}): Promise<ExecuteDueResult> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const actor = opts.actor ?? "autonomy-engine";
  const due = await exec(
    `SELECT * FROM autonomy_actions
     WHERE status = 'pending_undo' AND undo_deadline <= now()
     ORDER BY undo_deadline ASC
     LIMIT ${limit}`,
  );
  const result: ExecuteDueResult = { executed: 0, expired: 0, failed: 0, details: [] };

  for (const r of due) {
    const action = rowToAction(r);
    const handler = handlers.get(action.actionType);
    if (!handler) {
      await exec(
        `UPDATE autonomy_actions SET status = 'expired' WHERE id = $1 AND status = 'pending_undo'`,
        [action.id],
      );
      result.expired += 1;
      result.details.push({ id: action.id, actionType: action.actionType, outcome: "expired", note: "no handler registered" });
      ledger("autonomy.action_expired", { actionId: action.id, actionType: action.actionType, reason: "no handler registered" }, actor);
      continue;
    }
    try {
      const note = await handler.execute(action);
      const updated = await exec(
        `UPDATE autonomy_actions SET status = 'executed', executed_at = now()
         WHERE id = $1 AND status = 'pending_undo' RETURNING id`,
        [action.id],
      );
      if (!updated[0]) {
        // A human undid it concurrently — leave it undone.
        result.details.push({ id: action.id, actionType: action.actionType, outcome: "expired", note: "raced with undo" });
        continue;
      }
      result.executed += 1;
      result.details.push({ id: action.id, actionType: action.actionType, outcome: "executed" });
      ledger("autonomy.action_executed", { actionId: action.id, surface: action.surface, actionType: action.actionType, result: note ?? null }, actor);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg, actionId: action.id, actionType: action.actionType }, "[autonomyActions] execution failed — expiring proposal");
      await exec(
        `UPDATE autonomy_actions SET status = 'expired' WHERE id = $1 AND status = 'pending_undo'`,
        [action.id],
      );
      result.failed += 1;
      result.details.push({ id: action.id, actionType: action.actionType, outcome: "failed", note: msg.slice(0, 200) });
      ledger("autonomy.action_expired", { actionId: action.id, surface: action.surface, actionType: action.actionType, reason: msg.slice(0, 500) }, actor);
    }
  }
  return result;
}

// ─── Undo ────────────────────────────────────────────────────────────────────

/**
 * Undo an auto-action. A 'pending_undo' proposal is simply cancelled (it was
 * never executed); an 'executed' action is restored from the payload
 * snapshot by the registered handler. Returns the updated row.
 */
export async function undoAutonomyAction(id: string, actor: string): Promise<AutonomyActionRow> {
  const rows = await exec(`SELECT * FROM autonomy_actions WHERE id = $1`, [id]);
  const action = rows[0] ? rowToAction(rows[0]) : null;
  if (!action) throw new Error("Autonomy action not found");
  if (action.status !== "pending_undo" && action.status !== "executed") {
    throw new Error(`Autonomy action is '${action.status}' — only pending_undo or executed actions can be undone`);
  }

  if (action.status === "executed") {
    const handler = handlers.get(action.actionType);
    if (!handler) throw new Error(`No undo handler registered for action_type '${action.actionType}'`);
    await handler.undo(action, actor);
  }

  const updated = await exec(
    `UPDATE autonomy_actions SET status = 'undone', undone_by = $2
     WHERE id = $1 AND status IN ('pending_undo', 'executed') RETURNING *`,
    [id, actor],
  );
  if (!updated[0]) throw new Error("Autonomy action changed state concurrently — retry");
  ledger("autonomy.action_undone", {
    actionId: action.id,
    surface: action.surface,
    actionType: action.actionType,
    wasExecuted: action.status === "executed",
  }, actor);
  return rowToAction(updated[0]);
}

// ─── List (dashboard) ────────────────────────────────────────────────────────

export async function listAutonomyActions(opts: {
  status?: "pending_undo" | "executed" | "undone" | "expired";
  surface?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ rows: AutonomyActionRow[]; total: number }> {
  const params: unknown[] = [];
  const conds: string[] = [];
  if (opts.status) { params.push(opts.status); conds.push(`status = $${params.length}`); }
  if (opts.surface) { params.push(opts.surface); conds.push(`surface = $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const rows = await exec(
    `SELECT * FROM autonomy_actions ${where}
     ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const count = await exec(`SELECT COUNT(*)::int AS n FROM autonomy_actions ${where}`, params);
  return { rows: rows.map(rowToAction), total: Number(count[0]?.n ?? 0) };
}
