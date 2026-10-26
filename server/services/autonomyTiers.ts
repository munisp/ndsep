/**
 * Autonomy tier engine (round 12, wave 9 — roadmap §7)
 * =====================================================
 * Per-surface graduated-autonomy registry backed by `autonomy_tiers`
 * (migration 0139). Tiers:
 *
 *   tier 1 — suggest-only: the surface mints decision_feedback suggestions;
 *            a human decides everything (Wave-1/Wave-2 behaviour).
 *   tier 2 — guarded auto-action: the surface may act autonomously, but every
 *            action is parked in autonomy_actions (migration 0140) with a 24h
 *            undo window and a full before-state snapshot.
 *   tier 3 — trusted auto-action (reserved; same machinery, longer track
 *            record required).
 *
 * Gates (90-day decision_feedback window, latest action per prediction_id,
 * decided outcomes = accept/edit/reject; acceptance = accept / decided):
 *   promote 1→2 : acceptance ≥ 0.85 over ≥ 500 suggestions
 *   promote 2→3 : acceptance ≥ 0.95 over ≥ 2000 suggestions AND ≥ 30 days
 *                 stable in tier 2 (promoted_at ≥ 30 days old)
 *   demote      : decided acceptance over the trailing 200 decisions < 0.70
 *                 → step down exactly one tier (graduated demotion)
 *
 * FAIL-CLOSED: any error while reading stats or the registry leaves the
 * surface at tier 1 (getTier returns 1; evaluate best-effort forces tier 1).
 * Every transition (auto or manual) is appended to the anti-wipe
 * audit_ledger via appendLedger.
 */
import { getPool } from "../db";
import { logger } from "../logger";
import { appendLedger } from "../antiwipe/ledger";

// ─── Registry ────────────────────────────────────────────────────────────────

/** Surfaces with wave-9 tier-2 auto-action implementations. */
export const AUTONOMY_SURFACES = ["duplicate_merge", "scan_findings"] as const;
export type AutonomySurface = (typeof AUTONOMY_SURFACES)[number];

export const SURFACE_LABELS: Record<AutonomySurface, string> = {
  duplicate_merge: "Duplicate-complaint merge proposals",
  scan_findings: "False-finding suppression",
};

export const MIN_TIER = 1;
export const MAX_TIER = 3;

/** Promotion/demotion thresholds — exported for the dashboard + tests. */
export const TIER_GATES = {
  windowDays: 90,
  promote: {
    "1->2": { minAcceptance: 0.85, minSuggestions: 500 },
    "2->3": { minAcceptance: 0.95, minSuggestions: 2000, minStableDays: 30 },
  },
  demote: { trailingCount: 200, belowAcceptance: 0.7 },
} as const;

const ENGINE_ACTOR = "autonomy-engine";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TierRow {
  surface: string;
  tier: number;
  acceptanceRate: number | null;
  suggestionCount: number | null;
  promotedAt: string | null;
  demotedAt: string | null;
  updatedAt: string;
}

export interface SurfaceStats {
  surface: string;
  windowDays: number;
  /** Distinct suggestions (prediction_ids) seen in the window. */
  suggestions: number;
  decided: number;
  counts: { accept: number; edit: number; reject: number; ignore: number };
  /** accept / decided over the window; null when nothing decided. */
  acceptance: number | null;
  /** Decided acceptance over the trailing N decisions (regression detector). */
  trailing: { count: number; acceptance: number | null; window: number };
}

export type TierTransition =
  | { action: "promote"; toTier: number; reason: string }
  | { action: "demote"; toTier: number; reason: string }
  | { action: "none"; toTier: number; reason: string };

export interface EvaluationResult {
  surface: string;
  tier: number;
  previousTier: number;
  transition: TierTransition;
  stats: SurfaceStats;
  committed: boolean;
  failedClosed: boolean;
}

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

function rowToTierRow(r: any): TierRow {
  return {
    surface: r.surface as string,
    tier: Number(r.tier),
    acceptanceRate: r.acceptance_rate != null ? Number(r.acceptance_rate) : null,
    suggestionCount: r.suggestion_count != null ? Number(r.suggestion_count) : null,
    promotedAt: r.promoted_at ?? null,
    demotedAt: r.demoted_at ?? null,
    updatedAt: r.updated_at,
  };
}

