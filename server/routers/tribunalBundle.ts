/**
 * Tribunal Bundle Router (migration 0085)
 *
 * Assembles a court-facing, tamper-evident evidence bundle for an
 * enforcement case and anchors it into the anti-wipe audit ledger:
 *
 *   assembleBundle  staff; collects evidence-vault artifacts + SHA-256
 *                   hashes (server/antiwipe/vault), the hash-chain proof
 *                   segment covering case events (server/antiwipe/ledger),
 *                   the due-process log (appeals / hearings / response
 *                   windows — queried defensively with existence checks),
 *                   filings and determinations; builds a manifest JSON with
 *                   per-artifact hashes and a Merkle root
 *                   (server/services/merkle.ts); anchors the root via
 *                   appendLedger; transitions assembling -> sealed.
 *   requestExport   staff; opens a dual-control export request (72h TTL).
 *   approveExport   admin; two DISTINCT approvers, neither the requester —
 *                   the dual_control_requests maker-checker pattern (0080)
 *                   reimplemented on the bundle row because 0080's
 *                   action_type enum is fixed; second approval transitions
 *                   sealed -> exported.
 *   verifyBundle    admin + verifier roles; recomputes evidence hashes,
 *                   chain proofs and the Merkle root and returns a verdict.
 *                   This is the court-facing verification endpoint; every
 *                   call is written to the immutable bundle_access_log.
 *   getBundle / listBundles / accessLog  staff reads.
 *
 * Every mutation emits an audit event (emitMutationEvent) and seal/export
 * are additionally anchored into the hash-chained audit ledger.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, staffProcedure, adminProcedure, protectedProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { listEvidence, verifyEvidence, sha256Hex } from "../antiwipe/vault";
import { appendLedger, verifyChain, canonicalJson } from "../antiwipe/ledger";
import { merkleRoot, isHexDigest } from "../services/merkle";

// ─── DB helpers (same lazy-pool pattern as insiderThreat.ts) ────────────────

function requirePool() {
  const pool = getPool();
  if (!pool) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  }
  return pool;
}

/** True when the error is "relation does not exist" (migration pending). */
function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01";
}

async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const pool = requirePool();
  const safe = params.map((p) =>
    p !== null && typeof p === "object" && !(p instanceof Date) ? JSON.stringify(p) : p,
  );
  const result = await pool.query(sql, safe);
  return (result.rows ?? []) as T[];
}

/** Defensive existence check for tables owned by other modules. */
async function tableExists(name: string): Promise<boolean> {
  const rows = await query<{ reg: string | null }>(`SELECT to_regclass($1)::text AS reg`, [name]);
  return rows[0]?.reg != null;
}

function actorOf(user: { id: number; openId?: string | null }): string {
  return user.openId ?? String(user.id);
}

// ─── Bundle assembly internals ───────────────────────────────────────────────

interface BundleArtifactSpec {
  artifactType: "evidence" | "ledger_segment" | "due_process" | "filing" | "determination" | "manifest";
  ref: string;
  sha256: string;
  sizeBytes: number | null;
  metadata: Record<string, unknown>;
}

const EXPORT_TTL_HOURS = 72;
const MAX_LEDGER_SEGMENT_ENTRIES = 10_000;
const MAX_DUE_PROCESS_ROWS = 500;

/**
 * Due-process log for a case: notices, response windows (appeal deadlines),
 * hearings, stays. Every source table is optional — a missing migration
 * degrades that section to an empty list with an explicit note, never a
 * fake success.
 */
