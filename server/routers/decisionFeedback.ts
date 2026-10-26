/**
 * Decision Feedback Router (round 12, wave 1 — roadmap §4.1 keystone)
 * ===================================================================
 * Acceptance logging for every AI / rule-based suggestion surfaced to a
 * human across the platform's AI surfaces (triage, dpiagen, form_copilot,
 * settlement_terms, risk_weights, compliance_query, compliance_qa, ...).
 *
 * Flow:
 *   1. An AI surface (platformIntelligence.aiGenerateDPIA / aiGapAnalysis /
 *      aiComplianceQuery, ollamaRouter.complianceQA, ...) calls the exported
 *      mintPrediction() helper which inserts a BASELINE row with
 *      action='ignore' (an unanswered suggestion is statistically an
 *      implicit ignore) and returns a prediction_id uuid to the UI.
 *   2. When the human acts, the UI calls `record` (via
 *      client/src/lib/feedback.ts) which APPENDS a new row for the same
 *      prediction_id with the real outcome. Rows are append-only;
 *      `acceptanceRate` takes the LATEST action per prediction_id
 *      (DISTINCT ON) so re-decisions supersede the baseline.
 *   3. Each recorded outcome emits `ndsep.feedback.recorded` through
 *      publishWithOutbox (durable: outbox row first, broker best-effort)
 *      and appends to the anti-wipe hash-chained audit_ledger.
 *
 * PRIVACY (HMAC pseudonymization constraint):
 *   suggestion / final_value payloads must NEVER contain raw data-subject
 *   identifiers — no NIN, BVN, subject_ref, or raw subject emails/phones.
 *   Callers MUST pseudonymize data-subject references with the keyed-HMAC
 *   pattern (subject_ref_hash, migrations 0105/0122/0126;
 *   server/services/complaintLogic.hmacSha256Hex). This router enforces a
 *   conservative key denylist on both jsonb payloads and rejects payloads
 *   carrying obviously raw identifier fields.
 *
 * DB access is raw SQL against the shared pg pool (same convention as
 * complaintAnalytics.ts / supervisionRisk.ts); the table is defined in
 * drizzle/schema.ts (decisionFeedback table) + migration 0127.
 */
import { createHash, randomUUID } from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { publishWithOutbox } from "../kafka";
import { appendLedger } from "../antiwipe/ledger";

// ─── Constants ────────────────────────────────────────────────────────────────

export const FEEDBACK_ACTIONS = ["accept", "edit", "reject", "ignore"] as const;
export type FeedbackAction = (typeof FEEDBACK_ACTIONS)[number];

/** Well-known surfaces; free-form surfaces are allowed (validated shape only). */
export const KNOWN_SURFACES = [
  "triage",
  "dpiagen",
  "form_copilot",
  "settlement_terms",
  "risk_weights",
  "compliance_query",
  "compliance_qa",
  "gap_analysis",
] as const;

export const FEEDBACK_TOPIC = "ndsep.feedback.recorded";

/**
 * Conservative denylist of jsonb keys that indicate raw data-subject
 * identifiers. Payloads (recursively) carrying any of these keys are
 * rejected — callers must pseudonymize (HMAC) instead.
 */
