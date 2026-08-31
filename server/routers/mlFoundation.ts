import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";

const ML_FOUNDATION_URL = process.env.ML_FOUNDATION_URL ?? "http://127.0.0.1:8251";

async function modelRequest(path: string, options?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${ML_FOUNDATION_URL}${path}`, {
      ...options,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Candidate ML service is unavailable; no heuristic or synthetic fallback was used.",
      cause: error,
    });
  }
  if (!response.ok) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Verified candidate model is unavailable; inference was not performed.",
    });
  }
  return response.json();
}

const eventFeatureSchema = z.object({
  amount_ngn_equivalent: z.number().min(0).max(10_000_000),
  velocity_24h: z.number().int().min(0).max(10_000),
  device_age_days: z.number().int().min(0).max(20_000),
  country_risk_band: z.number().int().min(0).max(2),
  cross_border: z.boolean(),
  prior_review_count: z.number().int().min(0).max(10_000),
  failed_auth_24h: z.number().int().min(0).max(10_000),
  unusual_hour: z.number().int().min(0).max(1),
});

/**
 * Candidate-only ML access boundary.  This router deliberately does not expose a
 * deployment, promotion or automated-enforcement operation.  It is protected by
 * the platform session and always asks the worker for decision-support output.
 */
export const mlFoundationRouter = router({
  health: protectedProcedure.query(() => modelRequest("/health")),
  models: protectedProcedure.query(() => modelRequest("/v1/models")),
  predictSyntheticCandidate: protectedProcedure
    .input(eventFeatureSchema)
    .query(({ input }) => modelRequest("/v1/predict/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, purpose: "decision_support" }),
    })),
});
