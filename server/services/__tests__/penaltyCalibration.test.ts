/**
 * penaltyCalibration service unit tests (round 12, wave 8 — roadmap P2).
 *
 * Mocks: db pool (audit insert capture), decisionFeedback.mintPrediction,
 * casePrecedents.searchCases, hgbArtifact.loadArtifact (a handcrafted
 * one-tree artifact scored by the REAL predictProba). Covers:
 *  - badge shape + probability from the artifact;
 *  - HARD RULE: the computed penalty amount is echoed verbatim and the only
 *    DB write is the audit INSERT (never an UPDATE to penalties);
 *  - penalty band mapping parity with the python trainer;
 *  - fail-closed degradation (no artifact / no precedent worker).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  mint: vi.fn().mockResolvedValue("11111111-2222-4333-8444-555555555555"),
  search: vi.fn(),
  artifact: null as unknown,
}));

vi.mock("../../db", () => ({ getPool: () => ({ query: h.query }) }));
vi.mock("../../routers/decisionFeedback", () => ({
  mintPrediction: (...args: unknown[]) => h.mint(...args),
}));
vi.mock("../../routers/casePrecedents", () => ({
  searchCases: (...args: unknown[]) => h.search(...args),
  redactQueryText: (t: string) => t,
}));
vi.mock("../hgbArtifact", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../hgbArtifact")>();
  return { ...orig, loadArtifact: () => h.artifact };
});

import {
  calibratePenalty,
  penaltyBandFor,
  similarEnforcementMedian,
  BAND_MIDPOINTS,
  PENALTY_CALIBRATION_SURFACE,
} from "../penaltyCalibration";
import { predictProba } from "../hgbArtifact";

/** One split on penalty_band=over_100m vs a leaf: probability ~0.62/0.38. */
const ARTIFACT = {
  model: "penalty_calibration",
  model_type: "hist_gradient_boosting",
  version: "v20260401T000000Z",
  trained_at: "2026-04-01T00:00:00Z",
  features: [
    "penalty_band=under_floor", "penalty_band=2m_10m",
    "penalty_band=10m_100m", "penalty_band=over_100m",
    "violation_type=high", "violation_type=unknown",
    "org_size=medium", "org_size=unknown",
    "legal_basis_section=s.48", "legal_basis_section=unknown",
  ],
  categorical_levels: {
    penalty_band: ["under_floor", "2m_10m", "10m_100m", "over_100m"],
    violation_type: ["high", "unknown"],
    org_size: ["medium", "unknown"],
    legal_basis_section: ["s.48", "unknown"],
  },
  baseline: 0.0,
  trees: [[
    { value: 0, count: 10, feature_idx: 3, num_threshold: 0.5, missing_go_to_left: true, left: 1, right: 2, is_leaf: false },
    { value: -0.5, count: 5, feature_idx: 0, num_threshold: 0, missing_go_to_left: true, left: 0, right: 0, is_leaf: true },
    { value: 0.5, count: 5, feature_idx: 0, num_threshold: 0, missing_go_to_left: true, left: 0, right: 0, is_leaf: true },
  ]],
  metrics: {},
  sample_size: 10,
  usable: true,
};

const HIT = (band: string, caseType = "enforcement") => ({
  score: 0.9,
  payload: { case_type: caseType, case_id: "1", outcome: "decided", penalty_band: band },
});

beforeEach(() => {
  h.query.mockClear();
  h.mint.mockClear();
  h.search.mockReset().mockResolvedValue([HIT("2m_10m"), HIT("10m_100m"), HIT("10m_100m")]);
  h.artifact = ARTIFACT;
});

describe("penaltyBandFor (parity with ml/models/penalty_calibration.py)", () => {
  it("bands by the s.48 statutory floors", () => {
    expect(penaltyBandFor(500_000)).toBe("under_floor");
    expect(penaltyBandFor(2_000_000)).toBe("2m_10m");
    expect(penaltyBandFor(50_000_000)).toBe("10m_100m");
    expect(penaltyBandFor(250_000_000)).toBe("over_100m");
    expect(penaltyBandFor(NaN)).toBe("unknown");
  });
});

