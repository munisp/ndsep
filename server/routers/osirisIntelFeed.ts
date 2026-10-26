/**
 * OSIRIS Intel Feed router (round 13, P1.5)
 * ==========================================
 * Thin read/ops surface over the OSIRIS-sourced adverse-media candidates
 * ingested by workers/python/gdelt_adverse_media_worker.py (migration 0146):
 *
 *   - feedStatus:       per-source watermarks (osiris_intel_watermarks),
 *                       last poll timestamps and item counts — observability
 *                       for the GDELT + live-news feeds;
 *   - listRecentItems:  paginated read view over adverse_media_items filtered
 *                       to source_key IN ('osiris_gdelt', 'osiris_news')
 *                       (optionally a single source);
 *   - triggerPoll:      admin-only; invokes the worker's HTTP /run endpoint
 *                       (shared-secret X-Worker-Auth). FAIL-CLOSED: when the
 *                       worker is unreachable or returns non-OK, the
 *                       procedure errors instead of pretending a poll ran.
 *
 * Staff gating follows adverseMedia (staffProcedure for reads, adminProcedure
 * for the operational trigger). Items themselves are reviewed through the
 * existing adverseMedia review queue — this router never mutates item review
 * state. Raw SQL against the shared pg pool (same convention as
 * adverseMedia.ts / telegramWatch.ts).
 */
import { z } from "zod";
import { router, staffProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";

export const OSIRIS_INTEL_SOURCE_KEYS = ["osiris_gdelt", "osiris_news"] as const;
export type OsirisIntelSourceKey = (typeof OSIRIS_INTEL_SOURCE_KEYS)[number];

const WORKER_URL = (process.env.OSIRIS_INTEL_WORKER_URL ?? "http://localhost:8118").replace(/\/$/, "");
const WORKER_AUTH_TOKEN = process.env.WORKER_AUTH_TOKEN ?? "";

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
    logger.error({ err, query: query.slice(0, 200) }, "[osirisIntelFeed] DB query error");
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
    logger.warn({ err, action, resourceType }, "[osirisIntelFeed] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

export const osirisIntelFeedRouter = router({
  /** Per-source feed observability: watermarks, last poll, item counts. */
  feedStatus: staffProcedure.query(async () => {
    const watermarks = await exec(
      `SELECT source, last_seen_id, last_run_at, stats
       FROM osiris_intel_watermarks ORDER BY source ASC`,
    );
    // IN-list with two bound params (exec() JSON-stringifies array params,
    // so ANY($1::text[]) is not usable here).
    const sources = await exec(
      `SELECT source_key, name, enabled, last_status, last_error, last_polled_at
       FROM adverse_media_sources
       WHERE source_key IN ($1, $2)
       ORDER BY source_key ASC`,
      [OSIRIS_INTEL_SOURCE_KEYS[0], OSIRIS_INTEL_SOURCE_KEYS[1]],
    );
    const counts = await exec(
      `SELECT s.source_key,
              COUNT(i.id)::int AS total,
              COUNT(i.id) FILTER (WHERE i.review_status = 'pending')::int   AS pending,
              COUNT(i.id) FILTER (WHERE i.review_status = 'confirmed')::int AS confirmed,
              COUNT(i.id) FILTER (WHERE i.review_status = 'rejected')::int  AS rejected,
              MAX(i.fetched_at) AS last_item_at
       FROM adverse_media_sources s
       LEFT JOIN adverse_media_items i ON i.source_id = s.id
       WHERE s.source_key IN ($1, $2)
       GROUP BY s.source_key
       ORDER BY s.source_key ASC`,
      [OSIRIS_INTEL_SOURCE_KEYS[0], OSIRIS_INTEL_SOURCE_KEYS[1]],
    );
    return { watermarks, sources, counts };
  }),

  /** Paginated read view over OSIRIS-sourced adverse-media items. */
  listRecentItems: staffProcedure
    .input(z.object({
      source: z.enum(OSIRIS_INTEL_SOURCE_KEYS).optional(),
      review_status: z.enum(["pending", "confirmed", "rejected"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      const conds: string[] = [];
      if (input?.source) {
        params.push(input.source);
        conds.push(`s.source_key = $${params.length}`);
      } else {
        params.push(OSIRIS_INTEL_SOURCE_KEYS[0], OSIRIS_INTEL_SOURCE_KEYS[1]);
        conds.push(`s.source_key IN ($${params.length - 1}, $${params.length})`);
      }
      if (input?.review_status) {
        params.push(input.review_status);
        conds.push(`i.review_status = $${params.length}`);
      }
      const where = `WHERE ${conds.join(" AND ")}`;
      params.push(input?.limit ?? 50, input?.offset ?? 0);
      const rows = await exec(
        `SELECT i.id, i.url, i.title, i.summary, i.published_at, i.fetched_at,
                i.severity, i.triage_method, i.triage_label, i.review_status,
                s.source_key, s.name AS source_name,
                (SELECT jsonb_agg(jsonb_build_object(
                   'match_id', m.id, 'organization_id', m.organization_id,
                   'matched_name', m.matched_name, 'match_method', m.match_method,
                   'confidence', m.confidence, 'status', m.status))
                 FROM adverse_media_entity_matches m WHERE m.item_id = i.id) AS matches
         FROM adverse_media_items i
         JOIN adverse_media_sources s ON s.id = i.source_id
         ${where}
         ORDER BY i.fetched_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const total = await exec(
        `SELECT COUNT(*)::int AS n
         FROM adverse_media_items i
         JOIN adverse_media_sources s ON s.id = i.source_id
         ${where}`,
        params.slice(0, params.length - 2),
      );
      return { rows, total: Number(total[0]?.n ?? 0), limit: input?.limit ?? 50, offset: input?.offset ?? 0 };
    }),

  /** Admin: trigger one worker poll cycle. FAIL-CLOSED — an unreachable or
   *  erroring worker surfaces as a tRPC error, never a fake success. */
  triggerPoll: adminProcedure
    .input(z.object({
      source: z.enum(OSIRIS_INTEL_SOURCE_KEYS).optional(),
    }).optional())
    .mutation(async ({ input, ctx }) => {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
      };
      if (WORKER_AUTH_TOKEN) headers["X-Worker-Auth"] = WORKER_AUTH_TOKEN;
      let res: Response;
      try {
        res = await fetch(`${WORKER_URL}/run`, {
          method: "POST",
          headers,
          body: JSON.stringify(input?.source ? { sources: [input.source] } : {}),
          signal: AbortSignal.timeout(120_000), // a poll cycle can take a while
        });
      } catch (e) {
        logger.warn({ err: e instanceof Error ? e.message : String(e) },
          "[osirisIntelFeed] worker unreachable — failing closed");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "OSIRIS intel worker unreachable — poll NOT triggered",
        });
      }
      if (!res.ok) {
        logger.warn({ status: res.status }, "[osirisIntelFeed] worker /run returned non-OK");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `OSIRIS intel worker rejected the poll (HTTP ${res.status})`,
        });
      }
      const body = await res.json().catch(() => ({}));
      await logAudit("osiris_intel_poll_triggered", "osiris_intel_watermarks",
        null, String(ctx.user.id), { source: input?.source ?? "all" });
      fireAndForget("osirisIntelFeed.triggerPoll");
      return { status: "ok", source: input?.source ?? "all", worker: body };
    }),
});
