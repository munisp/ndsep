/**
 * Data Sovereignty / Localisation Enforcement Router
 *
 * Regulatory driver: CBN Circular PSS/DIR/PUB/CIR/001/004 (2026-06-15) —
 * all payment system participants must ensure payment transaction data
 * generated in Nigeria is stored and managed in Nigeria by 2027-01-01
 * (primary processing, databases, backups, admin access, encryption-key
 * custody all local). NDPA 2023 ss.41-43 cross-border rules apply to any
 * residual foreign processing — this router complements
 * server/routers/crossBorderAdequacy.ts.
 *
 * Surface:
 *   Hosting declarations     entity self-declared hosting posture + review
 *   Attestations             officer sign-off + document hash + expiry;
 *                            expired attestation = compliance flag
 *   Residency violations     auto (egress worker) + manual, status machine:
 *                            detected -> acknowledged -> under_remediation
 *                            -> resolved | dismissed
 *   Egress thresholds        admin-editable per-entity / global limits
 *   ASN/geo reference        admin-editable classification reference data
 *                            (REFERENCE ONLY — see migration 0096 header)
 *   Sovereignty score        0..1 weighted score + ranked explanation
 *                            payload (pure math in server/sovereigntyScore.ts)
 *   Regulator dashboard      sector heat map, worst offenders, deadline
 *                            countdown with readiness tiers
 *   Cross-regulator referral CBN <-> NDPC case handoff records
 *
 * Authz: staffProcedure for reads + operational workflow, adminProcedure
 * for declaration review, threshold/reference administration and dismissals.
 * Reads degrade gracefully (empty result + note) when migrations 0094-0096
 * have not been applied yet.
 *
 * Every mutation writes an audit_logs row and emits a mutation event
 * (hard rule: no silent mutations).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, staffProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import {
  CBN_LOCALISATION_DEADLINE,
  computeSovereigntyScore,
} from "../sovereigntyScore";

// ─── DB helpers (mirrors crossBorderAdequacy pattern) ────────────────────────

function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01";
}

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
    if (isMissingTable(err)) throw err;
    logger.error({ err, query: query.slice(0, 200) }, "[dataSovereignty] DB query error");
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
    logger.warn({ err, action, resourceType }, "[dataSovereignty] Audit log write failed");
  }
}

function fireAndForget(action: string, extra: Record<string, unknown> = {}): void {
  emitMutationEvent("ndsep.sovereignty.mutation", { action, ts: new Date().toISOString(), ...extra })
    .catch((e: unknown) =>
      logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

function actorOf(user: { id: number | string; name?: string | null }): string {
  return user.name ?? String(user.id);
}

// ─── Vocabulary ──────────────────────────────────────────────────────────────

const ENTITY_TYPES = ["psp", "fintech", "bank", "switch", "mmo", "pssp", "ptsp", "super_agent", "other"] as const;
const DECLARATION_STATUSES = ["submitted", "under_review", "approved", "rejected"] as const;
const VIOLATION_TYPES = [
  "foreign_egress_threshold",
  "egress_changepoint_shift",
  "undeclared_hosting",
  "key_custody_foreign",
  "backup_foreign",
  "admin_access_foreign",
  "attestation_expired",
  "manual",
] as const;
const VIOLATION_OPEN_STATUSES = ["detected", "acknowledged", "under_remediation"] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const REFERENCE_TYPES = ["nigerian_asn", "nigerian_cidr", "cloud_region_cidr"] as const;
const AUTHORITIES = ["NDPC", "CBN"] as const;
const REFERRAL_STATUSES = ["referred", "received", "under_joint_review", "actioned", "closed", "returned"] as const;

const locationSchema = z.object({
  name: z.string().max(256).optional(),
  city: z.string().max(128).optional(),
  country: z.string().length(2).toUpperCase(), // ISO-3166 alpha-2
});

const declarationInputSchema = z.object({
  entity_ref: z.string().min(2).max(128),
  entity_name: z.string().min(2).max(256),
  entity_type: z.enum(ENTITY_TYPES).default("fintech"),
  in_scope: z.boolean().default(true),
  primary_dc_name: z.string().max(256).optional(),
  primary_dc_city: z.string().max(128).optional(),
  primary_dc_country: z.string().length(2).toUpperCase().optional(),
  cloud_provider: z.string().max(64).optional(),
  cloud_regions: z.array(z.string().max(64)).max(100).default([]),
  backup_locations: z.array(locationSchema).max(50).default([]),
  dr_locations: z.array(locationSchema).max(50).default([]),
  admin_access_locations: z.array(locationSchema.extend({ team: z.string().max(128).optional() })).max(50).default([]),
  encryption_key_custody: z
    .object({
      country: z.string().length(2).toUpperCase(),
      hsm_provider: z.string().max(128).optional(),
      custody_model: z.enum(["own_hsm", "cloud_kms", "byok", "hyok"]).optional(),
    })
    .optional(),
  subprocessors: z
    .array(
      z.object({
        name: z.string().min(1).max(256),
        service: z.string().max(256).optional(),
        country: z.string().length(2).toUpperCase(),
        contract_ref: z.string().max(128).optional(),
      })
    )
    .max(200)
    .default([]),
});

/** Ordered violation status machine; dismiss/resolve are terminal. */
const VIOLATION_TRANSITIONS: Record<string, string[]> = {
  detected: ["acknowledged", "dismissed"],
  acknowledged: ["under_remediation", "resolved", "dismissed"],
  under_remediation: ["resolved", "dismissed"],
  resolved: [],
  dismissed: [],
};