async function collectDueProcessLog(caseRef: string, fineIds: number[]) {
  const log: Record<string, unknown> = { notes: [] as string[] };
  const notes = log.notes as string[];

  if (await tableExists("enforcement_notices")) {
    const rows = await query(
      `SELECT id, notice_type, title, legal_instrument_ref, gazette_number,
              published_at, sanction_start, sanction_end, status, created_at
       FROM enforcement_notices
       WHERE organization_id IN (
               SELECT org_id FROM enforcement_fines WHERE id = ANY($1::int[]))
          OR legal_instrument_ref = $2
       ORDER BY created_at ASC LIMIT $3`,
      [fineIds.length ? fineIds : [-1], caseRef, MAX_DUE_PROCESS_ROWS],
    ).catch((err: unknown) => {
      if (isMissingTable(err)) return [];
      throw err;
    });
    log.notices = rows;
  } else {
    log.notices = [];
    notes.push("enforcement_notices table absent (migration 0050 not applied)");
  }

  if (await tableExists("penalty_appeals")) {
    const appeals = await query<{ id: number }>(
      `SELECT id, penalty_id, status, submitted_by, grounds_for_appeal,
              requested_outcome, appeal_deadline, created_at, reviewed_at
       FROM penalty_appeals
       WHERE penalty_id = ANY($1::int[])
       ORDER BY created_at ASC LIMIT $2`,
      [fineIds.length ? fineIds : [-1], MAX_DUE_PROCESS_ROWS],
    ).catch((err: unknown) => {
      if (isMissingTable(err)) return [] as Array<{ id: number }>;
      throw err;
    });
    log.appeals = appeals;
    const appealIds = appeals.map((a) => Number(a.id));

    if (appealIds.length && (await tableExists("appeal_hearings"))) {
      log.hearings = await query(
        `SELECT id, appeal_id, hearing_date, location, mode, status, outcome, created_at
         FROM appeal_hearings WHERE appeal_id = ANY($1::int[])
         ORDER BY hearing_date ASC LIMIT $2`,
        [appealIds, MAX_DUE_PROCESS_ROWS],
      );
    } else {
      log.hearings = [];
      if (appealIds.length) notes.push("appeal_hearings table absent (migration 0035 not applied)");
    }
  } else {
    log.appeals = [];
    log.hearings = [];
    notes.push("penalty_appeals table absent — no due-process appeal data available");
  }

  if (await tableExists("penalty_stays")) {
    log.stays = await query(
      `SELECT id, penalty_id, appeal_id, stay_reason, status, granted_at, lifted_at
       FROM penalty_stays WHERE penalty_id = ANY($1::int[])
       ORDER BY granted_at ASC LIMIT $2`,
      [fineIds.length ? fineIds : [-1], MAX_DUE_PROCESS_ROWS],
    );
  } else {
    log.stays = [];
    notes.push("penalty_stays table absent (migration 0035 not applied)");
  }
  return log;
}

/** Filings (tribunal escalations) + determinations (decided appeals/notices). */
async function collectFilingsAndDeterminations(fineIds: number[]) {
  let filings: unknown[] = [];
  if (await tableExists("tribunal_escalations")) {
    filings = await query(
      `SELECT id, appeal_id, penalty_id, tribunal_name, case_number,
              escalated_at, status, decision, decided_at
       FROM tribunal_escalations
       WHERE penalty_id = ANY($1::int[])
       ORDER BY escalated_at ASC LIMIT $2`,
      [fineIds.length ? fineIds : [-1], MAX_DUE_PROCESS_ROWS],
    );
  }
  let determinations: unknown[] = [];
  if (await tableExists("penalty_appeals")) {
    determinations = await query(
      `SELECT id, penalty_id, status, review_notes, reviewed_by, reviewed_at
       FROM penalty_appeals
       WHERE penalty_id = ANY($1::int[]) AND status IN ('upheld', 'dismissed')
       ORDER BY reviewed_at ASC LIMIT $2`,
      [fineIds.length ? fineIds : [-1], MAX_DUE_PROCESS_ROWS],
    );
  }
  return { filings, determinations };
}

/**
 * Hash-chain proof segment covering this case's audit-ledger events.
 * Case events are matched on the conventional payload keys
 * (caseRef / case_ref / caseId). Returns the seq range, the per-entry
 * hashes, and a single segment digest for the Merkle manifest.
 */
async function collectLedgerSegment(caseRef: string) {
  if (!(await tableExists("audit_ledger"))) {
    return { entries: [] as Array<Record<string, unknown>>, fromSeq: null, toSeq: null, digest: null, note: "audit_ledger absent (migration 0061 not applied)" };
  }
  const entries = await query(
    `SELECT seq, prev_hash, entry_hash, action, actor, created_at
     FROM audit_ledger
     WHERE payload->>'caseRef' = $1
        OR payload->>'case_ref' = $1
        OR payload->>'caseId' = $1
     ORDER BY seq ASC LIMIT $2`,
    [caseRef, MAX_LEDGER_SEGMENT_ENTRIES],
  );
  if (entries.length === 0) {
    return { entries, fromSeq: null, toSeq: null, digest: null, note: "no audit-ledger events recorded for this case" };
  }
  const hashes = entries.map((e) => String(e.entry_hash));
  return {
    entries,
    fromSeq: Number(entries[0].seq),
    toSeq: Number(entries[entries.length - 1].seq),
    digest: sha256Hex(hashes.join("")),
    note: null,
  };
}

