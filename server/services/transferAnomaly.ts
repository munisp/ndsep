/**
 * Transfer anomaly detection service (NDPA 2023 ss.41-43)
 * =======================================================
 * 1. Z-score outlier detection on declared volume/subject trends per controller
 *    (pure functions — unit-testable).
 * 2. Contradiction detector: controller declares NO cross-border transfers but
 *    the scan_findings table holds foreign-tracker evidence for that entity.
 *    Defensive: if scan_findings does not exist, the scan reports
 *    "evidence unavailable" and raises NO findings (never assumes).
 * 3. Scheduled re-validation cascade: when an adequacy decision is suspended or
 *    revoked (0030 lifecycle), every active declaration relying on it is
 *    re-validated and cascade findings are raised.
 *
 * DB functions take an injected `exec` (query, params) => rows so they are
 * testable and the router wires the pooled executor.
 */

import { validateDeclarationBasis, type LegalBasis, type RegistrySnapshot } from "./transferValidation";

export type QueryExec = (query: string, params?: unknown[]) => Promise<any[]>;

// ─── 1. Z-score outlier detection (pure) ────────────────────────────────────

export interface TrendPoint {
  period: string;      // e.g. "2024" or "2024-Q3"
  value: number;       // subject-count or volume midpoint
}

export interface OutlierPoint extends TrendPoint {
  zScore: number;
  mean: number;
  stdDev: number;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Population standard deviation. */
export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length);
}

/**
 * Flag points whose |z-score| >= threshold. With fewer than `minPoints`
 * observations the series is too short for meaningful statistics — nothing is
 * flagged (no false positives on thin data).
 */
export function detectZScoreOutliers(
  series: TrendPoint[],
  threshold = 2.5,
  minPoints = 4,
): OutlierPoint[] {
  if (series.length < minPoints) return [];
  const values = series.map((p) => p.value);
  const m = mean(values);
  const sd = stdDev(values);
  if (sd === 0) return []; // flat series: no outliers
  return series
    .map((p) => ({ ...p, zScore: (p.value - m) / sd, mean: m, stdDev: sd }))
    .filter((p) => Math.abs(p.zScore) >= threshold);
}

// ─── 2. Contradiction detector (pure core + defensive DB scan) ──────────────

export interface ContradictionInput {
  declaresNoTransfers: boolean;
  foreignTrackerEvidenceCount: number;
}

export interface ContradictionResult {
  contradiction: boolean;
  reason: string;
}

export function evaluateContradiction(input: ContradictionInput): ContradictionResult {
  if (!input.declaresNoTransfers) {
    return { contradiction: false, reason: "declaration does not attest zero transfers" };
  }
  if (input.foreignTrackerEvidenceCount > 0) {
    return {
      contradiction: true,
      reason: `declaration attests zero cross-border transfers but ${input.foreignTrackerEvidenceCount} foreign-tracker evidence row(s) exist in scan_findings`,
    };
  }
  return { contradiction: false, reason: "no contradicting foreign-tracker evidence" };
}

export interface ContradictionScanReport {
  scanFindingsAvailable: boolean;   // FALSE => table missing; NO findings raised
  declarationsScanned: number;
  findingsCreated: number;
  contradictions: Array<{ declarationId: number; organizationId: number; evidenceCount: number; findingId: number | null }>;
}

/**
 * Defensive contradiction scan. Checks scan_findings existence via to_regclass;
 * when absent, returns scanFindingsAvailable=false and creates nothing.
 */
