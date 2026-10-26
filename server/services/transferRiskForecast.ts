/**
 * Transfer Risk Forecast service (Round-13 P1.6)
 * ================================================
 * Predictive geopolitical risk for cross-border transfer declarations.
 * Blends the STATIC conflict-zone risk (osirisClient.getConflictRiskLevel —
 * read-only, unmodified) with a PREDICTIVE forecast from OSIRIS's OI
 * Forecast engine (server/osiris/forecastClient.ts) into a single blended
 * level surfaced during cross-border review.
 *
 * Question template (per country):
 *   "Probability that <country> experiences conflict escalation or sanctions
 *    regime change affecting data-hosting risk in the next 12 months"
 *
 * BLENDING RULES (levels: none < elevated < high < critical):
 *   1. static critical stays critical — never downgraded by a model.
 *   2. forecast probability ≥ 0.6 of adverse change upgrades the blend ONE
 *      level above static (capped at critical).
 *   3. forecast probability < 0.2 with static elevated/high keeps static
 *      (reassuring forecasts NEVER downgrade either — see rule 1's spirit).
 *   4. forecast unavailable / timeout / error → blended = static, and the
 *      rationale records WHY (fail-visible, not fail-silent).
 *
 * COST CONTROL: OI forecasts are expensive swarm simulations. Results are
 * cached 24h per country (env OSIRIS_FORECAST_CACHE_MS to tune): a fresh
 * persisted row younger than the TTL is served instead of re-running.
 *
 * PERSISTENCE: every fresh run appends to transfer_risk_forecasts
 * (migration 0147) — history table, full audit trail including sources
 * jsonb and model_key_present. A decision_feedback baseline prediction
 * (surface 'transfer_forecast') is minted per run so officers can
 * agree/disagree (wired in routers/transferForecast.ts).
 *
 * Tests inject deps through TransferRiskDeps — no module-level singletons.
 */
import { getPool } from "../db";
import { logger } from "../logger";
import { getConflictRiskLevel, isConflictCountry } from "../osirisClient";
import {
  runForecast,
  type ForecastOutcome,
  type ForecastSource,
  type NormalizedForecast,
} from "../osiris/forecastClient";

// ─── Vocabulary ──────────────────────────────────────────────────────────────

export const RISK_LEVELS = ["none", "elevated", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
/** Static levels emitted by osirisClient.getConflictRiskLevel. */
export type StaticRisk = "critical" | "high" | "elevated" | "none";

export const FEEDBACK_SURFACE = "transfer_forecast";
export const UPGRADE_THRESHOLD = 0.6;
export const REASSURE_THRESHOLD = 0.2;
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — forecasts are expensive
const FORECAST_HORIZON_MONTHS = 12;

export function forecastCacheTtlMs(): number {
  const v = parseInt(process.env.OSIRIS_FORECAST_CACHE_MS ?? "", 10);
  return Number.isFinite(v) && v >= 60_000 ? v : DEFAULT_CACHE_TTL_MS;
}

// ─── Result types ────────────────────────────────────────────────────────────

export interface TransferRiskResult {
  countryIso: string;
  staticRisk: StaticRisk;
  blendedLevel: RiskLevel;
  /** Null when no forecast could be produced (see forecastStatus). */
  forecastProbability: number | null;
  forecastStatus: "completed" | "cached" | "unavailable" | "timeout" | "error";
  rationale: string;
  sources: ForecastSource[];
  modelKeyPresent: boolean;
  /** transfer_risk_forecasts.id for this reading (null when not persisted). */
  forecastId: string | null;
  /** decision_feedback prediction id for agree/disagree (null when not minted). */
  predictionId: string | null;
  fromCache: boolean;
  createdAt: string;
}

// ─── Dependency injection seam ───────────────────────────────────────────────

export interface TransferRiskDeps {
  exec: (query: string, params?: unknown[]) => Promise<any[]>;
  runForecast: (
    question: string,
    context?: Record<string, unknown>
  ) => Promise<ForecastOutcome>;
  staticRisk: (iso: string) => StaticRisk;
  conflictZoneName: (iso: string) => string | null;
  mintFeedback: (opts: {
    surface: string;
    suggestion: unknown;
    actorId: string | number;
  }) => Promise<string>;
  now: () => Date;
}

function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01";
}

async function defaultExec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new Error("Database unavailable");
  const safeParams = params.map((p) =>
    Array.isArray(p) || (p !== null && typeof p === "object" && !(p instanceof Date))
      ? JSON.stringify(p)
      : p
  );
  const result = await pool.query(query, safeParams);
  return result.rows ?? [];
}

async function defaultMintFeedback(opts: {
  surface: string;
  suggestion: unknown;
  actorId: string | number;
}): Promise<string> {
  // Lazy import: decisionFeedback pulls in kafka/ledger — keep the service
  // importable in minimal/test contexts.
  const { mintPrediction } = await import("../routers/decisionFeedback");
  return mintPrediction(opts);
}