// ─── Stats ───────────────────────────────────────────────────────────────────

/**
 * Acceptance stats for a surface from decision_feedback: latest action per
 * prediction_id (DISTINCT ON — same semantics as decisionFeedback.acceptanceRate),
 * 90-day window for gates, trailing-N window for the regression detector.
 */
export async function surfaceStats(surface: string): Promise<SurfaceStats> {
  const windowRows = await exec(
    `SELECT action, COUNT(*)::int AS n FROM (
       SELECT DISTINCT ON (prediction_id) action
       FROM decision_feedback
       WHERE surface = $1
         AND created_at >= now() - make_interval(days => $2)
       ORDER BY prediction_id, created_at DESC
     ) latest
     GROUP BY action`,
    [surface, TIER_GATES.windowDays],
  );
  const counts = { accept: 0, edit: 0, reject: 0, ignore: 0 };
  for (const r of windowRows) {
    if (r.action in counts) counts[r.action as keyof typeof counts] = Number(r.n);
  }
  const suggestions = counts.accept + counts.edit + counts.reject + counts.ignore;
  const decided = counts.accept + counts.edit + counts.reject;

  // Regression detector: accept share over the latest N DECIDED outcomes
  // (latest action per prediction_id, any age).
  const trailingRaw = await exec(
    `SELECT action FROM (
       SELECT DISTINCT ON (prediction_id) action, created_at
       FROM decision_feedback
       WHERE surface = $1
       ORDER BY prediction_id, created_at DESC
     ) latest
     WHERE action IN ('accept', 'edit', 'reject')
     ORDER BY created_at DESC
     LIMIT $2`,
    [surface, TIER_GATES.demote.trailingCount],
  );
  let tAccept = 0;
  for (const r of trailingRaw) if (r.action === "accept") tAccept += 1;
  const trailingCountTotal = trailingRaw.length;

  return {
    surface,
    windowDays: TIER_GATES.windowDays,
    suggestions,
    decided,
    counts,
    acceptance: decided > 0 ? counts.accept / decided : null,
    trailing: {
      count: trailingCountTotal,
      acceptance: trailingCountTotal > 0 ? tAccept / trailingCountTotal : null,
      window: TIER_GATES.demote.trailingCount,
    },
  };
}

// ─── Pure gate math (unit-tested) ────────────────────────────────────────────

/**
 * Decide the next tier from the current tier and measured stats. Pure —
 * no IO. Promotion is checked before demotion only in the sense that a
 * regression signal ALWAYS wins over an unmet promotion gate (fail-safe):
 * demotion is evaluated first.
 */
