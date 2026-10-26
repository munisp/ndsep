/**
 * Saved Views Router (round 12, wave 2 — roadmap §5 quick wins)
 * ============================================================================
 * CRUD for per-user, per-surface saved filter sets (table saved_views,
 * migration 0130). Powers "save this filter set" on the Global Search page
 * and the complaint triage queue.
 *
 * Scoping rules:
 *   - Every procedure is user-scoped: rows are only ever read or mutated when
 *     user_id matches the caller. No cross-user reads, no admin override.
 *   - (user_id, surface, name) is unique; create() on a duplicate name
 *     returns CONFLICT, callers either pick a new name or use update().
 *
 * user_id mapping: users.id is a serial int while saved_views.user_id is
 * uuid. userUuid() derives a stable pseudonymous uuid per user (sha256,
 * version-5 style — same convention as decisionFeedback.actorUuid).
 */
import { createHash } from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";

/**
 * Deterministic pseudonymous user uuid derived from the internal user id.
 * saved_views.user_id is a uuid that is NOT a FK to users.id (serial); we
 * derive a stable uuid (sha256 of a namespaced key, version-5 style — same
 * convention as decisionFeedback.actorUuid) so per-user scoping works
 * without storing a raw identifier.
 */
export function userUuid(userId: string | number): string {
  const hex = createHash("sha256").update(`ndsep:saved-view-user:${String(userId)}`).digest("hex");
  const h = hex.slice(0, 32).split("");
  h[12] = "5"; // version nibble
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16); // variant bits
  return `${h.slice(0, 8).join("")}-${h.slice(8, 12).join("")}-${h.slice(12, 16).join("")}-${h.slice(16, 20).join("")}-${h.slice(20, 32).join("")}`;
}

async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  try {
    const safeParams = params.map((p) =>
      Array.isArray(p) || (p !== null && typeof p === "object" && !(p instanceof Date) && !(p instanceof Buffer))
        ? JSON.stringify(p)
        : p
    );
    const result = await pool.query(query, safeParams);
    return result.rows ?? [];
  } catch (err: any) {
    // Unique-violation on (user_id, surface, name) → friendly conflict.
    if (err?.code === "23505") {
      throw new TRPCError({ code: "CONFLICT", message: "A saved view with this name already exists for this surface." });
    }
    logger.error({ err, query: query.slice(0, 200) }, "[savedViews] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

const filtersSchema = z
  .record(z.string(), z.unknown())
  .refine((f) => JSON.stringify(f).length <= 16_384, { message: "filters payload too large (max 16 KiB)" });

const surfaceSchema = z.string().trim().min(1).max(80).regex(/^[a-z0-9_.-]+$/, "lowercase surface key, e.g. 'global_search'");
const nameSchema = z.string().trim().min(1).max(120);

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

export const savedViewsRouter = router({
  /** List the caller's saved views for one surface. */
  list: protectedProcedure
    .input(z.object({ surface: surfaceSchema }))
    .query(async ({ input, ctx }) => {
      return exec(
        `SELECT id, surface, name, filters, created_at, updated_at
         FROM saved_views
         WHERE user_id = $1 AND surface = $2
         ORDER BY updated_at DESC
         LIMIT 100`,
        [userUuid(ctx.user.id), input.surface],
      );
    }),

  /** Create a new saved view. Duplicate (surface, name) → CONFLICT. */
  create: protectedProcedure
    .input(z.object({
      surface: surfaceSchema,
      name: nameSchema,
      filters: filtersSchema,
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `INSERT INTO saved_views (user_id, surface, name, filters)
         VALUES ($1, $2, $3, $4)
         RETURNING id, surface, name, filters, created_at, updated_at`,
        [userUuid(ctx.user.id), input.surface, input.name, input.filters],
      );
      fireAndForget("savedViews.create");
      return rows[0];
    }),

  /** Rename and/or replace the filters of one of the caller's views. */
  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: nameSchema.optional(),
      filters: filtersSchema.optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.name === undefined && input.filters === undefined) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to update — provide name and/or filters." });
      }
      const rows = await exec(
        `UPDATE saved_views
         SET name = COALESCE($3, name),
             filters = COALESCE($4, filters),
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING id, surface, name, filters, created_at, updated_at`,
        [input.id, userUuid(ctx.user.id), input.name ?? null, input.filters ?? null],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Saved view not found." });
      fireAndForget("savedViews.update");
      return rows[0];
    }),

  /** Delete one of the caller's views. */
  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `DELETE FROM saved_views WHERE id = $1 AND user_id = $2 RETURNING id`,
        [input.id, userUuid(ctx.user.id)],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Saved view not found." });
      fireAndForget("savedViews.remove");
      return { deleted: true, id: input.id };
    }),
});
