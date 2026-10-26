/**
 * Auto-triage service (round 12, wave 7 — roadmap §6, assist mode)
 * ================================================================
 * Classifies complaint free text through the local LLM gateway (/classify)
 * and — only when confidence >= AUTO_TRIAGE_CONFIDENCE (default 0.75) —
 * parks a PENDING row in triage_suggestions (migration 0135) plus a minted
 * decision_feedback baseline (surface 'triage'). The complaint row itself is
 * NEVER mutated by the model: an officer explicitly decides via
 * autoTriageRouter.decide (accept / edit / reject), which updates the
 * suggestion row and appends the outcome to decision_feedback.
 *
 * FAIL-CLOSED: any gateway error or timeout, any malformed model output, or
 * a confidence below threshold leaves the complaint in the manual queue —
 * the function returns { outcome: 'manual_queue', ... } instead of throwing,
 * so triage is never blocked by the LLM.
 *
 * PRIVACY: only the complaint's subject/description text leaves the server
 * (to the LOCAL gateway); no complainant PII columns are read here. The
 * minted suggestion payload is structural (category/severity/team) and
 * contains no data-subject identifiers.
 */
import { getPool } from "../db";
import { logger } from "../logger";
import { COMPLAINT_CATEGORIES } from "./complaintLogic";
import { mintPrediction } from "../routers/decisionFeedback";
import { callLlm, extractJsonObject, LlmGatewayError } from "./llmGateway";

// ─── Vocabulary ───────────────────────────────────────────────────────────────

export const TRIAGE_SEVERITIES = ["routine", "elevated", "high", "critical"] as const;
export type TriageSeverity = (typeof TRIAGE_SEVERITIES)[number];

export const TRIAGE_TEAMS = [
  "investigations",
  "legal",
  "compliance_monitoring",
  "breach_response",
  "consumer_protection",
] as const;
export type TriageTeam = (typeof TRIAGE_TEAMS)[number];

export const TRIAGE_SURFACE = "triage";

export function autoTriageConfidenceThreshold(): number {
  const v = parseFloat(process.env.AUTO_TRIAGE_CONFIDENCE ?? "");
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.75;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TriagePrediction {
  category: (typeof COMPLAINT_CATEGORIES)[number];
  severity: TriageSeverity;
  suggestedTeam: TriageTeam;
  confidence: number;
  modelVersion: string | null;
}

export type SuggestOutcome =
  | {
      outcome: "suggested";
      suggestionId: string;
      predictionId: string;
      suggestion: TriagePrediction;
      threshold: number;
    }
  | {
      outcome: "manual_queue";
      reason: string;
      threshold: number;
      confidence?: number;
      suggestion?: Partial<TriagePrediction>;
    };

// ─── DB helpers (raw SQL on the shared pool — same convention as decisionFeedback) ──

async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new Error("Database unavailable");
  const safeParams = params.map((p) =>
    Array.isArray(p) || (p !== null && typeof p === "object" && !(p instanceof Date))
      ? JSON.stringify(p)
      : p,
  );
  const result = await pool.query(query, safeParams);
  return result.rows ?? [];
}

// ─── Classification ───────────────────────────────────────────────────────────

/**
 * Classify complaint text via the gateway /classify endpoint. Returns a
 * validated prediction or null when the model output is unusable (missing
 * fields, out-of-vocabulary labels, out-of-range confidence). Throws
 * LlmGatewayError on transport failure — the caller fails closed.
 */
export async function classifyComplaintText(text: string): Promise<TriagePrediction | null> {
  const res = await callLlm<Record<string, unknown>>("/classify", {
    text: text.slice(0, 8000),
    labels: {
      category: [...COMPLAINT_CATEGORIES],
      severity: [...TRIAGE_SEVERITIES],
      team: [...TRIAGE_TEAMS],
    },
  });

  // Tolerate both structured responses and free-text JSON (extractJsonObject).
  let payload: Record<string, unknown> | null = res && typeof res === "object" ? res : null;
  if (!payload || typeof payload.category !== "string") {
    const raw = typeof res?.response === "string" ? res.response : typeof res?.text === "string" ? res.text : null;
    payload = raw ? extractJsonObject(raw) : null;
  }
  if (!payload) return null;

  const category = String(payload.category ?? "");
  const severity = String(payload.severity ?? "");
  const team = String(payload.team ?? payload.suggested_team ?? "");
  const confidence = Number(payload.confidence);
  if (!(COMPLAINT_CATEGORIES as readonly string[]).includes(category)) return null;
  if (!(TRIAGE_SEVERITIES as readonly string[]).includes(severity)) return null;
  if (!(TRIAGE_TEAMS as readonly string[]).includes(team)) return null;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;

  return {
    category: category as TriagePrediction["category"],
    severity: severity as TriageSeverity,
    suggestedTeam: team as TriageTeam,
    confidence,
    modelVersion: typeof payload.model_version === "string" ? payload.model_version : null,
  };
}

// ─── Suggest (assist mode) ────────────────────────────────────────────────────

/**
 * Generate a triage suggestion for a complaint. Fail-closed: any error or
 * sub-threshold confidence returns { outcome: 'manual_queue' } and writes
 * nothing (beyond, where applicable, the minted feedback baseline).
 */
