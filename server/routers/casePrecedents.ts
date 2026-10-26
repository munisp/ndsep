/**
 * Case Precedents Router (round 12, wave 6 — roadmap §4.3)
 * ========================================================
 * Case-similarity retrieval over the Commission's OWN decided case history.
 * workers/python/case_embedder_worker.py incrementally embeds redacted text
 * cards for closed public complaints, decided enforcement cases, completed
 * settlements, and decided tribunal escalations into the Qdrant collection
 * `ndsep_cases`; this router queries that collection (through the vector
 * worker's /search endpoint, which owns the embedding model) and returns
 * scored precedent cards to the SimilarPrecedentsPanel client component
 * mounted in triage, settlement, and penalty screens.
 *
 * Retrieval path and degradation contract (fail-closed, no silent mocks):
 *   - QDRANT_WORKER_URL (default http://localhost:8200) exposes
 *     GET /search?q=<text>&collection=ndsep_cases (qdrant_vector_worker.py).
 *     There is no direct Qdrant client in server/ code today — all server
 *     Qdrant access (see routers/aimlRouter.ts, routers/regIntel.ts) goes
 *     through HTTP to sidecar workers, and this router follows that pattern.
 *   - If the worker is unreachable, errors, or returns nothing, the router
 *     returns { results: [], degraded: true, reason } — never a fabricated
 *     precedent and never an exception that would break the host screen.
 *
 * Feedback loop (roadmap §4.1 keystone):
 *   - every similarCases response mints a decision_feedback prediction
 *     (surface='precedents') via decisionFeedback.mintPrediction; the
 *     response carries predictionId;
 *   - logPrecedentOutcome records the officer's helpful / not-helpful
 *     verdict by delegating to decisionFeedback.record (accept / reject).
 *
 * PRIVACY: precedent cards carry only structural metadata produced by the
 * embedder (case_type, case_id, sector, outcome, penalty_band, decided_at,
 * reference). Query text derived from a complaint is PII-scrubbed before it
 * leaves the server, and the minted suggestion payload never carries raw
 * data-subject identifier keys (decisionFeedback enforces a denylist).
 *
 * AuthZ: staffProcedure (admin / government_staff / auditor) — same gate as
 * complaint-handling workloads; precedent cards describe decided Commission
 * cases and are not public data.
 *
 * DB access for the complaintId path is raw SQL against the shared pg pool
 * (same convention as complaintAnalytics.ts / decisionFeedback.ts).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, staffProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { mintPrediction, decisionFeedbackRouter } from "./decisionFeedback";

// ─── Constants ────────────────────────────────────────────────────────────────

export const PRECEDENTS_SURFACE = "precedents";
export const CASES_COLLECTION = "ndsep_cases";

const QDRANT_WORKER_URL = process.env.QDRANT_WORKER_URL || "http://localhost:8200";
const WORKER_TIMEOUT_MS = Number(process.env.CASE_PRECEDENTS_TIMEOUT_MS || 5000);
const EMBED_MODEL = process.env.EMBED_MODEL || "all-MiniLM-L6-v2";

export const CASE_TYPES = ["complaint", "enforcement", "settlement", "tribunal"] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export interface PrecedentCard {
  caseType: string;
  caseId: string;
  reference: string;
  category: string;
  sector: string;
  outcome: string;
  penaltyBand: string;
  decidedAt: string;
  score: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  try {
    const result = await pool.query(query, params);
    return result.rows ?? [];
  } catch (err) {
    logger.error({ err, query: query.slice(0, 200) }, "[casePrecedents] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

/**
 * Defence-in-depth PII scrub for query text before it leaves the server for
 * the embedding service. Mirrors the embedder's redact_pii() shapes: emails,
 * MSISDN/phone numbers, 11-digit NIN/BVN runs, and long digit runs. The
 * query is never persisted, but it must not carry raw identifiers across a
 * process boundary either.
 */
export function redactQueryText(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/(?:\+?234[\s-]?[789][01]\d[\s-]?\d{3}[\s-]?\d{4}|0[789][01]\d[\s-]?\d{3}[\s-]?\d{4})/g, "[phone]")
    .replace(/(?<!\d)\d{11}(?!\d)/g, "[nin]")
    .replace(/(?<!\d)\d{8,16}(?!\d)/g, "[id]")
    .slice(0, 2000);
}

interface WorkerSearchHit {
  score: number;
  payload?: Record<string, unknown>;
}

/**
 * Query the vector worker's /search endpoint against ndsep_cases.
 * Returns null when the worker is unreachable or errors — callers convert
 * that into the explicit degraded response (fail-closed, no fabricated hits).
 */
