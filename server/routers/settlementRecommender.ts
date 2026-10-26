/**
 * Settlement Recommender Router (round 12, wave 8 — roadmap P2)
 * =============================================================
 * Thin tRPC wrapper over server/services/settlementRecommender.ts — scores a
 * proposed term sheet (learned fulfillment model) and returns precedent-
 * derived advisory adjustments. Advisory only: nothing here writes to
 * settlements / settlement_terms; the officer's term sheet is authoritative.
 *
 * Feedback loop: the service mints a decision_feedback prediction
 * (surface='settlement_terms'); the client records accept / edit / reject
 * through client/src/lib/feedback.ts against the returned predictionId.
 *
 * AuthZ: staffProcedure (admin / government_staff / auditor) — settlement
 * negotiation data is staff-only.
 *
 * NOTE: mounted under the `settlementRecommender` namespace by the round
 * integrator in server/routers.ts (this wave does not edit routers.ts).
 */
import { z } from "zod";
import { router, staffProcedure } from "../_core/trpc";
import { recommendTerms } from "../services/settlementRecommender";

const instalmentSchema = z.object({
  dueDate: z.string().optional(),
  due_date: z.string().optional(),
  amount: z.number().optional(),
});

export const settlementRecommenderRouter = router({
  /**
   * Score a proposed term sheet and return
   * { predictionId, fulfillmentProbability, suggestedAdjustments, ... }.
   * Mutation (not query): every call mints a decision_feedback baseline row.
   */
  recommendTerms: staffProcedure
    .input(z.object({
      monetaryAmount: z.number().min(0),
      originalAmount: z.number().min(0).nullish(),
      instalmentSchedule: z.array(instalmentSchema).max(36).optional(),
      nonMonetaryObligations: z.array(z.string().max(2000)).max(50).optional(),
      confidentialityFlag: z.boolean().optional(),
      orgSector: z.string().max(128).optional(),
      orgDataVolumeClass: z.string().max(32).optional(),
      queryText: z.string().min(3).max(4000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return recommendTerms({ ...input, actorId: ctx.user.id });
    }),
});

export type SettlementRecommenderRouter = typeof settlementRecommenderRouter;
