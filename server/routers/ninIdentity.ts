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
 *     complainants and DSAR requesters.
 *   - Re-verification: nin_verified rows expire after NIN_VERIFICATION_TTL_DAYS
 *     (default 365); checkVerification reports (and lazily marks) expiry.
 *   - Every verify/check/revoke writes to verification_audit_log (details must
 *     never contain a raw NIN).
 *   - NOTE: biometric / liveness matching against NIMC is an ADAPTER
 *     INTERFACE ONLY and is NOT implemented (verifyBiometric → NOT_IMPLEMENTED).
 */
import { createHmac, createHash, randomUUID } from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";

const NIMC_API_BASE = process.env.NIMC_API_BASE ?? "";
const NIMC_API_KEY = process.env.NIMC_API_KEY ?? "";
const NIMC_TIMEOUT_MS = Number(process.env.NIMC_TIMEOUT_MS ?? 10000);
const VERIFICATION_TTL_DAYS = Number(process.env.NIN_VERIFICATION_TTL_DAYS ?? 365);
const NIN_HMAC_KEY = process.env.NIN_HMAC_KEY ?? "";

if (!NIN_HMAC_KEY) {
  logger.warn("[nin] NIN_HMAC_KEY is not set — using a derived process key for NIN HMAC. Set NIN_HMAC_KEY in production.");
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
  const key = NIN_HMAC_KEY || createHash("sha256").update(`ndsep-nin-dev-key:${process.env.DATABASE_URL ?? "local"}`).digest("hex");
  return createHmac("sha256", key).update(nin.replace(/\s+/g, "")).digest("hex");
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
    logger.error({ action, subjectType, subjectRef }, "[nin] Refusing to write verification audit details containing an 11-digit value (possible raw NIN)");
    details = { redacted: true, original_action: action };
  }
  await exec(
    `INSERT INTO verification_audit_log (verification_id, action, actor, subject_type, subject_ref, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [verificationId, action, actor, subjectType, subjectRef, JSON.stringify(details)],
  );
}

const SUBJECT_TYPES = ["complainant", "dsar_requester", "user"] as const;

/** Lazily expire an active row past its expires_at. Returns the live row. */
async function currentVerification(subjectType: string, subjectRef: string): Promise<any | null> {
  const rows = await exec(
    `SELECT * FROM identity_verifications
     WHERE subject_type = $1 AND subject_ref = $2 AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`,
    [subjectType, subjectRef],
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
    subjectRef: row.subject_ref,
    assuranceLevel: row.assurance_level,
    status: row.status,
    verifiedAt: row.verified_at,
    expiresAt: row.expires_at,
  };
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
   * declare their identity without document proof.
   */
  verifyBasic: publicProcedure
    .input(z.object({
      subjectType: z.enum(SUBJECT_TYPES),
      subjectRef: z.string().min(2).max(128),
      consent: z.literal(true),
    }))
    .mutation(async ({ input, ctx }) => {
      await exec(
        `UPDATE identity_verifications SET status = 'revoked', updated_at = NOW()
         WHERE subject_type = $1 AND subject_ref = $2 AND status = 'active'`,
        [input.subjectType, input.subjectRef],
      );
      const rows = await exec(
        `INSERT INTO identity_verifications
           (subject_type, subject_ref, assurance_level, status, adapter, verified_at, expires_at)
         VALUES ($1, $2, 'basic', 'active', 'self_attested', NOW(), NOW() + ($3 || ' days')::interval)
         RETURNING id`,
        [input.subjectType, input.subjectRef, String(VERIFICATION_TTL_DAYS)],
      );
      await logVerification(rows[0].id, "verify_success", ctx.user ? String(ctx.user.id) : null, input.subjectType, input.subjectRef, { level: "basic", method: "self_attested" });
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
      consent: z.literal(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const actor = ctx.user ? String(ctx.user.id) : null;
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
      await exec(
        `UPDATE identity_verifications SET status = 'revoked', updated_at = NOW()
         WHERE subject_type = $1 AND subject_ref = $2 AND status = 'active'`,
        [input.subjectType, input.subjectRef],
      );
      const rows = await exec(
        `INSERT INTO identity_verifications
           (subject_type, subject_ref, nin_hmac, verification_token, assurance_level, status, adapter, adapter_ref, verified_at, expires_at)
         VALUES ($1, $2, $3, $4, 'nin_verified', 'active', 'nimc', $5, NOW(), NOW() + ($6 || ' days')::interval)
         RETURNING id, verified_at, expires_at`,
        [input.subjectType, input.subjectRef, hmac, token, adapterResponse.ref ?? null, String(VERIFICATION_TTL_DAYS)],
      );
      await logVerification(rows[0].id, "verify_success", actor, input.subjectType, input.subjectRef, { level: "nin_verified", adapter: "nimc", adapter_ref: adapterResponse.ref ?? null });
      emitMutationEvent("ndsep.identity.verified", { action: "nin_verified", subjectType: input.subjectType, ts: new Date().toISOString() })
        .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return {
        verified: true as const,
        verificationId: rows[0].id,
        assuranceLevel: "nin_verified" as const,
        verifiedAt: rows[0].verified_at,
        expiresAt: rows[0].expires_at,
        // The opaque token is returned once for the caller's records; the raw
        // NIN never leaves this procedure in any direction.
        verificationToken: token,
      };
    }),

  /**
   * Current verification status for a subject. Lazily marks expired rows;
   * re-verification is required once expires_at has passed.
   */
  checkVerification: publicProcedure
    .input(z.object({
      subjectType: z.enum(SUBJECT_TYPES),
      subjectRef: z.string().min(2).max(128),
    }))
    .query(async ({ input }) => {
      const row = await currentVerification(input.subjectType, input.subjectRef);
      if (!row) {
        return { subjectType: input.subjectType, subjectRef: input.subjectRef, assuranceLevel: "none" as const, status: "none" as const };
      }
      await logVerification(row.id, "check", null, input.subjectType, input.subjectRef, { level: row.assurance_level, status: row.status });
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
      return exec(
        `SELECT id, verification_id, action, actor, details, created_at
         FROM verification_audit_log
         WHERE subject_type = $1 AND subject_ref = $2
         ORDER BY created_at DESC LIMIT $3`,
        [input.subjectType, input.subjectRef, input.limit],
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