export async function searchCases(queryText: string, fetchLimit: number): Promise<WorkerSearchHit[] | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);
    const url = `${QDRANT_WORKER_URL}/search?q=${encodeURIComponent(queryText)}&collection=${CASES_COLLECTION}`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const body = (await resp.json()) as { results?: WorkerSearchHit[] };
    if (!Array.isArray(body.results)) return null;
    return body.results.slice(0, fetchLimit);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[casePrecedents] vector worker unreachable");
    return null;
  }
}

function toCard(hit: WorkerSearchHit): PrecedentCard {
  const p = hit.payload ?? {};
  return {
    caseType: String(p.case_type ?? "unknown"),
    caseId: String(p.case_id ?? ""),
    reference: String(p.reference ?? ""),
    category: String(p.category ?? ""),
    sector: String(p.sector ?? ""),
    outcome: String(p.outcome ?? ""),
    penaltyBand: String(p.penalty_band ?? ""),
    decidedAt: String(p.decided_at ?? ""),
    score: typeof hit.score === "number" ? hit.score : 0,
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const casePrecedentsRouter = router({
  /**
   * Find precedents similar to a complaint under triage, a settlement under
   * negotiation, or a penalty under preview. Provide either `queryText`
   * (free text, PII-scrubbed server-side) or `complaintId` (server builds
   * the query from the complaint's category/subject/description).
   */
  similarCases: staffProcedure
    .input(z.object({
      caseType: z.enum(CASE_TYPES).optional(),
      queryText: z.string().min(3).max(4000).optional(),
      complaintId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(10).default(5),
    }).refine((v) => v.queryText || v.complaintId, {
      message: "Provide queryText or complaintId",
    }))
    .query(async ({ input, ctx }) => {
      let queryText = input.queryText ?? "";
      if (!queryText && input.complaintId) {
        const rows = await exec(
          `SELECT id, category, subject, description, status
           FROM public_complaints WHERE id = $1`,
          [input.complaintId],
        );
        if (!rows.length) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Complaint not found" });
        }
        const c = rows[0];
        queryText = `Complaint category: ${c.category}\nSubject: ${c.subject}\n${c.description}`;
      }
      queryText = redactQueryText(queryText);

      // Over-fetch so a caseType filter still yields up to `limit` cards.
      const hits = await searchCases(queryText, input.limit * 3);
      if (hits === null) {
        return {
          predictionId: null,
          results: [] as PrecedentCard[],
          degraded: true,
          reason: "case-similarity retrieval unavailable (vector worker unreachable)",
          collection: CASES_COLLECTION,
        };
      }

      let cards = hits.map(toCard);
      if (input.caseType) {
        cards = cards.filter((c) => c.caseType === input.caseType);
      }
      cards = cards.slice(0, input.limit);

      // Mint the feedback prediction so the panel can log helpful /
      // not-helpful verdicts against this exact suggestion set.
      const predictionId = await mintPrediction({
        surface: PRECEDENTS_SURFACE,
        suggestion: {
          case_type_filter: input.caseType ?? null,
          complaint_id: input.complaintId ?? null,
          results: cards.map((c) => ({
            case_type: c.caseType,
            case_id: c.caseId,
            reference: c.reference,
            outcome: c.outcome,
            penalty_band: c.penaltyBand,
            score: c.score,
          })),
        },
        actorId: ctx.user.id,
        modelVersion: EMBED_MODEL,
      });

      return {
        predictionId,
        results: cards,
        degraded: cards.length === 0,
        reason: cards.length === 0 ? "no decided cases embedded yet (run case_embedder_worker)" : null,
        collection: CASES_COLLECTION,
      };
    }),

  /**
   * Record an officer's helpful / not-helpful verdict on a precedent panel.
   * Delegates to decisionFeedback.record so the outcome lands in the same
   * append-only acceptance log (surface='precedents') with outbox event +
   * audit-ledger trail. helpful → accept, not helpful → reject.
   */
  logPrecedentOutcome: staffProcedure
    .input(z.object({
      predictionId: z.string().uuid(),
      helpful: z.boolean(),
      caseType: z.enum(CASE_TYPES).optional(),
      caseId: z.string().max(64).optional(),
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const caller = decisionFeedbackRouter.createCaller(ctx);
      const result = await caller.record({
        predictionId: input.predictionId,
        surface: PRECEDENTS_SURFACE,
        action: input.helpful ? "accept" : "reject",
        modelVersion: EMBED_MODEL,
        finalValue: {
          verdict: input.helpful ? "helpful" : "not_helpful",
          case_type: input.caseType ?? null,
          case_id: input.caseId ?? null,
          note: input.note ?? null,
        },
      });
      logger.info({
        predictionId: input.predictionId,
        helpful: input.helpful,
        actor: ctx.user.id,
      }, "[casePrecedents] precedent outcome recorded");
      return { recorded: true, feedbackId: result.id, action: result.action };
    }),
});

export type CasePrecedentsRouter = typeof casePrecedentsRouter;
