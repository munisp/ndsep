/**
 * Open data portal & public API router (FEAT-E, round 9).
 *
 * Public, no-login endpoints serving SANITISED AGGREGATE datasets only:
 *   sanctions_register    published enforcement_notices + publication_documents
 *   complaint_stats       complaint counts by category/state/month with
 *                         k-anonymity (cells < 5 suppressed); NO row-level data
 *   dcpmi_registry        aggregate counts of DCPMI-flagged organisations by
 *                         sector (from penalty_computations) + registered-org
 *                         counts by sector/compliance status
 *   enforcement_outcomes  yearly case outcomes and fine collection aggregates
 *
 * JSON and CSV export. Every access is logged to open_data_access_log with a
 * salted sha256 accessor hash (raw IP / identity never stored). Dataset
 * versioning + changelog live in open_data_datasets (admin-managed).
 * Machine-readable contract: openapi/round9_opendata.yaml.
 */
import { z } from "zod";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { kAnonymize, toCsv, accessorHash, bumpDatasetVersion, K_ANONYMITY_THRESHOLD, type ChangelogEntry } from "../services/openDataLogic";

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
    logger.error({ err, query: query.slice(0, 200) }, "[openDataPortal] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

function clientIp(req: any): string {
  const fwd = req?.headers?.["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  return req?.ip ?? req?.socket?.remoteAddress ?? "unknown";
}

async function logAccess(datasetKey: string, endpoint: string, format: string | null, ctx: any): Promise<void> {
  try {
    await exec(
      `INSERT INTO open_data_access_log (dataset_key, endpoint, format, accessor_type, accessor_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        datasetKey, endpoint, format,
        ctx?.user ? "authenticated" : "anonymous",
        accessorHash(ctx?.user ? `user:${ctx.user.id}` : clientIp(ctx?.req)),
      ],
    );
  } catch (err) {
    logger.warn({ err, datasetKey }, "[openDataPortal] access log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
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
    logger.warn({ err, action, resourceType }, "[openDataPortal] Audit log write failed");
  }
}

const DATASET_KEYS = ["sanctions_register", "complaint_stats", "dcpmi_registry", "enforcement_outcomes"] as const;
type DatasetKey = (typeof DATASET_KEYS)[number];

async function datasetRows(key: DatasetKey, year?: number): Promise<Array<Record<string, string | number | null>>> {
  switch (key) {
    case "sanctions_register": {
      const notices = await exec(
        `SELECT 'enforcement_notice' AS record_type, org_name, notice_type, title,
                legal_instrument_ref, gazette_number, published_at, sanction_start, sanction_end, status
         FROM enforcement_notices WHERE status IN ('published', 'remediated')`,
      );
      const docs = await exec(
        `SELECT 'publication_document' AS record_type, org_name, doc_type AS notice_type, title,
                legal_instrument_ref, gazette_number, published_at, NULL::date AS sanction_start, NULL::date AS sanction_end, status
         FROM publication_documents WHERE status IN ('published', 'corrected')`,
      );
      return [...notices, ...docs];
    }
    case "complaint_stats": {
      const params: unknown[] = [];
      let where = "";
      if (year) { params.push(year); where = `WHERE EXTRACT(YEAR FROM received_at) = $1`; }
      const rows = await exec(
        `SELECT category, COALESCE(state, 'unspecified') AS state,
                TO_CHAR(DATE_TRUNC('month', received_at), 'YYYY-MM') AS month,
                COUNT(*)::int AS count
         FROM public_complaints ${where}
         GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
        params,
      );
      // k-anonymity: suppress any cell below the threshold.
      return kAnonymize(rows) as Array<Record<string, string | number | null>>;
    }
    case "dcpmi_registry": {
      const dcpmi = await exec(
        `SELECT COALESCE(o.sector, 'unknown') AS sector, COUNT(DISTINCT pc.org_id)::int AS dcpmi_count
         FROM penalty_computations pc JOIN organizations o ON o.id = pc.org_id
         WHERE pc.is_dcpmi IS TRUE GROUP BY 1 ORDER BY 1`,
      );
      const registry = await exec(
        `SELECT COALESCE(sector, 'unknown') AS sector,
                COALESCE(compliance_status::text, 'unknown') AS compliance_status,
                COUNT(*)::int AS registered_count
         FROM organizations GROUP BY 1, 2 ORDER BY 1, 2`,
      );
      return [
        ...dcpmi.map((r) => ({ grouping: "dcpmi_by_sector", ...r })),
        ...registry.map((r) => ({ grouping: "registered_by_sector_status", ...r })),
      ];
    }
    case "enforcement_outcomes": {
      const params: unknown[] = [];
      let where = "";
      if (year) { params.push(year); where = `WHERE EXTRACT(YEAR FROM opened_at) = $1`; }
      const cases = await exec(
        `SELECT EXTRACT(YEAR FROM opened_at)::int AS year, status::text AS outcome, COUNT(*)::int AS count
         FROM enforcement_cases ${where} GROUP BY 1, 2 ORDER BY 1, 2`,
        params,
      );
      const fines = await exec(
        `SELECT EXTRACT(YEAR FROM issued_at)::int AS year,
                COUNT(*)::int AS fines_count,
                COALESCE(SUM(amount), 0)::numeric AS imposed_total,
                COALESCE(SUM(amount_paid), 0)::numeric AS collected_total
         FROM enforcement_fines ${year ? "WHERE EXTRACT(YEAR FROM issued_at) = $1" : ""}
         GROUP BY 1 ORDER BY 1`,
        params,
      );
      return [
        ...cases.map((r) => ({ measure: "case_outcome", ...r })),
        ...fines.map((r) => ({ measure: "fine_collection", outcome: null, count: null, ...r })),
      ];
    }
  }
}

export const openDataPortalRouter = router({
  /** Dataset catalogue with version + changelog (public). */
  listDatasets: publicProcedure.query(async ({ ctx }) => {
    await logAccess("*", "meta", null, ctx);
    return exec(`SELECT dataset_key, title, description, version, changelog, published, updated_at
                 FROM open_data_datasets ORDER BY dataset_key ASC`);
  }),

  /** Fetch a dataset as JSON or CSV (public, aggregate only). */
  getDataset: publicProcedure
    .input(z.object({
      dataset: z.enum(DATASET_KEYS),
      format: z.enum(["json", "csv"]).default("json"),
      year: z.number().int().min(2020).max(2100).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const ds = await exec(
        `SELECT dataset_key, title, version, published FROM open_data_datasets WHERE dataset_key = $1`,
        [input.dataset],
      );
      if (!ds[0] || !ds[0].published) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Dataset not found or unpublished" });
      }
      await logAccess(input.dataset, input.format === "csv" ? "export_csv" : "export_json", input.format, ctx);
      const rows = await datasetRows(input.dataset, input.year);
      if (input.format === "csv") {
        return { dataset: input.dataset, version: ds[0].version, format: "csv" as const, csv: toCsv(rows) };
      }
      return {
        dataset: input.dataset,
        version: ds[0].version,
        format: "json" as const,
        k_anonymity_threshold: input.dataset === "complaint_stats" ? K_ANONYMITY_THRESHOLD : null,
        rows,
      };
    }),

  /** Access-log tail (admin oversight; hashed accessors only). */
  accessLog: adminProcedure
    .input(z.object({ dataset: z.enum(DATASET_KEYS).optional(), limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input?.dataset) { params.push(input.dataset); where = `WHERE dataset_key = $1`; }
      params.push(input?.limit ?? 100);
      return exec(
        `SELECT * FROM open_data_access_log ${where} ORDER BY accessed_at DESC LIMIT $${params.length}`,
        params,
      );
    }),

  /** Publish a dataset update: bumps version and appends a changelog entry. */
  publishDatasetUpdate: adminProcedure
    .input(z.object({ dataset: z.enum(DATASET_KEYS), note: z.string().min(5).max(1000) }))
    .mutation(async ({ input, ctx }) => {
      const ds = await exec(`SELECT * FROM open_data_datasets WHERE dataset_key = $1`, [input.dataset]);
      if (!ds[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Dataset not found" });
      const actor = ctx.user.name ?? String(ctx.user.id);
      const next = bumpDatasetVersion(
        { version: ds[0].version, changelog: (ds[0].changelog ?? []) as ChangelogEntry[] },
        actor, input.note,
      );
      const [row] = await exec(
        `UPDATE open_data_datasets SET version = $2, changelog = $3, updated_by = $4, updated_at = NOW()
         WHERE dataset_key = $1 RETURNING dataset_key, version, changelog, updated_at`,
        [input.dataset, next.version, next.changelog, actor],
      );
      await logAudit("open_data_dataset_published", "open_data_datasets", ds[0].id, String(ctx.user.id), {
        dataset: input.dataset, version: next.version, note: input.note,
      });
      fireAndForget("openDataPortal.publishDatasetUpdate");
      return row;
    }),
});
