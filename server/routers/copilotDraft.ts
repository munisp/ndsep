/**
 * Copilot drafting router (round 12, wave 7 — roadmap §6)
 * =======================================================
 * Template-aware document drafting against the local LLM gateway:
 *
 *   complaint_acknowledgment — acknowledgement letter for a public complaint
 *   enforcement_notice       — draft enforcement notice for a case
 *   settlement_terms         — settlement term proposal narrative
 *
 * Facts are pulled SERVER-SIDE from the same rows the officer already sees
 * (no complainant PII columns are read — reference codes, subjects, statuses,
 * amounts and dates only). The prompt is sent to the local gateway
 * (/compliance-qa) and the draft text returned alongside a predictionId
 * minted through the Wave-1 feedback loop (decisionFeedback.mintPrediction).
 * The UI records accept / edit-accept (with edit distance) / reject via
 * client/src/lib/feedback.ts.
 *
 * Fail-closed: a gateway failure surfaces as a visible TRPCError to the
 * officer — nothing is silently fabricated and nothing is persisted.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { mintPrediction } from "./decisionFeedback";
import { callLlm, extractText, LlmGatewayError } from "../services/llmGateway";

// ─── Constants ────────────────────────────────────────────────────────────────

export const DRAFT_TEMPLATES = ["complaint_acknowledgment", "enforcement_notice", "settlement_terms"] as const;
export type DraftTemplate = (typeof DRAFT_TEMPLATES)[number];

export const DRAFT_TONES = ["formal", "neutral", "firm"] as const;
export type DraftTone = (typeof DRAFT_TONES)[number];

/** Feedback surfaces per template (settlement_terms is a Wave-1 known surface). */
const SURFACE_FOR: Record<DraftTemplate, string> = {
  complaint_acknowledgment: "copilot_draft",
  enforcement_notice: "copilot_draft",
  settlement_terms: "settlement_terms",
};

// ─── DB helper ────────────────────────────────────────────────────────────────

