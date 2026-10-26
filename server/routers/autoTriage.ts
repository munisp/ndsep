/**
 * Auto-triage router (round 12, wave 7 — roadmap §6, assist mode)
 * ===============================================================
 * Thin tRPC surface over services/autoTriage.ts:
 *
 *   suggest(complaintId)  — manual "Suggest triage" trigger. Fail-closed:
 *                           returns { outcome: 'manual_queue', reason } when
 *                           the gateway is down / output unusable / confidence
 *                           below AUTO_TRIAGE_CONFIDENCE; only a confident
 *                           classification writes a PENDING triage_suggestions
 *                           row (+ decision_feedback baseline via mintPrediction).
 *   listPending           — pending suggestions queue (newest first).
 *   forComplaint          — latest suggestion for the complaint detail panel.
 *   decide(suggestionId, action, finalValue?)
 *                         — officer decision. Updates triage_suggestions AND
 *                           appends the outcome to decision_feedback through
 *                           the Wave-1 decisionFeedback.record procedure
 *                           (pseudonymization denylist + ndsep.feedback.recorded
 *                           event + audit ledger all inherited).
 *
 * The router is mounted under the `autoTriage` namespace by the round
 * integrator in server/routers.ts; the client uses structural typing
 * ((trpc as any).autoTriage.*) until then, same as Wave-1 bulkOps/savedViews.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { logger } from "../logger";
import { decisionFeedbackRouter } from "./decisionFeedback";
import {
  autoTriageConfidenceThreshold,
  decideTriage,
  latestSuggestionForComplaint,
  listPendingSuggestions,
  suggestTriage,
  TRIAGE_SURFACE,
} from "../services/autoTriage";

function isMissingTable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /does not exist|relation .* does not exist|42P01/.test(msg);
}

function mapServiceError(err: unknown): TRPCError {
  if (err instanceof TRPCError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (/not found/i.test(msg)) return new TRPCError({ code: "NOT_FOUND", message: msg });
  if (/already decided|must be one of|must be a 2-64 char/i.test(msg)) return new TRPCError({ code: "BAD_REQUEST", message: msg });
  if (/database unavailable/i.test(msg)) return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  logger.error({ err: msg }, "[autoTriage] unexpected error");
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Auto-triage error" });
}

export const autoTriageRouter = router({
  /** Manual trigger: classify one complaint and (maybe) park a suggestion. */
  suggest: protectedProcedure
    .input(z.object({ complaintId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await suggestTriage(input.complaintId, ctx.user.id);
      } catch (err) {
        throw mapServiceError(err);
      }
    }),

  /** Pending suggestions queue (newest first). */
  listPending: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }).optional(),
    )
    .query(async ({ input }) => {
      try {
        const { rows, total } = await listPendingSuggestions(input ?? {});
        return {
          rows,
          total,
          threshold: autoTriageConfidenceThreshold(),
          note: null as string | null,
        };
      } catch (err) {
        if (isMissingTable(err)) return { rows: [], total: 0, threshold: autoTriageConfidenceThreshold(), note: "migration 0135 not applied" };
        throw mapServiceError(err);
      }
    }),

  /** Latest suggestion (any status) for one complaint — detail panel badge. */
  forComplaint: protectedProcedure
    .input(z.object({ complaintId: z.number().int().positive() }))
    .query(async ({ input }) => {
      try {
        return { suggestion: await latestSuggestionForComplaint(input.complaintId), note: null as string | null };
      } catch (err) {
        if (isMissingTable(err)) return { suggestion: null, note: "migration 0135 not applied" };
        throw mapServiceError(err);
      }
    }),

  /**
   * Officer decision on a pending suggestion. Writes BOTH the
   * triage_suggestions status AND the decision_feedback outcome row
   * (accept/edit/reject) for the minted prediction.
   */
  decide: protectedProcedure
    .input(
      z.object({
        suggestionId: z.string().uuid(),
        action: z.enum(["accepted", "edited", "rejected"]),
        finalValue: z
          .object({
            category: z.string().max(64).optional(),
            severity: z.string().max(32).optional(),
            suggestedTeam: z.string().max(64).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      let result;
      try {
        result = await decideTriage({
          suggestionId: input.suggestionId,
          action: input.action,
          finalValue: input.finalValue,
          decidedBy: ctx.user.name ?? String(ctx.user.id),
        });
      } catch (err) {
        throw mapServiceError(err);
      }

      // Wave-1 feedback loop: append the human outcome for the minted
      // prediction. 'accepted' -> accept, 'edited' -> edit (finalValue
      // required), 'rejected' -> reject. When the baseline was never minted
      // (mintPrediction best-effort failure) we still have predictionId=null
      // and skip — the triage_suggestions row is the durable record.
      let feedback: { id: string; predictionId: string } | null = null;
      if (result.predictionId) {
        const feedbackCaller = decisionFeedbackRouter.createCaller(ctx);
        const action = result.status === "accepted" ? "accept" : result.status === "edited" ? "edit" : "reject";
        const recorded = await feedbackCaller.record({
          predictionId: result.predictionId,
          surface: TRIAGE_SURFACE,
          action,
          ...(action === "edit" && result.finalValue ? { finalValue: result.finalValue } : {}),
        });
        feedback = { id: recorded.id, predictionId: recorded.predictionId };
      }

      return { ...result, feedback };
    }),
});
