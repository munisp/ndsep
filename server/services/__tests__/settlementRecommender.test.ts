/**
 * settlementRecommender service unit tests (round 12, wave 8 — roadmap P2).
 *
 * Mocks: db pool (fulfilled-terms query capture), decisionFeedback.mintPrediction,
 * casePrecedents.searchCases, hgbArtifact.loadArtifact (handcrafted artifact,
 * real predictProba). Covers:
 *  - recommendation shape + probability from the artifact;
 *  - suggested adjustments derived from FULFILLED similar-case medians;
 *  - feedback-loop minting on surface 'settlement_terms';
 *  - fail-closed degradation (no artifact / no worker / no DB).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  query: vi.fn(),
  mint: vi.fn().mockResolvedValue("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"),
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
  recommendTerms,
  buildFeatureValues,
  buildAdjustments,
  SETTLEMENT_TERMS_SURFACE,
  type TermSheetInput,
} from "../settlementRecommender";

/** One split on n_instalments (feature_idx 1): >= threshold -> high fulfilment. */
const ARTIFACT = {
  model: "settlement_recommender",
  model_type: "hist_gradient_boosting",
  version: "v20260401T000000Z",
  trained_at: "2026-04-01T00:00:00Z",
  features: [
    "log_monetary_amount", "n_instalments", "n_obligations", "confidential",
    "reduction_ratio", "duration_days", "org_size_score",
    "sector=fintech", "sector=banking", "sector=unknown",
  ],
  categorical_levels: { sector: ["fintech", "banking", "unknown"] },
  baseline: 0.0,
  trees: [[
    { value: 0, count: 10, feature_idx: 1, num_threshold: 3, missing_go_to_left: true, left: 1, right: 2, is_leaf: false },
    { value: -0.8, count: 5, feature_idx: 0, num_threshold: 0, missing_go_to_left: true, left: 0, right: 0, is_leaf: true },
    { value: 0.9, count: 5, feature_idx: 0, num_threshold: 0, missing_go_to_left: true, left: 0, right: 0, is_leaf: true },
  ]],
  metrics: {},
  sample_size: 100,
  usable: true,
};

const FULFILLED_HIT = (id: number) => ({
  score: 0.9,
  payload: { case_type: "settlement", case_id: String(id), outcome: "fulfilled", penalty_band: "2m_10m" },
});

const TERM_ROWS = [
  { id: 1, original_amount: 10_000_000, reduction_amount: 2_000_000, instalment_schedule: [{}, {}, {}, {}] },
  { id: 2, original_amount: 10_000_000, reduction_amount: 1_000_000, instalment_schedule: [{}, {}, {}, {}, {}, {}] },
  { id: 3, original_amount: 5_000_000, reduction_amount: 0, instalment_schedule: [{}, {}] },
];

const INPUT: TermSheetInput = {
  monetaryAmount: 8_000_000,
  originalAmount: 10_000_000,
  instalmentSchedule: [{ dueDate: "2026-05-01" }, { dueDate: "2026-06-01" }],
  nonMonetaryObligations: ["audit"],
  confidentialityFlag: false,
  orgSector: "fintech",
  orgDataVolumeClass: "high",
  actorId: 42,
};

beforeEach(() => {
  h.query.mockReset().mockResolvedValue({ rows: TERM_ROWS });
  h.mint.mockClear();
  h.search.mockReset().mockResolvedValue([FULFILLED_HIT(1), FULFILLED_HIT(2), FULFILLED_HIT(3)]);
  h.artifact = ARTIFACT;
});

describe("buildFeatureValues (parity with settlement_recommender.py)", () => {
  it("computes the term-sheet feature map", () => {
    const v = buildFeatureValues(ARTIFACT as any, INPUT);
    expect(v.log_monetary_amount).toBeCloseTo(Math.log1p(8_000_000), 9);
    expect(v.n_instalments).toBe(2);
    expect(v.n_obligations).toBe(1);
    expect(v.confidential).toBe(0);
    expect(v.reduction_ratio).toBeCloseTo(0.2, 9);
    expect(v.duration_days).toBe(31);
    expect(v.org_size_score).toBe(0.7);
    expect(v["sector=fintech"]).toBe(1);
    expect(v["sector=banking"]).toBe(0);
  });
  it("unseen sectors collapse to the 'unknown' level", () => {
    const v = buildFeatureValues(ARTIFACT as any, { ...INPUT, orgSector: "martian-mining" });
    expect(v["sector=unknown"]).toBe(1);
    expect(v["sector=fintech"]).toBe(0);
  });
});