async function writeAccessLog(
  bundleId: number,
  accessor: string,
  action: string,
  detail: Record<string, unknown> = {},
  verdict: string | null = null,
): Promise<void> {
  await query(
    `INSERT INTO bundle_access_log (bundle_id, accessor, action, verdict, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [bundleId, accessor, action, verdict, detail],
  );
}

async function getBundleRow(bundleId: number) {
  const rows = await query(`SELECT * FROM tribunal_bundles WHERE id = $1`, [bundleId]);
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "bundle not found" });
  return rows[0];
}

// ─── Verifier procedure: admin / staff / auditor / court verifier ────────────
// "Public-ish" in the sense that it is the externally exposed court-facing
// verification surface, but still authenticated and role-gated; every call
// lands in the immutable bundle_access_log.
const verifierProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const role = (ctx.user as { role?: string } | null)?.role;
  if (!ctx.user || !["admin", "government_staff", "auditor", "verifier"].includes(role ?? "")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "admin or verifier role required" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// ─── Router ──────────────────────────────────────────────────────────────────

export const tribunalBundleRouter = router({
  /**
   * Assemble + seal a tribunal bundle for a case. Idempotent per identical
   * artifact set: an existing sealed bundle with the same Merkle root is
   * returned instead of duplicating (the manifest content is deterministic
   * for unchanged inputs).
   */
  assembleBundle: staffProcedure
    .input(z.object({ caseId: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const actor = actorOf(ctx.user);
      const caseRef = input.caseId;

      // Resolve fines linked to the case (case_id numeric or reference text).
      const fines = await query<{ id: number }>(
        `SELECT id FROM enforcement_fines
         WHERE case_id::text = $1 OR fine_reference = $1 OR ndpc_reference = $1`,
        [caseRef],
      ).catch((err: unknown) => {
        if (isMissingTable(err)) return [] as Array<{ id: number }>;
        throw err;
      });
      const fineIds = fines.map((f) => Number(f.id));

      // 1. Evidence vault artifacts (hashes are the content addresses).
      let evidenceArtifacts: BundleArtifactSpec[] = [];
      let evidenceNote: string | null = null;
      try {
        const { entries } = await listEvidence({ caseRef, limit: 500 });
        evidenceArtifacts = entries.map((e) => ({
          artifactType: "evidence" as const,
          ref: e.hash,
          sha256: e.hash,
          sizeBytes: e.sizeBytes,
          metadata: {
            path: e.path,
            contentType: e.contentType,
            sealed: e.sealed,
            uploadedAt: e.createdAt,
            uploaderName: e.uploaderName,
          },
        }));
      } catch (err) {
        if (!isMissingTable(err)) throw err;
        evidenceNote = "evidence vault absent (migration 0060 not applied)";
      }

      // 2. Hash-chain proof segment.
      const segment = await collectLedgerSegment(caseRef);

      // 3. Due-process log (defensive: each source table optional).
      const dueProcess = await collectDueProcessLog(caseRef, fineIds);

      // 4. Filings + determinations.
      const { filings, determinations } = await collectFilingsAndDeterminations(fineIds);

      // Snapshot artifacts: the snapshot bytes live in metadata so the court
      // verifier can re-hash them without trusting live (mutable) tables.
      const snapshotArtifact = (
        artifactType: BundleArtifactSpec["artifactType"],
        ref: string,
        snapshot: unknown,
      ): BundleArtifactSpec => {
        const canonical = canonicalJson(snapshot);
        return {
          artifactType,
          ref,
          sha256: sha256Hex(canonical),
          sizeBytes: Buffer.byteLength(canonical, "utf8"),
          metadata: { snapshot },
        };
      };

      const artifacts: BundleArtifactSpec[] = [
        ...evidenceArtifacts,
        ...(segment.digest
          ? [{
              artifactType: "ledger_segment" as const,
              ref: `audit_ledger:${segment.fromSeq}-${segment.toSeq}`,
              sha256: segment.digest,
              sizeBytes: null,
              metadata: {
                fromSeq: segment.fromSeq,
                toSeq: segment.toSeq,
                entryHashes: segment.entries.map((e) => String(e.entry_hash)),
              },
            }]
          : []),
        snapshotArtifact("due_process", `due_process:${caseRef}`, dueProcess),
        snapshotArtifact("filing", `filings:${caseRef}`, filings),
        snapshotArtifact("determination", `determinations:${caseRef}`, determinations),
      ];

      const leafHashes = artifacts.map((a) => a.sha256);
      const root = merkleRoot(leafHashes);

      // Idempotent reuse: same root => identical bundle already sealed.
      const existing = await query(
        `SELECT id, status, merkle_root FROM tribunal_bundles
         WHERE case_ref = $1 AND merkle_root = $2 AND status IN ('sealed', 'exported')
         ORDER BY id DESC LIMIT 1`,
        [caseRef, root],
      );
      if (existing[0]) {
        return {
          bundleId: Number(existing[0].id),
          caseRef,
          status: existing[0].status,
          merkleRoot: root,
          artifactCount: artifacts.length,
          deduplicated: true,
          notes: [evidenceNote, segment.note].filter(Boolean),
        };
      }

      const inserted = await query<{ id: string }>(
        `INSERT INTO tribunal_bundles (case_ref, status, artifact_count, assembled_by)
         VALUES ($1, 'assembling', $2, $3) RETURNING id`,
        [caseRef, artifacts.length, actor],
      );
      const bundleId = Number(inserted[0].id);

      const manifest = {
        bundleId,
        caseRef,
        assembledAt: new Date().toISOString(),
        assembledBy: actor,
        algorithm: "sha256-merkle(hex-concat, odd-leaf-duplicated)",
        artifacts: artifacts.map((a, i) => ({
          merkleIndex: i,
          artifactType: a.artifactType,
          ref: a.ref,
          sha256: a.sha256,
          sizeBytes: a.sizeBytes,
        })),
        ledgerSegment: segment.fromSeq
          ? { fromSeq: segment.fromSeq, toSeq: segment.toSeq, digest: segment.digest }
          : null,
        merkleRoot: root,
        notes: [evidenceNote, segment.note].filter(Boolean),
      };

      await query(
        `UPDATE tribunal_bundles SET manifest = $2, merkle_root = $3,
                chain_segment_from = $4, chain_segment_to = $5, updated_at = now()
         WHERE id = $1`,
        [bundleId, manifest, root, segment.fromSeq, segment.toSeq],
      );
      for (const [i, a] of Array.from(artifacts.entries())) {
        await query(
          `INSERT INTO bundle_artifacts (bundle_id, merkle_index, artifact_type, ref, sha256, size_bytes, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [bundleId, i, a.artifactType, a.ref, a.sha256, a.sizeBytes, a.metadata],
        );
      }

      // Anchor the Merkle root into the hash-chained audit ledger.
      const anchor = await appendLedger(
        "tribunal_bundle.sealed",
        { bundleId, caseRef, merkleRoot: root, artifactCount: artifacts.length },
        actor,
      );
      await query(
        `UPDATE tribunal_bundles
         SET status = 'sealed', sealed_at = now(), sealed_by = $2,
             ledger_anchor_seq = $3, ledger_anchor_hash = $4, updated_at = now()
         WHERE id = $1`,
        [bundleId, actor, anchor.seq, anchor.entryHash],
      );
      await writeAccessLog(bundleId, actor, "assemble", { merkleRoot: root });
      await emitMutationEvent("tribunal.bundle.sealed", {
        bundleId, caseRef, merkleRoot: root, actor,
      }).catch(() => undefined);

      return {
        bundleId,
        caseRef,
        status: "sealed" as const,
        merkleRoot: root,
        artifactCount: artifacts.length,
        ledgerAnchorSeq: anchor.seq,
        manifest,
        deduplicated: false,
        notes: [evidenceNote, segment.note].filter(Boolean),
      };
    }),

  /** Bundle detail (manifest + artifacts); the view itself is access-logged. */
  getBundle: staffProcedure
    .input(z.object({ bundleId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const bundle = await getBundleRow(input.bundleId);
      const artifacts = await query(
        `SELECT merkle_index, artifact_type, ref, sha256, size_bytes, metadata, created_at
         FROM bundle_artifacts WHERE bundle_id = $1 ORDER BY merkle_index ASC`,
        [input.bundleId],
      );
      await writeAccessLog(input.bundleId, actorOf(ctx.user), "view", {});
      return { bundle, artifacts };
    }),

  listBundles: staffProcedure
    .input(
      z.object({
        caseRef: z.string().max(128).optional(),
        status: z.enum(["assembling", "sealed", "exported"]).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }).optional(),
    )
    .query(async ({ input }) => {
      const rows = await query(
        `SELECT id, case_ref, status, merkle_root, artifact_count,
                ledger_anchor_seq, assembled_by, assembled_at, sealed_at, exported_at
         FROM tribunal_bundles
         WHERE ($1::text IS NULL OR case_ref = $1)
           AND ($2::text IS NULL OR status = $2)
         ORDER BY id DESC LIMIT $3`,
        [input?.caseRef ?? null, input?.status ?? null, input?.limit ?? 50],
      );
      return { rows };
    }),

  /** Immutable access log for a bundle. */
  accessLog: staffProcedure
    .input(z.object({
      bundleId: z.number().int().positive(),
      limit: z.number().int().min(1).max(500).default(100),
    }))
    .query(async ({ input }) => {
      const rows = await query(
        `SELECT id, accessor, action, verdict, detail, accessed_at
         FROM bundle_access_log WHERE bundle_id = $1
         ORDER BY accessed_at DESC LIMIT $2`,
        [input.bundleId, input.limit],
      );
      return { rows };
    }),

  /** Open a dual-control export request on a sealed bundle (72h TTL). */
  requestExport: staffProcedure
    .input(z.object({
      bundleId: z.number().int().positive(),
      exportedTo: z.string().min(2).max(256),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = actorOf(ctx.user);
      const bundle = await getBundleRow(input.bundleId);
      if (bundle.status !== "sealed") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `bundle is '${bundle.status}' — only sealed bundles can be exported`,
        });
      }
      if (
        bundle.export_requested_by &&
        new Date(String(bundle.export_expires_at)).getTime() > Date.now()
      ) {
        throw new TRPCError({ code: "CONFLICT", message: "an export request is already pending" });
      }
      await query(
        `UPDATE tribunal_bundles
         SET export_requested_by = $2, export_requested_at = now(),
             export_expires_at = now() + make_interval(hours => $3),
             export_first_approver = NULL, export_second_approver = NULL,
             exported_to = $4, updated_at = now()
         WHERE id = $1`,
        [input.bundleId, actor, EXPORT_TTL_HOURS, input.exportedTo],
      );
      await writeAccessLog(input.bundleId, actor, "export_request", { exportedTo: input.exportedTo });
      await emitMutationEvent("tribunal.bundle.export_requested", {
        bundleId: input.bundleId, requestedBy: actor, exportedTo: input.exportedTo,
      }).catch(() => undefined);
      return { bundleId: input.bundleId, status: "export_pending" as const, expiresInHours: EXPORT_TTL_HOURS };
    }),

  /**
   * Approve an export request. Two DISTINCT approvers required; the
   * requester can never approve; expired requests fail. The second approval
   * performs the export (sealed -> exported) and anchors it in the ledger.
   */
  approveExport: adminProcedure
    .input(z.object({ bundleId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const approver = actorOf(ctx.user);
      const pool = requirePool();
      const client = await pool.connect();
      let outcome: { status: "pending" | "exported" };
      try {
        await client.query("BEGIN");
        const res = await client.query(
          `SELECT * FROM tribunal_bundles WHERE id = $1 FOR UPDATE`,
          [input.bundleId],
        );
        const bundle = res.rows[0];
        if (!bundle) throw new TRPCError({ code: "NOT_FOUND", message: "bundle not found" });
        if (bundle.status === "exported") {
          throw new TRPCError({ code: "CONFLICT", message: "bundle already exported" });
        }
        if (bundle.status !== "sealed" || !bundle.export_requested_by) {
          throw new TRPCError({ code: "CONFLICT", message: "no export request pending for this bundle" });
        }
        if (new Date(bundle.export_expires_at).getTime() <= Date.now()) {
          await client.query(
            `UPDATE tribunal_bundles
             SET export_requested_by = NULL, export_requested_at = NULL, export_expires_at = NULL,
                 export_first_approver = NULL, export_second_approver = NULL, updated_at = now()
             WHERE id = $1`,
            [input.bundleId],
          );
          await client.query("COMMIT");
          throw new TRPCError({ code: "CONFLICT", message: "export request expired — request it again" });
        }
        if (bundle.export_requested_by === approver) {
          throw new TRPCError({ code: "FORBIDDEN", message: "self-approval is not permitted" });
        }
        if (bundle.export_first_approver === approver) {
          throw new TRPCError({ code: "CONFLICT", message: "approver has already approved" });
        }
        if (!bundle.export_first_approver) {
          await client.query(
            `UPDATE tribunal_bundles SET export_first_approver = $2, updated_at = now() WHERE id = $1`,
            [input.bundleId, approver],
          );
          outcome = { status: "pending" }; // awaiting second approver
        } else {
          await client.query(
            `UPDATE tribunal_bundles
             SET export_second_approver = $2, status = 'exported', exported_at = now(), updated_at = now()
             WHERE id = $1`,
            [input.bundleId, approver],
          );
          outcome = { status: "exported" };
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }

      await writeAccessLog(input.bundleId, approver, "export_approve", { outcome: outcome.status });
      if (outcome.status === "exported") {
        const bundle = await getBundleRow(input.bundleId);
        await appendLedger(
          "tribunal_bundle.exported",
          {
            bundleId: input.bundleId,
            caseRef: bundle.case_ref,
            merkleRoot: bundle.merkle_root,
            exportedTo: bundle.exported_to,
            firstApprover: bundle.export_first_approver,
            secondApprover: approver,
          },
          approver,
        );
        await writeAccessLog(input.bundleId, approver, "export", { exportedTo: bundle.exported_to });
        await emitMutationEvent("tribunal.bundle.exported", {
          bundleId: input.bundleId, exportedTo: bundle.exported_to, approver,
        }).catch(() => undefined);
      }
      return { bundleId: input.bundleId, ...outcome };
    }),

  /**
   * Court-facing verification: recompute every artifact hash and the chain
   * proofs, rebuild the Merkle root, compare against the sealed manifest and
   * the anchored ledger entry. Returns a structured verdict; the call is
   * written to the immutable access log with its verdict.
   */
  verifyBundle: verifierProcedure
    .input(z.object({
      bundleId: z.number().int().positive(),
      expectedMerkleRoot: z.string().max(64).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const accessor = actorOf(ctx.user);
      const bundle = await getBundleRow(input.bundleId);
      const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

      const artifacts = await query<{
        merkle_index: number; artifact_type: string; ref: string;
        sha256: string; metadata: Record<string, unknown>;
      }>(
        `SELECT merkle_index, artifact_type, ref, sha256, metadata
         FROM bundle_artifacts WHERE bundle_id = $1 ORDER BY merkle_index ASC`,
        [input.bundleId],
      );

      const recomputedLeaves: string[] = [];
      for (const a of artifacts) {
        if (a.artifact_type === "evidence") {
          // Re-hash the on-disk vault bytes against the content address.
          const v = await verifyEvidence(a.ref).catch((err: unknown) => {
            if (isMissingTable(err)) return { hash: a.ref, ok: false, reason: "missing_metadata" as const, sealed: false };
            throw err;
          });
          // For evidence artifacts ref === sha256 (the content address), so
          // verifyEvidence().ok already proves the on-disk bytes re-hash to
          // the digest committed in the manifest.
          checks.push({
            name: `evidence:${a.ref.slice(0, 12)}`,
            ok: v.ok && a.ref === a.sha256,
            detail: v.ok ? "vault bytes match content address" : `vault verification failed: ${v.reason ?? "unknown"}`,
          });
          recomputedLeaves.push(a.sha256);
        } else if (a.artifact_type === "ledger_segment") {
          const meta = a.metadata as { fromSeq?: number; toSeq?: number; entryHashes?: string[] };
          const storedHashes = Array.isArray(meta.entryHashes) ? meta.entryHashes : [];
          const redigest = sha256Hex(storedHashes.join(""));
          let chainOk = redigest === a.sha256;
          let detail = chainOk ? "segment digest matches manifest" : "segment digest mismatch";
          if (chainOk && meta.fromSeq != null && meta.toSeq != null) {
            const window = await verifyChain({
              fromSeq: meta.fromSeq,
              limit: meta.toSeq - meta.fromSeq + 1,
            }).catch((err: unknown) => {
              if (isMissingTable(err)) return null;
              throw err;
            });
            if (window == null) {
              chainOk = false;
              detail = "audit_ledger absent — cannot re-verify chain";
            } else if (!window.valid) {
              chainOk = false;
              detail = `chain verification failed at seq ${window.brokenAtSeq} (${window.reason})`;
            } else if (
              window.entriesChecked === storedHashes.length &&
              window.headHash !== storedHashes[storedHashes.length - 1]
            ) {
              chainOk = false;
              detail = "chain head hash does not match segment";
            } else {
              detail = `chain segment seq ${meta.fromSeq}-${meta.toSeq} verified (${window.entriesChecked} entries)`;
            }
          }
          checks.push({ name: `ledger_segment:${a.ref}`, ok: chainOk, detail });
          recomputedLeaves.push(a.sha256);
        } else {
          // Snapshot artifacts: re-hash the stored snapshot bytes.
          const snapshot = (a.metadata as { snapshot?: unknown }).snapshot;
          const redigest = sha256Hex(canonicalJson(snapshot));
          checks.push({
            name: `${a.artifact_type}:${a.ref}`,
            ok: redigest === a.sha256 && isHexDigest(a.sha256),
            detail: redigest === a.sha256 ? "snapshot re-hash matches" : "snapshot re-hash MISMATCH",
          });
          recomputedLeaves.push(a.sha256);
        }
      }

      const recomputedRoot = merkleRoot(recomputedLeaves);
      const rootOk = recomputedRoot === bundle.merkle_root;
      checks.push({
        name: "merkle_root",
        ok: rootOk,
        detail: rootOk ? "recomputed root equals sealed manifest root" : `recomputed ${recomputedRoot} != sealed ${bundle.merkle_root}`,
      });

      if (input.expectedMerkleRoot) {
        const presentedOk = input.expectedMerkleRoot === bundle.merkle_root;
        checks.push({
          name: "presented_root",
          ok: presentedOk,
          detail: presentedOk ? "court-presented root matches" : "court-presented root does NOT match the sealed bundle",
        });
      }

      if (bundle.ledger_anchor_seq != null) {
        const anchorRows = await query<{ entry_hash: string; payload: Record<string, unknown> }>(
          `SELECT entry_hash, payload FROM audit_ledger WHERE seq = $1`,
          [Number(bundle.ledger_anchor_seq)],
        ).catch((err: unknown) => {
          if (isMissingTable(err)) return [];
          throw err;
        });
        const anchor = anchorRows[0];
        const anchorOk =
          !!anchor &&
          anchor.entry_hash === bundle.ledger_anchor_hash &&
          (anchor.payload as { merkleRoot?: string })?.merkleRoot === bundle.merkle_root;
        checks.push({
          name: "ledger_anchor",
          ok: anchorOk,
          detail: anchorOk
            ? `audit-ledger anchor seq ${bundle.ledger_anchor_seq} intact`
            : "audit-ledger anchor MISSING or altered — possible ledger tampering",
        });
      }

      const valid = checks.every((c) => c.ok);
      await writeAccessLog(
        input.bundleId, accessor, "verify",
        { checks: checks.map((c) => ({ name: c.name, ok: c.ok })) },
        valid ? "valid" : "invalid",
      );
      return {
        bundleId: input.bundleId,
        caseRef: bundle.case_ref,
        status: bundle.status,
        merkleRoot: bundle.merkle_root,
        verdict: valid ? ("valid" as const) : ("invalid" as const),
        checks,
        verifiedAt: new Date().toISOString(),
        verifiedBy: accessor,
      };
    }),
});

export type TribunalBundleRouter = typeof tribunalBundleRouter;
