/**
 * Penalty Calibration Router (round 12, wave 8 — roadmap P2)
 * ==========================================================
 * Thin tRPC wrapper over server/services/penaltyCalibration.ts — the
 * advisory calibration badge for the NDPA s.48 penalty preview.
 *
 * HARD RULE: calibration NEVER alters the computed penalty. This router
 * takes the ALREADY-COMPUTED s.48 amount (verbatim, advisory context only)
 * and returns { predictionId, upholdProbability, similarMedian, ... } —
 * it exposes no path back into penaltyEngine's computation.
 *
 * Feedback loop: the service mints a decision_feedback prediction
 * (surface='penalty_calibration') and appends a penalty_calibration_audit
 * row (migration 0138); the client records accept / reject through
 * client/src/lib/feedback.ts against the returned predictionId.
 *
 * AuthZ: staffProcedure — penalty previews are staff-only (same gate as
 * revenueVerification.computePenaltyPreview, which is adminProcedure; the
 * badge itself is additionally useful to government_staff reviewing cases).
 *
 * NOTE: mounted under the `penaltyCalibration` namespace by the round
 * integrator in server/routers.ts (this wave does not edit routers.ts).
 */
import { z } from "zod";
import { router, staffProcedure } from "../_core/trpc";
import { calibratePenalty } from "../services/penaltyCalibration";

export const penaltyCalibrationRouter = router({
  /**
   * Advisory badge for a computed s.48 penalty preview.
   * Mutation (not query): every call mints a decision_feedback baseline row
   * and appends a penalty_calibration_audit row.
   */
  calibratePreview: staffProcedure
    .input(z.object({
      /** The authoritative s.48 computed amount (NGN). NEVER modified. */
      penaltyAmount: z.number().min(0),
      violationType: z.string().max(64).optional(),
      orgSize: z.string().max(32).optional(),
      legalBasisSection: z.string().max(32).optional(),
      orgId: z.number().int().positive().optional(),
      queryText: z.string().min(3).max(4000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return calibratePenalty({ ...input, actorId: ctx.user.id });
    }),
});

export type PenaltyCalibrationRouter = typeof penaltyCalibrationRouter;