const RAW_IDENTIFIER_KEYS = new Set([
  "nin",
  "bvn",
  "subject_ref",
  "subjectref",
  "data_subject_ref",
  "national_id",
  "passport_number",
  "phone_number",
  "msisdn",
  "email",
  "email_address",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    logger.error({ err, query: query.slice(0, 200) }, "[decisionFeedback] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

/**
 * Deterministic pseudonymous actor uuid derived from the internal user id.
 * decision_feedback.actor_id is a uuid that is NOT a FK to users.id (serial);
 * we derive a stable uuid (sha256 of a namespaced key, version-5 style) so
 * acceptance analytics can group by actor without storing a raw identifier.
 */
export function actorUuid(actorKey: string | number): string {
  const hex = createHash("sha256").update(`ndsep:feedback-actor:${String(actorKey)}`).digest("hex");
  const h = hex.slice(0, 32).split("");
  h[12] = "5"; // version nibble
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16); // variant bits
  return `${h.slice(0, 8).join("")}-${h.slice(8, 12).join("")}-${h.slice(12, 16).join("")}-${h.slice(16, 20).join("")}-${h.slice(20, 32).join("")}`;
}

/** Recursively scan a json payload for raw data-subject identifier keys. */
function findRawIdentifierKey(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findRawIdentifierKey(item);
      if (hit) return hit;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (RAW_IDENTIFIER_KEYS.has(k.toLowerCase())) return k;
    const hit = findRawIdentifierKey(v);
    if (hit) return hit;
  }
  return null;
}

function assertPseudonymized(payload: unknown, field: string): void {
  const bad = findRawIdentifierKey(payload);
  if (bad) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${field} appears to contain a raw data-subject identifier (key "${bad}") — pseudonymize with keyed HMAC before recording feedback`,
    });
  }
}

/** Cap payload size defensively (suggestions can be long LLM outputs). */
function capPayload(value: unknown, maxBytes = 64 * 1024): unknown {
  const json = JSON.stringify(value ?? null);
  if (json.length <= maxBytes) return value ?? null;
  return { truncated: true, excerpt: json.slice(0, maxBytes) };
}

async function insertFeedbackRow(row: {
  predictionId: string;
  surface: string;
  modelVersion: string | null;
  suggestion: unknown;
  actorId: string;
  action: FeedbackAction;
  editDistance: number | null;
  finalValue: unknown | null;
}): Promise<{ id: string; created_at: string }> {
  const rows = await exec(
    `INSERT INTO decision_feedback
       (prediction_id, surface, model_version, suggestion, actor_id, action, edit_distance, final_value)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb)
     RETURNING id, created_at`,
    [
      row.predictionId,
      row.surface,
      row.modelVersion,
      row.suggestion,
      row.actorId,
      row.action,
      row.editDistance,
      row.finalValue ?? null,
    ],
  );
  return rows[0];
}

function emitFeedbackEvent(row: {
  id: string;
  predictionId: string;
  surface: string;
  action: FeedbackAction;
  actorId: string;
  modelVersion: string | null;
}): void {
  publishWithOutbox(FEEDBACK_TOPIC, row.predictionId, {
    event: "feedback.recorded",
    feedbackId: row.id,
    predictionId: row.predictionId,
    surface: row.surface,
    action: row.action,
    actorId: row.actorId,
    modelVersion: row.modelVersion,
    ts: new Date().toISOString(),
  }).catch((e: unknown) =>
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "[decisionFeedback] publishWithOutbox failed"),
  );
}

function ledgerWrite(action: string, payload: Record<string, unknown>, actor: string): void {
  appendLedger(action, payload, actor).catch((e: unknown) =>
    logger.warn({ err: e instanceof Error ? e.message : String(e), action }, "[decisionFeedback] audit_ledger append failed"),
  );
}

// ─── Instrumentation helper used by AI surfaces ──────────────────────────────

/**
 * Mint a prediction_id and insert the baseline ('ignore') feedback row for a
 * freshly-generated suggestion. Best-effort by design: if the DB is
 * unavailable the caller still receives a prediction_id so the AI surface's
 * primary response is never blocked by feedback plumbing; in that case the
 * outcome row recorded later will simply carry the full suggestion inline.
 *
 * `suggestion` MUST be pseudonymized (no raw data-subject identifiers — see
 * module header).
 */
export async function mintPrediction(opts: {
  surface: string;
  suggestion: unknown;
  actorId: string | number;
  modelVersion?: string | null;
}): Promise<string> {
  const predictionId = randomUUID();
  try {
    const suggestion = capPayload(opts.suggestion);
    assertPseudonymized(suggestion, "suggestion");
    const actorId = actorUuid(opts.actorId);
    const row = await insertFeedbackRow({
      predictionId,
      surface: opts.surface,
      modelVersion: opts.modelVersion ?? null,
      suggestion,
      actorId,
      action: "ignore",
      editDistance: null,
      finalValue: null,
    });
    emitFeedbackEvent({ id: row.id, predictionId, surface: opts.surface, action: "ignore", actorId, modelVersion: opts.modelVersion ?? null });
  } catch (err) {
    logger.warn({ err, surface: opts.surface }, "[decisionFeedback] mintPrediction failed — returning untracked predictionId");
  }
  return predictionId;
}

// ─── Router ───────────────────────────────────────────────────────────────────

const surfaceSchema = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, "surface must be snake_case");

export const decisionFeedbackRouter = router({
  /**
   * Record the human outcome for a previously-minted prediction.
   * Appends a row (the baseline 'ignore' row remains as history);
   * `suggestion` is optional — when omitted it is copied from the most
   * recent prior row for the same prediction_id.
   */
  record: protectedProcedure
    .input(z.object({
      predictionId: z.string().uuid(),
      surface: surfaceSchema,
      action: z.enum(FEEDBACK_ACTIONS),
      modelVersion: z.string().max(128).optional(),
      suggestion: z.unknown().optional(),
      editDistance: z.number().min(0).max(1_000_000).optional(),
      finalValue: z.unknown().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const actorId = actorUuid(ctx.user.id);
      let suggestion = input.suggestion !== undefined ? capPayload(input.suggestion) : undefined;
      let finalValue = input.finalValue !== undefined ? capPayload(input.finalValue) : null;
      if (suggestion !== undefined) assertPseudonymized(suggestion, "suggestion");
      if (finalValue !== null) assertPseudonymized(finalValue, "final_value");

      if (suggestion === undefined) {
        const prior = await exec(
          `SELECT suggestion FROM decision_feedback WHERE prediction_id = $1
           ORDER BY created_at DESC LIMIT 1`,
          [input.predictionId],
        );
        if (!prior.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Unknown prediction_id and no suggestion payload supplied — nothing to record",
          });
        }
        suggestion = prior[0].suggestion;
      }
      if (input.action === "edit" && finalValue === null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "action 'edit' requires finalValue" });
      }

      const row = await insertFeedbackRow({
        predictionId: input.predictionId,
        surface: input.surface,
        modelVersion: input.modelVersion ?? null,
        suggestion,
        actorId,
        action: input.action,
        editDistance: input.editDistance ?? null,
        finalValue,
      });

      emitFeedbackEvent({
        id: row.id,
        predictionId: input.predictionId,
        surface: input.surface,
        action: input.action,
        actorId,
        modelVersion: input.modelVersion ?? null,
      });
      ledgerWrite("feedback.recorded", {
        feedbackId: row.id,
        predictionId: input.predictionId,
        surface: input.surface,
        action: input.action,
        actorId,
        editDistance: input.editDistance ?? null,
      }, String(ctx.user.id));

      return { id: row.id as string, predictionId: input.predictionId, action: input.action, createdAt: row.created_at };
    }),

  /**
   * Acceptance rate per surface over a trailing window. Uses the LATEST
   * action per prediction_id (DISTINCT ON) so the minted 'ignore' baseline
   * and any superseded decisions don't double-count.
   */
  acceptanceRate: protectedProcedure
    .input(z.object({
      surface: surfaceSchema,
      windowDays: z.number().int().min(1).max(365).default(30),
    }))
    .query(async ({ input }) => {
      const rows = await exec(
        `SELECT action, COUNT(*)::int AS n FROM (
           SELECT DISTINCT ON (prediction_id) action
           FROM decision_feedback
           WHERE surface = $1
             AND created_at >= now() - make_interval(days => $2)
           ORDER BY prediction_id, created_at DESC
         ) latest
         GROUP BY action`,
        [input.surface, input.windowDays],
      );
      const counts: Record<FeedbackAction, number> = { accept: 0, edit: 0, reject: 0, ignore: 0 };
      for (const r of rows) {
        const action = r.action as FeedbackAction;
        if (action in counts) counts[action] = Number(r.n);
      }
      const total = counts.accept + counts.edit + counts.reject + counts.ignore;
      const decided = counts.accept + counts.edit + counts.reject;
      let avgEditDistance: number | null = null;
      if (counts.edit > 0) {
        const avgRows = await exec(
          `SELECT AVG(edit_distance)::float AS avg_ed FROM (
             SELECT DISTINCT ON (prediction_id) action, edit_distance
             FROM decision_feedback
             WHERE surface = $1
               AND created_at >= now() - make_interval(days => $2)
             ORDER BY prediction_id, created_at DESC
           ) latest
           WHERE action = 'edit' AND edit_distance IS NOT NULL`,
          [input.surface, input.windowDays],
        );
        avgEditDistance = avgRows[0]?.avg_ed != null ? Number(avgRows[0].avg_ed) : null;
      }
      return {
        surface: input.surface,
        windowDays: input.windowDays,
        counts,
        total,
        /** accept / all outcomes (incl. implicit ignores). */
        acceptanceRate: total > 0 ? counts.accept / total : null,
        /** accept / decided outcomes (excludes ignores). */
        decidedAcceptanceRate: decided > 0 ? counts.accept / decided : null,
        /** mean edit_distance over the latest 'edit' outcomes. */
        avgEditDistance,
      };
    }),

  /** Recent feedback rows for a surface (or all surfaces), newest first. */
  listRecent: protectedProcedure
    .input(z.object({
      surface: surfaceSchema.optional(),
      action: z.enum(FEEDBACK_ACTIONS).optional(),
      predictionId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const params: unknown[] = [];
      const conds: string[] = [];
      if (input.surface) { params.push(input.surface); conds.push(`surface = $${params.length}`); }
      if (input.action) { params.push(input.action); conds.push(`action = $${params.length}`); }
      if (input.predictionId) { params.push(input.predictionId); conds.push(`prediction_id = $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      params.push(input.limit, input.offset);
      const rows = await exec(
        `SELECT id, prediction_id, surface, model_version, action, edit_distance,
                actor_id, suggestion, final_value, created_at
         FROM decision_feedback ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const countParams = params.slice(0, params.length - 2);
      const totalRows = await exec(
        `SELECT COUNT(*)::int AS n FROM decision_feedback ${where}`,
        countParams,
      );
      return {
        rows: rows.map((r) => ({
          id: r.id as string,
          predictionId: r.prediction_id as string,
          surface: r.surface as string,
          modelVersion: r.model_version as string | null,
          action: r.action as FeedbackAction,
          editDistance: r.edit_distance !== null ? Number(r.edit_distance) : null,
          actorId: r.actor_id as string,
          suggestion: r.suggestion as unknown,
          finalValue: r.final_value as unknown,
          createdAt: r.created_at as string,
        })),
        total: Number(totalRows[0]?.n ?? 0),
        limit: input.limit,
        offset: input.offset,
      };
    }),
});