function defaultDeps(): TransferRiskDeps {
  return {
    exec: defaultExec,
    runForecast: (q, c) => runForecast(q, c),
    staticRisk: (iso) => getConflictRiskLevel(iso),
    conflictZoneName: (iso) => isConflictCountry(iso)?.name ?? null,
    mintFeedback: defaultMintFeedback,
    now: () => new Date(),
  };
}

// ─── Blending (pure, exported for tests) ─────────────────────────────────────

export function upgradeOne(level: RiskLevel): RiskLevel {
  const i = RISK_LEVELS.indexOf(level);
  return RISK_LEVELS[Math.min(i + 1, RISK_LEVELS.length - 1)];
}

/**
 * Blend static conflict risk with the forecast probability of adverse change.
 * Rules per module header; returns the level plus the rule tag applied.
 */
export function blendRisk(
  staticRisk: StaticRisk,
  forecastProbability: number | null
): { blended: RiskLevel; rule: string } {
  if (staticRisk === "critical") {
    return { blended: "critical", rule: "static-critical-preserved" };
  }
  if (forecastProbability !== null && forecastProbability >= UPGRADE_THRESHOLD) {
    return { blended: upgradeOne(staticRisk), rule: `forecast-upgrade(p>=${UPGRADE_THRESHOLD})` };
  }
  if (
    forecastProbability !== null &&
    forecastProbability < REASSURE_THRESHOLD &&
    (staticRisk === "elevated" || staticRisk === "high")
  ) {
    return { blended: staticRisk, rule: `forecast-reassuring-kept-static(p<${REASSURE_THRESHOLD})` };
  }
  return { blended: staticRisk, rule: forecastProbability === null ? "no-forecast-static-only" : "no-change" };
}

/** Question template — single place so prompts stay auditable/consistent. */
export function buildForecastQuestion(countryLabel: string): string {
  return (
    `Probability that ${countryLabel} experiences conflict escalation or sanctions regime change ` +
    `affecting data-hosting risk in the next ${FORECAST_HORIZON_MONTHS} months`
  );
}

// ─── Cache read ──────────────────────────────────────────────────────────────

interface ForecastRow {
  id: string;
  country_iso: string;
  static_risk: StaticRisk;
  forecast_probability: number | null;
  blended_level: RiskLevel;
  rationale: string;
  sources: unknown;
  model_key_present: boolean;
  prediction_id: string | null;
  created_at: string | Date;
}

