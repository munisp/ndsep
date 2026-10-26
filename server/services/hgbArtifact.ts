/**
 * HGB JSON artifact loader + pure-TS scorer (round 12, wave 8 — roadmap P2).
 *
 * The wave-8 trainers (ml/models/settlement_recommender.py,
 * ml/models/penalty_calibration.py) fit sklearn HistGradientBoostingClassifier
 * and export the ensemble to JSON under ml/weights/ (see
 * ml/models/hgb_json.py for the schema). Following the platform convention
 * (pure TS, no Python runtime call — complaintSurgeMath.ts), this module
 * reimplements scoring exactly:
 *
 *   raw = baseline + SUM over trees of leaf_value(row)   // leaf values
 *        already carry the learning rate — do NOT multiply again (pinned by
 *        ml/tests/test_round12_w8_trainers.py export-parity tests)
 *   p   = sigmoid(raw)
 *   traversal: left iff row[feature_idx] <= num_threshold
 *              (NaN -> missing_go_to_left), else right
 *
 * Fail-closed: a missing/corrupt artifact returns null from loadArtifact —
 * callers degrade explicitly (degraded badge) rather than fabricate a score.
 */
import fs from "fs";
import path from "path";
import { logger } from "../logger";

export interface HgbNode {
  value: number;
  count: number;
  feature_idx: number;
  num_threshold: number;
  missing_go_to_left: boolean;
  left: number;
  right: number;
  is_leaf: boolean;
}

export interface HgbArtifact {
  model: string;
  model_type: string;
  version: string;
  trained_at: string;
  features: string[];
  categorical_levels: Record<string, string[]>;
  baseline: number;
  trees: HgbNode[][];
  metrics: Record<string, unknown>;
  sample_size: number;
  usable?: boolean;
  warning?: string;
}

export function weightsDir(): string {
  return (
    process.env.NDSEP_ML_WEIGHTS_DIR ||
    path.resolve(__dirname, "..", "..", "ml", "weights")
  );
}

/** mtime-keyed cache so scoring doesn't re-read disk per request. */
const cache = new Map<string, { mtimeMs: number; artifact: HgbArtifact }>();

export function loadArtifact(artifactName: string): HgbArtifact | null {
  const file = path.join(weightsDir(), artifactName);
  try {
    const stat = fs.statSync(file);
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === stat.mtimeMs) return hit.artifact;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as HgbArtifact;
    if (parsed.model_type !== "hist_gradient_boosting" || !Array.isArray(parsed.trees)) {
      logger.warn({ file }, "[hgbArtifact] artifact is not an HGB export");
      return null;
    }
    cache.set(file, { mtimeMs: stat.mtimeMs, artifact: parsed });
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn({ err: err instanceof Error ? err.message : String(err), file },
        "[hgbArtifact] artifact load failed");
    }
    return null;
  }
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function traverse(nodes: HgbNode[], row: number[]): number {
  let idx = 0;
  // Defensive bound: a corrupt artifact must never loop forever.
  for (let hops = 0; hops < nodes.length + 1; hops++) {
    const n = nodes[idx];
    if (!n) return 0;
    if (n.is_leaf) return n.value;
    const v = row[n.feature_idx];
    if (v == null || Number.isNaN(v)) {
      idx = n.missing_go_to_left ? n.left : n.right;
    } else {
      idx = v <= n.num_threshold ? n.left : n.right;
    }
  }
  return 0;
}

/**
 * Score one feature row against an exported artifact. `values` maps the
 * artifact's feature names to numbers; names absent from the map score 0
 * (one-hot columns of unseen levels are naturally 0).
 */
export function predictProba(
  artifact: HgbArtifact,
  values: Record<string, number>,
): number {
  const row = artifact.features.map((f) => {
    const v = values[f];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  });
  let raw = artifact.baseline;
  for (const nodes of artifact.trees) raw += traverse(nodes, row);
  return sigmoid(raw);
}

/** Clear the artifact cache (tests). */
export function _resetArtifactCache(): void {
  cache.clear();
}
