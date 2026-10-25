/**
 * Field Inspection Router — offline-first sync API for field inspectors
 * - Inspection cases
 * - Offline-queued evidence with client-generated UUIDs (idempotent upsert)
 * - Vector-clock / last-write-wins conflict resolution with a conflict log
 * - Batch sync endpoint accepting arrays of queued evidence items
 */
import { z } from "zod";
import { router, staffProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";

/** Canonical JSON stringify with recursively sorted keys — Postgres jsonb
 *  semantics ignore key order, so the sync conflict comparison must too,
 *  otherwise {"a":1,"b":2} vs {"b":2,"a":1} is a false conflict. */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(",")}}`;
}

/** Inspection-case status machine: forward-only, closed is terminal
 *  (no closed -> open reopen via this endpoint). */
const CASE_TRANSITIONS: Record<string, string[]> = {
  open: ["in_field", "closed"],
  in_field: ["synced", "closed"],
  synced: ["closed"],
  closed: [],
};

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
    const rows = result.rows ?? [];
    return autoDecryptRows(query, rows);
  } catch (err) {
    logger.error({ err, query: query.slice(0, 200) }, "[fieldInspection] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

/** audit_logs.resource_id / user_id are int4; coerce non-numeric refs to NULL. */
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
  details: Record<string, unknown> = {}
): Promise<void> {
  try {
    await exec(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NOW())`,
      [action, resourceType, toIntOrNull(resourceId), toIntOrNull(userId), JSON.stringify(details)]
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[fieldInspection] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

/**
 * Last-write-wins comparison. Vector clocks are merged for provenance, but the
 * decisive ordering is client_updated_at (with the vector clock recorded on
 * the row). Returns true when the incoming client write should win.
 */
function clientWriteWins(serverRow: any, clientUpdatedAt: Date): boolean {
  if (!serverRow?.client_updated_at) return true;
  return clientUpdatedAt.getTime() > new Date(serverRow.client_updated_at).getTime();
}

function mergeVectorClocks(server: any, client: any): Record<string, number> {
  const merged: Record<string, number> = { ...(server ?? {}) };
  for (const [k, v] of Object.entries(client ?? {})) {
    merged[k] = Math.max(Number(merged[k] ?? 0), Number(v));
  }
  return merged;
}

const EVIDENCE_TYPES = ["photo", "document", "interview_note", "observation", "screenshot"] as const;

const syncItemSchema = z.object({
  evidence_uuid: z.string().uuid(),
  evidence_type: z.enum(EVIDENCE_TYPES).default("observation"),
  payload: z.record(z.string(), z.any()).optional(),
  captured_at: z.string().optional(),
  client_updated_at: z.string(),
  version_vector: z.record(z.string(), z.number()).optional(),
  deleted: z.boolean().default(false),
});

