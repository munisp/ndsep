#!/usr/bin/env python3
"""A/B outcomes producer (round 12, wave 5 — roadmap §4.5).

ml/ab_testing.py's promotion logic compares champion vs challenger on
LOGGED GROUND TRUTH in <experiment>_outcomes.jsonl — but nothing produced
those files. This job closes the loop: it joins scored fraud predictions
(monitoring inference_log / experiment result logs, keyed by subject_id =
the transaction reference passed at scoring time) with SUBSEQUENT human
verdicts on fraud_alerts (officer dispositions), and appends outcome rows
in exactly the format ab_testing.load_labeled_results() reads:

    {"ts": <iso8601>, "subject_id": <str>, "outcome": 0.0|1.0}

Incrementality: watermarked on fraud_alerts.updated_at (lakehouse watermark
'ab_outcomes_fraud'); re-runs only process newly-resolved/re-resolved
alerts. ab_testing.load_labeled_results() already dedupes outcomes per
subject_id (latest wins), so a re-resolution simply appends a newer row.

Called from ml.training.continuous at the start of each cycle (fail-open:
a DB hiccup must never block training), or standalone:

    python -m ml.lakehouse.ab_outcomes_producer
    python -m ml.lakehouse.ab_outcomes_producer --experiment fraud-ft-rollout
"""

from __future__ import annotations

import argparse
import json
import os

import pandas as pd

from ml.training import lakehouse

WATERMARK = "ab_outcomes_fraud"

VERDICT_QUERY = """
    SELECT a.transaction_ref AS subject_id,
           a.status          AS verdict_status,
           a.updated_at      AS verdict_updated_at
    FROM fraud_alerts a
    WHERE a.status IN ('confirmed_fraud', 'false_positive')
      AND a.transaction_ref IS NOT NULL
      AND (%s::timestamptz IS NULL OR a.updated_at > %s::timestamptz)
    ORDER BY a.updated_at
    LIMIT 100000
"""


def _db_connect():
    dsn = (os.environ.get("DATABASE_URL") or os.environ.get("WORKER_DATABASE_URL"))
    if not dsn:
        return None
    import psycopg2
    return psycopg2.connect(dsn, connect_timeout=3)


def fetch_verdict_outcomes(since: str | None) -> pd.DataFrame | None:
    """New verdict rows (subject_id, outcome, updated_at); None on DB failure."""
    from ml.validation.verdict_ingest import verdict_label
    try:
        conn = _db_connect()
        if conn is None:
            print("[ab_outcomes] DATABASE_URL not set — nothing to produce")
            return None
        try:
            with conn.cursor() as cur:
                cur.execute(VERDICT_QUERY, (since, since))
                rows = cur.fetchall()
                cols = [d[0] for d in cur.description]
        finally:
            conn.close()
    except Exception as e:
        print(f"[ab_outcomes] verdict fetch failed ({e})")
        return None
    df = pd.DataFrame(rows, columns=cols)
    if not len(df):
        return df
    df["subject_id"] = df["subject_id"].astype(str)
    df["outcome"] = df["verdict_status"].map(verdict_label).astype(float)
    return df


def join_outcomes(predictions: pd.DataFrame,
                  verdicts: pd.DataFrame) -> pd.DataFrame:
    """Join logged predictions with verdicts on subject_id.

    Latest verdict per subject wins. Returns rows {subject_id, outcome}
    for subjects that have BOTH a logged prediction and a verdict.
    """
    if predictions is None or not len(predictions) \
            or verdicts is None or not len(verdicts):
        return pd.DataFrame(columns=["subject_id", "outcome"])
    preds = predictions.copy()
    preds["subject_id"] = preds["subject_id"].astype(str)
    outs = verdicts.copy()
    outs["subject_id"] = outs["subject_id"].astype(str)
    if "verdict_updated_at" in outs.columns:
        outs = (outs.sort_values("verdict_updated_at")
                    .drop_duplicates("subject_id", keep="last"))
    joined = preds[["subject_id"]].drop_duplicates().merge(
        outs[["subject_id", "outcome"]], on="subject_id", how="inner")
    return joined.reset_index(drop=True)


def produce_experiment_outcomes(
        experiment: str | None = None,
        experiments_path: str | None = None,
        results_root: str | None = None,
        lakehouse_root: str = lakehouse.DEFAULT_ROOT) -> dict | None:
    """Append verdict outcomes to every running fraud experiment (or one).

    The watermark advances ONLY after all outcome rows are written, so a
    failed run re-reads the same verdicts next time. Returns a summary dict,
    or None when verdicts could not be fetched.
    """
    from ml import ab_testing
    path = experiments_path or ab_testing.EXPERIMENTS_PATH
    root = results_root or ab_testing.AB_RESULTS_DIR

    wm = lakehouse.load_watermark(WATERMARK, root=lakehouse_root)
    verdicts = fetch_verdict_outcomes(wm)
    if verdicts is None:
        return None
    summary = {"watermark_before": wm, "verdicts_fetched": int(len(verdicts)),
               "experiments": {}}
    if not len(verdicts):
        print(f"[ab_outcomes] no new verdicts since {wm}")
        return summary
    new_wm = str(pd.to_datetime(verdicts["verdict_updated_at"]).max())

    exps = ab_testing.load_experiments(path)["experiments"]
    targets = [e for e in exps
               if e.get("model") == "fraud" and e.get("status") == "running"
               and (experiment is None or e["name"] == experiment)]
    total_written = 0
    for exp in targets:
        results = ab_testing.load_results(exp["name"], root=root)
        joined = join_outcomes(results, verdicts)
        for _, row in joined.iterrows():
            ab_testing.record_outcome(exp["name"], row["subject_id"],
                                      row["outcome"], root=root)
        summary["experiments"][exp["name"]] = int(len(joined))
        total_written += len(joined)
        print(f"[ab_outcomes] {exp['name']}: +{len(joined)} outcome rows")
    summary["outcomes_written"] = int(total_written)
    summary["watermark_after"] = new_wm
    lakehouse.save_watermark(WATERMARK, new_wm, root=lakehouse_root)
    print(f"[ab_outcomes] {total_written} outcomes written; "
          f"watermark -> {new_wm}")
    return summary


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--experiment", default=None,
                    help="only produce outcomes for this experiment")
    args = ap.parse_args()
    summary = produce_experiment_outcomes(experiment=args.experiment)
    if summary is not None:
        print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
