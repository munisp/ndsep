/**
 * Complaint surge math — pure TypeScript port of the Bayesian machinery in
 * ml/bayesian/models.py (``poisson_changepoint``) and ml/bayesian/mcmc.py
 * (``hdi``), plus the rolling-baseline z-score used by the surge detector.
 *
 * NO python runtime call: everything is reimplemented here on top of a
 * small seedable PRNG so results are deterministic in tests and audits.
 *
 * Numerical notes:
 *  - gammaln: Lanczos approximation (g = 7, 9-term series), max abs error
 *    ~1e-10 for x >= 0.5 — well below what the change-point grid needs.
 *  - Gamma sampler: Marsaglia & Tsang (2000) on a mulberry32 PRNG.
 */

// ─── PRNG + samplers ─────────────────────────────────────────────────────────

/** Deterministic 32-bit PRNG (same family as numpy default_rng reproducibility goals). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller on the given uniform source. */
export function randn(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Gamma(shape, scale) sampler — Marsaglia & Tsang. Matches the
 * parameterisation of numpy's rng.gamma(shape, scale) used in
 * models.py (scale = 1/rate).
 */
export function gammaSample(rng: () => number, shape: number, scale: number): number {
  if (shape <= 0 || scale <= 0) return NaN;
  let k = shape;
  // Boost shapes < 1 to >= 1, then correct with a uniform power.
  if (k < 1) {
    const u = Math.max(rng(), Number.MIN_VALUE);
    return gammaSample(rng, k + 1, scale) * Math.pow(u, 1 / k);
  }
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = randn(rng);
    const v0 = 1 + c * x;
    if (v0 <= 0) continue;
    const v = v0 * v0 * v0;
    const u = Math.max(rng(), Number.MIN_VALUE);
    // Squeeze + acceptance tests
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return scale * d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return scale * d * v;
  }
}

// ─── Special functions ───────────────────────────────────────────────────────

const LANCZOS_G = 7;
const LANCZOS_COEF = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** log Gamma(x), x > 0 — Lanczos approximation (reflection for x < 0.5). */
export function gammaln(x: number): number {
  if (x <= 0) return NaN;
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - gammaln(1 - x);
  }
  const z = x - 1;
  let acc = LANCZOS_COEF[0];
  for (let i = 1; i < LANCZOS_G + 2; i++) {
    acc += LANCZOS_COEF[i] / (z + i);
  }
  const t = z + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(acc);
}

// ─── Interval estimation ─────────────────────────────────────────────────────

/** Highest-density interval of a 1-D sample (port of mcmc.hdi: shortest prob-mass span). */
export function hdi(samples: number[], prob = 0.95): [number, number] {
  const x = [...samples].sort((a, b) => a - b);
  const n = x.length;
  if (n === 0) return [NaN, NaN];
  let k = Math.floor(prob * n);
  k = Math.min(Math.max(k, 1), n - 1);
  let best = 0;
  let bestWidth = Infinity;
  for (let i = 0; i + k < n; i++) {
    const w = x[i + k] - x[i];
    if (w < bestWidth) {
      bestWidth = w;
      best = i;
    }
  }
  return [x[best], x[best + k]];
}

// ─── Z-score vs rolling baseline ─────────────────────────────────────────────

export interface ZScoreResult {
  observed: number;
  baselineMean: number;
  baselineStd: number;
  zscore: number;         // 0 when the baseline is degenerate (std = 0) unless observed > mean
  baselineDays: number;   // number of baseline points actually used
}

/**
 * Z-score of the latest observation against the trailing `window` baseline
 * values (EXCLUDING the observed point itself — matches a "today vs the last
 * 90 days" comparison). Sample stddev (ddof = 1); when the baseline has zero
 * variance, any positive excess over the mean yields +Infinity so the
 * threshold comparator flags it, and no excess yields 0.
 *
 * Returns null when there are fewer than `minPeriods` baseline points.
 */
export function rollingZScore(
  baselineSeries: number[],
  observed: number,
  window: number,
  minPeriods = 14,
): ZScoreResult | null {
  const baseline = baselineSeries.slice(-window);
  if (baseline.length < minPeriods) return null;
  const mean = baseline.reduce((s, v) => s + v, 0) / baseline.length;
  const variance =
    baseline.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (baseline.length - 1);
  const std = Math.sqrt(variance);
  let z: number;
  if (std === 0) {
    z = observed > mean ? Infinity : 0;
  } else {
    z = (observed - mean) / std;
  }
  return { observed, baselineMean: mean, baselineStd: std, zscore: z, baselineDays: baseline.length };
}

// ─── Poisson change-point (port of models.py::poisson_changepoint) ──────────

export interface ChangepointOptions {
  a?: number;          // Gamma rate prior shape (default 1.0, as in models.py)
  b?: number;          // Gamma rate prior rate  (default 0.2, as in models.py)
  seed?: number;       // PRNG seed for the conditional rate draws
  nRateDraws?: number; // posterior rate draws (default 20000, as in models.py)
}

export interface ChangepointResult {
  T: number;
  taus: number[];
  tauPosterior: number[];
  mapTau: number;
  meanTau: number;
  medianTau: number;
  tauHdi95Grid: [number, number];
  pLam2GtLam1: number;
  lam1: { mean: number; hdi95: [number, number] };
  lam2: { mean: number; hdi95: [number, number] };
  prior: { rateGammaA: number; rateGammaB: number; tau: string };
}

/**
 * log p(y) with lambda ~ Gamma(a, b) (b = rate) marginalized out.
 * Direct port of models.py::_log_marginal_poisson.
 */
