/**
 * DPO Marketplace Router (gap 11)
 *
 * Public directory of DPO / DPCO profiles with an NDPC-administered
 * verification flag, organisation engagement requests, and a deterministic
 * matching endpoint.
 *
 * Matching algorithm (scoreMatch, pure & deterministic — no randomness, no
 * wall-clock dependency):
 *   sector overlap   0..40 points  = 40 * |req.sectors ∩ prof.sectors| / |req.sectors|
 *   region overlap   0..25 points  = 25 * |req.regions ∩ prof.regions| / |req.regions|
 *   language overlap 0..15 points  = 15 * |req.languages ∩ prof.languages| / |req.languages|
 *   capacity fit     0 or 10 points when prof.capacity >= req.minCapacity
 *   NDPC verified    0 or 10 points trust bonus
 * Empty requirement facets (e.g. no sectors requested) award full points for
 * that facet, so sparse requirements never penalise a profile. Maximum 100.
 * Ties break by (verified desc, capacity desc, name asc) for stable ordering.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { encryptField } from "../encryption";

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
    logger.error({ err, query: query.slice(0, 200) }, "[dpoMarket] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

/** audit_logs.resource_id / user_id are int4; coerce non-numeric refs to NULL. */
function toIntOrNull(v: string | number | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isInteger(n) && Math.abs(n) < 2147483647 ? n : null;
}