describe("recommendTerms", () => {
  it("returns probability, precedent stats and adjustments; mints feedback", async () => {
    const rec = await recommendTerms(INPUT);
    // 2 instalments <= threshold 3 -> left leaf -> sigmoid(-0.8)
    expect(rec.fulfillmentProbability).toBeCloseTo(0.31, 2);
    expect(rec.degraded).toBe(false);
    expect(rec.precedentStats.fulfilledCases).toBe(3);
    expect(rec.precedentStats.medianInstalments).toBe(4);
    expect(rec.precedentStats.medianReductionRatio).toBeCloseTo(0.1, 9);
    // proposal has 2 instalments < median 4 -> suggest more
    expect(rec.suggestedAdjustments.some((a) => a.parameter === "n_instalments")).toBe(true);
    expect(h.mint).toHaveBeenCalledOnce();
    const arg = h.mint.mock.calls[0][0] as any;
    expect(arg.surface).toBe(SETTLEMENT_TERMS_SURFACE);
    expect(arg.suggestion.n_instalments).toBe(2);
    expect(arg.modelVersion).toBe("v20260401T000000Z");
  });

  it("queries only FULFILLED settlements for precedent stats", async () => {
    await recommendTerms(INPUT);
    const sql = String(h.query.mock.calls[0][0]);
    expect(sql).toContain("FROM settlements");
    expect(sql).toContain("'fulfilled'");
    expect(h.query.mock.calls[0][1][0]).toEqual([1, 2, 3]);
  });

  it("high-instalment proposals score the right leaf", async () => {
    const rec = await recommendTerms({
      ...INPUT,
      instalmentSchedule: Array.from({ length: 6 }, (_, i) => ({ dueDate: `2026-0${i + 1}-01` })),
    });
    expect(rec.fulfillmentProbability).toBeCloseTo(0.7109, 3); // sigmoid(0.9)
  });

  it("degrades explicitly when the artifact is missing", async () => {
    h.artifact = null;
    const rec = await recommendTerms(INPUT);
    expect(rec.fulfillmentProbability).toBeNull();
    expect(rec.degraded).toBe(true);
    expect(rec.reason).toMatch(/artifact unavailable/);
  });

  it("degrades explicitly when the precedent worker is unreachable", async () => {
    h.search.mockResolvedValue(null);
    const rec = await recommendTerms(INPUT);
    expect(rec.degraded).toBe(true);
    expect(rec.precedentStats.fulfilledCases).toBe(0);
    expect(rec.suggestedAdjustments).toEqual([]);
    expect(rec.fulfillmentProbability).not.toBeNull();
  });

  it("survives the fulfilled-terms query failing", async () => {
    h.query.mockRejectedValue(new Error("relation settlement_terms does not exist"));
    const rec = await recommendTerms(INPUT);
    expect(rec.degraded).toBe(true);
    expect(rec.precedentStats.fulfilledCases).toBe(0);
  });
});

describe("buildAdjustments", () => {
  it("stays silent on thin precedent bases (<3 fulfilled cases)", () => {
    const adj = buildAdjustments(INPUT, { medianInstalments: 8, medianReductionRatio: 0.1, fulfilledCases: 2 });
    expect(adj).toEqual([]);
  });
  it("flags an above-norm reduction", () => {
    const adj = buildAdjustments(
      { ...INPUT, monetaryAmount: 5_000_000, originalAmount: 10_000_000 },
      { medianInstalments: 2, medianReductionRatio: 0.1, fulfilledCases: 10 },
    );
    const red = adj.find((a) => a.parameter === "reduction_ratio");
    expect(red).toBeDefined();
    expect(red!.current).toBeCloseTo(0.5, 9);
    expect(red!.suggested).toBeCloseTo(0.1, 9);
  });
  it("suggests an instalment schedule for single-bullet proposals", () => {
    const adj = buildAdjustments(
      { ...INPUT, instalmentSchedule: [] },
      { medianInstalments: 4, medianReductionRatio: 0.1, fulfilledCases: 10 },
    );
    expect(adj.some((a) => a.parameter === "n_instalments" && a.current === 0)).toBe(true);
  });
});