export async function suggestTriage(complaintId: number, actorId: string | number): Promise<SuggestOutcome> {
  const threshold = autoTriageConfidenceThreshold();

  const rows = await exec(
    `SELECT id, reference_code, subject, description, category, status FROM public_complaints WHERE id = $1`,
    [complaintId],
  );
  const complaint = rows[0];
  if (!complaint) {
    throw new Error(`Complaint ${complaintId} not found`);
  }
  const text = [complaint.subject, complaint.description].filter(Boolean).join("\n\n").trim();
  if (text.length < 10) {
    return { outcome: "manual_queue", reason: "insufficient_text", threshold };
  }

  let prediction: TriagePrediction | null;
  try {
    prediction = await classifyComplaintText(text);
  } catch (err) {
    logger.warn(
      { err: err instanceof LlmGatewayError ? err.message : String(err), complaintId },
      "[autoTriage] gateway failure — complaint stays in the manual queue",
    );
    return {
      outcome: "manual_queue",
      reason: err instanceof LlmGatewayError ? `gateway_${err.kind}` : "gateway_error",
      threshold,
    };
  }
  if (!prediction) {
    return { outcome: "manual_queue", reason: "unusable_model_output", threshold };
  }
  if (prediction.confidence < threshold) {
    return { outcome: "manual_queue", reason: "below_threshold", threshold, confidence: prediction.confidence, suggestion: prediction };
  }

  // Above threshold: mint the feedback baseline FIRST so the suggestion row
  // can reference the prediction_id, then park the PENDING suggestion.
  const suggestionPayload = {
    complaintRef: complaint.reference_code ?? null,
    category: prediction.category,
    severity: prediction.severity,
    suggestedTeam: prediction.suggestedTeam,
    confidence: prediction.confidence,
  };
  const predictionId = await mintPrediction({
    surface: TRIAGE_SURFACE,
    suggestion: suggestionPayload,
    actorId,
    modelVersion: prediction.modelVersion,
  });

  const inserted = await exec(
    `INSERT INTO triage_suggestions
       (complaint_id, prediction_id, category, severity, suggested_team, confidence, model_version, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
     RETURNING id`,
    [complaintId, predictionId, prediction.category, prediction.severity, prediction.suggestedTeam, prediction.confidence, prediction.modelVersion],
  );

  return {
    outcome: "suggested",
    suggestionId: inserted[0]?.id as string,
    predictionId,
    suggestion: prediction,
    threshold,
  };
}

// ─── Decide ───────────────────────────────────────────────────────────────────

export type TriageDecisionAction = "accepted" | "edited" | "rejected";

export interface TriageDecisionResult {
  suggestionId: string;
  status: TriageDecisionAction;
  predictionId: string | null;
  finalValue: { category: string; severity: string; suggestedTeam: string } | null;
}

/**
 * Apply a human decision to a pending suggestion. Only updates the
 * triage_suggestions row — the decision_feedback append is performed by the
 * router via the Wave-1 decisionFeedback.record procedure (which enforces
 * the pseudonymization denylist and emits ndsep.feedback.recorded).
 */
export async function decideTriage(opts: {
  suggestionId: string;
  action: TriageDecisionAction;
  finalValue?: { category?: string; severity?: string; suggestedTeam?: string };
  decidedBy: string;
}): Promise<TriageDecisionResult> {
  const { suggestionId, action, decidedBy } = opts;
  const existing = await exec(
    `SELECT id, prediction_id, status, category, severity, suggested_team FROM triage_suggestions WHERE id = $1`,
    [suggestionId],
  );
  const row = existing[0];
  if (!row) throw new Error("Triage suggestion not found");
  if (row.status !== "pending") throw new Error(`Triage suggestion already decided (${row.status})`);

  let finalValue: TriageDecisionResult["finalValue"] = null;
  if (action === "edited") {
    const category = opts.finalValue?.category ?? row.category;
    const severity = opts.finalValue?.severity ?? row.severity;
    const suggestedTeam = opts.finalValue?.suggestedTeam ?? row.suggested_team;
    if (!(COMPLAINT_CATEGORIES as readonly string[]).includes(category))
      throw new Error(`finalValue.category must be one of: ${COMPLAINT_CATEGORIES.join(", ")}`);
    if (!(TRIAGE_SEVERITIES as readonly string[]).includes(severity))
      throw new Error(`finalValue.severity must be one of: ${TRIAGE_SEVERITIES.join(", ")}`);
    if (typeof suggestedTeam !== "string" || suggestedTeam.length < 2 || suggestedTeam.length > 64)
      throw new Error("finalValue.suggestedTeam must be a 2-64 char team name");
    finalValue = { category, severity, suggestedTeam };
  }

  await exec(
    `UPDATE triage_suggestions
     SET status = $2, decided_by = $3, decided_at = NOW()
     WHERE id = $1 AND status = 'pending'`,
    [suggestionId, action, decidedBy],
  );

  return { suggestionId, status: action, predictionId: row.prediction_id ?? null, finalValue };
}

/** Pending suggestions, newest first, joined to the complaint for display. */
export async function listPendingSuggestions(opts: { limit?: number; offset?: number } = {}): Promise<{ rows: any[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const rows = await exec(
    `SELECT t.id, t.complaint_id, t.prediction_id, t.category, t.severity, t.suggested_team,
            t.confidence, t.model_version, t.status, t.created_at,
            c.reference_code, c.subject, c.status AS complaint_status
     FROM triage_suggestions t
     JOIN public_complaints c ON c.id = t.complaint_id
     WHERE t.status = 'pending'
     ORDER BY t.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
  );
  const count = await exec(`SELECT COUNT(*)::int AS n FROM triage_suggestions WHERE status = 'pending'`);
  return { rows, total: Number(count[0]?.n ?? 0) };
}

/** Latest suggestion (any status) for one complaint — used by the detail panel. */
export async function latestSuggestionForComplaint(complaintId: number): Promise<any | null> {
  const rows = await exec(
    `SELECT id, complaint_id, prediction_id, category, severity, suggested_team, confidence,
            model_version, status, decided_by, decided_at, created_at
     FROM triage_suggestions
     WHERE complaint_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [complaintId],
  );
  return rows[0] ?? null;
}
