/**
 * International cooperation workflows router (FEAT-E, round 9).
 *
 *   - counterpart DPA registry (African DPAs / GPA members; seeded reference
 *     data, admin-managed);
 *   - MOU / cooperation instrument registry with effective dates;
 *   - mutual-assistance requests (outbound/inbound) with lifecycle
 *     draft -> sent -> acknowledged -> fulfilled/declined (withdrawable);
 *   - evidence-sharing packages linked to tribunal bundles BY REFERENCE AND
 *     HASH ONLY (bundle_merkle_root captured at share time; no content leaves
 *     the vault through this router);
 *   - statutory-deadline tracking for inbound requests.
 * Every mutation writes an audit_logs row, an icoop_request_events row where
 * applicable, and emits a mutation event.
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure, staffProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import {
  canTransitionRequest,
  statusTimestampColumn,
  deadlineState,
  formatRequestRef,
  formatInstrumentRef,
  ICOOP_STATUSES,
  type IcoopStatus,
} from "../services/icoopLogic";

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
    logger.error({ err, query: query.slice(0, 200) }, "[internationalCooperation] DB query error");
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
    logger.warn({ err, action, resourceType }, "[internationalCooperation] Audit log write failed");
  }
}

async function logEvent(requestId: number, eventType: string, actor: string, note: string | null): Promise<void> {
  await exec(
    `INSERT INTO icoop_request_events (request_id, event_type, actor, note) VALUES ($1, $2, $3, $4)`,
    [requestId, eventType, actor, note],
  );
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

export const internationalCooperationRouter = router({
  // ─── Counterpart DPA registry ────────────────────────────────────────────
  listCounterparts: protectedProcedure
    .input(z.object({ region: z.enum(["africa", "gpa", "other"]).optional(), activeOnly: z.boolean().default(true) }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.region) { params.push(input.region); conditions.push(`region = $${params.length}`); }
      if (input?.activeOnly !== false) conditions.push(`active IS TRUE`);
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(`SELECT * FROM counterpart_dpa_registry ${where} ORDER BY country ASC`, params);
    }),

  upsertCounterpart: adminProcedure
    .input(z.object({
      authority_key: z.string().min(2).max(64).regex(/^[a-z0-9_]+$/),
      name: z.string().min(2).max(256),
      country: z.string().min(2).max(128),
      region: z.enum(["africa", "gpa", "other"]),
      networks: z.array(z.string()).default([]),
      contact_name: z.string().max(256).optional(),
      contact_email: z.string().email().optional(),
      active: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const actor = ctx.user.name ?? String(ctx.user.id);
      const [row] = await exec(
        `INSERT INTO counterpart_dpa_registry
           (authority_key, name, country, region, networks, contact_name, contact_email, active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (authority_key) DO UPDATE SET
           name = EXCLUDED.name, country = EXCLUDED.country, region = EXCLUDED.region,
           networks = EXCLUDED.networks, contact_name = EXCLUDED.contact_name,
           contact_email = EXCLUDED.contact_email, active = EXCLUDED.active, updated_at = NOW()
         RETURNING *`,
        [input.authority_key, input.name, input.country, input.region, input.networks,
         input.contact_name ?? null, input.contact_email ?? null, input.active, actor],
      );
      await logAudit("counterpart_dpa_upserted", "counterpart_dpa_registry", row.id, String(ctx.user.id), { authority_key: input.authority_key });
      fireAndForget("internationalCooperation.upsertCounterpart");
      return row;
    }),

  // ─── MOU / instrument registry ───────────────────────────────────────────
  registerMou: adminProcedure
    .input(z.object({
      title: z.string().min(5).max(512),
      counterpart_dpa_id: z.number().int().positive(),
      instrument_type: z.enum(["mou", "treaty", "arrangement", "administrative_agreement"]).default("mou"),
      signed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      document_ref: z.string().max(1024).optional(),
      document_hash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
      notes: z.string().max(4000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const dpa = await exec(`SELECT id FROM counterpart_dpa_registry WHERE id = $1`, [input.counterpart_dpa_id]);
      if (!dpa[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Counterpart DPA not found" });
      const year = new Date().getUTCFullYear();
      const [{ n }] = await exec(`SELECT COUNT(*)::int + 1 AS n FROM mou_registry WHERE instrument_ref LIKE $1`, [`MOU-${year}-%`]);
      const ref = formatInstrumentRef(year, Number(n));
      const status = input.effective_date ? "in_force" : "draft";
      const [row] = await exec(
        `INSERT INTO mou_registry
           (instrument_ref, title, counterpart_dpa_id, instrument_type, signed_date, effective_date,
            expiry_date, status, document_ref, document_hash, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [ref, input.title, input.counterpart_dpa_id, input.instrument_type,
         input.signed_date ?? null, input.effective_date ?? null, input.expiry_date ?? null,
         status, input.document_ref ?? null, input.document_hash ?? null, input.notes ?? null,
         ctx.user.name ?? String(ctx.user.id)],
      );
      await logAudit("mou_registered", "mou_registry", row.id, String(ctx.user.id), { instrument_ref: ref });
      fireAndForget("internationalCooperation.registerMou");
      return row;
    }),

  listMous: protectedProcedure
    .input(z.object({ status: z.enum(["draft", "in_force", "expired", "terminated"]).optional() }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input?.status) { params.push(input.status); where = `WHERE m.status = $1`; }
      return exec(
        `SELECT m.*, d.name AS counterpart_name, d.country AS counterpart_country
         FROM mou_registry m LEFT JOIN counterpart_dpa_registry d ON d.id = m.counterpart_dpa_id
         ${where} ORDER BY m.created_at DESC LIMIT 500`,
        params,
      );
    }),

  // ─── Mutual-assistance requests ──────────────────────────────────────────
  createRequest: staffProcedure
    .input(z.object({
      direction: z.enum(["outbound", "inbound"]),
      counterpart_dpa_id: z.number().int().positive(),
      mou_id: z.number().int().positive().optional(),
      subject: z.string().min(5).max(512),
      legal_basis: z.string().max(4000).optional(),
      statutory_deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.direction === "outbound" && input.statutory_deadline) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "statutory_deadline applies to inbound requests only" });
      }
      const dpa = await exec(`SELECT id, active FROM counterpart_dpa_registry WHERE id = $1`, [input.counterpart_dpa_id]);
      if (!dpa[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Counterpart DPA not found" });
      const year = new Date().getUTCFullYear();
      const [{ nextval }] = await exec(`SELECT nextval('icma_ref_seq') AS nextval`);
      const ref = formatRequestRef(year, Number(nextval));
      const actor = ctx.user.name ?? String(ctx.user.id);
      const [row] = await exec(
        `INSERT INTO mutual_assistance_requests
           (request_ref, direction, counterpart_dpa_id, mou_id, subject, legal_basis, statutory_deadline, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [ref, input.direction, input.counterpart_dpa_id, input.mou_id ?? null,
         input.subject, input.legal_basis ?? null, input.statutory_deadline ?? null, actor],
      );
      await logEvent(row.id, "created", actor, null);
      await logAudit("icma_request_created", "mutual_assistance_requests", row.id, String(ctx.user.id), { request_ref: ref, direction: input.direction });
      fireAndForget("internationalCooperation.createRequest");
      return row;
    }),

  transitionRequest: staffProcedure
    .input(z.object({
      id: z.number().int().positive(),
      to: z.enum(ICOOP_STATUSES),
      note: z.string().max(2000).optional(),
      decline_reason: z.string().min(5).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const req = await exec(`SELECT * FROM mutual_assistance_requests WHERE id = $1`, [input.id]);
      if (!req[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      if (!canTransitionRequest(req[0].status, input.to)) {
        throw new TRPCError({ code: "CONFLICT", message: `Invalid transition ${req[0].status} -> ${input.to}` });
      }
      if (input.to === "declined" && !input.decline_reason) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "decline_reason required when declining" });
      }
      const tsCol = statusTimestampColumn(input.to as IcoopStatus);
      const actor = ctx.user.name ?? String(ctx.user.id);
      const [row] = await exec(
        `UPDATE mutual_assistance_requests
         SET status = $2,
             ${tsCol ? `${tsCol} = NOW(),` : ""}
             decline_reason = CASE WHEN $2 = 'declined' THEN $3 ELSE decline_reason END,
             updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [input.id, input.to, input.decline_reason ?? null],
      );
      await logEvent(input.id, input.to, actor, input.note ?? null);
      await logAudit("icma_request_transitioned", "mutual_assistance_requests", input.id, String(ctx.user.id), {
        from: req[0].status, to: input.to,
      });
      fireAndForget("internationalCooperation.transitionRequest");
      return row;
    }),

  listRequests: protectedProcedure
    .input(z.object({
      direction: z.enum(["outbound", "inbound"]).optional(),
      status: z.enum(ICOOP_STATUSES).optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.direction) { params.push(input.direction); conditions.push(`r.direction = $${params.length}`); }
      if (input?.status) { params.push(input.status); conditions.push(`r.status = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      params.push(input?.limit ?? 100);
      const rows = await exec(
        `SELECT r.*, d.name AS counterpart_name, d.country AS counterpart_country
         FROM mutual_assistance_requests r
         JOIN counterpart_dpa_registry d ON d.id = r.counterpart_dpa_id
         ${where} ORDER BY r.created_at DESC LIMIT $${params.length}`,
        params,
      );
      return rows.map((r) => ({ ...r, deadline_state: deadlineState(r) }));
    }),

  /** Inbound requests approaching / past statutory deadline. */
  inboundDeadlineDashboard: staffProcedure.query(async () => {
    const rows = await exec(
      `SELECT r.*, d.name AS counterpart_name, d.country AS counterpart_country
       FROM mutual_assistance_requests r
       JOIN counterpart_dpa_registry d ON d.id = r.counterpart_dpa_id
       WHERE r.direction = 'inbound' AND r.status IN ('sent', 'acknowledged')
       ORDER BY r.statutory_deadline ASC NULLS LAST LIMIT 500`,
    );
    return rows.map((r) => ({ ...r, deadline_state: deadlineState(r) }));
  }),

  requestTimeline: protectedProcedure
    .input(z.object({ request_id: z.number().int().positive() }))
    .query(async ({ input }) => {
      return exec(
        `SELECT * FROM icoop_request_events WHERE request_id = $1 ORDER BY created_at ASC`,
        [input.request_id],
      );
    }),

  // ─── Evidence-sharing packages (bundle reference + hash only) ────────────
  shareEvidencePackage: staffProcedure
    .input(z.object({
      request_id: z.number().int().positive(),
      tribunal_bundle_id: z.number().int().positive(),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const req = await exec(`SELECT * FROM mutual_assistance_requests WHERE id = $1`, [input.request_id]);
      if (!req[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      if (!["sent", "acknowledged"].includes(req[0].status)) {
        throw new TRPCError({ code: "CONFLICT", message: "Evidence can only be shared on sent/acknowledged requests" });
      }
      // Only sealed/exported tribunal bundles may be referenced; we capture the
      // merkle root (hash) — never bundle content — for integrity verification.
      const bundle = await exec(
        `SELECT id, merkle_root, status FROM tribunal_bundles WHERE id = $1`,
        [input.tribunal_bundle_id],
      );
      if (!bundle[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Tribunal bundle not found" });
      if (!bundle[0].merkle_root || !["sealed", "exported"].includes(bundle[0].status)) {
        throw new TRPCError({ code: "CONFLICT", message: "Bundle must be sealed (merkle root present) before sharing" });
      }
      const actor = ctx.user.name ?? String(ctx.user.id);
      const packageRef = `EVP-${input.request_id}-${input.tribunal_bundle_id}`;
      const [row] = await exec(
        `INSERT INTO icoop_evidence_packages
           (request_id, tribunal_bundle_id, bundle_merkle_root, package_ref, shared_at, shared_by, notes)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6)
         ON CONFLICT (package_ref) DO NOTHING RETURNING *`,
        [input.request_id, input.tribunal_bundle_id, bundle[0].merkle_root, packageRef, actor, input.notes ?? null],
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Evidence package already shared for this bundle" });
      await logEvent(input.request_id, "note", actor, `Evidence package ${packageRef} shared (bundle #${input.tribunal_bundle_id})`);
      await logAudit("icma_evidence_shared", "icoop_evidence_packages", row.id, String(ctx.user.id), {
        request_id: input.request_id, tribunal_bundle_id: input.tribunal_bundle_id,
      });
      fireAndForget("internationalCooperation.shareEvidencePackage");
      return row;
    }),

  listEvidencePackages: protectedProcedure
    .input(z.object({ request_id: z.number().int().positive() }))
    .query(async ({ input }) => {
      return exec(
        `SELECT id, request_id, tribunal_bundle_id, bundle_merkle_root, package_ref, shared_at, shared_by, notes, created_at
         FROM icoop_evidence_packages WHERE request_id = $1 ORDER BY created_at DESC`,
        [input.request_id],
      );
    }),
});