async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  try {
    const safeParams = params.map((p) =>
      Array.isArray(p) || (p !== null && typeof p === "object" && !(p instanceof Date))
        ? JSON.stringify(p)
        : p,
    );
    const result = await pool.query(query, safeParams);
    return result.rows ?? [];
  } catch (err) {
    logger.error({ err, query: query.slice(0, 160) }, "[copilotDraft] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

// ─── Fact gathering (server-side; no data-subject PII columns are selected) ──

interface DraftFacts {
  heading: string;
  lines: string[];
}

async function factsForComplaint(complaintId: number): Promise<DraftFacts> {
  const rows = await exec(
    `SELECT id, reference_code, category, subject, status, controller_id, state, received_at, ack_sla_due_at
     FROM public_complaints WHERE id = $1`,
    [complaintId],
  );
  const c = rows[0];
  if (!c) throw new TRPCError({ code: "NOT_FOUND", message: `Complaint ${complaintId} not found` });
  return {
    heading: `Complaint ${c.reference_code}`,
    lines: [
      `Reference: ${c.reference_code}`,
      `Category: ${c.category ?? "uncategorised"}`,
      `Subject: ${c.subject ?? "(none)"}`,
      `Status: ${c.status}`,
      `Controller: ${c.controller_name ?? (c.controller_id != null ? `organisation #${c.controller_id}` : "unknown")}`,
      `State: ${c.state ?? "n/a"}`,
      `Received: ${c.received_at ? new Date(c.received_at).toISOString().slice(0, 10) : "n/a"}`,
      `Acknowledgement SLA due: ${c.ack_sla_due_at ? new Date(c.ack_sla_due_at).toISOString().slice(0, 10) : "n/a"}`,
    ],
  };
}

async function factsForEnforcementCase(caseId: number): Promise<DraftFacts> {
  const rows = await exec(
    `SELECT id, case_reference, status, penalty_id, organization_id, opened_at, escalation_reason
     FROM enforcement_cases WHERE id = $1`,
    [caseId],
  );
  const c = rows[0];
  if (!c) throw new TRPCError({ code: "NOT_FOUND", message: `Enforcement case ${caseId} not found` });
  return {
    heading: `Enforcement case ${c.case_reference}`,
    lines: [
      `Case reference: ${c.case_reference}`,
      `Status: ${c.status}`,
      `Organisation: #${c.organization_id}`,
      `Penalty id: ${c.penalty_id}`,
      `Opened: ${c.opened_at ? new Date(c.opened_at).toISOString().slice(0, 10) : "n/a"}`,
      c.escalation_reason ? `Escalation reason: ${String(c.escalation_reason).slice(0, 500)}` : "",
    ].filter(Boolean),
  };
}

async function factsForSettlement(settlementId: number): Promise<DraftFacts> {
  const rows = await exec(
    `SELECT id, settlement_ref, case_ref, status, original_amount, respondent_name, created_at
     FROM settlements WHERE id = $1`,
    [settlementId],
  );
  const s = rows[0];
  if (!s) throw new TRPCError({ code: "NOT_FOUND", message: `Settlement ${settlementId} not found` });
  const terms = await exec(
    `SELECT version, monetary_amount, currency, non_monetary_obligations, instalment_schedule, is_counter
     FROM settlement_terms WHERE settlement_id = $1 ORDER BY version DESC LIMIT 1`,
    [settlementId],
  );
  const t = terms[0];
  const obligations = Array.isArray(t?.non_monetary_obligations)
    ? (t.non_monetary_obligations as unknown[]).map(String)
    : typeof t?.non_monetary_obligations === "string"
      ? (() => { try { const p = JSON.parse(t.non_monetary_obligations); return Array.isArray(p) ? p.map(String) : []; } catch { return []; } })()
      : [];
  return {
    heading: `Settlement ${s.settlement_ref}`,
    lines: [
      `Settlement reference: ${s.settlement_ref}`,
      `Case: ${s.case_ref}`,
      `Status: ${s.status}`,
      `Respondent: ${s.respondent_name ?? "n/a"}`,
      s.original_amount != null ? `Original penalty amount: ${s.original_amount}` : "",
      t ? `Current terms v${t.version}: ${t.currency} ${t.monetary_amount}${t.is_counter ? " (counter-proposal)" : ""}` : "No terms recorded yet",
      obligations.length ? `Non-monetary obligations: ${obligations.slice(0, 10).join("; ")}` : "",
    ].filter(Boolean),
  };
}

// ─── Prompt construction ──────────────────────────────────────────────────────

export function buildDraftPrompt(template: DraftTemplate, tone: DraftTone, facts: DraftFacts, instructions?: string): string {
  const task =
    template === "complaint_acknowledgment"
      ? "Draft a complaint acknowledgement letter confirming receipt within the statutory acknowledgement window, stating the reference, the next steps in the triage process and the expected timelines. Do not admit or deny liability."
      : template === "enforcement_notice"
        ? "Draft an enforcement notice referencing the case, the alleged contraventions, the statutory basis under the NDPA 2023, the required remedial actions and the response deadline. Use placeholders like [RESPONDENT NAME] where a fact is not provided."
        : "Draft a settlement term proposal narrative: restate the current position, propose fair settlement terms (monetary amount, non-monetary obligations, instalment structure where sensible) and justify them against the original penalty. Use placeholders like [AMOUNT] where a fact is not provided.";
  return [
    `You are a drafting assistant for the Nigeria Data Protection Commission (NDPC).`,
    `Task: ${task}`,
    `Tone: ${tone}. Output ONLY the draft document text — no commentary, no markdown fences.`,
    `Facts (authoritative — do not invent contradicting facts):`,
    facts.heading,
    ...facts.lines.map((l) => `- ${l}`),
    instructions ? `Officer instructions: ${instructions.slice(0, 1000)}` : "",
  ].filter(Boolean).join("\n");
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const copilotDraftRouter = router({
  draft: protectedProcedure
    .input(
      z.object({
        template: z.enum(DRAFT_TEMPLATES),
        entityId: z.number().int().positive(),
        tone: z.enum(DRAFT_TONES).default("formal"),
        instructions: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const facts =
        input.template === "complaint_acknowledgment"
          ? await factsForComplaint(input.entityId)
          : input.template === "enforcement_notice"
            ? await factsForEnforcementCase(input.entityId)
            : await factsForSettlement(input.entityId);

      const prompt = buildDraftPrompt(input.template, input.tone, facts, input.instructions);

      let res: Record<string, unknown>;
      try {
        res = await callLlm<Record<string, unknown>>("/compliance-qa", { question: prompt });
      } catch (err) {
        const msg = err instanceof LlmGatewayError ? err.message : String(err);
        logger.warn({ err: msg, template: input.template }, "[copilotDraft] gateway failure");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Drafting assistant unavailable (${msg}). Write the document manually.`,
        });
      }
      const draft = extractText(res);
      if (!draft) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Drafting assistant returned an empty draft. Write the document manually.",
        });
      }
      const modelVersion = typeof res.model_version === "string" ? res.model_version : null;

      // Wave-1 feedback loop: mint the baseline prediction. Suggestion payload
      // is structural (template/tone/excerpt) — no data-subject identifiers.
      const predictionId = await mintPrediction({
        surface: SURFACE_FOR[input.template],
        suggestion: {
          template: input.template,
          tone: input.tone,
          heading: facts.heading,
          excerpt: draft.slice(0, 2000),
        },
        actorId: ctx.user.id,
        modelVersion,
      });

      return { predictionId, draft, template: input.template, tone: input.tone, modelVersion, factsHeading: facts.heading };
    }),
});
