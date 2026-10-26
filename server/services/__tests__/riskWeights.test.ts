/**
 * riskWeights service unit tests (round 12, wave 8 — roadmap P2).
 *
 * No database: the shared pg pool (../../db getPool) is mocked with a
 * query stub. Covers the fail-closed contract of getActiveWeights():
 * learned weights are returned ONLY for an active, fresh (<30d), complete
 * row; every other condition falls back to DEFAULT_RISK_WEIGHTS.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ query: vi.fn(), poolAvailable: true }));
vi.mock("../../db", () => ({
  getPool: () => (h.poolAvailable ? { query: h.query } : null),
}));
const mockQuery = h.query;

import {
  getActiveWeights,
  validateWeightsPayload,
  FRESHNESS_WINDOW_MS,
} from "../riskWeights";
import { DEFAULT_RISK_WEIGHTS, RISK_FACTOR_KEYS } from "../supervisionRiskScoring";

const LEARNED = {
  complaint_volume: 0.30,
  complaint_surge: 0.05,
  scan_findings: 0.30,
  prior_sanctions: 0.15,
  filing_delinquency: 0.05,
  data_volume_class: 0.15,
};

function activeRow(overrides: Record<string, unknown> = {}) {
  return {
    version: "v20260401T000000Z",
    weights: LEARNED,
    trained_at: new Date(Date.now() - 2 * 86400_000).toISOString(), // 2d old
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  h.poolAvailable = true;
});

describe("validateWeightsPayload", () => {
  it("accepts a complete non-negative payload", () => {
    expect(validateWeightsPayload(LEARNED)).toEqual(LEARNED);
  });
  it("rejects missing keys, negatives, non-numbers, zero sum", () => {
    expect(validateWeightsPayload({ ...LEARNED, complaint_volume: undefined })).toBeNull();
    const missing: any = { ...LEARNED };
    delete missing.prior_sanctions;
    expect(validateWeightsPayload(missing)).toBeNull();
    expect(validateWeightsPayload({ ...LEARNED, complaint_volume: -0.1 })).toBeNull();
    expect(validateWeightsPayload({ ...LEARNED, complaint_volume: "high" })).toBeNull();
    const zeros = Object.fromEntries(RISK_FACTOR_KEYS.map((k) => [k, 0]));
    expect(validateWeightsPayload(zeros)).toBeNull();
    expect(validateWeightsPayload(null)).toBeNull();
    expect(validateWeightsPayload([0.2, 0.2])).toBeNull();
  });
});

describe("getActiveWeights", () => {
  it("falls back when the DB pool is unavailable", async () => {
    h.poolAvailable = false;
    const r = await getActiveWeights();
    expect(r.source).toBe("default");
    expect(r.weights).toEqual(DEFAULT_RISK_WEIGHTS);
    expect(r.reason).toMatch(/database unavailable/);
  });

  it("falls back when the query throws", async () => {
    mockQuery.mockRejectedValue(new Error("relation does not exist"));
    const r = await getActiveWeights();
    expect(r.source).toBe("default");
    expect(r.weights).toEqual(DEFAULT_RISK_WEIGHTS);
  });

  it("falls back when no active row exists", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const r = await getActiveWeights();
    expect(r.source).toBe("default");
    expect(r.reason).toMatch(/no active/);
  });

  it("returns learned weights for an active fresh complete row", async () => {
    mockQuery.mockResolvedValue({ rows: [activeRow()] });
    const r = await getActiveWeights();
    expect(r.source).toBe("learned");
    expect(r.version).toBe("v20260401T000000Z");
    expect(r.weights).toEqual(LEARNED);
    expect(r.reason).toBeNull();
  });

  it("fails closed on stale active rows (>30d)", async () => {
    mockQuery.mockResolvedValue({
      rows: [activeRow({ trained_at: new Date(Date.now() - 45 * 86400_000).toISOString() })],
    });
    const r = await getActiveWeights();
    expect(r.source).toBe("default");
    expect(r.weights).toEqual(DEFAULT_RISK_WEIGHTS);
    expect(r.reason).toMatch(/stale/);
  });

  it("fails closed on future-dated rows", async () => {
    mockQuery.mockResolvedValue({
      rows: [activeRow({ trained_at: new Date(Date.now() + 86400_000).toISOString() })],
    });
    const r = await getActiveWeights();
    expect(r.source).toBe("default");
  });

  it("fails closed on an incomplete weights payload", async () => {
    const bad: any = { ...LEARNED };
    delete bad.filing_delinquency;
    mockQuery.mockResolvedValue({ rows: [activeRow({ weights: bad })] });
    const r = await getActiveWeights();
    expect(r.source).toBe("default");
    expect(r.reason).toMatch(/incomplete|invalid/);
  });

  it("honours the 30-day boundary", async () => {
    const now = new Date();
    mockQuery.mockResolvedValue({
      rows: [activeRow({ trained_at: new Date(now.getTime() - FRESHNESS_WINDOW_MS + 1000).toISOString() })],
    });
    expect((await getActiveWeights(now)).source).toBe("learned");
    mockQuery.mockResolvedValue({
      rows: [activeRow({ trained_at: new Date(now.getTime() - FRESHNESS_WINDOW_MS - 1000).toISOString() })],
    });
    expect((await getActiveWeights(now)).source).toBe("default");
  });
});