export const fieldInspectionRouter = router({
  // ─── Cases ───────────────────────────────────────────────────────────────
  createCase: staffProcedure
    .input(z.object({
      case_uuid: z.string().uuid(),
      organization_id: z.number().int().positive().optional(),
      title: z.string().min(3).max(256),
      scope: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Idempotent on client-generated case UUID (offline-created cases re-sync safely)
      const [row] = await exec(
        `INSERT INTO inspection_cases (case_uuid, organization_id, inspector_id, title, scope, status)
         VALUES ($1, $2, $3, $4, $5, 'open')
         ON CONFLICT (case_uuid) DO UPDATE SET updated_at = NOW()
         RETURNING *`,
        [input.case_uuid, input.organization_id ?? null, String(ctx.user.id), input.title, input.scope ?? null]
      );
      await logAudit("inspection_case_created", "inspection_cases", row?.id, String(ctx.user.id), { case_uuid: input.case_uuid });
      fireAndForget("fieldInspection.createCase");
      return row;
    }),

  listCases: staffProcedure
    .input(z.object({ status: z.string().optional(), organizationId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.status) { params.push(input.status); conditions.push(`c.status = $${params.length}`); }
      if (input?.organizationId) { params.push(input.organizationId); conditions.push(`c.organization_id = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(
        `SELECT c.*, (SELECT COUNT(*) FROM inspection_evidence e WHERE e.case_uuid = c.case_uuid AND e.deleted = false) AS evidence_count
         FROM inspection_cases c ${where} ORDER BY c.opened_at DESC LIMIT 200`,
        params
      );
    }),

  updateCaseStatus: staffProcedure
    .input(z.object({
      case_uuid: z.string().uuid(),
      status: z.enum(["open", "in_field", "synced", "closed"]),
    }))
    .mutation(async ({ input, ctx }) => {
      // Transition state machine: only CASE_TRANSITIONS moves are allowed
      // (closed is terminal — no closed -> open reopen).
      const allowed = Object.entries(CASE_TRANSITIONS)
        .filter(([, tos]) => tos.includes(input.status))
        .map(([from]) => `'${from}'`);
      if (!allowed.length) {
        throw new TRPCError({ code: "CONFLICT", message: `No transition to '${input.status}' is permitted` });
      }
      const [row] = await exec(
        `UPDATE inspection_cases
         SET status = $2, closed_at = CASE WHEN $2 = 'closed' THEN NOW() ELSE closed_at END, updated_at = NOW()
         WHERE case_uuid = $1 AND status IN (${allowed.join(",")}) RETURNING *`,
        [input.case_uuid, input.status]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: `Inspection case not found, or its current status cannot transition to '${input.status}'` });
      await logAudit("inspection_case_status", "inspection_cases", row.id, String(ctx.user.id), { status: input.status });
      fireAndForget("fieldInspection.updateCaseStatus");
      return row;
    }),

  // ─── Evidence sync ───────────────────────────────────────────────────────
  /**
   * Batch sync endpoint: accepts an array of offline-queued evidence items for
   * one case. Upsert is idempotent by client UUID; conflicts are resolved
   * last-write-wins and logged.
   */
  syncBatch: staffProcedure
    .input(z.object({
      case_uuid: z.string().uuid(),
      client_device_id: z.string().min(1).max(128),
      items: z.array(syncItemSchema).min(1).max(500),
    }))
    .mutation(async ({ input, ctx }) => {
      // Inspector ownership: only the case's owning inspector (or an admin)
      // may sync evidence into it.
      const caseRows = await exec(`SELECT id, inspector_id FROM inspection_cases WHERE case_uuid = $1`, [input.case_uuid]);
      if (!caseRows[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Inspection case not found — create the case first" });
      }
      const isAdmin = (ctx.user as any).role === "admin";
      if (!isAdmin && String(caseRows[0].inspector_id) !== String(ctx.user.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the assigned inspector (or an admin) may sync this case" });
      }
      const results: Array<{
        evidence_uuid: string;
        outcome: "inserted" | "updated" | "conflict_server_wins" | "conflict_client_wins" | "unchanged";
      }> = [];

      // Whole batch in ONE transaction on ONE connection: a partial sync must
      // never leave half-written evidence.
      const pool = getPool();
      if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const client = await pool.connect();
      const tx = async (q: string, p: unknown[] = []) => {
        const safe = p.map((v) =>
          Array.isArray(v) || (v !== null && typeof v === "object" && !(v instanceof Date))
            ? JSON.stringify(v) : v);
        return (await client.query(q, safe)).rows ?? [];
      };
      try {
        await client.query("BEGIN");
        for (const item of input.items) {
          const clientUpdatedAt = new Date(item.client_updated_at);
          if (Number.isNaN(clientUpdatedAt.getTime())) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid client_updated_at for ${item.evidence_uuid}` });
          }
          const existing = await tx(`SELECT * FROM inspection_evidence WHERE evidence_uuid = $1 FOR UPDATE`, [item.evidence_uuid]);

          if (!existing[0]) {
            const inserted = await tx(
              `INSERT INTO inspection_evidence
                 (evidence_uuid, case_uuid, client_device_id, evidence_type, payload,
                  captured_at, client_updated_at, version_vector, deleted)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
               ON CONFLICT (evidence_uuid) DO NOTHING
               RETURNING evidence_uuid`,
              [
                item.evidence_uuid, input.case_uuid, input.client_device_id, item.evidence_type,
                item.payload ?? {}, item.captured_at ?? null, item.client_updated_at,
                item.version_vector ?? {}, item.deleted,
              ]
            );
            if (inserted[0]) {
              results.push({ evidence_uuid: item.evidence_uuid, outcome: "inserted" });
              continue;
            }
            // Raced insert: re-read and fall through to conflict handling.
            existing.push(...(await tx(`SELECT * FROM inspection_evidence WHERE evidence_uuid = $1 FOR UPDATE`, [item.evidence_uuid])));
          }

          const server = existing[0];
          const serverTime = new Date(server.client_updated_at).getTime();
          // Canonical (key-order-insensitive) compare — jsonb semantics.
          if (clientUpdatedAt.getTime() === serverTime
              && canonicalStringify(server.payload ?? {}) === canonicalStringify(item.payload ?? {})
              && Boolean(server.deleted) === item.deleted) {
            results.push({ evidence_uuid: item.evidence_uuid, outcome: "unchanged" });
            continue;
          }

          const mergedVector = mergeVectorClocks(server.version_vector, item.version_vector);
          if (clientWriteWins(server, clientUpdatedAt)) {
            await tx(
              `UPDATE inspection_evidence
               SET evidence_type = $2, payload = $3, captured_at = COALESCE($4, captured_at),
                   client_updated_at = $5, server_updated_at = NOW(), version_vector = $6,
                   deleted = $7, client_device_id = $8
               WHERE evidence_uuid = $1`,
              [
                item.evidence_uuid, item.evidence_type, item.payload ?? {},
                item.captured_at ?? null, item.client_updated_at, mergedVector,
                item.deleted, input.client_device_id,
              ]
            );
            await tx(
              `INSERT INTO inspection_sync_conflicts
                 (evidence_uuid, case_uuid, client_device_id, conflict_field, client_value, server_value, resolution)
               VALUES ($1,$2,$3,$4,$5,$6,'client_wins')`,
              [
                item.evidence_uuid, input.case_uuid, input.client_device_id, "payload",
                { payload: item.payload ?? {}, deleted: item.deleted, client_updated_at: item.client_updated_at },
                { payload: server.payload ?? {}, deleted: server.deleted, client_updated_at: server.client_updated_at },
              ]
            );
            results.push({ evidence_uuid: item.evidence_uuid, outcome: "conflict_client_wins" });
          } else {
            // Server value is newer: log the rejected client write, keep server row
            await tx(
              `INSERT INTO inspection_sync_conflicts
                 (evidence_uuid, case_uuid, client_device_id, conflict_field, client_value, server_value, resolution)
               VALUES ($1,$2,$3,$4,$5,$6,'server_wins')`,
              [
                item.evidence_uuid, input.case_uuid, input.client_device_id, "payload",
                { payload: item.payload ?? {}, deleted: item.deleted, client_updated_at: item.client_updated_at },
                { payload: server.payload ?? {}, deleted: server.deleted, client_updated_at: server.client_updated_at },
              ]
            );
            results.push({ evidence_uuid: item.evidence_uuid, outcome: "conflict_server_wins" });
          }
        }

        await tx(`UPDATE inspection_cases SET status = 'synced', updated_at = NOW() WHERE case_uuid = $1 AND status IN ('open','in_field')`, [input.case_uuid]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (err instanceof TRPCError) throw err;
        logger.error({ err }, "[fieldInspection] syncBatch failed — rolled back");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Sync batch failed; no partial data written" });
      } finally {
        client.release();
      }
      await logAudit("inspection_sync_batch", "inspection_cases", caseRows[0].id, String(ctx.user.id), {
        case_uuid: input.case_uuid,
        device: input.client_device_id,
        items: input.items.length,
        outcomes: results.reduce((acc: Record<string, number>, r) => { acc[r.outcome] = (acc[r.outcome] ?? 0) + 1; return acc; }, {}),
      });
      fireAndForget("fieldInspection.syncBatch");
      return { case_uuid: input.case_uuid, processed: results.length, results };
    }),

  listEvidence: staffProcedure
    .input(z.object({ case_uuid: z.string().uuid(), includeDeleted: z.boolean().default(false) }))
    .query(async ({ input }) => {
      return exec(
        `SELECT * FROM inspection_evidence
         WHERE case_uuid = $1 ${input.includeDeleted ? "" : "AND deleted = false"}
         ORDER BY captured_at ASC NULLS LAST, created_at ASC`,
        [input.case_uuid]
      );
    }),

  listSyncConflicts: staffProcedure
    .input(z.object({ case_uuid: z.string().uuid().optional() }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input?.case_uuid) { params.push(input.case_uuid); where = `WHERE case_uuid = $${params.length}`; }
      return exec(`SELECT * FROM inspection_sync_conflicts ${where} ORDER BY created_at DESC LIMIT 200`, params);
    }),
});