/** Public-directory masking: never expose raw contact PII on public endpoints. */
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`;
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return `***${phone.slice(-2)}`;
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
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [action, resourceType, toIntOrNull(resourceId), toIntOrNull(userId), JSON.stringify(details)],
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[dpoMarket] Audit log write failed");
  }
}

export interface MatchRequirements {
  sectors?: string[];
  regions?: string[];
  languages?: string[];
  minCapacity?: number;
}

export interface MatchProfile {
  id: number;
  name: string;
  sectors: string[];
  regions: string[];
  languages: string[];
  capacity: number;
  verified: boolean;
}

function overlapScore(required: string[], offered: string[], weight: number): number {
  if (!required || required.length === 0) return weight; // unconstrained facet => full marks
  const offeredSet = new Set((offered ?? []).map((s) => String(s).toLowerCase()));
  const hits = required.filter((r) => offeredSet.has(String(r).toLowerCase())).length;
  return (weight * hits) / required.length;
}

/** Deterministic 0..100 match score; see file header for the scoring rubric. */
export function scoreMatch(req: MatchRequirements, prof: MatchProfile): number {
  const score =
    overlapScore(req.sectors ?? [], prof.sectors ?? [], 40) +
    overlapScore(req.regions ?? [], prof.regions ?? [], 25) +
    overlapScore(req.languages ?? [], prof.languages ?? [], 15) +
    ((req.minCapacity ?? 1) <= (prof.capacity ?? 0) ? 10 : 0) +
    (prof.verified ? 10 : 0);
  // Round to 2dp so scores are stable and comparable across runs.
  return Math.round(score * 100) / 100;
}

const requirementsSchema = z.object({
  sectors: z.array(z.string()).default([]),
  regions: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  minCapacity: z.number().int().min(1).default(1),
});

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
  }
  return [];
}

export const dpoMarketplaceRouter = router({
  // ─── Profiles ─────────────────────────────────────────────────────────────

  /** DPO/DPCO self-registers a marketplace profile (starts unverified). */
  createProfile: protectedProcedure
    .input(z.object({
      name: z.string().min(2).max(255),
      profileType: z.enum(["dpo", "dpco"]).default("dpo"),
      email: z.string().email(),
      phone: z.string().max(50).optional(),
      bio: z.string().max(2000).optional(),
      sectors: z.array(z.string()).default([]),
      regions: z.array(z.string()).default([]),
      languages: z.array(z.string()).default([]),
      capacity: z.number().int().min(1).max(500).default(1),
    }))
    .mutation(async ({ input, ctx }) => {
      // Contact PII is encrypted at rest (PII_FIELDS: dpo_marketplace_profiles)
      // and owner_user_id anchors the ownership checks on update/delete.
      const rows = await exec(
        `INSERT INTO dpo_marketplace_profiles (name, profile_type, email, phone, bio, sectors, regions, languages, capacity, owner_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [input.name, input.profileType, encryptField(input.email), input.phone ? encryptField(input.phone) : null, input.bio ?? null,
         JSON.stringify(input.sectors), JSON.stringify(input.regions), JSON.stringify(input.languages), input.capacity, ctx.user.id],
      );
      await logAudit("marketplace.profile_create", "dpo_marketplace_profile", rows[0].id, String(ctx.user.id), { email: input.email });
      return rows[0];
    }),

  /** Profile owner updates their listing (verified flag is NOT self-service). */
  updateProfile: protectedProcedure
    .input(z.object({
      profileId: z.number(),
      name: z.string().min(2).max(255).optional(),
      phone: z.string().max(50).optional(),
      bio: z.string().max(2000).optional(),
      sectors: z.array(z.string()).optional(),
      regions: z.array(z.string()).optional(),
      languages: z.array(z.string()).optional(),
      capacity: z.number().int().min(1).max(500).optional(),
      active: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Ownership: only the profile owner or an admin may modify a listing.
      const ownerRows = await exec(`SELECT owner_user_id FROM dpo_marketplace_profiles WHERE id = $1`, [input.profileId]);
      if (!ownerRows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found" });
      if (ctx.user.role !== "admin" && ownerRows[0].owner_user_id !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the profile owner or an admin may update this profile" });
      }
      const rows = await exec(
        `UPDATE dpo_marketplace_profiles SET
           name = COALESCE($2, name),
           phone = COALESCE($3, phone),
           bio = COALESCE($4, bio),
           sectors = COALESCE($5, sectors),
           regions = COALESCE($6, regions),
           languages = COALESCE($7, languages),
           capacity = COALESCE($8, capacity),
           active = COALESCE($9, active),
           updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [input.profileId, input.name ?? null, input.phone ? encryptField(input.phone) : null, input.bio ?? null,
         input.sectors ? JSON.stringify(input.sectors) : null,
         input.regions ? JSON.stringify(input.regions) : null,
         input.languages ? JSON.stringify(input.languages) : null,
         input.capacity ?? null, input.active ?? null],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found" });
      await logAudit("marketplace.profile_update", "dpo_marketplace_profile", input.profileId, String(ctx.user.id), {});
      return rows[0];
    }),

  /** Public browse of active profiles with optional facet filters. */
  listProfiles: publicProcedure
    .input(z.object({
      sector: z.string().optional(),
      region: z.string().optional(),
      language: z.string().optional(),
      verifiedOnly: z.boolean().default(false),
      profileType: z.enum(["dpo", "dpco"]).optional(),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT id, name, profile_type, bio, sectors, regions, languages, capacity, verified, created_at
                 FROM dpo_marketplace_profiles WHERE active = true`;
      const params: unknown[] = [];
      if (input.profileType) { params.push(input.profileType); sql += ` AND profile_type = $${params.length}`; }
      if (input.verifiedOnly) { sql += ` AND verified = true`; }
      if (input.sector) { params.push(JSON.stringify([input.sector.toLowerCase()])); sql += ` AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(sectors) s WHERE lower(s) = lower($${params.length}::jsonb->>0))`; }
      if (input.region) { params.push(JSON.stringify([input.region.toLowerCase()])); sql += ` AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(regions) r WHERE lower(r) = lower($${params.length}::jsonb->>0))`; }
      if (input.language) { params.push(JSON.stringify([input.language.toLowerCase()])); sql += ` AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(languages) l WHERE lower(l) = lower($${params.length}::jsonb->>0))`; }
      sql += ` ORDER BY verified DESC, name ASC LIMIT 200`;
      return exec(sql, params);
    }),

  getProfile: publicProcedure
    .input(z.object({ profileId: z.number() }))
    .query(async ({ input }) => {
      const rows = await exec(
        `SELECT id, name, profile_type, email, phone, bio, sectors, regions, languages, capacity, verified, active, created_at
         FROM dpo_marketplace_profiles WHERE id = $1`,
        [input.profileId],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found" });
      // Public endpoint: mask contact PII — direct contact details are only
      // exchanged after an engagement is agreed, never via the directory.
      const profile = rows[0];
      return { ...profile, email: maskEmail(profile.email ?? null), phone: maskPhone(profile.phone ?? null) };
    }),

  /** NDPC admin: toggle the verified trust flag on a profile. */
  setVerified: adminProcedure
    .input(z.object({ profileId: z.number(), verified: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `UPDATE dpo_marketplace_profiles
         SET verified = $1,
             verified_by = CASE WHEN $1 THEN $2 ELSE NULL END,
             verified_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
             updated_at = NOW()
         WHERE id = $3 RETURNING id, name, verified, verified_at`,
        [input.verified, ctx.user.email ?? String(ctx.user.id), input.profileId],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found" });
      await logAudit("marketplace.profile_verify", "dpo_marketplace_profile", input.profileId, String(ctx.user.id), { verified: input.verified });
      emitMutationEvent("ndsep.marketplace.profile", { action: input.verified ? "verified" : "unverified", profileId: input.profileId, ts: new Date().toISOString() })
        .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  // ─── Engagements ──────────────────────────────────────────────────────────

  /** Organisation posts an engagement request (requirements drive matching). */
  postEngagement: protectedProcedure
    .input(z.object({
      orgId: z.number().optional(),
      orgName: z.string().min(2).max(255),
      contactEmail: z.string().email(),
      requirements: requirementsSchema.default({ sectors: [], regions: [], languages: [], minCapacity: 1 }),
    }))
    .mutation(async ({ input, ctx }) => {
      // Per-year DB-sequence reference (migration 0077) — no Date.now() suffix.
      const [seqRow] = await exec(`SELECT nextval('ndsep_engagement_ref_seq') AS n`);
      const ref = `ENG-${new Date().getFullYear()}-${String(seqRow?.n ?? 1).padStart(5, "0")}`;
      const rows = await exec(
        `INSERT INTO marketplace_engagements (engagement_ref, org_id, org_name, contact_email, requirements)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [ref, input.orgId ?? null, input.orgName, encryptField(input.contactEmail), JSON.stringify(input.requirements)],
      );
      await logAudit("marketplace.engagement_post", "marketplace_engagement", rows[0].id, String(ctx.user.id), { engagement_ref: ref, org: input.orgName });
      emitMutationEvent("ndsep.marketplace.engagement", { action: "posted", engagementRef: ref, ts: new Date().toISOString() })
        .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  listEngagements: protectedProcedure
    .input(z.object({ status: z.enum(["open", "matched", "in_progress", "completed", "cancelled"]).optional() }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM marketplace_engagements WHERE 1=1`;
      const params: unknown[] = [];
      if (input.status) { params.push(input.status); sql += ` AND status = $${params.length}`; }
      sql += ` ORDER BY created_at DESC LIMIT 200`;
      return exec(sql, params);
    }),

  updateEngagementStatus: protectedProcedure
    .input(z.object({
      engagementRef: z.string().min(4),
      status: z.enum(["open", "matched", "in_progress", "completed", "cancelled"]),
      matchedProfileId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `UPDATE marketplace_engagements
         SET status = $1, matched_profile_id = COALESCE($2, matched_profile_id), updated_at = NOW()
         WHERE engagement_ref = $3 RETURNING *`,
        [input.status, input.matchedProfileId ?? null, input.engagementRef],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Engagement not found" });
      await logAudit("marketplace.engagement_update", "marketplace_engagement", rows[0].id, String(ctx.user.id), { status: input.status });
      return rows[0];
    }),

  // ─── Matching ─────────────────────────────────────────────────────────────

  /**
   * Deterministic matching endpoint: scores all active profiles against the
   * given requirements (see file header for the rubric) and returns the best
   * `limit` matches in a stable order.
   */
  matchProfiles: publicProcedure
    .input(requirementsSchema.extend({ limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const rows = await exec(
        `SELECT id, name, profile_type, sectors, regions, languages, capacity, verified
         FROM dpo_marketplace_profiles WHERE active = true`,
      );
      const req: MatchRequirements = {
        sectors: input.sectors, regions: input.regions, languages: input.languages, minCapacity: input.minCapacity,
      };
      return rows
        .map((row) => {
          const prof: MatchProfile = {
            id: row.id,
            name: row.name,
            sectors: parseJsonArray(row.sectors),
            regions: parseJsonArray(row.regions),
            languages: parseJsonArray(row.languages),
            capacity: Number(row.capacity) || 0,
            verified: !!row.verified,
          };
          return {
            profileId: prof.id,
            name: prof.name,
            profileType: row.profile_type,
            verified: prof.verified,
            capacity: prof.capacity,
            score: scoreMatch(req, prof),
          };
        })
        .sort((a, b) =>
          b.score - a.score ||
          Number(b.verified) - Number(a.verified) ||
          b.capacity - a.capacity ||
          a.name.localeCompare(b.name),
        )
        .slice(0, input.limit);
    }),
});
