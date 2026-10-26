/**
 * Next-best-action router (round 12, wave 7 — roadmap §6)
 * =======================================================
 * Loads an entity's current state from the DB, evaluates the pure
 * nextBestAction() state machine, mints a prediction through the Wave-1
 * feedback loop (surface 'next_best_action', model_version 'rules:v1') and
 * returns { predictionId, action, label, mutationHint, rationale }.
 *
 * The client (NextBestActionCard) records the outcome via
 * client/src/lib/feedback.ts: accept when the officer clicks the action,
 * ignore when the card is dismissed.
 *
 * Mounted under the `nextBestAction` namespace by the round integrator.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { mintPrediction } from "./decisionFeedback";
import { nextBestAction, NBA_MODEL_VERSION, NBA_SURFACE, type NbaState } from "../services/nextBestAction";

async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  try {
    const result = await pool.query(query, params);
    return result.rows ?? [];
  } catch (err) {
    logger.error({ err, query: query.slice(0, 160) }, "[nextBestAction] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

async function loadState(entityType: string, entityId: number): Promise<{ state: NbaState; ref: string | null }> {
  switch (entityType) {
    case "complaint": {
      const rows = await exec(
        `SELECT id, reference_code, status, assigned_officer_id FROM public_complaints WHERE id = $1`,
        [entityId],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: `Complaint ${entityId} not found` });
      return {
        state: { status: rows[0].status, assigned: rows[0].assigned_officer_id != null },
        ref: rows[0].reference_code ?? null,
      };
    }
    case "settlement": {
      const rows = await exec(`SELECT id, settlement_ref, status FROM settlements WHERE id = $1`, [entityId]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: `Settlement ${entityId} not found` });
      return { state: { status: rows[0].status }, ref: rows[0].settlement_ref ?? null };
    }
    case "publication": {
      const rows = await exec(
        `SELECT id, status, correction_pending FROM publication_documents WHERE id = $1`,
        [entityId],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: `Publication document ${entityId} not found` });
      return { state: { status: rows[0].status, correctionPending: rows[0].correction_pending === true }, ref: null };
    }
    case "finding": {
      const rows = await exec(`SELECT id, status FROM transfer_findings WHERE id = $1`, [entityId]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: `Finding ${entityId} not found` });
      return { state: { status: rows[0].status }, ref: null };
    }
    default:
      throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown entityType '${entityType}'` });
  }
}

export const nextBestActionRouter = router({
  forEntity: protectedProcedure
    .input(
      z.object({
        entityType: z.enum(["complaint", "settlement", "publication", "finding"]),
        entityId: z.number().int().positive(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { state, ref } = await loadState(input.entityType, input.entityId);
      const nba = nextBestAction(input.entityType, state);
      if (!nba) {
        return { predictionId: null, action: null, entityType: input.entityType, entityId: input.entityId };
      }

      // Wave-1 feedback loop: mint the baseline prediction (structural
      // payload only — entity ref + action, no data-subject identifiers).
      const predictionId = await mintPrediction({
        surface: NBA_SURFACE,
        suggestion: { entityType: input.entityType, entityRef: ref, action: nba.action, status: state.status ?? null },
        actorId: ctx.user.id,
        modelVersion: NBA_MODEL_VERSION,
      });

      return { predictionId, entityType: input.entityType, entityId: input.entityId, ...nba };
    }),
});
