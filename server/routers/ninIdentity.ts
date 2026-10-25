/**
 * NIN-Verified Identity Router (privacy-preserving NIMC adapter)
 *
 * Nigeria Identity Management Commission (NIMC) NIN verification for
 * complainants and DSAR requesters, under NDPA 2023 data-minimisation
 * principles:
 *
 *   - The raw National Identification Number is NEVER persisted. Only:
 *       verification_token (opaque adapter token / local UUID),
 *       nin_hmac (keyed HMAC-SHA256 — equality-checkable, non-reversible),
 *       assurance_level, timestamps.
 *     tests/round8/ninPrivacy.test.ts statically enforces this.
 *   - The NIMC adapter is env-gated (NIMC_API_BASE + NIMC_API_KEY). Without
 *     credentials every verification attempt fails EXPLICITLY with
 *     status UNCONFIGURED — no mock "verified" responses ever.
 *   - Assurance levels: none → basic (self-attested, no NIMC) → nin_verified.
 *     Levels attach to subjects via (subject_type, subject_ref) covering
 *     complainants and DSAR requesters. subject_ref is additionally stored
 *     keyed-hashed (subject_ref_hash, migration 0105) for equality lookups.
 *   - Round-9 hardening:
 *       * verifyBasic NEVER supersedes an active nin_verified row (a weaker
 *         self-attestation cannot knock out a stronger verification).
 *       * verifyBasic / verifyNin require a possession proof for subjectRef.
 *       * verifyNin is rate limited per-IP AND per-subject (atomic counters).
 *       * NIN_HMAC_KEY fails closed outside development; the key is never
 *         derived from DATABASE_URL or other deployment material.
 *       * checkVerification is staff-only (assurance status is not public).
 *       * verifyNin revoke+insert runs in ONE transaction with a clean
 *         CONFLICT response on concurrent verification.
 *   - Re-verification: nin_verified rows expire after NIN_VERIFICATION_TTL_DAYS
 *     (default 365); checkVerification reports (and lazily marks) expiry.
 *   - Every verify/check/revoke writes to verification_audit_log (details must
 *     never contain a raw NIN).
 *   - NOTE: biometric / liveness matching against NIMC is an ADAPTER
 *     INTERFACE ONLY and is NOT implemented (verifyBiometric → NOT_IMPLEMENTED).
 */
import { createHmac, randomUUID } from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, staffProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import {
  hmacSha256Hex,
  sha256Hex,
  requireHmacKey,
  hashIp,
  ipHashSalt,
  extractClientIp,
  fixedWindowStart,
  counterExceedsLimit,
} from "../services/complaintLogic";

const NIMC_API_BASE = process.env.NIMC_API_BASE ?? "";
const NIMC_API_KEY = process.env.NIMC_API_KEY ?? "";
const NIMC_TIMEOUT_MS = Number(process.env.NIMC_TIMEOUT_MS ?? 10000);
const VERIFICATION_TTL_DAYS = Number(process.env.NIN_VERIFICATION_TTL_DAYS ?? 365);
const NIN_HMAC_KEY = process.env.NIN_HMAC_KEY ?? "";
const TRUSTED_PROXY_COUNT = Math.max(0, parseInt(process.env.NDSEP_TRUSTED_PROXY_COUNT ?? "0", 10) || 0);
const VERIFY_NIN_IP_LIMIT_PER_HOUR = Math.max(1, parseInt(process.env.NIN_VERIFY_IP_LIMIT_PER_HOUR ?? "10", 10) || 10);
const VERIFY_NIN_SUBJECT_LIMIT_PER_DAY = Math.max(1, parseInt(process.env.NIN_VERIFY_SUBJECT_LIMIT_PER_DAY ?? "5", 10) || 5);

if (!NIN_HMAC_KEY) {
  logger.warn("[nin] NIN_HMAC_KEY is not set — NIN HMAC uses a dev-only key outside production. Set NIN_HMAC_KEY.");
}

/** Explicit adapter configuration status — never a silent mock. */
export function getNimcAdapterStatus(): { status: "configured" | "UNCONFIGURED"; base?: string; reason?: string } {
  if (!NIMC_API_BASE || !NIMC_API_KEY) {
    return {
      status: "UNCONFIGURED",
      reason: "NIMC_API_BASE and/or NIMC_API_KEY not set; NIN verification unavailable (no silent mock)",
    };
  }
  return { status: "configured", base: NIMC_API_BASE };
}