describe("calibratePenalty", () => {
  it("returns probability + similarMedian and echoes the amount verbatim", async () => {
    const badge = await calibratePenalty({
      penaltyAmount: 120_000_000,
      violationType: "high",
      orgSize: "medium",
      legalBasisSection: "s.48",
      orgId: 7,
      actorId: 42,
    });
    expect(badge.penaltyBand).toBe("over_100m");
    // over_100m branch: sigmoid(0 + 0.5)
    expect(badge.upholdProbability).toBeCloseTo(0.6225, 3);
    // medians of [6m, 55m, 55m]
    expect(badge.similarMedian).toBe(BAND_MIDPOINTS["10m_100m"]);
    expect(badge.similarCount).toBe(3);
    // HARD RULE: the computed amount is returned untouched
    expect(badge.computedAmount).toBe(120_000_000);
    expect(badge.degraded).toBe(false);
    expect(badge.predictionId).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("mints a decision_feedback prediction on surface penalty_calibration", async () => {
    await calibratePenalty({ penaltyAmount: 5_000_000, actorId: 42 });
    expect(h.mint).toHaveBeenCalledOnce();
    const arg = h.mint.mock.calls[0][0] as any;
    expect(arg.surface).toBe(PENALTY_CALIBRATION_SURFACE);
    expect(arg.actorId).toBe(42);
    expect(arg.suggestion.penalty_band).toBe("2m_10m");
  });

  it("appends an audit row — and NEVER mutates the penalty", async () => {
    await calibratePenalty({ penaltyAmount: 5_000_000, orgId: 7, actorId: 42 });
    const sqls = h.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("INSERT INTO penalty_calibration_audit"))).toBe(true);
    // HARD RULE: no write path touches penalty tables
    expect(sqls.some((s) => /UPDATE\s+(financial_penalties|enforcement_fines)/i.test(s))).toBe(false);
    expect(sqls.some((s) => /INSERT\s+INTO\s+(financial_penalties|enforcement_fines)/i.test(s))).toBe(false);
  });

  it("degrades explicitly when the artifact is missing", async () => {
    h.artifact = null;
    const badge = await calibratePenalty({ penaltyAmount: 5_000_000, actorId: 42 });
    expect(badge.upholdProbability).toBeNull();
    expect(badge.degraded).toBe(true);
    expect(badge.reason).toMatch(/artifact unavailable/);
    expect(badge.computedAmount).toBe(5_000_000);
  });

  it("degrades explicitly when precedent retrieval fails", async () => {
    h.search.mockResolvedValue(null);
    const badge = await calibratePenalty({ penaltyAmount: 5_000_000, actorId: 42 });
    expect(badge.similarMedian).toBeNull();
    expect(badge.degraded).toBe(true);
    expect(badge.upholdProbability).not.toBeNull(); // model still scored
  });

  it("unseen categorical levels fall back to the 'unknown' level", async () => {
    const badge = await calibratePenalty({
      penaltyAmount: 5_000_000, violationType: "never-seen-type", actorId: 42,
    });
    // 2m_10m band -> left leaf -> sigmoid(-0.5)
    expect(badge.upholdProbability).toBeCloseTo(0.3775, 3);
  });
});

describe("similarEnforcementMedian", () => {
  it("keeps enforcement hits only and medians band midpoints", async () => {
    h.search.mockResolvedValue([
      HIT("2m_10m"), HIT("over_100m", "settlement"), HIT("under_floor"),
    ]);
    const r = await similarEnforcementMedian("q");
    expect(r.similarMedian).toBe((BAND_MIDPOINTS["2m_10m"] + BAND_MIDPOINTS.under_floor) / 2);
    expect(r.similarCount).toBe(2);
    expect(r.degraded).toBe(false);
  });

  it("fails closed when the worker is unreachable", async () => {
    h.search.mockResolvedValue(null);
    const r = await similarEnforcementMedian("q");
    expect(r.degraded).toBe(true);
    expect(r.similarMedian).toBeNull();
  });
});

describe("hgbArtifact.predictProba traversal semantics", () => {
  it("raw = baseline + sum(leaf values); no extra learning-rate factor", () => {
    const over100m = { "penalty_band=over_100m": 1, "violation_type=high": 1 };
    expect(predictProba(ARTIFACT as any, over100m)).toBeCloseTo(0.6225, 3);
    expect(predictProba(ARTIFACT as any, { "penalty_band=2m_10m": 1 })).toBeCloseTo(0.3775, 3);
  });
});