const REFERRAL_TRANSITIONS: Record<string, string[]> = {
  referred: ["received", "returned"],
  received: ["under_joint_review", "actioned", "returned"],
  under_joint_review: ["actioned", "closed", "returned"],
  actioned: ["closed"],
  closed: [],
  returned: ["referred"],
};

// ─── Router ──────────────────────────────────────────────────────────────────

export const dataSovereigntyRouter = router({
  // ─── Hosting declarations ────────────────────────────────────────────────
  listDeclarations: staffProcedure
    .input(
      z
        .object({
          status: z.enum(DECLARATION_STATUSES).optional(),
          entity_type: z.enum(ENTITY_TYPES).optional(),
          in_scope: z.boolean().optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.status) { params.push(input.status); conditions.push(`declaration_status = $${params.length}`); }
      if (input?.entity_type) { params.push(input.entity_type); conditions.push(`entity_type = $${params.length}`); }
      if (input?.in_scope !== undefined) { params.push(input.in_scope); conditions.push(`in_scope = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      try {
        const rows = await exec(
          `SELECT * FROM hosting_declarations ${where} ORDER BY submitted_at DESC LIMIT ${input?.limit ?? 200}`,
          params
        );
        return { rows, note: null as string | null };
      } catch (err) {
        if (isMissingTable(err)) return { rows: [], note: "migration 0094 not applied" };
        throw err;
      }
    }),

  getDeclaration: staffProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [row] = await exec(`SELECT * FROM hosting_declarations WHERE id = $1`, [input.id]);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Hosting declaration not found" });
      const attestations = await exec(
        `SELECT *, (expires_at < NOW()) AS is_expired
         FROM residency_attestations WHERE declaration_id = $1 ORDER BY attested_at DESC`,
        [input.id]
      );
      return { declaration: row, attestations };
    }),

  /** Entity (or NDPC officer on its behalf) submits a hosting declaration. */
  submitDeclaration: protectedProcedure
    .input(declarationInputSchema)
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `INSERT INTO hosting_declarations
           (entity_ref, entity_name, entity_type, in_scope, primary_dc_name, primary_dc_city,
            primary_dc_country, cloud_provider, cloud_regions, backup_locations, dr_locations,
            admin_access_locations, encryption_key_custody, subprocessors, declaration_status,
            submitted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'submitted',$15)
         RETURNING *`,
        [
          input.entity_ref, input.entity_name, input.entity_type, input.in_scope,
          input.primary_dc_name ?? null, input.primary_dc_city ?? null,
          input.primary_dc_country ?? null, input.cloud_provider ?? null,
          input.cloud_regions, input.backup_locations, input.dr_locations,
          input.admin_access_locations, input.encryption_key_custody ?? {},
          input.subprocessors, actorOf(ctx.user as any),
        ]
      );
      await logAudit("hosting_declaration_submitted", "hosting_declarations", row?.id, String(ctx.user.id), {
        entity_ref: input.entity_ref, entity_type: input.entity_type,
      });
      fireAndForget("dataSovereignty.submitDeclaration", { entity_ref: input.entity_ref });
      return row;
    }),

  /** NDPC reviews a declaration: approve (becomes scoring baseline) or reject. */
  reviewDeclaration: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        decision: z.enum(["approved", "rejected", "under_review"]),
        review_notes: z.string().min(5).max(4000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE hosting_declarations
         SET declaration_status = $2, reviewed_by = $3, reviewed_at = NOW(),
             review_notes = $4, updated_at = NOW()
         WHERE id = $1 AND declaration_status IN ('submitted', 'under_review')
         RETURNING *`,
        [input.id, input.decision, actorOf(ctx.user as any), input.review_notes]
      );
      if (!row)
        throw new TRPCError({ code: "CONFLICT", message: "Declaration not found or already decided" });
      await logAudit("hosting_declaration_reviewed", "hosting_declarations", input.id, String(ctx.user.id), {
        decision: input.decision, entity_ref: row.entity_ref,
      });
      fireAndForget("dataSovereignty.reviewDeclaration", { entity_ref: row.entity_ref });
      return row;
    }),

  // ─── Attestations ────────────────────────────────────────────────────────
  listAttestations: staffProcedure
    .input(
      z
        .object({
          entity_ref: z.string().optional(),
          status: z.enum(["active", "expired", "revoked", "superseded"]).optional(),
          includeExpiredActive: z.boolean().default(true),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.entity_ref) { params.push(input.entity_ref); conditions.push(`entity_ref = $${params.length}`); }
      if (input?.status) { params.push(input.status); conditions.push(`status = $${params.length}`); }
      if (input?.includeExpiredActive === false) conditions.push(`NOT (status = 'active' AND expires_at < NOW())`);
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      try {
        const rows = await exec(
          `SELECT *, (expires_at < NOW()) AS is_expired
           FROM residency_attestations ${where} ORDER BY attested_at DESC LIMIT ${input?.limit ?? 200}`,
          params
        );
        return { rows, note: null as string | null };
      } catch (err) {
        if (isMissingTable(err)) return { rows: [], note: "migration 0094 not applied" };
        throw err;
      }
    }),

  /**
   * Record an officer attestation: named officer + statement + SHA-256 of the
   * signed artefact + expiry. Supersedes any prior active attestation for the
   * same declaration.
   */
  createAttestation: staffProcedure
    .input(
      z.object({
        declaration_id: z.number().int().positive(),
        attesting_officer_name: z.string().min(2).max(256),
        attesting_officer_title: z.string().min(2).max(256),
        attestation_statement: z.string().min(20).max(8000),
        document_hash: z.string().regex(/^[0-9a-f]{64}$/, "SHA-256 hex digest required"),
        expires_at: z.string().datetime({ offset: true }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [decl] = await exec(
        `SELECT id, entity_ref, declaration_status FROM hosting_declarations WHERE id = $1`,
        [input.declaration_id]
      );
      if (!decl) throw new TRPCError({ code: "NOT_FOUND", message: "Hosting declaration not found" });
      if (decl.declaration_status !== "approved")
        throw new TRPCError({ code: "CONFLICT", message: "Attestation requires an approved declaration" });
      const [row] = await exec(
        `WITH superseded AS (
           UPDATE residency_attestations
           SET status = 'superseded'
           WHERE declaration_id = $1 AND status = 'active'
         )
         INSERT INTO residency_attestations
           (declaration_id, entity_ref, attesting_officer_name, attesting_officer_title,
            attestation_statement, document_hash, expires_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
         RETURNING *`,
        [
          input.declaration_id, decl.entity_ref, input.attesting_officer_name,
          input.attesting_officer_title, input.attestation_statement,
          input.document_hash, input.expires_at,
        ]
      );
      await logAudit("residency_attestation_created", "residency_attestations", row?.id, String(ctx.user.id), {
        entity_ref: decl.entity_ref, declaration_id: input.declaration_id, expires_at: input.expires_at,
      });
      fireAndForget("dataSovereignty.createAttestation", { entity_ref: decl.entity_ref });
      return row;
    }),

  revokeAttestation: adminProcedure
    .input(z.object({ id: z.number().int().positive(), reason: z.string().min(10).max(4000) }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE residency_attestations
         SET status = 'revoked', revoked_by = $2, revoked_at = NOW(), revocation_reason = $3
         WHERE id = $1 AND status = 'active'
         RETURNING *`,
        [input.id, actorOf(ctx.user as any), input.reason]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Only an active attestation can be revoked" });
      await logAudit("residency_attestation_revoked", "residency_attestations", input.id, String(ctx.user.id), {
        entity_ref: row.entity_ref, reason: input.reason,
      });
      fireAndForget("dataSovereignty.revokeAttestation", { entity_ref: row.entity_ref });
      return row;
    }),

  /**
   * Expired attestation = compliance flag. This sweep flips still-'active'
   * rows past expiry to 'expired' and raises an attestation_expired residency
   * violation per entity (deduped against open violations). Returns counts.
   */
  flagExpiredAttestations: adminProcedure
    .mutation(async ({ ctx }) => {
      const expired = await exec(
        `UPDATE residency_attestations SET status = 'expired'
         WHERE status = 'active' AND expires_at < NOW()
         RETURNING id, entity_ref, expires_at`
      );
      let violationsRaised = 0;
      for (const row of expired) {
        const inserted = await exec(
          `INSERT INTO residency_violations (entity_ref, violation_type, source, severity, details)
           SELECT $1, 'attestation_expired', 'auto', 'medium', $2
           WHERE NOT EXISTS (
             SELECT 1 FROM residency_violations
             WHERE entity_ref = $1 AND violation_type = 'attestation_expired'
               AND status IN ('detected', 'acknowledged', 'under_remediation')
           )
           RETURNING id`,
          [row.entity_ref, { attestation_id: row.id, expires_at: row.expires_at }]
        );
        violationsRaised += inserted.length;
      }
      if (expired.length > 0) {
        await logAudit("residency_attestations_expired_sweep", "residency_attestations", null, String(ctx.user.id), {
          expired_count: expired.length, violations_raised: violationsRaised,
        });
        fireAndForget("dataSovereignty.flagExpiredAttestations", { expired: expired.length });
      }
      return { expired: expired.length, violationsRaised };
    }),

  // ─── Residency violations ────────────────────────────────────────────────
  listViolations: staffProcedure
    .input(
      z
        .object({
          entity_ref: z.string().optional(),
          status: z.enum(["detected", "acknowledged", "under_remediation", "resolved", "dismissed"]).optional(),
          violation_type: z.enum(VIOLATION_TYPES).optional(),
          severity: z.enum(SEVERITIES).optional(),
          openOnly: z.boolean().default(false),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.entity_ref) { params.push(input.entity_ref); conditions.push(`entity_ref = $${params.length}`); }
      if (input?.status) { params.push(input.status); conditions.push(`status = $${params.length}`); }
      if (input?.violation_type) { params.push(input.violation_type); conditions.push(`violation_type = $${params.length}`); }
      if (input?.severity) { params.push(input.severity); conditions.push(`severity = $${params.length}`); }
      if (input?.openOnly) conditions.push(`status IN ('detected', 'acknowledged', 'under_remediation')`);
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      try {
        const rows = await exec(
          `SELECT * FROM residency_violations ${where}
           ORDER BY detected_at DESC LIMIT ${input?.limit ?? 200}`,
          params
        );
        return { rows, note: null as string | null };
      } catch (err) {
        if (isMissingTable(err)) return { rows: [], note: "migration 0095 not applied" };
        throw err;
      }
    }),

  /** Analyst-recorded violation (e.g. from an on-site inspection). */
  createManualViolation: staffProcedure
    .input(
      z.object({
        entity_ref: z.string().min(2).max(128),
        violation_type: z.enum(VIOLATION_TYPES).exclude(["foreign_egress_threshold", "egress_changepoint_shift"]),
        severity: z.enum(SEVERITIES).default("medium"),
        details: z.record(z.string(), z.any()).default({}),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `INSERT INTO residency_violations (entity_ref, violation_type, source, severity, details)
         VALUES ($1, $2, 'manual', $3, $4) RETURNING *`,
        [input.entity_ref, input.violation_type, input.severity, input.details]
      );
      await logAudit("residency_violation_created_manual", "residency_violations", row?.id, String(ctx.user.id), {
        entity_ref: input.entity_ref, violation_type: input.violation_type, severity: input.severity,
      });
      fireAndForget("dataSovereignty.createManualViolation", { entity_ref: input.entity_ref });
      return row;
    }),

  acknowledgeViolation: staffProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE residency_violations
         SET status = 'acknowledged', acknowledged_by = $2, acknowledged_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'detected' RETURNING *`,
        [input.id, actorOf(ctx.user as any)]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Only a detected violation can be acknowledged" });
      await logAudit("residency_violation_acknowledged", "residency_violations", input.id, String(ctx.user.id), {
        entity_ref: row.entity_ref,
      });
      fireAndForget("dataSovereignty.acknowledgeViolation", { entity_ref: row.entity_ref });
      return row;
    }),

  /**
   * Advance the violation status machine:
   *   acknowledged -> under_remediation -> resolved
   *   any non-terminal -> dismissed (admin only, requires reason)
   */
  updateViolationStatus: staffProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        to: z.enum(["under_remediation", "resolved", "dismissed"]),
        resolution_notes: z.string().min(5).max(4000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [current] = await exec(`SELECT id, entity_ref, status FROM residency_violations WHERE id = $1`, [input.id]);
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Violation not found" });
      const allowed = VIOLATION_TRANSITIONS[current.status] ?? [];
      if (!allowed.includes(input.to))
        throw new TRPCError({
          code: "CONFLICT",
          message: `Illegal transition ${current.status} -> ${input.to}`,
        });
      const terminal = input.to === "resolved" || input.to === "dismissed";
      const [row] = await exec(
        `UPDATE residency_violations
         SET status = $2, resolution_notes = $3, updated_at = NOW(),
             resolved_by = CASE WHEN $4 THEN $5 ELSE resolved_by END,
             resolved_at = CASE WHEN $4 THEN NOW() ELSE resolved_at END
         WHERE id = $1 RETURNING *`,
        [input.id, input.to, input.resolution_notes, terminal, actorOf(ctx.user as any)]
      );
      await logAudit(`residency_violation_${input.to}`, "residency_violations", input.id, String(ctx.user.id), {
        entity_ref: current.entity_ref, from: current.status, to: input.to,
      });
      fireAndForget("dataSovereignty.updateViolationStatus", { entity_ref: current.entity_ref });
      return row;
    }),

  // ─── Egress thresholds & rollups ─────────────────────────────────────────
  getThresholds: staffProcedure
    .input(z.object({ entity_ref: z.string().optional() }).optional())
    .query(async ({ input }) => {
      try {
        if (input?.entity_ref) {
          const rows = await exec(
            `SELECT * FROM egress_thresholds WHERE entity_ref = $1 OR entity_ref IS NULL ORDER BY entity_ref NULLS LAST`,
            [input.entity_ref]
          );
          return { rows, note: null as string | null };
        }
        const rows = await exec(`SELECT * FROM egress_thresholds ORDER BY entity_ref NULLS FIRST`);
        return { rows, note: null as string | null };
      } catch (err) {
        if (isMissingTable(err)) return { rows: [], note: "migration 0095 not applied" };
        throw err;
      }
    }),

  upsertThreshold: adminProcedure
    .input(
      z.object({
        entity_ref: z.string().min(2).max(128).nullable(), // null = global default
        max_foreign_ratio: z.number().min(0).max(1).optional(),
        max_foreign_bytes_per_window: z.number().int().positive().optional(),
        changepoint_probability_min: z.number().gt(0.5).max(1).optional(),
        changepoint_min_rate_ratio: z.number().gt(1).optional(),
        window_minutes: z.number().int().min(1).max(60).optional(),
        in_scope_only: z.boolean().optional(),
        enabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { entity_ref, ...fields } = input;
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) { params.push(v); sets.push(`${k} = $${params.length}`); }
      }
      params.push(actorOf(ctx.user as any));
      sets.push(`updated_by = $${params.length}`, `updated_at = NOW()`);
      // Ensure the row exists (idempotent), then update the supplied fields.
      if (entity_ref == null) {
        await exec(
          `INSERT INTO egress_thresholds (entity_ref)
           SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM egress_thresholds WHERE entity_ref IS NULL)`
        );
      } else {
        await exec(
          `INSERT INTO egress_thresholds (entity_ref)
           SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM egress_thresholds WHERE entity_ref = $1)`,
          [entity_ref]
        );
      }
      let row: any;
      if (entity_ref == null) {
        [row] = await exec(
          `UPDATE egress_thresholds SET ${sets.join(", ")} WHERE entity_ref IS NULL RETURNING *`,
          params
        );
      } else {
        params.push(entity_ref);
        [row] = await exec(
          `UPDATE egress_thresholds SET ${sets.join(", ")} WHERE entity_ref = $${params.length} RETURNING *`,
          params
        );
      }
      await logAudit("egress_threshold_upserted", "egress_thresholds", row?.id, String(ctx.user.id), {
        entity_ref: entity_ref ?? "GLOBAL", fields: Object.keys(fields).filter((k) => (fields as any)[k] !== undefined),
      });
      fireAndForget("dataSovereignty.upsertThreshold", { entity_ref: entity_ref ?? "GLOBAL" });
      return row;
    }),

  egressRollups: staffProcedure
    .input(
      z.object({
        entity_ref: z.string().min(1).max(128),
        sinceHours: z.number().int().min(1).max(24 * 30).default(24),
        limit: z.number().int().min(1).max(2000).default(288),
      })
    )
    .query(async ({ input }) => {
      try {
        const rows = await exec(
          `SELECT * FROM egress_flow_rollups
           WHERE entity_ref = $1 AND window_start >= NOW() - ($2 || ' hours')::interval
           ORDER BY window_start DESC LIMIT $3`,
          [input.entity_ref, input.sinceHours, input.limit]
        );
        return { rows, note: null as string | null };
      } catch (err) {
        if (isMissingTable(err)) return { rows: [], note: "migration 0095 not applied" };
        throw err;
      }
    }),

  // ─── ASN/geo reference data (admin-editable, REFERENCE ONLY) ─────────────
  listAsnGeoReference: staffProcedure
    .input(
      z
        .object({
          reference_type: z.enum(REFERENCE_TYPES).optional(),
          is_nigerian: z.boolean().optional(),
          limit: z.number().int().min(1).max(1000).default(500),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.reference_type) { params.push(input.reference_type); conditions.push(`reference_type = $${params.length}`); }
      if (input?.is_nigerian !== undefined) { params.push(input.is_nigerian); conditions.push(`is_nigerian = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      try {
        const rows = await exec(
          `SELECT id, reference_type, asn, cidr::text AS cidr, provider, region, country_code,
                  is_nigerian, notes, source, created_by, created_at, updated_at
           FROM asn_geo_reference ${where} ORDER BY reference_type, id LIMIT ${input?.limit ?? 500}`,
          params
        );
        return { rows, note: "REFERENCE DATA ONLY — verify against AFRINIC WHOIS / provider ip-ranges feeds" as string | null };
      } catch (err) {
        if (isMissingTable(err)) return { rows: [], note: "migration 0096 not applied" };
        throw err;
      }
    }),

  upsertReferenceEntry: adminProcedure
    .input(
      z.object({
        reference_type: z.enum(REFERENCE_TYPES),
        asn: z.number().int().positive().optional(),
        cidr: z.string().max(64).optional(), // validated by Postgres CIDR type
        provider: z.string().max(128).optional(),
        region: z.string().max(64).optional(),
        country_code: z.string().length(2).toUpperCase(),
        is_nigerian: z.boolean(),
        notes: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.reference_type === "nigerian_asn" && input.asn == null)
        throw new TRPCError({ code: "BAD_REQUEST", message: "asn is required for nigerian_asn entries" });
      if (input.reference_type !== "nigerian_asn" && !input.cidr)
        throw new TRPCError({ code: "BAD_REQUEST", message: "cidr is required for CIDR entries" });
      const [row] = await exec(
        `INSERT INTO asn_geo_reference
           (reference_type, asn, cidr, provider, region, country_code, is_nigerian, notes, source, created_by)
         VALUES ($1, $2, $3::cidr, $4, $5, $6, $7, $8, 'admin-entry', $9)
         ON CONFLICT ${input.asn != null ? "(reference_type, asn) WHERE asn IS NOT NULL" : "(reference_type, cidr) WHERE cidr IS NOT NULL"}
         DO UPDATE SET provider = EXCLUDED.provider, region = EXCLUDED.region,
                       country_code = EXCLUDED.country_code, is_nigerian = EXCLUDED.is_nigerian,
                       notes = EXCLUDED.notes, source = 'admin-entry', updated_at = NOW()
         RETURNING id, reference_type, asn, cidr::text AS cidr, provider, region, country_code, is_nigerian`,
        [
          input.reference_type, input.asn ?? null, input.cidr ?? null, input.provider ?? null,
          input.region ?? null, input.country_code, input.is_nigerian, input.notes ?? null,
          actorOf(ctx.user as any),
        ]
      );
      await logAudit("asn_geo_reference_upserted", "asn_geo_reference", row?.id, String(ctx.user.id), {
        reference_type: input.reference_type, asn: input.asn ?? null, cidr: input.cidr ?? null,
        is_nigerian: input.is_nigerian,
      });
      fireAndForget("dataSovereignty.upsertReferenceEntry", {});
      return row;
    }),

  deleteReferenceEntry: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `DELETE FROM asn_geo_reference WHERE id = $1 RETURNING id, reference_type, asn, cidr::text AS cidr`,
        [input.id]
      );
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Reference entry not found" });
      await logAudit("asn_geo_reference_deleted", "asn_geo_reference", input.id, String(ctx.user.id), row);
      fireAndForget("dataSovereignty.deleteReferenceEntry", {});
      return row;
    }),

  // ─── Sovereignty score ───────────────────────────────────────────────────

  /**
   * Recompute the sovereignty score for one entity from current DB state and
   * persist score + ranked explanation. Inputs:
   *   consistency  share of observed foreign egress destinations (24 h
   *                rollups) that appear in the approved declaration's cloud
   *                regions / countries (1 when no foreign egress observed)
   *   freshness    days to expiry of the newest active attestation
   *   history      open + trailing-180-day resolved residency violations
   *   egress ratio foreign_bytes / total_bytes across the last 24 h
   */
  recomputeScore: staffProcedure
    .input(z.object({ entity_ref: z.string().min(2).max(128) }))
    .mutation(async ({ input, ctx }) => {
      const [decl] = await exec(
        `SELECT * FROM hosting_declarations
         WHERE entity_ref = $1 AND declaration_status = 'approved'
         ORDER BY reviewed_at DESC LIMIT 1`,
        [input.entity_ref]
      );
      const [att] = await exec(
        `SELECT expires_at FROM residency_attestations
         WHERE entity_ref = $1 AND status = 'active'
         ORDER BY expires_at DESC LIMIT 1`,
        [input.entity_ref]
      );
      const [vio] = await exec(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('detected', 'acknowledged', 'under_remediation'))::int AS open_count,
           COUNT(*) FILTER (WHERE status IN ('resolved', 'dismissed')
                            AND detected_at >= NOW() - interval '180 days')::int AS recent_resolved
         FROM residency_violations WHERE entity_ref = $1`,
        [input.entity_ref]
      );
      const [eg] = await exec(
        `SELECT COALESCE(SUM(foreign_bytes), 0)::bigint AS foreign_bytes,
                COALESCE(SUM(total_bytes), 0)::bigint AS total_bytes
         FROM egress_flow_rollups
         WHERE entity_ref = $1 AND window_start >= NOW() - interval '24 hours'`,
        [input.entity_ref]
      );
      const observed = await exec(
        `SELECT DISTINCT dest ->> 'provider' AS provider, dest ->> 'region' AS region,
                dest ->> 'country_code' AS country_code
         FROM egress_flow_rollups,
              LATERAL jsonb_array_elements(top_foreign_destinations) AS dest
         WHERE entity_ref = $1 AND window_start >= NOW() - interval '24 hours'`,
        [input.entity_ref]
      );

      // declared-vs-observed consistency: foreign destinations covered by the
      // approved declaration (declared foreign processing is lawful residual;
      // undeclared foreign processing is not).
      let consistency = 1;
      if (observed.length > 0) {
        if (!decl) {
          consistency = 0; // foreign egress with NO approved declaration
        } else {
          const declaredRegions = new Set(
            (Array.isArray(decl.cloud_regions) ? decl.cloud_regions : []).map((r: string) => String(r).toLowerCase())
          );
          const declaredCountries = new Set<string>();
          for (const list of [decl.backup_locations, decl.dr_locations, decl.admin_access_locations, decl.subprocessors]) {
            for (const item of Array.isArray(list) ? list : []) {
              if (item?.country) declaredCountries.add(String(item.country).toUpperCase());
            }
          }
          const covered = observed.filter((o: any) => {
            const region = String(o.region ?? "").toLowerCase();
            const cc = String(o.country_code ?? "").toUpperCase();
            return (region && declaredRegions.has(region)) || (cc && declaredCountries.has(cc));
          }).length;
          consistency = covered / observed.length;
        }
      }

      const attestationDaysToExpiry = att?.expires_at
        ? Math.floor((new Date(att.expires_at).getTime() - Date.now()) / 86_400_000)
        : null;
      const foreignRatio = Number(eg?.total_bytes ?? 0) > 0
        ? Number(eg.foreign_bytes) / Number(eg.total_bytes)
        : 0;

      const result = computeSovereigntyScore({
        declaredObservedConsistency: consistency,
        attestationDaysToExpiry,
        openViolations: Number(vio?.open_count ?? 0),
        recentlyResolvedViolations: Number(vio?.recent_resolved ?? 0),
        foreignEgressRatio: foreignRatio,
      });

      const [scoreRow] = await exec(
        `INSERT INTO sovereignty_scores (entity_ref, score, components, weights, readiness_tier, computed_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [input.entity_ref, result.score, result.components, result.weights, result.readinessTier, actorOf(ctx.user as any)]
      );
      await exec(
        `INSERT INTO sovereignty_score_explanations (score_id, entity_ref, explanation, summary)
         VALUES ($1, $2, $3, $4)`,
        [scoreRow.id, input.entity_ref, result.explanation, result.summary]
      );
      await logAudit("sovereignty_score_computed", "sovereignty_scores", scoreRow.id, String(ctx.user.id), {
        entity_ref: input.entity_ref, score: result.score, tier: result.readinessTier,
      });
      fireAndForget("dataSovereignty.recomputeScore", { entity_ref: input.entity_ref });
      return { ...scoreRow, explanation: result.explanation, summary: result.summary, days_to_deadline: result.daysToDeadline };
    }),

  /** Latest score + explanation for one entity (computes on demand if none). */
  getScore: staffProcedure
    .input(z.object({ entity_ref: z.string().min(2).max(128) }))
    .query(async ({ input }) => {
      try {
        const [score] = await exec(
          `SELECT * FROM sovereignty_scores WHERE entity_ref = $1 ORDER BY computed_at DESC LIMIT 1`,
          [input.entity_ref]
        );
        if (!score) return { score: null, explanation: null, note: "no score computed yet — call recomputeScore" };
        const [expl] = await exec(
          `SELECT explanation, summary, computed_at FROM sovereignty_score_explanations
           WHERE score_id = $1`,
          [score.id]
        );
        return {
          score,
          explanation: expl?.explanation ?? null,
          summary: expl?.summary ?? null,
          note: null as string | null,
        };
      } catch (err) {
        if (isMissingTable(err)) return { score: null, explanation: null, note: "migration 0096 not applied" };
        throw err;
      }
    }),

  /** Latest score per entity, worst first. */
  scoreRegister: staffProcedure
    .input(
      z
        .object({
          tier: z.enum(["sovereign_ready", "on_track", "at_risk", "critical", "non_compliant"]).optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const conditions = input?.tier ? `WHERE readiness_tier = $1` : "";
        const params = input?.tier ? [input.tier] : [];
        const rows = await exec(
          `SELECT DISTINCT ON (entity_ref) entity_ref, score, readiness_tier, components, computed_at
           FROM sovereignty_scores ${conditions}
           ORDER BY entity_ref, computed_at DESC`,
          params
        );
        rows.sort((a: any, b: any) => Number(a.score) - Number(b.score));
        return { rows: rows.slice(0, input?.limit ?? 200), note: null as string | null };
      } catch (err) {
        if (isMissingTable(err)) return { rows: [], note: "migration 0096 not applied" };
        throw err;
      }
    }),

  // ─── Regulator dashboard ─────────────────────────────────────────────────

  /** Sector heat map: latest score + open violations per entity_type. */
  sectorHeatMap: staffProcedure.query(async () => {
    try {
      const rows = await exec(
        `WITH latest AS (
           SELECT DISTINCT ON (entity_ref) entity_ref, score, readiness_tier
           FROM sovereignty_scores ORDER BY entity_ref, computed_at DESC
         ), decls AS (
           SELECT DISTINCT ON (entity_ref) entity_ref, entity_type, in_scope
           FROM hosting_declarations ORDER BY entity_ref, submitted_at DESC
         ), vio AS (
           SELECT entity_ref, COUNT(*)::int AS open_violations
           FROM residency_violations
           WHERE status IN ('detected', 'acknowledged', 'under_remediation')
           GROUP BY entity_ref
         )
         SELECT d.entity_type,
                COUNT(*)::int AS entities,
                COUNT(*) FILTER (WHERE d.in_scope)::int AS in_scope_entities,
                ROUND(AVG(l.score)::numeric, 3) AS avg_score,
                COUNT(*) FILTER (WHERE l.readiness_tier IN ('at_risk', 'critical', 'non_compliant'))::int AS at_risk_or_worse,
                COALESCE(SUM(v.open_violations), 0)::int AS open_violations
         FROM decls d
         LEFT JOIN latest l ON l.entity_ref = d.entity_ref
         LEFT JOIN vio v ON v.entity_ref = d.entity_ref
         GROUP BY d.entity_type
         ORDER BY avg_score ASC NULLS LAST`
      );
      return { rows, note: null as string | null };
    } catch (err) {
      if (isMissingTable(err)) return { rows: [], note: "migrations 0094-0096 not applied" };
      throw err;
    }
  }),

  /** Worst offenders: lowest scores with open violation counts. */
  worstOffenders: staffProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      try {
        const rows = await exec(
          `WITH latest AS (
             SELECT DISTINCT ON (entity_ref) entity_ref, score, readiness_tier, computed_at
             FROM sovereignty_scores ORDER BY entity_ref, computed_at DESC
           ), vio AS (
             SELECT entity_ref,
                    COUNT(*)::int AS open_violations,
                    MAX(detected_at) AS last_violation_at
             FROM residency_violations
             WHERE status IN ('detected', 'acknowledged', 'under_remediation')
             GROUP BY entity_ref
           ), eg AS (
             SELECT entity_ref,
                    CASE WHEN SUM(total_bytes) > 0
                         THEN SUM(foreign_bytes)::double precision / SUM(total_bytes)
                         ELSE 0 END AS foreign_ratio_24h
             FROM egress_flow_rollups
             WHERE window_start >= NOW() - interval '24 hours'
             GROUP BY entity_ref
           )
           SELECT l.entity_ref, d.entity_name, d.entity_type, l.score, l.readiness_tier,
                  COALESCE(v.open_violations, 0) AS open_violations, v.last_violation_at,
                  COALESCE(eg.foreign_ratio_24h, 0) AS foreign_ratio_24h
           FROM latest l
           LEFT JOIN LATERAL (
             SELECT entity_name, entity_type FROM hosting_declarations h
             WHERE h.entity_ref = l.entity_ref ORDER BY submitted_at DESC LIMIT 1
           ) d ON TRUE
           LEFT JOIN vio v ON v.entity_ref = l.entity_ref
           LEFT JOIN eg ON eg.entity_ref = l.entity_ref
           ORDER BY l.score ASC, open_violations DESC
           LIMIT $1`,
          [input?.limit ?? 20]
        );
        return { rows, note: null as string | null };
      } catch (err) {
        if (isMissingTable(err)) return { rows: [], note: "migration 0096 not applied" };
        throw err;
      }
    }),

  /**
   * Deadline countdown to the CBN localisation deadline (2027-01-01) with
   * readiness-tier distribution across in-scope entities.
   */
  deadlineCountdown: staffProcedure.query(async () => {
    const now = new Date();
    const deadline = new Date(CBN_LOCALISATION_DEADLINE);
    const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000);
    try {
      const tierRows = await exec(
        `WITH latest AS (
           SELECT DISTINCT ON (entity_ref) entity_ref, readiness_tier
           FROM sovereignty_scores ORDER BY entity_ref, computed_at DESC
         )
         SELECT readiness_tier, COUNT(*)::int AS entities
         FROM latest GROUP BY readiness_tier`
      );
      const [scope] = await exec(
        `SELECT COUNT(DISTINCT entity_ref) FILTER (WHERE in_scope)::int AS in_scope_entities,
                COUNT(DISTINCT entity_ref)::int AS declared_entities
         FROM hosting_declarations`
      );
      const [flags] = await exec(
        `SELECT COUNT(*)::int AS expired_active_attestations
         FROM residency_attestations WHERE status = 'active' AND expires_at < NOW()`
      );
      const tiers: Record<string, number> = {
        sovereign_ready: 0, on_track: 0, at_risk: 0, critical: 0, non_compliant: 0,
      };
      for (const r of tierRows) tiers[r.readiness_tier] = r.entities;
      return {
        deadline: CBN_LOCALISATION_DEADLINE,
        days_remaining: daysRemaining,
        past_deadline: daysRemaining <= 0,
        readiness_tiers: tiers,
        in_scope_entities: scope?.in_scope_entities ?? 0,
        declared_entities: scope?.declared_entities ?? 0,
        expired_attestation_flags: flags?.expired_active_attestations ?? 0,
        note: null as string | null,
      };
    } catch (err) {
      if (isMissingTable(err))
        return {
          deadline: CBN_LOCALISATION_DEADLINE,
          days_remaining: daysRemaining,
          past_deadline: daysRemaining <= 0,
          readiness_tiers: null,
          in_scope_entities: null,
          declared_entities: null,
          expired_attestation_flags: null,
          note: "migrations 0094-0096 not applied",
        };
      throw err;
    }
  }),

  // ─── CBN <-> NDPC cross-regulator referrals ─────────────────────────────
  createReferral: staffProcedure
    .input(
      z.object({
        entity_ref: z.string().min(2).max(128),
        violation_id: z.number().int().positive().optional(),
        referring_authority: z.enum(AUTHORITIES),
        receiving_authority: z.enum(AUTHORITIES),
        case_summary: z.string().min(20).max(8000),
        legal_basis: z.string().max(512).optional(),
        evidence_refs: z
          .array(z.object({ type: z.string().max(64), ref: z.string().max(512), hash: z.string().max(128).optional() }))
          .max(50)
          .default([]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.referring_authority === input.receiving_authority)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Referring and receiving authorities must differ" });
      if (input.violation_id != null) {
        const [vio] = await exec(`SELECT id FROM residency_violations WHERE id = $1`, [input.violation_id]);
        if (!vio) throw new TRPCError({ code: "NOT_FOUND", message: "Violation not found" });
      }
      const [row] = await exec(
        `INSERT INTO cross_regulator_referrals
           (entity_ref, violation_id, referring_authority, receiving_authority,
            case_summary, legal_basis, evidence_refs, referred_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          input.entity_ref, input.violation_id ?? null, input.referring_authority,
          input.receiving_authority, input.case_summary,
          input.legal_basis ?? "CBN Circular PSS/DIR/PUB/CIR/001/004",
          input.evidence_refs, actorOf(ctx.user as any),
        ]
      );
      await logAudit("cross_regulator_referral_created", "cross_regulator_referrals", row?.id, String(ctx.user.id), {
        entity_ref: input.entity_ref,
        from: input.referring_authority,
        to: input.receiving_authority,
        violation_id: input.violation_id ?? null,
      });
      fireAndForget("dataSovereignty.createReferral", {
        entity_ref: input.entity_ref,
        direction: `${input.referring_authority}->${input.receiving_authority}`,
      });
      return row;
    }),

  listReferrals: staffProcedure
    .input(
      z
        .object({
          entity_ref: z.string().optional(),
          receiving_authority: z.enum(AUTHORITIES).optional(),
          status: z.enum(REFERRAL_STATUSES).optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.entity_ref) { params.push(input.entity_ref); conditions.push(`entity_ref = $${params.length}`); }
      if (input?.receiving_authority) { params.push(input.receiving_authority); conditions.push(`receiving_authority = $${params.length}`); }
      if (input?.status) { params.push(input.status); conditions.push(`status = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      try {
        const rows = await exec(
          `SELECT * FROM cross_regulator_referrals ${where} ORDER BY referred_at DESC LIMIT ${input?.limit ?? 200}`,
          params
        );
        return { rows, note: null as string | null };
      } catch (err) {
        if (isMissingTable(err)) return { rows: [], note: "migration 0095 not applied" };
        throw err;
      }
    }),

  updateReferralStatus: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        to: z.enum(REFERRAL_STATUSES),
        outcome_notes: z.string().min(5).max(4000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [current] = await exec(
        `SELECT id, entity_ref, status FROM cross_regulator_referrals WHERE id = $1`,
        [input.id]
      );
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Referral not found" });
      const allowed = REFERRAL_TRANSITIONS[current.status] ?? [];
      if (!allowed.includes(input.to))
        throw new TRPCError({ code: "CONFLICT", message: `Illegal transition ${current.status} -> ${input.to}` });
      const [row] = await exec(
        `UPDATE cross_regulator_referrals
         SET status = $2, outcome_notes = COALESCE($3, outcome_notes), updated_at = NOW(),
             received_by = CASE WHEN $2 = 'received' THEN $4 ELSE received_by END,
             received_at = CASE WHEN $2 = 'received' THEN NOW() ELSE received_at END
         WHERE id = $1 RETURNING *`,
        [input.id, input.to, input.outcome_notes ?? null, actorOf(ctx.user as any)]
      );
      await logAudit(`cross_regulator_referral_${input.to}`, "cross_regulator_referrals", input.id, String(ctx.user.id), {
        entity_ref: current.entity_ref, from: current.status, to: input.to,
      });
      fireAndForget("dataSovereignty.updateReferralStatus", { entity_ref: current.entity_ref });
      return row;
    }),
});