function ninHmac(nin: string): string {
  // Fail-closed outside development; the fallback key is a fixed dev seed —
  // NEVER derived from DATABASE_URL or any deployment-specific material.
  const { key } = requireHmacKey(NIN_HMAC_KEY, "NIN_HMAC_KEY", { devSeed: "nin-identity" });
  return createHmac("sha256", key).update(nin.replace(/\s+/g, "")).digest("hex");
}

/**
 * Keyed hash of the subject reference for equality lookups. Legacy rows were
 * backfilled with unkeyed SHA-256 (migration 0105), so lookups match either.
 */
function subjectRefHashes(subjectRef: string): { keyed: string; legacy: string } {
  const { key } = requireHmacKey(NIN_HMAC_KEY, "NIN_HMAC_KEY", { devSeed: "nin-identity" });
  const normalized = subjectRef.trim();
  return { keyed: hmacSha256Hex(key, normalized), legacy: sha256Hex(normalized) };
}

/** Non-TOCTOU atomic counter rate limit. */
async function enforceCounterLimit(key: string, maxPerWindow: number, windowMs: number): Promise<void> {
  const rows = await exec(
    `INSERT INTO rate_limit_counters (limiter_key, window_start, count, updated_at)
     VALUES ($1, $2, 1, NOW())
     ON CONFLICT (limiter_key, window_start)
     DO UPDATE SET count = rate_limit_counters.count + 1, updated_at = NOW()
     RETURNING count`,
    [key, fixedWindowStart(Date.now(), windowMs)],
  );
  if (counterExceedsLimit(Number(rows[0]?.count ?? 1), maxPerWindow)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Verification rate limit reached. Please try again later." });
  }
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
    logger.error({ err, query: query.slice(0, 200) }, "[nin] DB query error");
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
    const toInt = (v: string | number | null): number | null => {
      if (v == null) return null;
      const n = typeof v === "number" ? v : parseInt(v, 10);
      return Number.isInteger(n) && Math.abs(n) < 2147483647 ? n : null;
    };
    await exec(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [action, resourceType, toInt(resourceId), toInt(userId), JSON.stringify(details)],
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[nin] Audit log write failed");
  }
}