export async function runContradictionScan(
  exec: QueryExec,
  opts: { limit?: number } = {},
): Promise<ContradictionScanReport> {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5000);

  const reg = await exec(`SELECT to_regclass('public.scan_findings') AS reg`);
  if (!reg[0]?.reg) {
    return { scanFindingsAvailable: false, declarationsScanned: 0, findingsCreated: 0, contradictions: [] };
  }

  const [{ n: scannedCount }] = await exec(
    `SELECT COUNT(*)::int AS n FROM transfer_declarations
     WHERE declares_no_transfers = TRUE AND status IN ('submitted','under_review','accepted')`,
  );

  // scan_findings has NO organization_id / category / destination_country
  // columns (0083): reach the organisation via scan_targets, and extract the
  // destination from the evidence JSONB payload. One grouped query (batched,
  // bounded) instead of a per-declaration loop.
  const contradictions = await exec(
    `SELECT d.id AS declaration_id, d.organization_id,
            COUNT(sf.id)::int AS evidence_count,
            array_agg(DISTINCT dest.country) FILTER (WHERE dest.country IS NOT NULL) AS destinations
     FROM transfer_declarations d
     JOIN scan_targets st ON st.organization_id = d.organization_id
     JOIN scan_findings sf ON sf.target_id = st.id
       AND sf.finding_type IN ('pre_consent_tracker', 'tracker_detected', 'cookie_before_consent')
       AND sf.status NOT IN ('dismissed', 'resolved', 'suppressed')
     CROSS JOIN LATERAL (
       SELECT COALESCE(sf.evidence->>'destination_country',
                       sf.evidence->>'tracker_country',
                       sf.evidence->>'country') AS country
     ) dest
     WHERE d.declares_no_transfers = TRUE
       AND d.status IN ('submitted','under_review','accepted')
     GROUP BY d.id, d.organization_id
     ORDER BY d.id
     LIMIT $1`,
    [limit],
  );

  const report: ContradictionScanReport = {
    scanFindingsAvailable: true,
    declarationsScanned: Number(scannedCount ?? 0),
    findingsCreated: 0,
    contradictions: [],
  };

  for (const row of contradictions) {
    const n = Number(row.evidence_count ?? 0);
    const verdict = evaluateContradiction({ declaresNoTransfers: true, foreignTrackerEvidenceCount: n });
    if (!verdict.contradiction) continue;

    // Idempotent + race-safe: INSERT only when no open contradiction finding
    // exists for this declaration (NOT EXISTS evaluated at insert time).
    const inserted = await exec(
      `INSERT INTO transfer_findings
         (declaration_id, organization_id, finding_type, severity, description, evidence, enforcement_referral, created_by)
       SELECT $1, $2, 'contradiction_tracker_evidence', 'high', $3, $4, TRUE, 'system:anomaly'
       WHERE NOT EXISTS (
         SELECT 1 FROM transfer_findings
         WHERE declaration_id = $1 AND finding_type = 'contradiction_tracker_evidence'
           AND status IN ('open','referred','under_investigation')
       )
       RETURNING id`,
      [
        row.declaration_id,
        row.organization_id,
        verdict.reason,
        JSON.stringify({ foreignTrackerEvidenceCount: n, destinations: row.destinations ?? [] }),
      ],
    );
    if (!inserted[0]) continue;
    await exec(
      `UPDATE transfer_declarations SET compliance_status = 'non_compliant', updated_at = NOW() WHERE id = $1`,
      [row.declaration_id],
    );
    report.findingsCreated += 1;
    report.contradictions.push({ declarationId: row.declaration_id, organizationId: row.organization_id, evidenceCount: n, findingId: inserted[0]?.id ?? null });
  }
  return report;
}

// ─── 3. Adequacy-suspension cascade re-validation ───────────────────────────

export interface CascadeReport {
  adequacyDecisionId: number;
  adequacyStatus: string;
  declarationsRevalidated: number;
  cascadeFindingsCreated: number;
  affectedDeclarationIds: number[];
}

/**
 * Re-validate ALL active declarations relying on a given adequacy decision.
 * Called when the 0030 lifecycle suspends/revokes that decision. Declarations
 * that lose their safeguard get compliance_status = 'non_compliant' and a
 * cascade finding (idempotent per declaration while an open cascade finding exists).
 */
export async function revalidateDeclarationsForAdequacy(
  exec: QueryExec,
  adequacyDecisionId: number,
): Promise<CascadeReport> {
  const dec = await exec(
    `SELECT id, country, decision_status FROM adequacy_decisions WHERE id = $1`,
    [adequacyDecisionId],
  );
  if (!dec[0]) throw new Error(`adequacy decision ${adequacyDecisionId} not found`);
  const status = String(dec[0].decision_status);

  const declarations = await exec(
    `SELECT id, organization_id, destination_country, legal_basis
     FROM transfer_declarations
     WHERE adequacy_decision_id = $1 AND status IN ('submitted','under_review','accepted')`,
    [adequacyDecisionId],
  );

  const report: CascadeReport = {
    adequacyDecisionId,
    adequacyStatus: status,
    declarationsRevalidated: declarations.length,
    cascadeFindingsCreated: 0,
    affectedDeclarationIds: [],
  };
  if (status === "in_force") return report; // nothing to cascade

  for (const decl of declarations) {
    report.affectedDeclarationIds.push(decl.id);
    const existing = await exec(
      `SELECT id FROM transfer_findings
       WHERE declaration_id = $1 AND finding_type = 'adequacy_suspended_cascade'
         AND status IN ('open','referred','under_investigation') LIMIT 1`,
      [decl.id],
    );
    if (existing[0]) {
      await exec(
        `UPDATE transfer_declarations SET compliance_status = 'non_compliant', updated_at = NOW() WHERE id = $1`,
        [decl.id],
      );
      continue;
    }
    await exec(
      `INSERT INTO transfer_findings
         (declaration_id, organization_id, finding_type, severity, description, evidence, enforcement_referral, created_by)
       VALUES ($1, $2, 'adequacy_suspended_cascade', 'critical', $3, $4, TRUE, 'system:cascade')
       RETURNING id`,
      [
        decl.id,
        decl.organization_id,
        `Adequacy decision #${adequacyDecisionId} for "${dec[0].country}" is now "${status}"; declaration #${decl.id} (basis: ${decl.legal_basis}) no longer has a valid safeguard (NDPA 2023 ss.41-43).`,
        JSON.stringify({ adequacyDecisionId, adequacyStatus: status }),
      ],
    );
    await exec(
      `UPDATE transfer_declarations SET compliance_status = 'non_compliant', updated_at = NOW() WHERE id = $1`,
      [decl.id],
    );
    report.cascadeFindingsCreated += 1;
  }
  return report;
}