export function logMarginalPoisson(y: number[], a: number, b: number): number {
  const n = y.length;
  const s = y.reduce((acc, v) => acc + v, 0);
  let lgY = 0;
  for (const v of y) lgY += gammaln(v + 1);
  return (
    gammaln(a + s) - gammaln(a) + a * Math.log(b) - (a + s) * Math.log(b + n) - lgY
  );
}

function weightedChoiceIndex(rng: () => number, weights: number[]): number {
  const r = rng();
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r < acc) return i;
  }
  return weights.length - 1;
}

/**
 * Single change-point in a Poisson count series.
 *
 * counts : per-period (e.g. daily) complaint counts.
 * Model: y_t ~ Poisson(lam1) for t <= tau, Poisson(lam2) for t > tau.
 * Priors: tau ~ DiscreteUniform{1..T-1}, lam_i ~ Gamma(a, b).
 *
 * The tau posterior is exact on the grid (conjugate Gamma-Poisson
 * marginals); rate posteriors are sampled by drawing tau from the grid
 * posterior then lam_i | tau, y from the conditional Gammas — identical in
 * construction to the python reference.
 */
export function poissonChangepoint(counts: number[], opts: ChangepointOptions = {}): ChangepointResult {
  const a = opts.a ?? 1.0;
  const b = opts.b ?? 0.2;
  const seed = opts.seed ?? 42;
  const nRateDraws = opts.nRateDraws ?? 20000;

  const y = counts.map((v) => Math.trunc(v));
  const T = y.length;
  if (T < 4) throw new Error("need at least 4 periods for a change-point");
  for (const v of y) {
    if (!Number.isFinite(v) || v < 0) throw new Error("counts must be non-negative finite integers");
  }

  const taus: number[] = [];
  for (let t = 1; t <= T - 1; t++) taus.push(t);

  const logPost = taus.map(
    (t) => logMarginalPoisson(y.slice(0, t), a, b) + logMarginalPoisson(y.slice(t), a, b),
  );
  const maxLp = Math.max(...logPost);
  const post = logPost.map((v) => Math.exp(v - maxLp));
  const postSum = post.reduce((s, v) => s + v, 0);
  for (let i = 0; i < post.length; i++) post[i] /= postSum;

  let mapIdx = 0;
  for (let i = 1; i < post.length; i++) if (post[i] > post[mapIdx]) mapIdx = i;
  const mapTau = taus[mapIdx];
  const meanTau = taus.reduce((s, t, i) => s + t * post[i], 0);

  const cdf: number[] = [];
  post.reduce((s, v, i) => (cdf[i] = s + v), 0);
  const searchSorted = (target: number): number => {
    let lo = 0;
    let hi = cdf.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const medianTau = taus[Math.min(searchSorted(0.5), T - 2)];
  const ciLo = taus[Math.min(searchSorted(0.025), T - 2)];
  const ciHi = taus[Math.min(searchSorted(0.975), T - 2)];

  // Draw rates conditional on tau drawn from the grid posterior.
  const rng = mulberry32(seed >>> 0);
  const lam1: number[] = new Array(nRateDraws);
  const lam2: number[] = new Array(nRateDraws);
  let lam1Sum = 0;
  let lam2Sum = 0;
  let gt = 0;
  for (let i = 0; i < nRateDraws; i++) {
    const t = taus[weightedChoiceIndex(rng, post)];
    let s1 = 0;
    for (let j = 0; j < t; j++) s1 += y[j];
    let s2 = 0;
    for (let j = t; j < T; j++) s2 += y[j];
    const l1 = gammaSample(rng, a + s1, 1 / (b + t));
    const l2 = gammaSample(rng, a + s2, 1 / (b + (T - t)));
    lam1[i] = l1;
    lam2[i] = l2;
    lam1Sum += l1;
    lam2Sum += l2;
    if (l2 > l1) gt++;
  }

  return {
    T,
    taus,
    tauPosterior: post,
    mapTau,
    meanTau,
    medianTau,
    tauHdi95Grid: [ciLo, ciHi],
    pLam2GtLam1: gt / nRateDraws,
    lam1: { mean: lam1Sum / nRateDraws, hdi95: hdi(lam1, 0.95) },
    lam2: { mean: lam2Sum / nRateDraws, hdi95: hdi(lam2, 0.95) },
    prior: { rateGammaA: a, rateGammaB: b, tau: "discrete-uniform" },
  };
}

// ─── Detector combination ────────────────────────────────────────────────────

export type SurgeMethod = "zscore" | "changepoint" | "combined";

export interface SurgeThresholds {
  zscoreThreshold: number;        // e.g. 3.0
  changepointProb: number;        // e.g. 0.95 — required P(lam2 > lam1)
}

/**
 * Decide whether the evidence constitutes a surge and by which detector(s).
 * "combined" = both detectors fire (highest confidence).
 */
export function classifySurge(
  zscore: number | null,
  pLam2GtLam1: number | null,
  thresholds: SurgeThresholds,
): { isSurge: boolean; method: SurgeMethod | null } {
  const zFire = zscore != null && zscore >= thresholds.zscoreThreshold;
  const cpFire = pLam2GtLam1 != null && pLam2GtLam1 >= thresholds.changepointProb;
  if (zFire && cpFire) return { isSurge: true, method: "combined" };
  if (zFire) return { isSurge: true, method: "zscore" };
  if (cpFire) return { isSurge: true, method: "changepoint" };
  return { isSurge: false, method: null };
}

/** Severity ladder driven by z-score magnitude (deterministic, auditable). */
export function severityForZscore(zscore: number | null): "elevated" | "high" | "critical" {
  if (zscore == null || !Number.isFinite(zscore) && zscore !== Infinity) return "elevated";
  if (zscore === Infinity || zscore >= 6) return "critical";
  if (zscore >= 4) return "high";
  return "elevated";
}
