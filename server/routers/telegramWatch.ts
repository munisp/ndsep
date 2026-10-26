/**
 * Telegram Watch router (round 13, P0.1)
 * ======================================
 * Staff review surface for OSIRIS Telegram breach early-warning signals
 * ingested by workers/python/telegram_breach_watch_worker.py (migration
 * 0141: telegram_watch_items + breach_lag_signals).
 *
 *   - listSignals:    paginated signal queue with status filter;
 *   - confirmSignal / rejectSignal: staff verdict; each decision appends a
 *     decision_feedback row (surface='telegram_watch') keyed by the signal's
 *     stable prediction_id (minted at insert time by the worker via
 *     gen_random_uuid()). Worker-ingested signals have no baseline 'ignore'
 *     row — the first human decision IS the first feedback row; per-
 *     prediction DISTINCT ON analytics are unaffected.
 *   - breachLagList:  entities with breach_notification_overdue signals and
 *     days overdue (NDPA 72-hour self-report rule);
 *   - stats:          queue + lag-signal counters.
 *
 * Authz follows adverseMedia: staffProcedure for everything (regulators /
 * auditors). Every mutation writes an audit_logs row and emits a mutation
 * event. Raw SQL against the shared pg pool (same convention as
 * adverseMedia.ts / decisionFeedback.ts).
 */
