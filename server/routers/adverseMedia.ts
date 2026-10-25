/**
 * Adverse-media / OSINT intelligence feed router (FEAT-E, round 9).
 *
 * Ingestion is performed by workers/python/adverse_media_worker.py against
 * the admin-managed adverse_media_sources table (seeded with disabled,
 * UNCONFIGURED slots — the worker fails closed on unconfigured sources).
 * This router provides:
 *   - staff review queue: confirm / reject items, confirm / reject entity
 *     matches, link items to organizations;
 *   - confirmed items promote into supervision_risk_signals (shared table
 *     read by supervision / analytics routers);
 *   - admin source CRUD + enable/disable;
 *   - retention: purgeExpired enforces per-source retention_days.
 * Every mutation writes an audit_logs row and emits a mutation event.
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure, staffProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { keywordClassify, matchOrganizations, retentionExpiry, urlHash, normalizeUrl, SEVERITIES } from "../services/adverseMediaLogic";

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
    return autoDecryptRows(query, result.rows ?? []);
  } catch (err) {
    logger.error({ err, query: query.slice(0, 200) }, "[adverseMedia] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

function toIntOrNull(v: string | number | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isInteger(n) && Math.abs(n) < 2147483647 ? n : null;
}

async function logAudit(
  action: string,
  resourceType: string,
  resourceId: string | number | null,
  userId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await exec(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NOW())`,
      [action, resourceType, toIntOrNull(resourceId), toIntOrNull(userId), JSON.stringify(details)],
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[adverseMedia] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

const SOURCE_TYPES = ["rss", "news_api", "breach_disclosure"] as const;

export const adverseMediaRouter = router({
  // ─── Source CRUD (admin) ─────────────────────────────────────────────────
  listSources: protectedProcedure.query(async () => {
    return exec(`SELECT * FROM adverse_media_sources ORDER BY id ASC`);
  }),

  createSource: adminProcedure
    .input(z.object({
      source_key: z.string().min(2).max(64).regex(/^[a-z0-9_]+$/, "lowercase snake_case key"),
      name: z.string().min(2).max(256),
      source_type: z.enum(SOURCE_TYPES),
      feed_url: z.string().url().optional(),
      poll_interval_minutes: z.number().int().min(5).max(1440).default(60),
      retention_days: z.number().int().min(30).max(3650).default(365),
      enabled: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `INSERT INTO adverse_media_sources
           (source_key, name, source_type, feed_url, poll_interval_minutes, retention_days, enabled, last_status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $4::text IS NULL THEN 'UNCONFIGURED' ELSE 'ok' END, $8)
         ON CONFLICT (source_key) DO NOTHING
         RETURNING *`,
        [input.source_key, input.name, input.source_type, input.feed_url ?? null,
         input.poll_interval_minutes, input.retention_days, input.enabled, ctx.user.name ?? String(ctx.user.id)],
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "source_key already exists" });
      await logAudit("adverse_media_source_created", "adverse_media_sources", row.id, String(ctx.user.id), { source_key: input.source_key });
      fireAndForget("adverseMedia.createSource");
      return row;
    }),

  updateSource: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      name: z.string().min(2).max(256).optional(),
      feed_url: z.string().url().nullable().optional(),
      enabled: z.boolean().optional(),
      poll_interval_minutes: z.number().int().min(5).max(1440).optional(),
      retention_days: z.number().int().min(30).max(3650).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE adverse_media_sources SET
           name = COALESCE($2, name),
           feed_url = CASE WHEN $3::text IS NULL THEN feed_url ELSE $3 END,
           enabled = COALESCE($4, enabled),
           poll_interval_minutes = COALESCE($5, poll_interval_minutes),
           retention_days = COALESCE($6, retention_days),
           last_status = CASE
             WHEN $4 IS TRUE AND COALESCE($3, feed_url) IS NULL THEN 'UNCONFIGURED'
             WHEN $4 IS TRUE THEN 'ok'
             WHEN $4 IS FALSE THEN 'disabled'
             ELSE last_status END,
           updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [input.id, input.name ?? null, input.feed_url ?? null, input.enabled ?? null,
         input.poll_interval_minutes ?? null, input.retention_days ?? null],
      );
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Source not found" });
      await logAudit("adverse_media_source_updated", "adverse_media_sources", input.id, String(ctx.user.id), { enabled: input.enabled ?? null });
      fireAndForget("adverseMedia.updateSource");
      return row;
    }),

  // ─── Review queue (staff) ────────────────────────────────────────────────
  reviewQueue: staffProcedure
    .input(z.object({
      review_status: z.enum(["pending", "confirmed", "rejected"]).default("pending"),
      severity: z.enum(SEVERITIES).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [input?.review_status ?? "pending"];
      let where = `WHERE i.review_status = $1`;
      if (input?.severity) { params.push(input.severity); where += ` AND i.severity = $${params.length}`; }
      params.push(input?.limit ?? 50);
      return exec(
        `SELECT i.*, s.name AS source_name, s.source_key,
                (SELECT jsonb_agg(jsonb_build_object(
                   'match_id', m.id, 'organization_id', m.organization_id,
                   'matched_name', m.matched_name, 'match_method', m.match_method,
                   'confidence', m.confidence, 'status', m.status))
                 FROM adverse_media_entity_matches m WHERE m.item_id = i.id) AS matches
         FROM adverse_media_items i
         JOIN adverse_media_sources s ON s.id = i.source_id
         ${where} ORDER BY i.fetched_at DESC LIMIT $${params.length}`,
        params,
      );
    }),

  /** Analyst confirms an item: promotes confirmed entity matches into
   *  supervision_risk_signals (idempotent via UNIQUE source pointer). */
  confirmItem: staffProcedure
    .input(z.object({ id: z.number().int().positive(), note: z.string().max(2000).optional() }))
    .mutation(async ({ input, ctx }) => {
      const reviewer = ctx.user.name ?? String(ctx.user.id);
      const [item] = await exec(
        `UPDATE adverse_media_items
         SET review_status = 'confirmed', reviewed_by = $2, reviewed_at = NOW(), review_note = $3
         WHERE id = $1 AND review_status = 'pending' RETURNING *`,
        [input.id, reviewer, input.note ?? null],
      );
      if (!item) throw new TRPCError({ code: "CONFLICT", message: "Item not found or already reviewed" });
      const matches = await exec(
        `SELECT * FROM adverse_media_entity_matches WHERE item_id = $1 AND status = 'confirmed' AND organization_id IS NOT NULL`,
        [input.id],
      );
      let promoted = 0;
      for (const m of matches) {
        const r = await exec(
          `INSERT INTO supervision_risk_signals
             (signal_type, organization_id, source_table, source_id, severity, title, summary, created_by)
           VALUES ('adverse_media', $1, 'adverse_media_items', $2, $3, $4, $5, $6)
           ON CONFLICT (source_table, source_id, signal_type) DO NOTHING
           RETURNING id`,
          [m.organization_id, item.id, item.severity, item.title, item.summary ?? null, reviewer],
        );
        promoted += r.length;
      }
      await logAudit("adverse_media_item_confirmed", "adverse_media_items", input.id, String(ctx.user.id), { signals_promoted: promoted });
      fireAndForget("adverseMedia.confirmItem");
      return { item, signals_promoted: promoted };
    }),

  rejectItem: staffProcedure
    .input(z.object({ id: z.number().int().positive(), note: z.string().min(3).max(2000) }))
    .mutation(async ({ input, ctx }) => {
      const [item] = await exec(
        `UPDATE adverse_media_items
         SET review_status = 'rejected', reviewed_by = $2, reviewed_at = NOW(), review_note = $3
         WHERE id = $1 AND review_status = 'pending' RETURNING *`,
        [input.id, ctx.user.name ?? String(ctx.user.id), input.note],
      );
      if (!item) throw new TRPCError({ code: "CONFLICT", message: "Item not found or already reviewed" });
      await logAudit("adverse_media_item_rejected", "adverse_media_items", input.id, String(ctx.user.id), { note: input.note });
      fireAndForget("adverseMedia.rejectItem");
      return item;
    }),

  /** Confirm / reject a suggested entity match, or manually link an item to
   *  an organization (creates a confirmed manual match). */
  reviewMatch: staffProcedure
    .input(z.object({
      match_id: z.number().int().positive(),
      decision: z.enum(["confirmed", "rejected"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE adverse_media_entity_matches
         SET status = $2, confirmed_by = $3
         WHERE id = $1 AND status = 'suggested' RETURNING *`,
        [input.match_id, input.decision, ctx.user.name ?? String(ctx.user.id)],
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Match not found or already reviewed" });
      await logAudit("adverse_media_match_reviewed", "adverse_media_entity_matches", input.match_id, String(ctx.user.id), { decision: input.decision });
      fireAndForget("adverseMedia.reviewMatch");
      return row;
    }),

  linkToEntity: staffProcedure
    .input(z.object({
      item_id: z.number().int().positive(),
      organization_id: z.number().int().positive(),
    }))
    .mutation(async ({ input, ctx }) => {
      const org = await exec(`SELECT id, name FROM organizations WHERE id = $1`, [input.organization_id]);
      if (!org[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      const [row] = await exec(
        `INSERT INTO adverse_media_entity_matches (item_id, organization_id, matched_name, match_method, confidence, status, confirmed_by)
         VALUES ($1, $2, $3, 'exact', 1, 'confirmed', $4)
         ON CONFLICT (item_id, organization_id) DO UPDATE
           SET status = 'confirmed', confirmed_by = EXCLUDED.confirmed_by
         RETURNING *`,
        [input.item_id, input.organization_id, org[0].name, ctx.user.name ?? String(ctx.user.id)],
      );
      await logAudit("adverse_media_item_linked", "adverse_media_entity_matches", row.id, String(ctx.user.id), {
        item_id: input.item_id, organization_id: input.organization_id,
      });
      fireAndForget("adverseMedia.linkToEntity");
      return row;
    }),

  // ─── Signals read (protected; consumed by supervision dashboards) ────────
  listSignals: protectedProcedure
    .input(z.object({
      organization_id: z.number().int().positive().optional(),
      status: z.enum(["open", "acknowledged", "closed"]).optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.organization_id) { params.push(input.organization_id); conditions.push(`organization_id = $${params.length}`); }
      if (input?.status) { params.push(input.status); conditions.push(`status = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      params.push(input?.limit ?? 100);
      return exec(
        `SELECT * FROM supervision_risk_signals ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
        params,
      );
    }),

  acknowledgeSignal: staffProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE supervision_risk_signals
         SET status = 'acknowledged', acknowledged_by = $2, acknowledged_at = NOW()
         WHERE id = $1 AND status = 'open' RETURNING *`,
        [input.id, ctx.user.name ?? String(ctx.user.id)],
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Signal not found or not open" });
      await logAudit("supervision_signal_acknowledged", "supervision_risk_signals", input.id, String(ctx.user.id), {});
      fireAndForget("adverseMedia.acknowledgeSignal");
      return row;
    }),

  // ─── Manual ingest (staff) — same triage pipeline as the worker ──────────
  ingestManualItem: staffProcedure
    .input(z.object({
      source_id: z.number().int().positive(),
      title: z.string().min(3).max(512),
      url: z.string().url().optional(),
      summary: z.string().max(20000).optional(),
      published_at: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const actor = ctx.user.name ?? String(ctx.user.id);
      const source = await exec(`SELECT * FROM adverse_media_sources WHERE id = $1`, [input.source_id]);
      if (!source[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Source not found" });
      const triage = keywordClassify(`${input.title}\n${input.summary ?? ""}`);
      const hash = urlHash(input.url ?? null, input.title, input.published_at ?? "");
      const expires = retentionExpiry(new Date(), source[0].retention_days);
      const [item] = await exec(
        `INSERT INTO adverse_media_items
           (source_id, url, url_hash, title, summary, published_at, severity, triage_method, triage_label, retention_expires_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()), $7, 'keyword', $8, $9)
         ON CONFLICT (url_hash) DO NOTHING
         RETURNING *`,
        [input.source_id, input.url ? normalizeUrl(input.url) : null, hash, input.title,
         input.summary ?? null, input.published_at ?? null, triage.severity, triage.label, expires.toISOString()],
      );
      if (!item) return { duplicate: true, url_hash: hash };
      // Suggest entity matches against the registry.
      const orgs = await exec(`SELECT id, name FROM organizations LIMIT 5000`);
      const matches = matchOrganizations(`${input.title} ${input.summary ?? ""}`, orgs.map((o) => ({ id: o.id, name: o.name })));
      for (const m of matches.slice(0, 10)) {
        await exec(
          `INSERT INTO adverse_media_entity_matches (item_id, organization_id, matched_name, match_method, confidence)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (item_id, organization_id) DO NOTHING`,
          [item.id, m.organization_id, m.matched_name, m.match_method, m.confidence],
        );
      }
      await logAudit("adverse_media_item_ingested_manual", "adverse_media_items", item.id, String(ctx.user.id), {
        triage_method: "keyword", severity: triage.severity, matches: matches.length,
      });
      fireAndForget("adverseMedia.ingestManualItem");
      return { duplicate: false, item, matches_suggested: matches.length, ingested_by: actor };
    }),

  // ─── Retention enforcement (admin; also callable by scheduler) ───────────
  purgeExpired: adminProcedure.mutation(async ({ ctx }) => {
    const rows = await exec(
      `DELETE FROM adverse_media_items
       WHERE retention_expires_at IS NOT NULL
         AND retention_expires_at < NOW()
         AND review_status <> 'confirmed'
       RETURNING id`,
    );
    await logAudit("adverse_media_retention_purge", "adverse_media_items", null, String(ctx.user.id), { purged: rows.length });
    fireAndForget("adverseMedia.purgeExpired");
    return { purged: rows.length };
  }),
});
