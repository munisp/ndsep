/**
 * Duplicate-merge autonomy (round 12, wave 9 — roadmap §7, surface 'duplicate_merge')
 * ===================================================================================
 * Finds near-duplicate OPEN complaints — same controller (normalized name),
 * same category, received within 14 days of each other, similar subject —
 * and turns them into merge proposals:
 *
 *   tier 1 : the pair is minted as a decision_feedback suggestion
 *            (surface 'duplicate_merge') only — a human merges manually via
 *            publicComplaints.mergeDuplicates / DuplicateComplaintPicker.
 *   tier ≥2: a MERGE PROPOSAL is parked in autonomy_actions with a 24h undo
 *            window (migration 0140); executeDueAutonomyActions() (shared
 *            queue, server/services/autonomyActions.ts) applies the merge
 *            after the deadline, undoAction() restores from the payload
 *            snapshot before or after execution.
 *
 * Similarity: pg_trgm similarity() when the extension is installed (guarded
 * via pg_extension lookup; errors → fallback), otherwise an ILIKE-equivalent
 * normalized-substring shortlist; both paths verify with an in-process
 * trigram Jaccard (the same metric pg_trgm implements) so behaviour is
 * deterministic and unit-testable.
 *
 * Temporal wiring (workers/temporal workstream): schedule
 * `runDuplicateMergeSweep()` periodically (e.g. hourly); execution of due
 * proposals is the shared `executeDueAutonomyActions()`.
 *
 * FAIL-CLOSED: tier resolution fails → tier 1 (suggest-only); a proposal that
 * can no longer be applied at execution time is expired, never forced.
 */
import { getPool } from "../db";
import { logger } from "../logger";
import { getTier } from "./autonomyTiers";
import {
  createAutonomyAction,
  registerActionHandler,
  type AutonomyActionRow,
} from "./autonomyActions";
import { mintPrediction } from "../routers/decisionFeedback";

export const DUPLICATE_MERGE_SURFACE = "duplicate_merge";
export const MERGE_PROPOSAL_ACTION = "merge_proposal";
export const DUPLICATE_WINDOW_DAYS = 14;
/** Final acceptance threshold for the trigram Jaccard on normalized subjects. */
export const SIMILARITY_THRESHOLD = 0.4;
/** SQL shortlist threshold when pg_trgm is available (deliberately looser). */
const PG_TRGM_SHORTLIST = 0.3;
/** Fetch horizon so pairs straddling the 14-day window are not missed. */
const FETCH_HORIZON_DAYS = DUPLICATE_WINDOW_DAYS * 2;

// ─── Pure matching helpers (unit-tested) ─────────────────────────────────────

const LEGAL_SUFFIXES = new Set([
  "ltd", "limited", "plc", "llc", "inc", "incorporated", "co", "company",
  "corp", "corporation", "nig", "nigeria", "ng", "enterprises", "enterprise",
  "ventures", "holdings", "group", "services", "intl", "international",
]);

/** Normalize a free-text controller name: lowercase, alnum tokens, legal suffixes dropped. */
export function normalizeControllerName(name: string | null | undefined): string {
  if (!name) return "";
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !LEGAL_SUFFIXES.has(t));
  return tokens.join(" ").trim();
}