// ─── Volume-trend anomaly scan (DB wiring around pure z-score) ──────────────

/**
 * Leave-one-out z-score outlier detection: each candidate point is scored
 * against the mean/stddev of the series EXCLUDING itself, so a single spike
 * does not inflate its own baseline (masking). Requires `minPoints`
 * observations (candidate + baseline) before anything is flagged.
 */
export function detectLeaveOneOutOutliers(
  series: TrendPoint[],
  threshold = 2.5,
  minPoints = 4,
): OutlierPoint[] {
  if (series.length < minPoints) return [];
  const out: OutlierPoint[] = [];
  for (let i = 0; i < series.length; i++) {
    const baseline = series.filter((_, j) => j !== i).map((p) => p.value);
    const m = mean(baseline);
    const sd = stdDev(baseline);
    if (sd === 0) continue; // flat baseline: no meaningful z-score
    const z = (series[i].value - m) / sd;
    if (Math.abs(z) >= threshold) {
      out.push({ ...series[i], zScore: z, mean: m, stdDev: sd });
    }
  }
  return out;
}

export interface VolumeAnomalyReport {
  organizationsScanned: number;
  findingsCreated: number;
  anomalies: Array<{ organizationId: number; destination: string; period: string; value: number; zScore: number; findingId: number | null }>;
}

export async function runVolumeAnomalyScan(
  exec: QueryExec,
  opts: { threshold?: number; minPoints?: number; limit?: number } = {},
): Promise<VolumeAnomalyReport> {
  const threshold = opts.threshold ?? 2.5;
  const minPoints = opts.minPoints ?? 4;
  const limit = Math.min(Math.max(opts.limit ?? 20000, 1), 100000);
  const rows = await exec(
    `SELECT organization_id, destination_country AS destination,
            to_char(period_start, 'YYYY') AS period,
            volume_estimate_gb::float AS value
     FROM transfer_declarations
     WHERE status IN ('submitted','under_review','accepted')
       AND declares_no_transfers = FALSE
       AND volume_estimate_gb IS NOT NULL  -- NULL volume is MISSING data, never a zero
     ORDER BY organization_id, destination_country, period_start
     LIMIT $1`,
    [limit],
  );
  // Per-destination series: volumes for different destinations are not
  // commensurable and must not share a baseline.
  const bySeries = new Map<string, { organizationId: number; destination: string; series: TrendPoint[] }>();
  for (const r of rows) {
    const key = `${r.organization_id}::${r.destination}`;
    const entry = bySeries.get(key) ?? { organizationId: r.organization_id, destination: r.destination, series: [] };
    entry.series.push({ period: r.period, value: Number(r.value) });
    bySeries.set(key, entry);
  }
  const orgs = new Set<number>(rows.map((r) => r.organization_id));
  const report: VolumeAnomalyReport = { organizationsScanned: orgs.size, findingsCreated: 0, anomalies: [] };
  for (const { organizationId, destination, series } of Array.from(bySeries.values())) {
    const outliers = detectLeaveOneOutOutliers(series, threshold, minPoints);
    for (const o of outliers) {
      // NOT EXISTS dedupe: one open volume-anomaly finding per
      // (org, destination, period) regardless of concurrent scans.
      const inserted = await exec(
        `INSERT INTO transfer_findings
           (organization_id, finding_type, severity, description, evidence, enforcement_referral, created_by)
         SELECT $1, 'volume_anomaly', 'medium', $2, $3, FALSE, 'system:anomaly'
         WHERE NOT EXISTS (
           SELECT 1 FROM transfer_findings
           WHERE organization_id = $1 AND finding_type = 'volume_anomaly'
             AND status IN ('open','referred','under_investigation')
             AND evidence->>'destination' = $4
             AND evidence->>'period' = $5
         )
         RETURNING id`,
        [
          organizationId,
          `Declared transfer volume to "${destination}" in period ${o.period} (${o.value} GB) is a statistical outlier for this controller/destination (leave-one-out z=${o.zScore.toFixed(2)}, threshold=${threshold}).`,
          JSON.stringify({ destination, period: o.period, value: o.value, zScore: o.zScore, mean: o.mean, stdDev: o.stdDev }),
          destination,
          o.period,
        ],
      );
      if (!inserted[0]) continue;
      report.findingsCreated += 1;
      report.anomalies.push({ organizationId, destination, period: o.period, value: o.value, zScore: o.zScore, findingId: inserted[0]?.id ?? null });
    }
  }
  return report;
}

/** Re-export for router convenience: validate one declaration's registry snapshot. */
export { validateDeclarationBasis };
export type { LegalBasis, RegistrySnapshot };
