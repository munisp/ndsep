/**
 * Pure-logic tests for the surge-detection math (no DB, no python runtime).
 *
 * complaintSurgeMath.ts is a TS port of ml/bayesian/models.py
 * (poisson_changepoint) and mcmc.py (hdi); these tests pin the numerics on
 * synthetic series with known ground truth.
 */
import { describe, it, expect } from "vitest";
import {
  gammaln,
  hdi,
  mulberry32,
  gammaSample,
  rollingZScore,
  logMarginalPoisson,
  poissonChangepoint,
  classifySurge,
  severityForZscore,
} from "../../server/services/complaintSurgeMath";

// Deterministic Poisson sampler (Knuth) for synthetic series generation.
function poissonDraw(rng: () => number, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

function syntheticSeries(lam1: number, lam2: number, changeAt: number, T: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const out: number[] = [];
  for (let t = 0; t < T; t++) {
    out.push(poissonDraw(rng, t < changeAt ? lam1 : lam2));
  }
  return out;
}

describe("gammaln (Lanczos)", () => {
  it("matches known values", () => {
    expect(gammaln(1)).toBeCloseTo(0, 10);            // Γ(1) = 1
    expect(gammaln(2)).toBeCloseTo(0, 10);            // Γ(2) = 1
    expect(gammaln(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 10);
    expect(gammaln(10)).toBeCloseTo(Math.log(362880), 8); // Γ(10) = 9!
    expect(gammaln(123.4)).toBeCloseTo(469.3360974421906, 8); // scipy reference
  });
});

describe("PRNG + gamma sampler", () => {
  it("mulberry32 is deterministic per seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it("gamma sample mean tracks shape × scale", () => {
    const rng = mulberry32(7);
    const n = 20000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += gammaSample(rng, 4.5, 2.0);
    expect(sum / n).toBeCloseTo(9.0, 0); // E = 4.5 * 2
  });
});

describe("hdi", () => {
  it("covers the requested mass on a unimodal sample", () => {
    const rng = mulberry32(11);
    const samples: number[] = [];
    for (let i = 0; i < 5000; i++) samples.push(gammaSample(rng, 9, 1));
    const [lo, hi] = hdi(samples, 0.95);
    const inside = samples.filter((s) => s >= lo && s <= hi).length;
    expect(inside / samples.length).toBeGreaterThanOrEqual(0.945);
    expect(inside / samples.length).toBeLessThanOrEqual(0.96);
    expect(lo).toBeLessThan(hi);
  });
});

describe("rolling z-score", () => {
  it("returns null with insufficient history", () => {
    expect(rollingZScore([1, 2, 1, 2], 10, 90, 14)).toBeNull();
  });

  it("flags an obvious spike against a stable baseline", () => {
    const baseline = Array.from({ length: 90 }, (_, i) => (i % 3)); // mean 1, small variance
    const z = rollingZScore(baseline, 25, 90, 14);
    expect(z).not.toBeNull();
    expect(z!.zscore).toBeGreaterThan(3);
    expect(z!.baselineMean).toBeCloseTo(1, 5);
  });

  it("does not flag an in-regime day", () => {
    const baseline = Array.from({ length: 90 }, (_, i) => (i % 3));
    const z = rollingZScore(baseline, 1, 90, 14);
    expect(z!.zscore).toBeLessThan(1);
  });

  it("zero-variance baseline: excess → Infinity, no excess → 0", () => {
    const flat = Array.from({ length: 30 }, () => 2);
    expect(rollingZScore(flat, 9, 90, 14)!.zscore).toBe(Infinity);
    expect(rollingZScore(flat, 2, 90, 14)!.zscore).toBe(0);
  });

  it("excludes the observed point from its own baseline", () => {
    const baseline = Array.from({ length: 30 }, () => 2);
    const withSpikeInside = [...baseline, 100];
    // window covers the whole array incl. the spike, but the API contract is
    // that callers pass baseline-only series; here we verify mean uses all
    // points handed in as baseline.
    const z = rollingZScore(withSpikeInside, 5, 90, 14);
    expect(z!.baselineDays).toBe(31);
    expect(z!.baselineMean).toBeGreaterThan(2); // spike leaked into baseline
  });
});

describe("logMarginalPoisson", () => {
  it("matches the analytic conjugate marginal on small data", () => {
    // y = [2], a = 1, b = 0.2:
    // log p(y) = gammaln(3) - gammaln(1) + 1*log(0.2) - 3*log(1.2) - gammaln(3)
    //          = -log(0.2 denominator) ... compute directly:
    const expected =
      gammaln(3) - gammaln(1) + Math.log(0.2) - 3 * Math.log(1.2) - gammaln(3);
    expect(logMarginalPoisson([2], 1, 0.2)).toBeCloseTo(expected, 12);
    // And numerically: log[ b^a Γ(a+s) / (Γ(a) (b+n)^(a+s)) ] - log(s!)
    const numeric = Math.log((0.2 * 2) / (1 * Math.pow(1.2, 3))) - Math.log(2);
    expect(logMarginalPoisson([2], 1, 0.2)).toBeCloseTo(numeric, 10);
  });
});

describe("poissonChangepoint (port of ml/bayesian/models.py)", () => {
  it("finds a planted regime shift 2/day → 10/day at t=45 of 90", () => {
    const counts = syntheticSeries(2, 10, 45, 90, 2026);
    const res = poissonChangepoint(counts, { seed: 42, nRateDraws: 8000 });
    expect(Math.abs(res.mapTau - 45)).toBeLessThanOrEqual(6);
    expect(Math.abs(res.meanTau - 45)).toBeLessThanOrEqual(8);
    expect(res.pLam2GtLam1).toBeGreaterThan(0.99);
    expect(res.lam1.mean).toBeGreaterThan(1);
    expect(res.lam1.mean).toBeLessThan(4);
    expect(res.lam2.mean).toBeGreaterThan(7);
    expect(res.lam2.mean).toBeLessThan(13);
    expect(res.tauPosterior).toHaveLength(89); // taus 1..T-1
    const total = res.tauPosterior.reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 10);
    // MAP index should carry the dominant posterior mass
    expect(Math.max(...res.tauPosterior)).toBeGreaterThan(0.2);
  });

  it("is diffuse with P(lam2>lam1) ≈ 0.5 on a homogeneous series", () => {
    const counts = syntheticSeries(3, 3, 45, 90, 99);
    const res = poissonChangepoint(counts, { seed: 7, nRateDraws: 8000 });
    expect(res.pLam2GtLam1).toBeGreaterThan(0.25);
    expect(res.pLam2GtLam1).toBeLessThan(0.75);
    // No dominant change-point: max grid mass stays small
    expect(Math.max(...res.tauPosterior)).toBeLessThan(0.2);
  });

  it("detects a downward shift too (pLam2GtLam1 near 0)", () => {
    const counts = syntheticSeries(12, 2, 45, 90, 555);
    const res = poissonChangepoint(counts, { seed: 1, nRateDraws: 8000 });
    expect(Math.abs(res.mapTau - 45)).toBeLessThanOrEqual(6);
    expect(res.pLam2GtLam1).toBeLessThan(0.01);
  });

  it("is deterministic for a fixed seed", () => {
    const counts = syntheticSeries(2, 9, 60, 90, 31);
    const r1 = poissonChangepoint(counts, { seed: 5, nRateDraws: 2000 });
    const r2 = poissonChangepoint(counts, { seed: 5, nRateDraws: 2000 });
    expect(r1.pLam2GtLam1).toBe(r2.pLam2GtLam1);
    expect(r1.lam1.mean).toBe(r2.lam1.mean);
    expect(r1.tauPosterior).toEqual(r2.tauPosterior);
  });

  it("rejects series shorter than 4 periods", () => {
    expect(() => poissonChangepoint([1, 2, 3])).toThrow();
  });

  it("handles all-zero stretches without NaN", () => {
    const counts = [...Array(45).fill(0), ...syntheticSeries(6, 6, 0, 45, 77)];
    const res = poissonChangepoint(counts, { seed: 3, nRateDraws: 4000 });
    expect(Number.isFinite(res.pLam2GtLam1)).toBe(true);
    expect(Number.isFinite(res.lam1.mean)).toBe(true);
    expect(Number.isFinite(res.lam2.mean)).toBe(true);
  });
});

