/**
 * Compliance Scanning Router — regulator-side web/app compliance scanning
 * (NDPA 2023 ss. 25-26, 28; NDPC consent/cookie guidance).
 *
 * - Scan-target registry (auto-seeded from registered controllers, manual add)
 * - Scan scheduling (manual + cron-style interval via scan_crawler_worker)
 * - Run/finding browsing with severity filters
 * - Evidence attestation: verifies worker-captured artifact hashes and writes
 *   a hash-chained audit-ledger entry (anti-wipe vault sealing trail)
 * - Finding → enforcement-case referral (compliance_violations +
 *   enforcement_actions linkage)
 * - Suppression / allow-list workflow with dual control (approver ≠ requester,
 *   also enforced by a DB CHECK constraint in migration 0083)
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { appendLedger } from "../antiwipe/ledger";

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
    logger.error({ err, query: query.slice(0, 200) }, "[complianceScanning] DB query error");
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
    logger.warn({ err, action, resourceType }, "[complianceScanning] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const FINDING_TYPES = [
  "pre_consent_tracker", "missing_consent_banner", "cookie_before_consent",
  "dark_pattern_preticked", "dark_pattern_asymmetric_choice",
  "dark_pattern_forced_account", "tracker_detected", "fetch_error",
] as const;
const FINDING_STATUSES = ["open", "acknowledged", "suppressed", "referred", "resolved", "dismissed"] as const;
const TRACKER_CATEGORIES = [
  "analytics", "advertising", "social", "tag_manager", "session_replay",
  "fingerprinting", "ab_testing", "consent_management", "cdn", "other",
] as const;

const urlSchema = z.string().url().max(2048).refine(
  (u) => /^https?:\/\//i.test(u),
  { message: "base_url must include http(s) scheme" }
);

export const complianceScanningRouter = router({
  // ─── Scan target registry ────────────────────────────────────────────────
  listTargets: protectedProcedure
    .input(z.object({
      enabled: z.boolean().optional(),
      organizationId: z.number().int().positive().optional(),
      source: z.enum(["auto_seed", "manual"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.enabled !== undefined) { params.push(input.enabled); conditions.push(`t.enabled = $${params.length}`); }
      if (input?.organizationId) { params.push(input.organizationId); conditions.push(`t.organization_id = $${params.length}`); }
      if (input?.source) { params.push(input.source); conditions.push(`t.source = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(
        `SELECT t.*, o.name AS organization_name,
                (SELECT COUNT(*) FROM scan_runs r WHERE r.target_id = t.id) AS run_count,
                (SELECT COUNT(*) FROM scan_findings f WHERE f.target_id = t.id AND f.status = 'open') AS open_findings
           FROM scan_targets t
           LEFT JOIN organizations o ON o.id = t.organization_id
           ${where} ORDER BY t.created_at DESC LIMIT 500`,
        params
      );
    }),

  getTarget: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await exec(`SELECT * FROM scan_targets WHERE id = $1`, [input.id]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Scan target not found" });
      return rows[0];
    }),

  /** Manual add of a controller web property. */
  addTarget: adminProcedure
    .input(z.object({
      organization_id: z.number().int().positive().optional(),
      controller_name: z.string().min(2).max(256),
      base_url: urlSchema,
      scan_interval_hours: z.number().int().min(1).max(8760).default(168),
      crawl_paths: z.array(z.string().max(512)).max(49).default([]),
      max_pages: z.number().int().min(1).max(50).default(5),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.organization_id) {
        const org = await exec(`SELECT id FROM organizations WHERE id = $1`, [input.organization_id]);
        if (!org[0]) throw new TRPCError({ code: "BAD_REQUEST", message: "organization_id not found" });
      }
      const [row] = await exec(
        `INSERT INTO scan_targets
           (organization_id, controller_name, base_url, source, scan_interval_hours, crawl_paths, max_pages, notes, created_by)
         VALUES ($1, $2, $3, 'manual', $4, $5, $6, $7, $8)
         ON CONFLICT (base_url) DO NOTHING
         RETURNING *`,
        [input.organization_id ?? null, input.controller_name, input.base_url,
         input.scan_interval_hours, input.crawl_paths, input.max_pages,
         input.notes ?? null, ctx.user.name ?? String(ctx.user.id)]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "A target with this base_url already exists" });
      await logAudit("scan_target_added", "scan_targets", row.id, String(ctx.user.id), { base_url: input.base_url, source: "manual" });
      fireAndForget("complianceScanning.addTarget");
      return row;
    }),

  updateTarget: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      enabled: z.boolean().optional(),
      scan_interval_hours: z.number().int().min(1).max(8760).optional(),
      crawl_paths: z.array(z.string().max(512)).max(49).optional(),
      max_pages: z.number().int().min(1).max(50).optional(),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE scan_targets
            SET enabled = COALESCE($2, enabled),
                scan_interval_hours = COALESCE($3, scan_interval_hours),
                crawl_paths = COALESCE($4, crawl_paths),
                max_pages = COALESCE($5, max_pages),
                notes = COALESCE($6, notes),
                updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [input.id, input.enabled ?? null, input.scan_interval_hours ?? null,
         input.crawl_paths ?? null, input.max_pages ?? null, input.notes ?? null]
      );
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Scan target not found" });
      await logAudit("scan_target_updated", "scan_targets", input.id, String(ctx.user.id), {
        enabled: input.enabled, scan_interval_hours: input.scan_interval_hours,
      });
      fireAndForget("complianceScanning.updateTarget");
      return row;
    }),

  /**
   * Auto-seed targets from registered controllers (organizations table).
   * The organizations registry does not record controller websites, so the
   * caller supplies a base-url map for the organizations it wants seeded
   * (e.g. from the NDPC controller register import). Organizations without
   * a URL are reported in `skipped` — nothing is silently fabricated.
   */
  seedTargetsFromControllers: adminProcedure
    .input(z.object({
      urls: z.array(z.object({
        organization_id: z.number().int().positive(),
        base_url: urlSchema,
      })).min(1).max(1000),
      scan_interval_hours: z.number().int().min(1).max(8760).default(168),
    }))
    .mutation(async ({ input, ctx }) => {
      const seeded: any[] = [];
      const skipped: Array<{ organization_id: number; reason: string }> = [];
      for (const entry of input.urls) {
        const org = await exec(`SELECT id, name FROM organizations WHERE id = $1`, [entry.organization_id]);
        if (!org[0]) {
          skipped.push({ organization_id: entry.organization_id, reason: "organization not found" });
          continue;
        }
        const [row] = await exec(
          `INSERT INTO scan_targets
             (organization_id, controller_name, base_url, source, scan_interval_hours, created_by)
           VALUES ($1, $2, $3, 'auto_seed', $4, $5)
           ON CONFLICT (base_url) DO NOTHING
           RETURNING id, base_url`,
          [entry.organization_id, org[0].name, entry.base_url, input.scan_interval_hours,
           ctx.user.name ?? String(ctx.user.id)]
        );
        if (row) seeded.push(row);
        else skipped.push({ organization_id: entry.organization_id, reason: "base_url already registered" });
      }
      await logAudit("scan_targets_seeded", "scan_targets", null, String(ctx.user.id), {
        seeded: seeded.length, skipped: skipped.length,
      });
      fireAndForget("complianceScanning.seedTargetsFromControllers");
      return { seeded, skipped };
    }),

  // ─── Scan scheduling ─────────────────────────────────────────────────────
  /** Schedule a run immediately (default) or at a future time. Cron-style
   *  recurring scans are derived by the worker from target scan_interval_hours. */
  scheduleScan: adminProcedure
    .input(z.object({
      target_id: z.number().int().positive(),
      run_at: z.string().datetime({ offset: true }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const target = await exec(`SELECT id, enabled FROM scan_targets WHERE id = $1`, [input.target_id]);
      if (!target[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Scan target not found" });
      if (!target[0].enabled) throw new TRPCError({ code: "CONFLICT", message: "Target is disabled" });
      const [row] = await exec(
        `INSERT INTO scan_runs (target_id, trigger_type, scheduled_at, created_by)
         VALUES ($1, $2, COALESCE($3::timestamptz, NOW()), $4) RETURNING *`,
        [input.target_id, input.run_at ? "scheduled" : "manual", input.run_at ?? null,
         ctx.user.name ?? String(ctx.user.id)]
      );
      await logAudit("scan_scheduled", "scan_runs", row.id, String(ctx.user.id), {
        target_id: input.target_id, scheduled_at: row.scheduled_at,
      });
      fireAndForget("complianceScanning.scheduleScan");
      return row;
    }),

  cancelScan: adminProcedure
    .input(z.object({ run_id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE scan_runs SET status = 'cancelled', finished_at = NOW()
          WHERE id = $1 AND status = 'scheduled' RETURNING *`,
        [input.run_id]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Only a scheduled run can be cancelled" });
      await logAudit("scan_cancelled", "scan_runs", input.run_id, String(ctx.user.id), {});
      fireAndForget("complianceScanning.cancelScan");
      return row;
    }),

  // ─── Runs & artifacts ────────────────────────────────────────────────────
  listRuns: protectedProcedure
    .input(z.object({
      target_id: z.number().int().positive().optional(),
      status: z.enum(["scheduled", "running", "completed", "failed", "cancelled"]).optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.target_id) { params.push(input.target_id); conditions.push(`r.target_id = $${params.length}`); }
      if (input?.status) { params.push(input.status); conditions.push(`r.status = $${params.length}`); }
      params.push(input?.limit ?? 100);
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(
        `SELECT r.*, t.controller_name, t.base_url
           FROM scan_runs r JOIN scan_targets t ON t.id = r.target_id
           ${where} ORDER BY r.created_at DESC LIMIT $${params.length}`,
        params
      );
    }),

  listRunArtifacts: protectedProcedure
    .input(z.object({ run_id: z.number().int().positive() }))
    .query(async ({ input }) => {
      return exec(
        `SELECT id, run_id, target_id, artifact_type, url, sha256, size_bytes,
                fetched_at, metadata, attested, attested_by, attested_at, ledger_seq
           FROM scan_artifacts WHERE run_id = $1 ORDER BY id ASC`,
        [input.run_id]
      );
    }),

  /**
   * Attest an evidence artifact: re-reads the worker-recorded hash and writes
   * a hash-chained audit-ledger entry (anti-wipe trail) binding the artifact
   * hash, run and attesting officer. The ledger entry is the vault-sealing
   * record for content the crawler captured.
   */
  attestArtifact: adminProcedure
    .input(z.object({
      artifact_id: z.number().int().positive(),
      attestation_note: z.string().max(1000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `SELECT a.*, t.base_url, t.controller_name FROM scan_artifacts a
           JOIN scan_targets t ON t.id = a.target_id WHERE a.id = $1`,
        [input.artifact_id]
      );
      const artifact = rows[0];
      if (!artifact) throw new TRPCError({ code: "NOT_FOUND", message: "Artifact not found" });
      if (artifact.attested) throw new TRPCError({ code: "CONFLICT", message: "Artifact already attested" });
      if (!/^[0-9a-f]{64}$/.test(String(artifact.sha256))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Artifact hash is malformed — refusing to attest" });
      }
      const actor = ctx.user.name ?? String(ctx.user.id);
      const entry = await appendLedger("scan_artifact_attested", {
        artifact_id: artifact.id,
        run_id: artifact.run_id,
        target_id: artifact.target_id,
        controller: artifact.controller_name,
        base_url: artifact.base_url,
        artifact_type: artifact.artifact_type,
        url: artifact.url,
        sha256: artifact.sha256,
        size_bytes: artifact.size_bytes,
        fetched_at: artifact.fetched_at,
        note: input.attestation_note ?? null,
      }, actor);
      const [row] = await exec(
        `UPDATE scan_artifacts
            SET attested = TRUE, attested_by = $2, attested_at = NOW(), ledger_seq = $3
          WHERE id = $1 AND attested = FALSE RETURNING *`,
        [input.artifact_id, actor, entry.seq]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Artifact already attested (concurrent)" });
      await logAudit("scan_artifact_attested", "scan_artifacts", input.artifact_id, String(ctx.user.id), {
        sha256: artifact.sha256, ledger_seq: entry.seq,
      });
      fireAndForget("complianceScanning.attestArtifact");
      return { artifact: row, ledger_entry: { seq: entry.seq, entry_hash: entry.entryHash } };
    }),

  // ─── Findings ────────────────────────────────────────────────────────────
  listFindings: protectedProcedure
    .input(z.object({
      target_id: z.number().int().positive().optional(),
      run_id: z.number().int().positive().optional(),
      severity: z.enum(SEVERITIES).optional(),
      finding_type: z.enum(FINDING_TYPES).optional(),
      status: z.enum(FINDING_STATUSES).optional(),
      limit: z.number().int().min(1).max(1000).default(200),
    }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.target_id) { params.push(input.target_id); conditions.push(`f.target_id = $${params.length}`); }
      if (input?.run_id) { params.push(input.run_id); conditions.push(`f.run_id = $${params.length}`); }
      if (input?.severity) { params.push(input.severity); conditions.push(`f.severity = $${params.length}`); }
      if (input?.finding_type) { params.push(input.finding_type); conditions.push(`f.finding_type = $${params.length}`); }
      if (input?.status) { params.push(input.status); conditions.push(`f.status = $${params.length}`); }
      params.push(input?.limit ?? 200);
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(
        `SELECT f.*, t.controller_name, t.base_url
           FROM scan_findings f JOIN scan_targets t ON t.id = f.target_id
           ${where}
           ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                                    WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
                    f.detected_at DESC
           LIMIT $${params.length}`,
        params
      );
    }),

  getFinding: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await exec(
        `SELECT f.*, t.controller_name, t.base_url
           FROM scan_findings f JOIN scan_targets t ON t.id = f.target_id WHERE f.id = $1`,
        [input.id]
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Finding not found" });
      return rows[0];
    }),

  setFindingStatus: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      status: z.enum(["acknowledged", "resolved", "dismissed"]),
      resolution_notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE scan_findings
            SET status = $2,
                resolved_at = CASE WHEN $2 IN ('resolved', 'dismissed') THEN NOW() ELSE resolved_at END,
                resolved_by = CASE WHEN $2 IN ('resolved', 'dismissed') THEN $3 ELSE resolved_by END,
                resolution_notes = COALESCE($4, resolution_notes)
          WHERE id = $1 AND status IN ('open', 'acknowledged') RETURNING *`,
        [input.id, input.status, ctx.user.name ?? String(ctx.user.id), input.resolution_notes ?? null]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Finding not found or already closed" });
      await logAudit("scan_finding_status_set", "scan_findings", input.id, String(ctx.user.id), { status: input.status });
      fireAndForget("complianceScanning.setFindingStatus");
      return row;
    }),

  /**
   * Refer a finding to enforcement: creates a compliance_violations record
   * and a pending enforcement_actions case linked back to the finding.
   */
  referFindingToEnforcement: adminProcedure
    .input(z.object({
      finding_id: z.number().int().positive(),
      action_type: z.string().min(3).max(64).default("investigation_notice"),
      notes: z.string().min(10).max(4000),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `SELECT f.*, t.organization_id, t.controller_name
           FROM scan_findings f JOIN scan_targets t ON t.id = f.target_id WHERE f.id = $1`,
        [input.finding_id]
      );
      const finding = rows[0];
      if (!finding) throw new TRPCError({ code: "NOT_FOUND", message: "Finding not found" });
      if (finding.status === "referred") throw new TRPCError({ code: "CONFLICT", message: "Finding already referred" });
      if (!finding.organization_id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Target has no linked organization — link the scan target to a registered controller before referring",
        });
      }
      const [violation] = await exec(
        `INSERT INTO compliance_violations
           (organization_id, title, description, severity, status, enforcement_status, metadata)
         VALUES ($1, $2, $3, $4, 'non_compliant', 'pending', $5) RETURNING *`,
        [
          finding.organization_id,
          `Web compliance scan: ${finding.finding_type}${finding.tracker_name ? ` (${finding.tracker_name})` : ""}`,
          `Detected by NDSEP compliance scan run ${finding.run_id} on ${finding.url}. ${input.notes}`,
          finding.severity,
          { source: "complianceScanning", finding_id: finding.id, run_id: finding.run_id, evidence: finding.evidence },
        ]
      );
      const [action] = await exec(
        `INSERT INTO enforcement_actions (violation_id, organization_id, action_type, status, notes)
         VALUES ($1, $2, $3, 'pending', $4) RETURNING *`,
        [violation.id, finding.organization_id, input.action_type, input.notes]
      );
      const [updated] = await exec(
        `UPDATE scan_findings
            SET status = 'referred', enforcement_action_id = $2, resolution_notes = $3
          WHERE id = $1 AND status <> 'referred' RETURNING *`,
        [input.finding_id, action.id, input.notes]
      );
      await logAudit("scan_finding_referred", "scan_findings", input.finding_id, String(ctx.user.id), {
        violation_id: violation.id, enforcement_action_id: action.id,
      });
      fireAndForget("complianceScanning.referFindingToEnforcement");
      return { finding: updated, violation_id: violation.id, enforcement_action_id: action.id };
    }),

  // ─── Suppression / allow-list workflow (dual control) ────────────────────
  /** Any officer may request a suppression; it takes effect only after a
   *  DIFFERENT officer approves it (DB CHECK enforces approver ≠ requester). */
  requestSuppression: protectedProcedure
    .input(z.object({
      scope: z.enum(["finding_type", "tracker", "target", "finding"]),
      finding_type: z.enum(FINDING_TYPES).optional(),
      tracker_name: z.string().max(128).optional(),
      target_id: z.number().int().positive().optional(),
      finding_id: z.number().int().positive().optional(),
      reason: z.string().min(20).max(2000),
      expires_in_days: z.number().int().min(1).max(365).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const scopeFields: Record<string, unknown> = {
        finding_type: input.finding_type, tracker: input.tracker_name,
        target: input.target_id, finding: input.finding_id,
      };
      if (!scopeFields[input.scope]) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `scope '${input.scope}' requires its matching reference field` });
      }
      const requester = ctx.user.name ?? String(ctx.user.id);
      const [row] = await exec(
        `INSERT INTO scan_suppressions
           (scope, finding_type, tracker_name, target_id, finding_id, reason, requested_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7,
                 CASE WHEN $8::int IS NOT NULL THEN NOW() + ($8 || ' days')::interval ELSE NULL END)
         RETURNING *`,
        [input.scope, input.finding_type ?? null, input.tracker_name ?? null,
         input.target_id ?? null, input.finding_id ?? null, input.reason,
         requester, input.expires_in_days ?? null]
      );
      await logAudit("scan_suppression_requested", "scan_suppressions", row.id, String(ctx.user.id), {
        scope: input.scope, reason: input.reason.slice(0, 200),
      });
      fireAndForget("complianceScanning.requestSuppression");
      return row;
    }),

  /** Dual-control approval: the approver must differ from the requester. */
  approveSuppression: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const approver = ctx.user.name ?? String(ctx.user.id);
      const existing = await exec(`SELECT * FROM scan_suppressions WHERE id = $1`, [input.id]);
      if (!existing[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Suppression request not found" });
      if (existing[0].status !== "pending") throw new TRPCError({ code: "CONFLICT", message: "Suppression request is not pending" });
      if (existing[0].requested_by === approver) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Dual control: the requester cannot approve their own suppression" });
      }
      const [row] = await exec(
        `UPDATE scan_suppressions
            SET status = 'approved', approved_by = $2, approved_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status = 'pending' AND requested_by <> $2 RETURNING *`,
        [input.id, approver]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Approval raced or self-approval — request unchanged" });
      // Apply retroactively to matching open findings.
      let retro = 0;
      if (row.scope === "finding_type" && row.finding_type) {
        const r = await exec(
          `UPDATE scan_findings SET status = 'suppressed', suppression_id = $1
            WHERE status = 'open' AND finding_type = $2
              AND ($3::bigint IS NULL OR target_id = $3) RETURNING id`,
          [row.id, row.finding_type, row.target_id ?? null]
        );
        retro = r.length;
      } else if (row.scope === "tracker" && row.tracker_name) {
        const r = await exec(
          `UPDATE scan_findings SET status = 'suppressed', suppression_id = $1
            WHERE status = 'open' AND tracker_name = $2
              AND ($3::bigint IS NULL OR target_id = $3) RETURNING id`,
          [row.id, row.tracker_name, row.target_id ?? null]
        );
        retro = r.length;
      } else if (row.scope === "finding" && row.finding_id) {
        const r = await exec(
          `UPDATE scan_findings SET status = 'suppressed', suppression_id = $1
            WHERE status = 'open' AND id = $2 RETURNING id`,
          [row.id, row.finding_id]
        );
        retro = r.length;
      }
      await logAudit("scan_suppression_approved", "scan_suppressions", input.id, String(ctx.user.id), {
        approved_by: approver, retro_applied: retro,
      });
      fireAndForget("complianceScanning.approveSuppression");
      return { suppression: row, retro_applied_findings: retro };
    }),

  rejectSuppression: adminProcedure
    .input(z.object({ id: z.number().int().positive(), rejection_reason: z.string().min(10).max(2000) }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE scan_suppressions
            SET status = 'rejected', approved_by = $2, approved_at = NOW(), rejection_reason = $3, updated_at = NOW()
          WHERE id = $1 AND status = 'pending' RETURNING *`,
        [input.id, ctx.user.name ?? String(ctx.user.id), input.rejection_reason]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Suppression request is not pending" });
      await logAudit("scan_suppression_rejected", "scan_suppressions", input.id, String(ctx.user.id), {});
      fireAndForget("complianceScanning.rejectSuppression");
      return row;
    }),

  listSuppressions: protectedProcedure
    .input(z.object({ status: z.enum(["pending", "approved", "rejected", "expired", "revoked"]).optional() }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input?.status) { params.push(input.status); where = `WHERE status = $1`; }
      return exec(`SELECT * FROM scan_suppressions ${where} ORDER BY created_at DESC LIMIT 500`, params);
    }),

  // ─── Tracker signature reference data (configurable) ─────────────────────
  listTrackerSignatures: protectedProcedure
    .input(z.object({
      category: z.enum(TRACKER_CATEGORIES).optional(),
      active: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.category) { params.push(input.category); conditions.push(`category = $${params.length}`); }
      if (input?.active !== undefined) { params.push(input.active); conditions.push(`active = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(`SELECT * FROM tracker_signatures ${where} ORDER BY tracker_name ASC`, params);
    }),

  addTrackerSignature: adminProcedure
    .input(z.object({
      tracker_name: z.string().min(2).max(128).regex(/^[a-z0-9][a-z0-9-]*$/, "kebab-case name"),
      vendor: z.string().max(128).optional(),
      category: z.enum(TRACKER_CATEGORIES),
      domain_pattern: z.string().max(256).optional(),
      script_url_pattern: z.string().max(512).optional(),
      inline_pattern: z.string().max(512).optional(),
      cookie_name_pattern: z.string().max(256).optional(),
      default_severity: z.enum(SEVERITIES).default("medium"),
      notes: z.string().max(1000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!input.domain_pattern && !input.script_url_pattern && !input.inline_pattern && !input.cookie_name_pattern) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "At least one match pattern is required" });
      }
      const [row] = await exec(
        `INSERT INTO tracker_signatures
           (tracker_name, vendor, category, domain_pattern, script_url_pattern, inline_pattern, cookie_name_pattern, default_severity, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (tracker_name) DO NOTHING RETURNING *`,
        [input.tracker_name, input.vendor ?? null, input.category, input.domain_pattern ?? null,
         input.script_url_pattern ?? null, input.inline_pattern ?? null,
         input.cookie_name_pattern ?? null, input.default_severity, input.notes ?? null]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Signature with this tracker_name already exists" });
      await logAudit("tracker_signature_added", "tracker_signatures", row.id, String(ctx.user.id), { tracker_name: input.tracker_name });
      fireAndForget("complianceScanning.addTrackerSignature");
      return row;
    }),

  setTrackerSignatureActive: adminProcedure
    .input(z.object({ id: z.number().int().positive(), active: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE tracker_signatures SET active = $2 WHERE id = $1 RETURNING *`,
        [input.id, input.active]
      );
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Signature not found" });
      await logAudit("tracker_signature_toggled", "tracker_signatures", input.id, String(ctx.user.id), { active: input.active });
      fireAndForget("complianceScanning.setTrackerSignatureActive");
      return row;
    }),

  /** Dashboard rollup: finding counts by severity/status per target. */
  scanningOverview: protectedProcedure.query(async () => {
    const [row] = await exec(
      `SELECT
         (SELECT COUNT(*) FROM scan_targets WHERE enabled = TRUE) AS enabled_targets,
         (SELECT COUNT(*) FROM scan_runs WHERE status = 'completed') AS completed_runs,
         (SELECT COUNT(*) FROM scan_runs WHERE status = 'scheduled') AS scheduled_runs,
         (SELECT COUNT(*) FROM scan_findings WHERE status = 'open') AS open_findings,
         (SELECT COUNT(*) FROM scan_findings WHERE status = 'open' AND severity IN ('critical','high')) AS open_high_findings,
         (SELECT COUNT(*) FROM scan_suppressions WHERE status = 'pending') AS pending_suppressions,
         (SELECT COUNT(*) FROM scan_artifacts WHERE attested = FALSE) AS unattested_artifacts`
    );
    return row ?? {};
  }),
});
