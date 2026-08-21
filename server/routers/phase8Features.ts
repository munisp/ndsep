/**
 * Phase 8 Features:
 *  - Changelog Admin CRUD (adminProcedure)
 *  - Compliance Trend Drill-down (90-day history + sector benchmark + anomaly detection)
 */
import { z } from "zod";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { emitEvent, logAuditEvent, broadcastEvent, cacheGetJson, cacheSetJson, cacheDel, triggerWorkflow } from "../middlewareHelpers";
import { emitComplianceEvent, opensearchIndex, lakehouseIngest, daprPublish, fluvioPublish, permifyCheck } from "../middlewareExtensions";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { logger } from "../logger";

// ─// ── Helper: execute raw SQL ───────────────────────────────────────────────
async function exec(rawSql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
  if (params && params.length > 0) {
    const { getPool } = await import("../db");
    const pool = getPool();
    if (!pool) return [];
    const r = await pool.query(rawSql, params);
    return autoDecryptRows(rawSql, (r.rows ?? []) as Record<string, unknown>[]);
  }
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(sql.raw(rawSql));
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
  return autoDecryptRows(rawSql, (rows ?? []) as Record<string, unknown>[]);
}

// ─── Changelog Admin Router ────────────────────────────────────────────────────
export const changelogAdminRouter = router({
  /** List all changelog entries (admin view — includes all, not just recent) */
  listAll: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }).optional()
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;
      const rows = await exec(
        `SELECT id, version, title, body, category, published_at
         FROM changelogs
         ORDER BY published_at DESC
         LIMIT ${limit} OFFSET ${offset}`
      );
      const countRows = await exec(`SELECT COUNT(*)::int AS total FROM changelogs`);
      return {
        entries: rows as Array<{
          id: number;
          version: string;
          title: string;
          body: string;
          category: string;
          published_at: string;
        }>,
        total: (countRows[0]?.total as number) ?? 0,
      };
    }),

  /** Create a new changelog entry */
  create: adminProcedure
    .input(
      z.object({
        version: z.string().min(1).max(20),
        title: z.string().min(1).max(255),
        body: z.string().min(1),
        category: z.enum(["feature", "security", "improvement", "bugfix", "compliance"]),
        publishedAt: z.string().optional(), // ISO date string; defaults to NOW()
      })
    )
    .mutation(async ({ input }) => {
      const version = input.version.replace(/'/g, "''");
      const title = input.title.replace(/'/g, "''");
      const body = input.body.replace(/'/g, "''");
      const category = input.category;
      const publishedAt = input.publishedAt
        ? `'${input.publishedAt.replace(/'/g, "''")}'`
        : "NOW()";

      const rows = await exec(
        `INSERT INTO changelogs (version, title, body, category, published_at)
         VALUES ('${version}', '${title}', '${body}', '${category}', ${publishedAt})
         RETURNING id, version, title, body, category, published_at`
      );
      emitMutationEvent(EVENTS.ENFORCEMENT_CASE_OPENED, { action: "enforcement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0] as {
        id: number;
        version: string;
        title: string;
        body: string;
        category: string;
        published_at: string;
      };
    }),

  /** Update an existing changelog entry */
  update: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        version: z.string().min(1).max(20).optional(),
        title: z.string().min(1).max(255).optional(),
        body: z.string().min(1).optional(),
        category: z.enum(["feature", "security", "improvement", "bugfix", "compliance"]).optional(),
        publishedAt: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, version, title, body, category, publishedAt } = input;
      const setClauses: string[] = [];
      if (version !== undefined) setClauses.push(`version = '${version.replace(/'/g, "''")}'`);
      if (title !== undefined) setClauses.push(`title = '${title.replace(/'/g, "''")}'`);
      if (body !== undefined) setClauses.push(`body = '${body.replace(/'/g, "''")}'`);
      if (category !== undefined) setClauses.push(`category = '${category}'`);
      if (publishedAt !== undefined) setClauses.push(`published_at = '${publishedAt.replace(/'/g, "''")}'`);

      if (setClauses.length === 0) return { ok: false, message: "No fields to update" };

      const rows = await exec(
        `UPDATE changelogs SET ${setClauses.join(", ")}
         WHERE id = ${id}
         RETURNING id, version, title, body, category, published_at`
      );
      emitMutationEvent(EVENTS.ENFORCEMENT_CASE_OPENED, { action: "enforcement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0] as {
        id: number;
        version: string;
        title: string;
        body: string;
        category: string;
        published_at: string;
      };
    }),

  /** Delete a changelog entry */
  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await exec(`DELETE FROM changelogs WHERE id = ${input.id}`);
      emitMutationEvent(EVENTS.ENFORCEMENT_CASE_OPENED, { action: "enforcement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { ok: true };
    }),
});