export function decideTransition(
  current: { tier: number; promotedAt: string | Date | null },
  stats: Pick<SurfaceStats, "decided" | "acceptance" | "trailing">,
  now: Date = new Date(),
): TierTransition {
  const tier = Math.min(Math.max(Math.trunc(current.tier) || MIN_TIER, MIN_TIER), MAX_TIER);

  // 1. Regression → graduated demotion (one tier down). Requires a FULL
  //    trailing window so a handful of early rejections cannot demote.
  if (
    tier > MIN_TIER &&
    stats.trailing.count >= TIER_GATES.demote.trailingCount &&
    stats.trailing.acceptance !== null &&
    stats.trailing.acceptance < TIER_GATES.demote.belowAcceptance
  ) {
    return {
      action: "demote",
      toTier: tier - 1,
      reason: `regression: trailing ${stats.trailing.count} decided acceptance ${(stats.trailing.acceptance * 100).toFixed(1)}% < ${TIER_GATES.demote.belowAcceptance * 100}%`,
    };
  }

  // 2. Promotion gates.
  if (tier === 1) {
    const g = TIER_GATES.promote["1->2"];
    if (stats.decided >= g.minSuggestions && stats.acceptance !== null && stats.acceptance >= g.minAcceptance) {
      return {
        action: "promote",
        toTier: 2,
        reason: `gate 1→2: ${(stats.acceptance * 100).toFixed(1)}% acceptance over ${stats.decided} decided suggestions (≥ ${g.minAcceptance * 100}% over ≥ ${g.minSuggestions})`,
      };
    }
  } else if (tier === 2) {
    const g = TIER_GATES.promote["2->3"];
    const stableMs = g.minStableDays * 24 * 3600 * 1000;
    const stableSince = current.promotedAt ? new Date(current.promotedAt).getTime() : null;
    const stable = stableSince !== null && now.getTime() - stableSince >= stableMs;
    if (
      stats.decided >= g.minSuggestions &&
      stats.acceptance !== null &&
      stats.acceptance >= g.minAcceptance &&
      stable
    ) {
      return {
        action: "promote",
        toTier: 3,
        reason: `gate 2→3: ${(stats.acceptance * 100).toFixed(1)}% over ${stats.decided} decided + ${g.minStableDays}d stable in tier 2`,
      };
    }
  }

  return { action: "none", toTier: tier, reason: "gates not met" };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

async function upsertTier(row: {
  surface: string;
  tier: number;
  acceptanceRate: number | null;
  suggestionCount: number | null;
  promotedAt?: Date | null;
  demotedAt?: Date | null;
}): Promise<void> {
  await exec(
    `INSERT INTO autonomy_tiers (surface, tier, acceptance_rate, suggestion_count, promoted_at, demoted_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (surface) DO UPDATE SET
       tier = EXCLUDED.tier,
       acceptance_rate = EXCLUDED.acceptance_rate,
       suggestion_count = EXCLUDED.suggestion_count,
       promoted_at = COALESCE(EXCLUDED.promoted_at, autonomy_tiers.promoted_at),
       demoted_at = COALESCE(EXCLUDED.demoted_at, autonomy_tiers.demoted_at),
       updated_at = now()`,
    [
      row.surface,
      row.tier,
      row.acceptanceRate,
      row.suggestionCount,
      row.promotedAt ?? null,
      row.demotedAt ?? null,
    ],
  );
}

function ledger(action: string, payload: Record<string, unknown>, actor: string): void {
  appendLedger(action, payload, actor).catch((e: unknown) =>
    logger.warn({ err: e instanceof Error ? e.message : String(e), action }, "[autonomyTiers] audit_ledger append failed"),
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Current tier for a surface. FAIL-CLOSED: any error → tier 1. */
export async function getTier(surface: string): Promise<number> {
  try {
    const rows = await exec(`SELECT tier FROM autonomy_tiers WHERE surface = $1`, [surface]);
    const tier = Number(rows[0]?.tier ?? MIN_TIER);
    if (!Number.isFinite(tier) || tier < MIN_TIER || tier > MAX_TIER) return MIN_TIER;
    return tier;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), surface }, "[autonomyTiers] getTier failed — failing closed to tier 1");
    return MIN_TIER;
  }
}

/** All registered tier rows (dashboard). Errors return an empty list. */
export async function listTierRows(): Promise<TierRow[]> {
  try {
    const rows = await exec(`SELECT * FROM autonomy_tiers ORDER BY surface`);
    return rows.map(rowToTierRow);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[autonomyTiers] listTierRows failed");
    return [];
  }
}

/**
 * Evaluate a surface against the gates. With commit=true (default) a passed
 * gate is persisted and ledgered; commit=false is a read-only preview for the
 * dashboard. FAIL-CLOSED: any error returns tier 1 and best-effort forces the
 * stored tier back to 1.
 */