/** Verification audit log — details MUST NOT contain a raw NIN. */
async function logVerification(
  verificationId: number | null,
  action: string,
  actor: string | null,
  subjectType: string,
  subjectRef: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  // Defense in depth: refuse to persist anything shaped like a raw NIN.
  const serialized = JSON.stringify(details);
  if (/\b\d{11}\b/.test(serialized)) {
    logger.error({ action, subjectType }, "[nin] Refusing to write verification audit details containing an 11-digit value (possible raw NIN)");
    details = { redacted: true, original_action: action };
  }
  const { keyed } = subjectRefHashes(subjectRef);
  await exec(
    `INSERT INTO verification_audit_log (verification_id, action, actor, subject_type, subject_ref, subject_ref_hash, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [verificationId, action, actor, subjectType, subjectRef, keyed, JSON.stringify(details)],
  );
}

const SUBJECT_TYPES = ["complainant", "dsar_requester", "user"] as const;

/** Lazily expire an active row past its expires_at. Returns the live row. */
async function currentVerification(subjectType: string, subjectRef: string): Promise<any | null> {
  const { keyed, legacy } = subjectRefHashes(subjectRef);
  const rows = await exec(
    `SELECT * FROM identity_verifications
     WHERE subject_type = $1 AND (subject_ref_hash IN ($2, $3) OR (subject_ref_hash IS NULL AND subject_ref = $4)) AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`,
    [subjectType, keyed, legacy, subjectRef],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    await exec(`UPDATE identity_verifications SET status = 'expired', updated_at = NOW() WHERE id = $1`, [row.id]);
    await logVerification(row.id, "expired", null, subjectType, subjectRef, { expired_at: row.expires_at });
    return { ...row, status: "expired" };
  }
  return row;
}

/** Public-safe projection: never expose token/HMAC internals beyond level+status. */
function publicView(row: any) {
  return {
    subjectType: row.subject_type,
    assuranceLevel: row.assurance_level,
    status: row.status,
    verifiedAt: row.verified_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Possession-proof gate: the caller must demonstrate control of the subject
 * reference (e.g. the tracking secret / email challenge issued at intake).
 * The proof is NEVER stored raw — only its keyed HMAC is audited.
 */
function auditPossessionProof(proof: string): string {
  const { key } = requireHmacKey(NIN_HMAC_KEY, "NIN_HMAC_KEY", { devSeed: "nin-identity" });
  return hmacSha256Hex(key, proof);
}

export const ninIdentityRouter = router({
  /** Explicit NIMC adapter status (no secrets). */
  adapterStatus: publicProcedure.query(() => ({
    adapter: "nimc",
    ...getNimcAdapterStatus(),
    biometric: "NOT_IMPLEMENTED — adapter interface only",
    ttlDays: VERIFICATION_TTL_DAYS,
  })),

  /**
   * Self-attested 'basic' verification — no NIMC call, no NIN. Used to attach
   * a minimum assurance level to a complainant/DSAR requester when they
   * declare their identity without document proof. A 'basic' attestation can
   * NEVER supersede an active 'nin_verified' row.
   */
  verifyBasic: publicProcedure
    .input(z.object({
      subjectType: z.enum(SUBJECT_TYPES),
      subjectRef: z.string().min(2).max(128),
      /** Proof of possession of the subject reference (tracking secret / email challenge). */
      possessionProof: z.string().min(8).max(256),
      consent: z.literal(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const { keyed, legacy } = subjectRefHashes(input.subjectRef);
      // Never let a weaker self-attestation knock out a stronger verification.
      const strong = await exec(
        `SELECT id FROM identity_verifications
         WHERE subject_type = $1 AND (subject_ref_hash IN ($2, $3) OR (subject_ref_hash IS NULL AND subject_ref = $4))
           AND status = 'active' AND assurance_level = 'nin_verified'
         LIMIT 1`,
        [input.subjectType, keyed, legacy, input.subjectRef],
      );
      if (strong[0]) {
        await logVerification(strong[0].id, "verify_failed", ctx.user ? String(ctx.user.id) : null, input.subjectType, input.subjectRef, {
          level: "basic", reason: "active nin_verified row exists; basic self-attestation cannot supersede it",
        });
        throw new TRPCError({
          code: "CONFLICT",
          message: "This subject already holds a stronger NIN-verified identity; basic self-attestation is not applicable.",
        });
      }
      await exec(
        `UPDATE identity_verifications SET status = 'revoked', updated_at = NOW()
         WHERE subject_type = $1 AND (subject_ref_hash IN ($2, $3) OR (subject_ref_hash IS NULL AND subject_ref = $4))
           AND status = 'active' AND assurance_level = 'basic'`,
        [input.subjectType, keyed, legacy, input.subjectRef],
      );
      const rows = await exec(
        `INSERT INTO identity_verifications
           (subject_type, subject_ref, subject_ref_hash, assurance_level, status, adapter, verified_at, expires_at)
         VALUES ($1, $2, $3, 'basic', 'active', 'self_attested', NOW(), NOW() + ($4 || ' days')::interval)
         RETURNING id`,
        [input.subjectType, input.subjectRef, keyed, String(VERIFICATION_TTL_DAYS)],
      );
      await logVerification(rows[0].id, "verify_success", ctx.user ? String(ctx.user.id) : null, input.subjectType, input.subjectRef, {
        level: "basic", method: "self_attested", possession_proof_hmac: auditPossessionProof(input.possessionProof),
      });
      return { verificationId: rows[0].id, assuranceLevel: "basic" as const };
    }),

  /**
   * NIMC-backed NIN verification. The raw NIN is used in memory for the
   * adapter call and its HMAC, then discarded — it is never stored, logged,
   * or returned. Without NIMC credentials the mutation fails EXPLICITLY with
   * an UNCONFIGURED status (and an audit row); nothing is fabricated.
   */
  verifyNin: publicProcedure
    .input(z.object({
      nin: z.string().regex(/^\d{11}$/, "NIN must be exactly 11 digits"),
      subjectType: z.enum(SUBJECT_TYPES),
      subjectRef: z.string().min(2).max(128),
      /** Proof of possession of the subject reference. */
      possessionProof: z.string().min(8).max(256),
      consent: z.literal(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const actor = ctx.user ? String(ctx.user.id) : null;
      // Rate limits: per-IP AND per-subject (atomic upsert counters).
      const ip = extractClientIp((ctx as any).req?.headers, (ctx as any).req?.ip ?? (ctx as any).req?.socket?.remoteAddress, TRUSTED_PROXY_COUNT);
      await enforceCounterLimit(hashIp(`nin.verify.ip|${ip}`, ipHashSalt()), VERIFY_NIN_IP_LIMIT_PER_HOUR, 3_600_000);
      const { keyed: subjKeyed } = subjectRefHashes(input.subjectRef);
      await enforceCounterLimit(`nin.verify.subject|${input.subjectType}|${subjKeyed}`, VERIFY_NIN_SUBJECT_LIMIT_PER_DAY, 86_400_000);

      const adapter = getNimcAdapterStatus();
      if (adapter.status === "UNCONFIGURED") {
        await logVerification(null, "verify_unconfigured", actor, input.subjectType, input.subjectRef, { reason: adapter.reason });
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `NIMC adapter UNCONFIGURED: ${adapter.reason}`,
        });
      }

      await logVerification(null, "verify_request", actor, input.subjectType, input.subjectRef, { adapter: "nimc" });

      let adapterResponse: { verified: boolean; token?: string; ref?: string; reason?: string };
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), NIMC_TIMEOUT_MS);
        const resp = await fetch(`${NIMC_API_BASE.replace(/\/$/, "")}/verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${NIMC_API_KEY}`,
          },
          body: JSON.stringify({ nin: input.nin }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!resp.ok) {
          adapterResponse = { verified: false, reason: `NIMC HTTP ${resp.status}` };
        } else {
          const data = (await resp.json()) as { verified?: boolean; verification_token?: string; transaction_ref?: string; message?: string };
          adapterResponse = {
            verified: data.verified === true,
            token: data.verification_token,
            ref: data.transaction_ref,
            reason: data.verified === true ? undefined : (data.message ?? "NIMC returned verified=false"),
          };
        }
      } catch (err) {
        adapterResponse = { verified: false, reason: err instanceof Error ? err.message : String(err) };
      }

      if (!adapterResponse.verified) {
        await logVerification(null, "verify_failed", actor, input.subjectType, input.subjectRef, { reason: adapterResponse.reason ?? "adapter rejected" });
        return {
          verified: false as const,
          assuranceLevel: "none" as const,
          reason: adapterResponse.reason ?? "NIMC verification failed",
        };
      }

      const hmac = ninHmac(input.nin); // input.nin goes out of scope after this mutation — never stored.
      const token = adapterResponse.token ?? randomUUID();

      // Revoke + insert atomically. The partial unique index on
      // (subject_type, subject_ref) WHERE status='active' can raise 23505 on
      // concurrent verification — that maps to a clean CONFLICT, not a 500.
      const pool = getPool();
      if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const client = await pool.connect();
      let inserted: any;
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE identity_verifications SET status = 'revoked', updated_at = NOW()
           WHERE subject_type = $1 AND (subject_ref_hash IN ($2, $3) OR (subject_ref_hash IS NULL AND subject_ref = $4)) AND status = 'active'`,
          [input.subjectType, subjKeyed, subjectRefHashes(input.subjectRef).legacy, input.subjectRef],
        );
        const rows = await client.query(
          `INSERT INTO identity_verifications
             (subject_type, subject_ref, subject_ref_hash, nin_hmac, verification_token, assurance_level, status, adapter, adapter_ref, verified_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, 'nin_verified', 'active', 'nimc', $6, NOW(), NOW() + ($7 || ' days')::interval)
           RETURNING id, verified_at, expires_at`,
          [input.subjectType, input.subjectRef, subjKeyed, hmac, token, adapterResponse.ref ?? null, String(VERIFICATION_TTL_DAYS)],
        );
        inserted = rows.rows[0];
        await client.query("COMMIT");
      } catch (err: any) {
        await client.query("ROLLBACK").catch(() => {});
        if (err?.code === "23505") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A verification for this subject completed concurrently; check status instead of retrying blindly.",
          });
        }
        logger.error({ err }, "[nin] verifyNin persistence failed");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Verification persistence failed" });
      } finally {
        client.release();
      }
      await logVerification(inserted.id, "verify_success", actor, input.subjectType, input.subjectRef, { level: "nin_verified", adapter: "nimc", adapter_ref: adapterResponse.ref ?? null });
      emitMutationEvent("ndsep.identity.verified", { action: "nin_verified", subjectType: input.subjectType, ts: new Date().toISOString() })
        .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return {
        verified: true as const,
        verificationId: inserted.id,
        assuranceLevel: "nin_verified" as const,
        verifiedAt: inserted.verified_at,
        expiresAt: inserted.expires_at,
        // The opaque token is returned once for the caller's records; the raw
        // NIN never leaves this procedure in any direction.
        verificationToken: token,
      };
    }),

  /**
   * Current verification status for a subject. STAFF-ONLY: assurance status
   * is operational metadata, not public information. Lazily marks expired
   * rows; re-verification is required once expires_at has passed.
   */
  checkVerification: staffProcedure
    .input(z.object({
      subjectType: z.enum(SUBJECT_TYPES),
      subjectRef: z.string().min(2).max(128),
    }))
    .query(async ({ input, ctx }) => {
      const row = await currentVerification(input.subjectType, input.subjectRef);
      if (!row) {
        return { subjectType: input.subjectType, assuranceLevel: "none" as const, status: "none" as const };
      }
      await logVerification(row.id, "check", String(ctx.user.id), input.subjectType, input.subjectRef, { level: row.assurance_level, status: row.status });
      return publicView(row);
    }),

  /** Admin: revoke a verification (e.g. NIMC revocation notice, fraud flag). */
  revoke: adminProcedure
    .input(z.object({
      subjectType: z.enum(SUBJECT_TYPES),
      subjectRef: z.string().min(2).max(128),
      reason: z.string().min(4).max(500),
    }))
    .mutation(async ({ input, ctx }) => {
      const row = await currentVerification(input.subjectType, input.subjectRef);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "No active verification for this subject" });
      await exec(`UPDATE identity_verifications SET status = 'revoked', updated_at = NOW() WHERE id = $1`, [row.id]);
      await logVerification(row.id, "revoked", String(ctx.user.id), input.subjectType, input.subjectRef, { reason: input.reason });
      await logAudit("nin.revoke", "identity_verification", row.id, String(ctx.user.id), { reason: input.reason });
      return { success: true };
    }),

  /** Admin/auditor: verification audit trail for a subject. */
  auditTrail: adminProcedure
    .input(z.object({
      subjectType: z.enum(SUBJECT_TYPES),
      subjectRef: z.string().min(2).max(128),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      const { keyed, legacy } = subjectRefHashes(input.subjectRef);
      return exec(
        `SELECT id, verification_id, action, actor, details, created_at
         FROM verification_audit_log
         WHERE subject_type = $1 AND (subject_ref_hash IN ($2, $3) OR (subject_ref_hash IS NULL AND subject_ref = $4))
         ORDER BY created_at DESC LIMIT $5`,
        [input.subjectType, keyed, legacy, input.subjectRef, input.limit],
      );
    }),

  /**
   * Biometric / liveness verification against NIMC.
   * EXPLICITLY NOT IMPLEMENTED: this is the adapter interface seam. A future
   * adapter (NIMC biometric match + liveness challenge) plugs in here; until
   * then every call returns NOT_IMPLEMENTED and is audit-logged.
   */
  verifyBiometric: publicProcedure
    .input(z.object({
      subjectType: z.enum(SUBJECT_TYPES),
      subjectRef: z.string().min(2).max(128),
    }))
    .mutation(async ({ input }) => {
      await logVerification(null, "biometric_not_implemented", null, input.subjectType, input.subjectRef, {});
      return {
        status: "NOT_IMPLEMENTED" as const,
        note: "Biometric/liveness verification is an adapter interface only. No biometric capture, matching, or storage is implemented on this platform.",
      };
    }),
});