/** Normalize a subject for similarity comparison. */
export function normalizeSubject(subject: string | null | undefined): string {
  return (subject ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Trigram multiset (with pg_trgm-style two-space left / one-space right padding). */
function trigramSet(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Trigram Jaccard similarity in [0,1] — the pg_trgm similarity() metric. */
export function trigramSimilarity(a: string, b: string): number {
  const na = normalizeSubject(a);
  const nb = normalizeSubject(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = trigramSet(na);
  const tb = trigramSet(nb);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach((t) => { if (tb.has(t)) inter += 1; });
  return inter / (ta.size + tb.size - inter);
}

/** ILIKE-equivalent shortlist: normalized containment or a shared ≥8-char token. */
export function ilikeShortlist(a: string, b: string): boolean {
  const na = normalizeSubject(a);
  const nb = normalizeSubject(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const tokensA = new Set(na.split(" ").filter((t) => t.length >= 8));
  for (const t of nb.split(" ")) if (t.length >= 8 && tokensA.has(t)) return true;
  return false;
}

export interface ComplaintLite {
  id: number;
  reference_code: string;
  controller_name: string | null;
  category: string;
  subject: string;
  received_at: string | Date;
}

export interface DuplicatePair {
  canonical: ComplaintLite;
  duplicate: ComplaintLite;
  similarity: number;
  controllerKey: string;
  category: string;
}

/**
 * Decide whether two complaints are near-duplicates: same normalized
 * controller (non-empty), same category, received within `windowDays` of each
 * other, and subject similarity ≥ threshold.
 */
export function isDuplicatePair(
  a: ComplaintLite,
  b: ComplaintLite,
  opts: { windowDays?: number; threshold?: number } = {},
): { match: boolean; similarity: number; controllerKey: string } {
  const windowDays = opts.windowDays ?? DUPLICATE_WINDOW_DAYS;
  const threshold = opts.threshold ?? SIMILARITY_THRESHOLD;
  const controllerKey = normalizeControllerName(a.controller_name);
  if (!controllerKey || controllerKey !== normalizeControllerName(b.controller_name)) {
    return { match: false, similarity: 0, controllerKey };
  }
  if (a.category !== b.category) return { match: false, similarity: 0, controllerKey };
  const deltaDays = Math.abs(new Date(a.received_at).getTime() - new Date(b.received_at).getTime()) / 86_400_000;
  if (deltaDays > windowDays) return { match: false, similarity: 0, controllerKey };
  const similarity = trigramSimilarity(a.subject, b.subject);
  return { match: similarity >= threshold, similarity, controllerKey };
}

/**
 * Pair up near-duplicates from a candidate set. Canonical = earliest
 * received (tie: lowest id); each complaint appears in at most one pair as
 * duplicate and each canonical absorbs at most one duplicate per sweep
 * (conservative — the next sweep catches chains).
 *
 * `shortlist(a, b)` is an optional cheap pre-filter (SQL pg_trgm pair set or
 * the ILIKE-equivalent) consulted before the full similarity computation.
 */
export function findDuplicatePairs(
  complaints: ComplaintLite[],
  opts: { windowDays?: number; threshold?: number; shortlist?: (a: ComplaintLite, b: ComplaintLite) => boolean } = {},
): DuplicatePair[] {
  const shortlist = opts.shortlist ?? (() => true);
  const used = new Set<number>();
  const pairs: DuplicatePair[] = [];
  const sorted = [...complaints].sort((x, y) => {
    const d = new Date(x.received_at).getTime() - new Date(y.received_at).getTime();
    return d !== 0 ? d : x.id - y.id;
  });
  for (let i = 0; i < sorted.length; i++) {
    const canonical = sorted[i];
    if (used.has(canonical.id)) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const dup = sorted[j];
      if (used.has(dup.id)) continue;
      if (!shortlist(canonical, dup)) continue;
      const { match, similarity, controllerKey } = isDuplicatePair(canonical, dup, opts);
      if (!match) continue;
      used.add(canonical.id);
      used.add(dup.id);
      pairs.push({ canonical, duplicate: dup, similarity, controllerKey, category: canonical.category });
      break;
    }
  }
  return pairs;
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

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

/** pg_trgm availability — guarded; any error → fallback path. */
export async function hasPgTrgm(): Promise<boolean> {
  try {
    const rows = await exec(`SELECT COUNT(*)::int AS n FROM pg_extension WHERE extname = 'pg_trgm'`);
    return Number(rows[0]?.n ?? 0) > 0;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[duplicateMerge] pg_extension probe failed — using ILIKE fallback");
    return false;
  }
}

async function fetchCandidateComplaints(): Promise<ComplaintLite[]> {
  return exec(
    `SELECT id, reference_code, controller_name, category, subject, received_at
     FROM public_complaints
     WHERE status NOT IN ('resolved', 'closed')
       AND merged_into_id IS NULL
       AND controller_name IS NOT NULL
       AND received_at >= now() - make_interval(days => ${FETCH_HORIZON_DAYS})
     ORDER BY received_at ASC
     LIMIT 5000`,
  );
}

/**
 * pg_trgm shortlist: pairs (by id) with SQL-side similarity() ≥ 0.3, same
 * lower-cased controller + category, ≤14 days apart. Only called when the
 * extension probe succeeded.
 */
async function pgTrgmShortlist(): Promise<Set<string>> {
  const rows = await exec(
    `SELECT a.id AS a_id, b.id AS b_id
     FROM public_complaints a
     JOIN public_complaints b
       ON a.id < b.id
      AND lower(b.controller_name) = lower(a.controller_name)
      AND b.category = a.category
      AND abs(extract(epoch FROM (b.received_at - a.received_at))) <= ${DUPLICATE_WINDOW_DAYS} * 86400
      AND similarity(a.subject, b.subject) >= ${PG_TRGM_SHORTLIST}
     WHERE a.status NOT IN ('resolved', 'closed') AND a.merged_into_id IS NULL
       AND b.status NOT IN ('resolved', 'closed') AND b.merged_into_id IS NULL
       AND a.received_at >= now() - make_interval(days => ${FETCH_HORIZON_DAYS})
     LIMIT 2000`,
  );
  return new Set(rows.map((r) => `${r.a_id}:${r.b_id}`));
}

async function hasOpenProposalFor(complaintId: number): Promise<boolean> {
  const rows = await exec(
    `SELECT 1 FROM autonomy_actions
     WHERE action_type = $1 AND status IN ('pending_undo', 'executed')
       AND ((payload->>'canonical_id')::bigint = $2 OR (payload->>'duplicate_id')::bigint = $2)
     LIMIT 1`,
    [MERGE_PROPOSAL_ACTION, complaintId],
  );
  return rows.length > 0;
}

// ─── Sweep (Temporal-friendly; do NOT register schedules here) ───────────────

export interface SweepResult {
  tier: number;
  matcher: "pg_trgm" | "ilike_fallback";
  candidates: number;
  pairsFound: number;
  proposalsCreated: number;
  suggestionsMinted: number;
  skippedExisting: number;
}

/**
 * Periodic duplicate-merge sweep. Tier≥2: park undo-windowed merge proposals.
 * Tier 1: mint decision_feedback suggestions only (human decides).
 */
export async function runDuplicateMergeSweep(opts: { actor?: string } = {}): Promise<SweepResult> {
  const actor = opts.actor ?? "autonomy-engine";
  const tier = await getTier(DUPLICATE_MERGE_SURFACE);

  const complaints = await fetchCandidateComplaints();
  const trgm = await hasPgTrgm();

  let pairs: DuplicatePair[];
  let matcher: SweepResult["matcher"];
  if (trgm) {
    matcher = "pg_trgm";
    const shortlist = await pgTrgmShortlist();
    pairs = findDuplicatePairs(complaints, {
      shortlist: (a, b) => shortlist.has(`${a.id}:${b.id}`),
    });
  } else {
    matcher = "ilike_fallback";
    pairs = findDuplicatePairs(complaints, {
      shortlist: (a, b) => ilikeShortlist(a.subject, b.subject),
    });
  }

  const result: SweepResult = {
    tier,
    matcher,
    candidates: complaints.length,
    pairsFound: pairs.length,
    proposalsCreated: 0,
    suggestionsMinted: 0,
    skippedExisting: 0,
  };

  for (const pair of pairs) {
    if (await hasOpenProposalFor(pair.duplicate.id) || await hasOpenProposalFor(pair.canonical.id)) {
      result.skippedExisting += 1;
      continue;
    }
    const reason =
      `near-duplicate of ${pair.canonical.reference_code}: same controller ` +
      `('${pair.controllerKey}'), same category '${pair.category}', subject similarity ` +
      `${pair.similarity.toFixed(2)} within ${DUPLICATE_WINDOW_DAYS}d`;

    if (tier >= 2) {
      const rows = await exec(
        `SELECT id, status, merged_into_id, closed_at FROM public_complaints WHERE id = $1`,
        [pair.duplicate.id],
      );
      if (!rows[0]) { result.skippedExisting += 1; continue; }
      await createAutonomyAction({
        surface: DUPLICATE_MERGE_SURFACE,
        actionType: MERGE_PROPOSAL_ACTION,
        actor,
        payload: {
          kind: MERGE_PROPOSAL_ACTION,
          canonical_id: pair.canonical.id,
          duplicate_id: pair.duplicate.id,
          canonical_ref: pair.canonical.reference_code,
          duplicate_ref: pair.duplicate.reference_code,
          similarity: Number(pair.similarity.toFixed(4)),
          matcher,
          reason,
          snapshot: {
            duplicate: {
              id: pair.duplicate.id,
              status: rows[0].status,
              merged_into_id: rows[0].merged_into_id ?? null,
              closed_at: rows[0].closed_at ?? null,
            },
          },
        },
      });
      result.proposalsCreated += 1;
    } else {
      // Tier 1: suggestion only — a human merges via publicComplaints.mergeDuplicates.
      await mintPrediction({
        surface: DUPLICATE_MERGE_SURFACE,
        actorId: actor,
        suggestion: {
          kind: "merge_suggestion",
          canonicalRef: pair.canonical.reference_code,
          duplicateRef: pair.duplicate.reference_code,
          controller: pair.controllerKey,
          category: pair.category,
          similarity: Number(pair.similarity.toFixed(4)),
          reason,
        },
      });
      result.suggestionsMinted += 1;
    }
  }
  return result;
}

// ─── Handler: execute + undo ─────────────────────────────────────────────────

function payloadIds(action: AutonomyActionRow): { canonicalId: number; duplicateId: number } {
  const p = action.payload ?? {};
  const canonicalId = Number(p.canonical_id);
  const duplicateId = Number(p.duplicate_id);
  if (!Number.isInteger(canonicalId) || !Number.isInteger(duplicateId) || canonicalId <= 0 || duplicateId <= 0) {
    throw new Error("merge_proposal payload missing canonical_id/duplicate_id");
  }
  if (canonicalId === duplicateId) throw new Error("merge_proposal canonical and duplicate are the same complaint");
  return { canonicalId, duplicateId };
}

async function executeMergeProposal(action: AutonomyActionRow): Promise<Record<string, unknown>> {
  const { canonicalId, duplicateId } = payloadIds(action);
  const reason = String(action.payload.reason ?? "autonomous duplicate merge").slice(0, 2000);

  const [canonicalRows, duplicateRows] = await Promise.all([
    exec(`SELECT id, reference_code, status, merged_into_id FROM public_complaints WHERE id = $1`, [canonicalId]),
    exec(`SELECT id, reference_code, status, merged_into_id FROM public_complaints WHERE id = $1`, [duplicateId]),
  ]);
  const canonical = canonicalRows[0];
  const duplicate = duplicateRows[0];
  if (!canonical || !duplicate) throw new Error("complaint no longer exists");
  if (canonical.merged_into_id != null || canonical.status === "closed") {
    throw new Error(`canonical complaint ${canonicalId} is closed/merged — cannot absorb`);
  }
  if (duplicate.merged_into_id != null) throw new Error(`duplicate complaint ${duplicateId} already merged`);

  // Race-safe: refuse if a human merged it between proposal and execution.
  const merged = await exec(
    `UPDATE public_complaints
     SET merged_into_id = $1, status = 'closed', closed_at = now(), updated_at = now()
     WHERE id = $2 AND merged_into_id IS NULL AND status <> 'closed'
     RETURNING id`,
    [canonicalId, duplicateId],
  );
  if (!merged[0]) throw new Error(`duplicate complaint ${duplicateId} changed state concurrently`);

  await exec(`UPDATE complaint_attachments SET complaint_id = $1 WHERE complaint_id = $2`, [canonicalId, duplicateId]);
  const actor = "autonomy-engine";
  await exec(
    `INSERT INTO complaint_events (complaint_id, event_type, from_status, to_status, actor, details)
     VALUES ($1, 'merged', $2, 'closed', $3, $4)`,
    [duplicateId, duplicate.status, actor, JSON.stringify({ into: canonicalId, reason, autonomyActionId: action.id })],
  );
  await exec(
    `INSERT INTO complaint_events (complaint_id, event_type, from_status, to_status, actor, details)
     VALUES ($1, 'merged', NULL, NULL, $2, $3)`,
    [canonicalId, actor, JSON.stringify({ absorbed: duplicateId, duplicateRef: duplicate.reference_code, reason, autonomyActionId: action.id })],
  );
  return { canonicalId, mergedDuplicateId: duplicateId };
}

async function undoMergeProposal(action: AutonomyActionRow, actor: string): Promise<Record<string, unknown>> {
  const { canonicalId, duplicateId } = payloadIds(action);
  const snapshot = (action.payload.snapshot as any)?.duplicate ?? {};
  const restoredStatus = typeof snapshot.status === "string" && snapshot.status !== "closed" ? snapshot.status : "received";

  const rows = await exec(
    `UPDATE public_complaints
     SET merged_into_id = NULL, status = $2, closed_at = NULL, updated_at = now()
     WHERE id = $1 AND merged_into_id = $3
     RETURNING id`,
    [duplicateId, restoredStatus, canonicalId],
  );
  if (!rows[0]) {
    throw new Error(`complaint ${duplicateId} is no longer merged into ${canonicalId} — nothing to restore`);
  }
  await exec(`UPDATE complaint_attachments SET complaint_id = $1 WHERE complaint_id = $2`, [duplicateId, canonicalId]);
  await exec(
    `INSERT INTO complaint_events (complaint_id, event_type, from_status, to_status, actor, details)
     VALUES ($1, 'merge_undone', 'closed', $2, $3, $4)`,
    [duplicateId, restoredStatus, actor, JSON.stringify({ separatedFrom: canonicalId, autonomyActionId: action.id })],
  );
  return { restoredDuplicateId: duplicateId, restoredStatus };
}

registerActionHandler(MERGE_PROPOSAL_ACTION, { execute: executeMergeProposal, undo: undoMergeProposal });

/** Re-export the shared executor under the surface name the integrator expects. */
export { executeDueAutonomyActions as executeDueMerges } from "./autonomyActions";