function rowToResult(row: ForecastRow, fromCache: boolean): TransferRiskResult {
  return {
    countryIso: row.country_iso,
    staticRisk: row.static_risk,
    blendedLevel: row.blended_level,
    forecastProbability:
      row.forecast_probability === null ? null : Number(row.forecast_probability),
    forecastStatus: fromCache ? "cached" : "completed",
    rationale: row.rationale,
    sources: Array.isArray(row.sources) ? (row.sources as ForecastSource[]) : [],
    modelKeyPresent: row.model_key_present === true,
    forecastId: row.id,
    predictionId: row.prediction_id ?? null,
    fromCache,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Forecast + blend the transfer risk for a destination country (ISO-3166
 * alpha-2). Cache-first: a persisted reading younger than the TTL wins.
 * Fresh runs persist a history row and mint a decision_feedback baseline.
 * NEVER throws on OI/DB degradation — returns static-only with a recorded
 * reason.
 */
export async function forecastTransferRisk(
  countryIso: string,
  deps: Partial<TransferRiskDeps> = {}
): Promise<TransferRiskResult> {
  const d = { ...defaultDeps(), ...deps };
  const iso = countryIso.trim().toUpperCase();
  const staticRisk = d.staticRisk(iso);
  const now = d.now();

  // 1. 24h per-country cache (persisted rows ARE the cache — auditable).
  try {
    const rows = await d.exec(
      `SELECT * FROM transfer_risk_forecasts
       WHERE country_iso = $1 AND created_at > $2
       ORDER BY created_at DESC LIMIT 1`,
      [iso, new Date(now.getTime() - forecastCacheTtlMs()).toISOString()]
    );
    if (rows.length) return rowToResult(rows[0] as ForecastRow, true);
  } catch (err) {
    if (!isMissingTable(err)) {
      logger.warn({ err, iso }, "[transferRiskForecast] cache read failed — running fresh forecast");
    }
    // missing table (42P01): migration 0147 not applied yet — proceed uncached
  }

  // 2. Run the OI forecast (fail-closed: never throws).
  const zoneName = d.conflictZoneName(iso);
  const countryLabel = zoneName ? `${zoneName} (${iso})` : iso;
  const question = buildForecastQuestion(countryLabel);
  const outcome = await d.runForecast(question, {
    countryIso: iso,
    staticConflictRisk: staticRisk,
    horizonMonths: FORECAST_HORIZON_MONTHS,
  });

  const completed: NormalizedForecast | null = outcome.status === "completed" ? outcome.forecast : null;
  const failureReason = outcome.status === "completed" ? null : outcome.reason;
  const probability = completed?.forecastProbability ?? null;
  const { blended, rule } = blendRisk(staticRisk, probability);

  // 3. Compose an auditable rationale.
  const rationaleParts = [
    `Static conflict-zone risk for ${iso}: ${staticRisk}${zoneName ? ` (zone: ${zoneName})` : ""}.`,
  ];
  if (completed) {
    rationaleParts.push(
      `OI forecast probability of adverse change (12mo): ${probability!.toFixed(2)}.`,
      `Blending rule applied: ${rule} → blended ${blended}.`
    );
    if (completed.rationale) rationaleParts.push(`Forecast rationale: ${completed.rationale}`);
  } else {
    rationaleParts.push(
      `OI forecast ${outcome.status}: ${failureReason ?? "no result"}`,
      `Blended level falls back to static (${staticRisk}) — no model upgrade applied.`
    );
  }
  const rationale = rationaleParts.join(" ");
  const sources = completed?.sources ?? [];
  const modelKeyPresent = outcome.modelKeyPresent;
  const createdAt = (completed?.completedAt ? new Date(completed.completedAt) : now).toISOString();

  // 4. Persist + mint feedback baseline (best-effort; degradation never
  //    blocks the reading).
  let forecastId: string | null = null;
  let predictionId: string | null = null;
  try {
    predictionId = await d.mintFeedback({
      surface: FEEDBACK_SURFACE,
      suggestion: {
        countryIso: iso,
        staticRisk,
        blendedLevel: blended,
        forecastProbability: probability,
        rule,
      },
      actorId: "transfer-risk-forecast",
    });
  } catch (err) {
    logger.warn({ err, iso }, "[transferRiskForecast] feedback baseline mint failed — continuing");
  }
  try {
    const rows = await d.exec(
      `INSERT INTO transfer_risk_forecasts
         (country_iso, static_risk, forecast_probability, blended_level, rationale, sources, model_key_present, prediction_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        iso,
        staticRisk,
        probability,
        blended,
        rationale,
        sources,
        modelKeyPresent,
        predictionId,
        completed ? createdAt : now.toISOString(),
      ]
    );
    forecastId = rows[0]?.id ?? null;
  } catch (err) {
    if (!isMissingTable(err)) {
      logger.error({ err, iso }, "[transferRiskForecast] persist failed");
    } else {
      logger.warn({ iso }, "[transferRiskForecast] transfer_risk_forecasts missing (migration 0147 not applied)");
    }
  }

  return {
    countryIso: iso,
    staticRisk,
    blendedLevel: blended,
    forecastProbability: probability,
    forecastStatus: outcome.status,
    rationale,
    sources,
    modelKeyPresent,
    forecastId,
    predictionId,
    fromCache: false,
    createdAt,
  };
}

/**
 * Latest persisted reading per country (dashboards / listForecasts).
 * Returns [] when migration 0147 is not yet applied.
 */
export async function listLatestForecasts(
  limit = 100,
  deps: Partial<TransferRiskDeps> = {}
): Promise<TransferRiskResult[]> {
  const d = { ...defaultDeps(), ...deps };
  try {
    const rows = await d.exec(
      `SELECT DISTINCT ON (country_iso) *
       FROM transfer_risk_forecasts
       ORDER BY country_iso, created_at DESC
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 500))]
    );
    return (rows as ForecastRow[]).map((r) => rowToResult(r, true));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** Latest persisted reading for one country, or null (cheap DB-only read). */
export async function latestForecastForCountry(
  countryIso: string,
  deps: Partial<TransferRiskDeps> = {}
): Promise<TransferRiskResult | null> {
  const d = { ...defaultDeps(), ...deps };
  const iso = countryIso.trim().toUpperCase();
  try {
    const rows = await d.exec(
      `SELECT * FROM transfer_risk_forecasts WHERE country_iso = $1
       ORDER BY created_at DESC LIMIT 1`,
      [iso]
    );
    return rows.length ? rowToResult(rows[0] as ForecastRow, true) : null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/**
 * Resolve a free-text destination country (transfer_declarations stores
 * names, not ISO codes) to ISO alpha-2: prefer the destination_risk_register
 * iso_code; fall back to the two-letter prefix heuristic already used by
 * phase13Features. Exported for the router.
 */
export async function resolveIsoForCountry(
  countryName: string,
  deps: Partial<TransferRiskDeps> = {}
): Promise<{ iso: string; via: "risk_register" | "prefix_heuristic" }> {
  const d = { ...defaultDeps(), ...deps };
  const name = countryName.trim();
  try {
    const rows = await d.exec(
      `SELECT iso_code FROM destination_risk_register
       WHERE country ILIKE $1 ESCAPE '\\' AND iso_code IS NOT NULL
       ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`,
      [name.replace(/[\\%_]/g, (ch) => `\\${ch}`)]
    );
    const iso = rows[0]?.iso_code;
    if (typeof iso === "string" && /^[A-Za-z]{2}$/.test(iso)) {
      return { iso: iso.toUpperCase(), via: "risk_register" };
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }
  return { iso: name.slice(0, 2).toUpperCase(), via: "prefix_heuristic" };
}
