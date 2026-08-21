/**
 * Phase 7 Features: Dark/Light Theme Toggle, What's New Changelog, Compliance Score Sparklines
 */
import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { emitEvent, logAuditEvent, broadcastEvent, cacheGetJson, cacheSetJson, cacheDel, triggerWorkflow } from "../middlewareHelpers";
import { emitComplianceEvent, opensearchIndex, lakehouseIngest, daprPublish, fluvioPublish, permifyCheck } from "../middlewareExtensions";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { logger } from "../logger";

// ── Helper: execute raw SQL ───────────────────────────────────────────────────
async function exec(rawSql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
  const db = await getDb();
  if (!db) return [];
  let result: unknown;
  if (params && params.length > 0) {
    const { getPool } = await import("../db");
    const pool = getPool();
    if (!pool) return [];
    const r = await pool.query(rawSql, params);
    return autoDecryptRows(rawSql, (r.rows ?? []) as Record<string, unknown>[]);
  }
  result = await db.execute(sql.raw(rawSql));
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
  return autoDecryptRows(rawSql, (rows ?? []) as Record<string, unknown>[]);
}

// ─── Ensure changelogs table exists ──────────────────────────────────────────
(async () => {
  try {
    const { getPool } = await import("../db");
    const pool = getPool();
    if (pool) {
      await pool.query(`CREATE TABLE IF NOT EXISTS changelogs (
        id SERIAL PRIMARY KEY,
        version VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT,
        category VARCHAR(50) DEFAULT 'feature',
        published_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`);
    }
  } catch {}
})();

// ─── Changelog Router ──────────────────────────────────────────────────────────
export const changelogRouter = router({
  list: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(10),
      }).optional()
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 10;
      const rows = await exec(
        `SELECT id, version, title, body, category, published_at
         FROM changelogs
         ORDER BY published_at DESC
         LIMIT ${limit}`
      );
      return rows as Array<{
        id: number;
        version: string;
        title: string;
        body: string;
        category: string;
        published_at: string;
      }>;
    }),

  markSeen: protectedProcedure
    .input(z.object({ version: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.openId.replace(/'/g, "''");
      const version = input.version.replace(/'/g, "''");
      await exec(
        `INSERT INTO theme_preferences (user_id, last_seen_changelog_version, updated_at)
         VALUES ('${userId}', '${version}', NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET last_seen_changelog_version = '${version}', updated_at = NOW()`
      );
      emitMutationEvent(EVENTS.COMPLIANCE_GAP_IDENTIFIED, { action: "compliance_assessment", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { ok: true };
    }),
});

// ─── Compliance Sparkline Router ───────────────────────────────────────────────
export const sparklineRouter = router({
  getHistory: protectedProcedure
    .input(
      z.object({
        orgId: z.string().optional(),
        sector: z.string().optional(),
        days: z.number().min(7).max(90).default(30),
      })
    )
    .query(async ({ input }) => {
      const { orgId, sector, days } = input;

      if (orgId) {
        const safeOrgId = orgId.replace(/'/g, "''");
        const rows = await exec(
          `SELECT score, recorded_at, sector
           FROM compliance_score_history
           WHERE org_id = '${safeOrgId}'
             AND recorded_at >= NOW() - INTERVAL '${days} days'
           ORDER BY recorded_at ASC
           LIMIT ${days}`
        );
        return rows as Array<{ score: number; recorded_at: string; sector: string }>;
      }

      if (sector) {
        const safeSector = sector.replace(/'/g, "''");
        const rows = await exec(
          `SELECT AVG(score)::numeric(5,2) AS score, DATE(recorded_at)::text AS recorded_at, sector
           FROM compliance_score_history
           WHERE sector = '${safeSector}'
             AND recorded_at >= NOW() - INTERVAL '${days} days'
           GROUP BY DATE(recorded_at), sector
           ORDER BY recorded_at ASC
           LIMIT ${days}`
        );
        return rows as Array<{ score: number; recorded_at: string; sector: string }>;
      }

      // Platform-wide average
      const rows = await exec(
        `SELECT AVG(score)::numeric(5,2) AS score, DATE(recorded_at)::text AS recorded_at, 'ALL' AS sector
         FROM compliance_score_history
         WHERE recorded_at >= NOW() - INTERVAL '${days} days'
         GROUP BY DATE(recorded_at)
         ORDER BY recorded_at ASC
         LIMIT ${days}`
      );
      return rows as Array<{ score: number; recorded_at: string; sector: string }>;
    }),

  getSectorSummary: protectedProcedure
    .query(async () => {
      const rows = await exec(
        `SELECT sector,
                AVG(score)::numeric(5,2) AS avg_score,
                MIN(score) AS min_score,
                MAX(score) AS max_score,
                COUNT(DISTINCT org_id) AS org_count
         FROM compliance_score_history
         WHERE recorded_at >= NOW() - INTERVAL '30 days'
         GROUP BY sector
         ORDER BY avg_score DESC`
      );
      return rows as Array<{
        sector: string;
        avg_score: number;
        min_score: number;
        max_score: number;
        org_count: number;
      }>;
    }),
});

// ─── Theme Preferences Router ──────────────────────────────────────────────────
export const themePrefsRouter = router({
  get: protectedProcedure
    .query(async ({ ctx }) => {
      const userId = ctx.user.openId;
      try {
        const rows = await exec(
          `SELECT theme, last_seen_changelog_version FROM theme_preferences WHERE user_id = $1 LIMIT 1`,
          [userId]
        );
        const row = rows[0] as any;
        return {
          theme: (row?.theme as "light" | "dark") ?? "light",
          lastSeenChangelogVersion: (row?.last_seen_changelog_version as string) ?? null,
        };
      } catch {
        return { theme: "light" as const, lastSeenChangelogVersion: null };
      }
    }),

  set: protectedProcedure
    .input(
      z.object({
        theme: z.enum(["light", "dark"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.openId;
      try {
        await exec(
          `INSERT INTO theme_preferences (user_id, theme, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (user_id) DO UPDATE SET theme = $2, updated_at = NOW()`,
          [userId, input.theme]
        );
      } catch {
        // Silently ignore if table doesn't exist yet
      }
      emitMutationEvent(EVENTS.COMPLIANCE_GAP_IDENTIFIED, { action: "compliance_assessment", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { ok: true };
    }),
});