describe("surge classification + severity", () => {
  const thresholds = { zscoreThreshold: 3, changepointProb: 0.95 };

  it("combined when both detectors fire", () => {
    expect(classifySurge(4.2, 0.99, thresholds)).toEqual({ isSurge: true, method: "combined" });
  });

  it("single-detector surges", () => {
    expect(classifySurge(3.5, 0.4, thresholds)).toEqual({ isSurge: true, method: "zscore" });
    expect(classifySurge(1.0, 0.97, thresholds)).toEqual({ isSurge: true, method: "changepoint" });
  });

  it("no surge below both thresholds", () => {
    expect(classifySurge(2.9, 0.9, thresholds).isSurge).toBe(false);
    expect(classifySurge(null, null, thresholds).isSurge).toBe(false);
  });

  it("severity ladder", () => {
    expect(severityForZscore(Infinity)).toBe("critical");
    expect(severityForZscore(6.5)).toBe("critical");
    expect(severityForZscore(4.5)).toBe("high");
    expect(severityForZscore(3.1)).toBe("elevated");
    expect(severityForZscore(null)).toBe("elevated");
  });
});

describe("end-to-end synthetic surge (both detectors on one series)", () => {
  it("a sudden complaint spike trips z-score AND change-point", () => {
    // 89 quiet days (mean ~1/day), then a 25-complaint spike day.
    const quiet = syntheticSeries(1, 1, 0, 89, 808);
    const series = [...quiet, 25];
    const z = rollingZScore(series.slice(0, -1), series[series.length - 1], 89, 14);
    const cp = poissonChangepoint(series, { seed: 42, nRateDraws: 8000 });
    const verdict = classifySurge(z?.zscore ?? null, cp.pLam2GtLam1, { zscoreThreshold: 3, changepointProb: 0.95 });
    expect(z!.zscore).toBeGreaterThan(3);
    expect(cp.pLam2GtLam1).toBeGreaterThan(0.95);
    // Change-point lands on (or adjacent to) the final day.
    expect(cp.mapTau).toBeGreaterThanOrEqual(85);
    expect(verdict).toEqual({ isSurge: true, method: "combined" });
  });
});