// ─── Compliance Trend Router ───────────────────────────────────────────────────
export const complianceTrendRouter = router({
  /** Get 90-day compliance score history for a specific org + sector benchmark */
  getOrgTrend: protectedProcedure
    .input(
      z.object({
        orgId: z.number().int().positive(),
        days: z.number().min(7).max(90).default(90),
      })
    )
    .query(async ({ input }) => {
      const { orgId, days } = input;

      // Org history
      const orgHistory = await exec(
        `SELECT score::float, DATE(recorded_at)::text AS recorded_at, sector
         FROM compliance_score_history
         WHERE org_id = ${orgId}
           AND recorded_at >= NOW() - INTERVAL '${days} days'
         ORDER BY recorded_at ASC
         LIMIT ${days}`
      );

      // Org info
      const orgInfo = await exec(
        `SELECT id, name, sector, compliance_score FROM organizations WHERE id = ${orgId} LIMIT 1`
      );
      const org = orgInfo[0] as { id: number; name: string; sector: string; compliance_score: number } | undefined;

      // Sector benchmark (average of all orgs in same sector, per day)
      const sectorBenchmark = org
        ? await exec(
            `SELECT AVG(score)::numeric(5,2)::float AS score, DATE(recorded_at)::text AS recorded_at
             FROM compliance_score_history
             WHERE sector = '${org.sector.replace(/'/g, "''")}'
               AND org_id != ${orgId}
               AND recorded_at >= NOW() - INTERVAL '${days} days'
             GROUP BY DATE(recorded_at)
             ORDER BY recorded_at ASC
             LIMIT ${days}`
          )
        : [];

      // Simple anomaly detection: points > 2 stddev from rolling mean
      const anomalies = orgHistory.filter((point, idx, arr) => {
        if (arr.length < 5) return false;
        const window = arr.slice(Math.max(0, idx - 5), idx + 5);
        const mean = window.reduce((s, p) => s + Number(p.score), 0) / window.length;
        const stddev = Math.sqrt(
          window.reduce((s, p) => s + Math.pow(Number(p.score) - mean, 2), 0) / window.length
        );
        return Math.abs(Number(point.score) - mean) > 2 * stddev;
      });

      // KPI summary
      const scores = orgHistory.map((r) => Number(r.score));
      const currentScore = scores[scores.length - 1] ?? 0;
      const firstScore = scores[0] ?? 0;
      const delta = currentScore - firstScore;
      const bestScore = Math.max(...scores);
      const worstScore = Math.min(...scores);
      const bestDay = orgHistory.find((r) => Number(r.score) === bestScore)?.recorded_at ?? null;
      const worstDay = orgHistory.find((r) => Number(r.score) === worstScore)?.recorded_at ?? null;

      return {
        org: org ?? null,
        history: orgHistory as Array<{ score: number; recorded_at: string; sector: string }>,
        sectorBenchmark: sectorBenchmark as Array<{ score: number; recorded_at: string }>,
        anomalies: anomalies as Array<{ score: number; recorded_at: string; sector: string }>,
        kpi: {
          currentScore,
          delta: Math.round(delta * 100) / 100,
          bestScore,
          worstScore,
          bestDay,
          worstDay,
        },
      };
    }),

  /** List all orgs with their latest compliance score (for the org selector) */
  listOrgs: protectedProcedure
    .query(async () => {
      const rows = await exec(
        `SELECT o.id, o.name, o.sector, o.compliance_score,
                (SELECT score FROM compliance_score_history
                 WHERE org_id = o.id ORDER BY recorded_at DESC LIMIT 1) AS latest_score
         FROM organizations o
         ORDER BY o.sector, o.name`
      );
      return rows as Array<{
        id: number;
        name: string;
        sector: string;
        compliance_score: number;
        latest_score: number | null;
      }>;
    }),

  /** Get all sectors with their average compliance score */
  getSectorAverages: protectedProcedure
    .query(async () => {
      const rows = await exec(
        `SELECT sector, AVG(score)::numeric(5,2)::float AS avg_score, COUNT(DISTINCT org_id) AS org_count
         FROM compliance_score_history
         WHERE recorded_at >= NOW() - INTERVAL '30 days'
         GROUP BY sector
         ORDER BY avg_score DESC`
      );
      return rows as Array<{ sector: string; avg_score: number; org_count: number }>;
    }),
  getAnomalies: protectedProcedure
    .input(z.object({ orgId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await exec(
        `SELECT id, org_id, 'score_drop' as anomaly_type, 'medium' as severity,
                'Compliance score anomaly detected' as description, created_at as detected_at
         FROM compliance_score_history
         WHERE org_id = $1 AND score < 60
         ORDER BY recorded_at DESC LIMIT 50`,
        [input.orgId]
      ).catch(() => []);
      return rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        orgId: r.org_id,
        type: r.anomaly_type || 'score_drop',
        severity: r.severity || 'medium',
        description: r.description || 'Compliance anomaly detected',
        detectedAt: r.detected_at || r.recorded_at,
      }));
    }),
});
