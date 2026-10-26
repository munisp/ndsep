/**
 * Decision Feedback client helpers (round 12, wave 1 — roadmap §4.1)
 * ==================================================================
 * Typed wrappers around the `decisionFeedback` tRPC router so AI surfaces
 * (DPIA generator, compliance Q&A, form copilot, settlement terms, risk
 * weights, triage) can log human outcomes for suggestions they render.
 *
 * Every AI response instrumented server-side carries a `predictionId`
 * (uuid). Pass it to one of these helpers when the user acts:
 *
 *   acceptSuggestion(predictionId, { surface: "dpiagen" })
 *   editSuggestion(predictionId, { surface: "form_copilot", finalValue, editDistance })
 *   rejectSuggestion(predictionId, { surface: "triage" })
 *   ignoreSuggestion(predictionId, { surface: "compliance_qa" })
 *
 * PRIVACY: never pass raw data-subject identifiers (NIN, BVN, subject_ref,
 * raw subject emails/phones) in `finalValue` — the server rejects payloads
 * with raw identifier keys. Pseudonymize (HMAC) first.
 *
 * NOTE: the router is mounted under the `decisionFeedback` namespace in
 * server/routers.ts (round-12 integration), so this client is fully typed
 * against AppRouter.
 */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers";

export type FeedbackAction = "accept" | "edit" | "reject" | "ignore";

export interface RecordFeedbackInput {
  predictionId: string;
  surface: string;
  action: FeedbackAction;
  modelVersion?: string;
  finalValue?: unknown;
  editDistance?: number;
}

export interface RecordFeedbackResult {
  id: string;
  predictionId: string;
  action: FeedbackAction;
  createdAt: string;
}

let _client: ReturnType<typeof createTRPCClient<AppRouter>> | null = null;

function feedbackClient() {
  if (!_client) {
    _client = createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
          fetch(input, init) {
            return globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });
          },
        }),
      ],
    });
  }
  return _client;
}

/** Record any outcome explicitly. */
export async function recordFeedback(input: RecordFeedbackInput): Promise<RecordFeedbackResult> {
  return feedbackClient().decisionFeedback.record.mutate(input);
}

export async function acceptSuggestion(
  predictionId: string,
  opts: { surface: string; modelVersion?: string },
): Promise<RecordFeedbackResult> {
  return recordFeedback({ predictionId, surface: opts.surface, action: "accept", modelVersion: opts.modelVersion });
}

export async function editSuggestion(
  predictionId: string,
  opts: { surface: string; finalValue: unknown; editDistance?: number; modelVersion?: string },
): Promise<RecordFeedbackResult> {
  return recordFeedback({
    predictionId,
    surface: opts.surface,
    action: "edit",
    finalValue: opts.finalValue,
    editDistance: opts.editDistance,
    modelVersion: opts.modelVersion,
  });
}

export async function rejectSuggestion(
  predictionId: string,
  opts: { surface: string; reason?: string; modelVersion?: string },
): Promise<RecordFeedbackResult> {
  return recordFeedback({
    predictionId,
    surface: opts.surface,
    action: "reject",
    finalValue: opts.reason ? { reason: opts.reason } : undefined,
    modelVersion: opts.modelVersion,
  });
}

export async function ignoreSuggestion(
  predictionId: string,
  opts: { surface: string; modelVersion?: string },
): Promise<RecordFeedbackResult> {
  return recordFeedback({ predictionId, surface: opts.surface, action: "ignore", modelVersion: opts.modelVersion });
}

/**
 * Normalized Levenshtein edit distance (0 = identical, 1 = completely
 * different) — convenience for `editSuggestion` when both the suggestion
 * text and the user's final text are available.
 */
export function computeEditDistance(suggested: string, final: string): number {
  if (suggested === final) return 0;
  const a = suggested, b = final;
  if (!a.length) return b.length ? 1 : 0;
  if (!b.length) return 1;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length] / Math.max(a.length, b.length);
}