import { z } from "zod";
import { router, staffProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";

export const TELEGRAM_WATCH_SURFACE = "telegram_watch" as const;

async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  try {
    const safeParams = params.map((p) =>
      Array.isArray(p) || (p !== null && typeof p === "object" && !(p instanceof Date))
        ? JSON.stringify(p)
        : p
    );
    const result = await pool.query(query, safeParams);
    return result.rows ?? [];
  } catch (err) {
    logger.error({ err, query: query.slice(0, 200) }, "[telegramWatch] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

async function logAudit(
  action: string,
  resourceType: string,
  resourceId: string | number | null,
  userId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    const n = resourceId == null ? null : Number(resourceId);
    await exec(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NOW())`,
      [action, resourceType, Number.isInteger(n) ? n : null,
       userId == null ? null : Number(userId), JSON.stringify(details)],
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[telegramWatch] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

/**
 * Append the human outcome to decision_feedback (surface='telegram_watch').
 * The suggestion payload carries only structural metadata — the post text is
 * already PII-redacted at ingestion and we never include raw identifier
 * keys (decisionFeedback denylist: email/phone_number/...).
 */
async function recordFeedback(row: {
  predictionId: string;
  action: "accept" | "reject";
  actorUuid: string;
  suggestion: Record<string, unknown>;
}): Promise<void> {
  try {
    await exec(
      `INSERT INTO decision_feedback
         (prediction_id, surface, model_version, suggestion, actor_id, action, edit_distance, final_value)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, NULL, NULL)`,
      [row.predictionId, TELEGRAM_WATCH_SURFACE, "rules+ollama",
       JSON.stringify(row.suggestion), row.actorUuid, row.action],
    );
  } catch (err) {
    // Feedback plumbing must never block the review decision itself.
    logger.warn({ err, predictionId: row.predictionId }, "[telegramWatch] decision_feedback write failed");
  }
}

/** Same deterministic pseudonymous actor uuid derivation as decisionFeedback. */
import { createHash } from "crypto";
function actorUuid(actorKey: string | number): string {
  const hex = createHash("sha256").update(`ndsep:feedback-actor:${String(actorKey)}`).digest("hex");
  const h = hex.slice(0, 32).split("");
  h[12] = "5";
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8).join("")}-${h.slice(8, 12).join("")}-${h.slice(12, 16).join("")}-${h.slice(16, 20).join("")}-${h.slice(20, 32).join("")}`;
}

export const telegramWatchRouter = router({
  /** Paginated signal queue. */
  listSignals: staffProcedure
    .input(z.object({
      status: z.enum(["pending", "confirmed", "rejected"]).default("pending"),
      severity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
      channel: z.string().max(256).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [input?.status ?? "pending"];
      const conds = [`status = $1`];
      if (input?.severity) { params.push(input.severity); conds.push(`severity = $${params.length}`); }
      if (input?.channel) { params.push(input.channel); conds.push(`channel = $${params.length}`); }
      const where = `WHERE ${conds.join(" AND ")}`;
      params.push(input?.limit ?? 50, input?.offset ?? 0);
      const rows = await exec(
        `SELECT id, post_id, channel, post_ts, post_url, text_redacted, geo,
                classifier, severity, adverse_media_item_id, status,
                reviewed_by, reviewed_at, prediction_id, created_at
         FROM telegram_watch_items ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const total = await exec(
        `SELECT COUNT(*)::int AS n FROM telegram_watch_items ${where}`,
        params.slice(0, params.length - 2),
      );
      return { rows, total: Number(total[0]?.n ?? 0), limit: input?.limit ?? 50, offset: input?.offset ?? 0 };
    }),

  /** Confirm a breach signal (decision_feedback action='accept'). */
  confirmSignal: staffProcedure
    .input(z.object({ id: z.number().int().positive(), note: z.string().max(2000).optional() }))
    .mutation(async ({ input, ctx }) => {
      const reviewer = ctx.user.name ?? String(ctx.user.id);
      const [row] = await exec(
        `UPDATE telegram_watch_items
         SET status = 'confirmed', reviewed_by = $2, reviewed_at = NOW(), review_note = $3
         WHERE id = $1 AND status = 'pending' RETURNING *`,
        [input.id, reviewer, input.note ?? null],
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Signal not found or already reviewed" });
      await recordFeedback({
        predictionId: row.prediction_id,
        action: "accept",
        actorUuid: actorUuid(ctx.user.id),
        suggestion: {
          signal_id: row.id, channel: row.channel, severity: row.severity,
          classifier: row.classifier ?? {},
        },
      });
      await logAudit("telegram_watch_signal_confirmed", "telegram_watch_items", input.id, String(ctx.user.id), {
        channel: row.channel, severity: row.severity,
      });
      fireAndForget("telegramWatch.confirmSignal");
      return row;
    }),

  /** Reject a breach signal (decision_feedback action='reject'). */
  rejectSignal: staffProcedure
    .input(z.object({ id: z.number().int().positive(), note: z.string().min(3).max(2000) }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE telegram_watch_items
         SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW(), review_note = $3
         WHERE id = $1 AND status = 'pending' RETURNING *`,
        [input.id, ctx.user.name ?? String(ctx.user.id), input.note],
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Signal not found or already reviewed" });
      await recordFeedback({
        predictionId: row.prediction_id,
        action: "reject",
        actorUuid: actorUuid(ctx.user.id),
        suggestion: {
          signal_id: row.id, channel: row.channel, severity: row.severity,
          classifier: row.classifier ?? {},
        },
      });
      await logAudit("telegram_watch_signal_rejected", "telegram_watch_items", input.id, String(ctx.user.id), { note: input.note });
      fireAndForget("telegramWatch.rejectSignal");
      return row;
    }),

  /** Entities with overdue breach-notification signals (NDPA 72-hour rule). */
  breachLagList: staffProcedure
    .input(z.object({
      status: z.enum(["open", "acknowledged", "resolved"]).default("open"),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [input?.status ?? "open"];
      params.push(input?.limit ?? 50, input?.offset ?? 0);
      const rows = await exec(
        `SELECT s.id, s.signal_type, s.organization_id, o.name AS organization_name,
                s.telegram_watch_item_id, s.post_ts, s.notification_deadline,
                s.status, s.acknowledged_by, s.acknowledged_at, s.created_at,
                GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - s.notification_deadline)) / 86400))::int
                  AS days_overdue
         FROM breach_lag_signals s
         JOIN organizations o ON o.id = s.organization_id
         WHERE s.status = $1
         ORDER BY s.notification_deadline ASC
         LIMIT $2 OFFSET $3`,
        params,
      );
      return rows;
    }),

  /** Acknowledge an overdue-notification signal. */
  acknowledgeLagSignal: staffProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE breach_lag_signals
         SET status = 'acknowledged', acknowledged_by = $2, acknowledged_at = NOW()
         WHERE id = $1 AND status = 'open' RETURNING *`,
        [input.id, ctx.user.name ?? String(ctx.user.id)],
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Lag signal not found or not open" });
      await logAudit("breach_lag_signal_acknowledged", "breach_lag_signals", input.id, String(ctx.user.id), {});
      fireAndForget("telegramWatch.acknowledgeLagSignal");
      return row;
    }),

  /** Queue + lag counters for the panel header. */
  stats: staffProcedure.query(async () => {
    const [sig] = await exec(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::int   AS pending,
         COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
         COUNT(*) FILTER (WHERE status = 'rejected')::int  AS rejected,
         COUNT(*)::int                                     AS total
       FROM telegram_watch_items`,
    );
    const [lag] = await exec(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'open')::int          AS open,
         COUNT(*) FILTER (WHERE status = 'acknowledged')::int  AS acknowledged,
         COUNT(*) FILTER (WHERE status = 'resolved')::int      AS resolved,
         COUNT(DISTINCT organization_id) FILTER (WHERE status = 'open')::int AS entities_open
       FROM breach_lag_signals`,
    );
    const channels = await exec(
      `SELECT channel, last_post_ts, last_run_at FROM telegram_watch_watermarks ORDER BY channel ASC`,
    );
    return {
      signals: sig ?? { pending: 0, confirmed: 0, rejected: 0, total: 0 },
      breachLag: lag ?? { open: 0, acknowledged: 0, resolved: 0, entities_open: 0 },
      channels,
    };
  }),
});