export async function evaluate(surface: string, opts: { commit?: boolean; actor?: string } = {}): Promise<EvaluationResult> {
  const commit = opts.commit !== false;
  try {
    const [rows, stats] = await Promise.all([
      exec(`SELECT * FROM autonomy_tiers WHERE surface = $1`, [surface]),
      surfaceStats(surface),
    ]);
    const current = rows[0]
      ? rowToTierRow(rows[0])
      : { surface, tier: MIN_TIER, acceptanceRate: null, suggestionCount: null, promotedAt: null, demotedAt: null, updatedAt: "" };

    const transition = decideTransition({ tier: current.tier, promotedAt: current.promotedAt }, stats);

    if (commit && transition.action !== "none") {
      await upsertTier({
        surface,
        tier: transition.toTier,
        acceptanceRate: stats.acceptance,
        suggestionCount: stats.suggestions,
        promotedAt: transition.action === "promote" ? new Date() : null,
        demotedAt: transition.action === "demote" ? new Date() : null,
      });
      ledger(`autonomy.tier_${transition.action === "promote" ? "promoted" : "demoted"}`, {
        surface,
        fromTier: current.tier,
        toTier: transition.toTier,
        reason: transition.reason,
        acceptance: stats.acceptance,
        decided: stats.decided,
        trailing: stats.trailing,
      }, opts.actor ?? ENGINE_ACTOR);
    } else if (commit) {
      // No transition — still refresh the measured stats for the dashboard.
      await upsertTier({ surface, tier: current.tier, acceptanceRate: stats.acceptance, suggestionCount: stats.suggestions });
    }

    return {
      surface,
      tier: transition.toTier,
      previousTier: current.tier,
      transition,
      stats,
      committed: commit && transition.action !== "none",
      failedClosed: false,
    };
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), surface }, "[autonomyTiers] evaluate failed — failing closed to tier 1");
    if (commit) {
      try {
        await upsertTier({ surface, tier: MIN_TIER, acceptanceRate: null, suggestionCount: null, demotedAt: new Date() });
      } catch (e2) {
        logger.error({ err: e2 instanceof Error ? e2.message : String(e2), surface }, "[autonomyTiers] fail-closed tier-1 write also failed");
      }
    }
    return {
      surface,
      tier: MIN_TIER,
      previousTier: MIN_TIER,
      transition: { action: "none", toTier: MIN_TIER, reason: `fail-closed: ${err instanceof Error ? err.message : String(err)}` },
      stats: {
        surface,
        windowDays: TIER_GATES.windowDays,
        suggestions: 0,
        decided: 0,
        counts: { accept: 0, edit: 0, reject: 0, ignore: 0 },
        acceptance: null,
        trailing: { count: 0, acceptance: null, window: TIER_GATES.demote.trailingCount },
      },
      committed: false,
      failedClosed: true,
    };
  }
}

/** Evaluate every registered autonomy surface (sweep-friendly). */
export async function evaluateAllSurfaces(opts: { commit?: boolean } = {}): Promise<EvaluationResult[]> {
  const out: EvaluationResult[] = [];
  for (const surface of AUTONOMY_SURFACES) {
    out.push(await evaluate(surface, opts));
  }
  return out;
}

/**
 * Manual tier override (governance-sensitive — the router gates this behind
 * adminProcedure + the dual_control_requests maker-checker queue). Writes the
 * tier row and appends `autonomy.tier_override` to the audit ledger.
 */
export async function applyManualTierChange(opts: {
  surface: string;
  targetTier: number;
  actor: string;
  reason: string;
  dualControlRequestId: number;
}): Promise<TierRow> {
  const { surface, targetTier, actor, reason, dualControlRequestId } = opts;
  if (!(AUTONOMY_SURFACES as readonly string[]).includes(surface)) {
    throw new Error(`Unknown autonomy surface '${surface}'`);
  }
  if (!Number.isInteger(targetTier) || targetTier < MIN_TIER || targetTier > MAX_TIER) {
    throw new Error(`targetTier must be an integer between ${MIN_TIER} and ${MAX_TIER}`);
  }
  const existing = await exec(`SELECT * FROM autonomy_tiers WHERE surface = $1`, [surface]);
  const fromTier = existing[0] ? Number(existing[0].tier) : MIN_TIER;
  await upsertTier({
    surface,
    tier: targetTier,
    acceptanceRate: existing[0]?.acceptance_rate != null ? Number(existing[0].acceptance_rate) : null,
    suggestionCount: existing[0]?.suggestion_count != null ? Number(existing[0].suggestion_count) : null,
    promotedAt: targetTier > fromTier ? new Date() : null,
    demotedAt: targetTier < fromTier ? new Date() : null,
  });
  ledger("autonomy.tier_override", {
    surface,
    fromTier,
    toTier: targetTier,
    reason: reason.slice(0, 500),
    dualControlRequestId,
    manual: true,
  }, actor);
  const rows = await exec(`SELECT * FROM autonomy_tiers WHERE surface = $1`, [surface]);
  return rowToTierRow(rows[0]);
}
