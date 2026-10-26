"""Tests for ml/lakehouse/ab_outcomes_producer.py — A/B ground-truth producer.

Covers the prediction/verdict join and the end-to-end production of
*_outcomes.jsonl rows in exactly the format ab_testing.load_labeled_results
consumes. DB access and the experiments file are tmp/mocked — no Postgres,
no trained weights required.

    pytest ml/tests/test_ab_outcomes_producer.py -v
"""

from __future__ import annotations

import json
import os
import sys

import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))  # repo root on path

from ml import ab_testing  # noqa: E402
from ml.lakehouse import ab_outcomes_producer as prod  # noqa: E402
from ml.training import lakehouse  # noqa: E402


def _verdicts(*rows):
    return pd.DataFrame(rows, columns=["subject_id", "verdict_status",
                                       "verdict_updated_at", "outcome"])


# --------------------------------------------------------------------------- #
# Join
# --------------------------------------------------------------------------- #
def test_join_outcomes():
    preds = pd.DataFrame({"subject_id": ["TX-1", "TX-2", "TX-3", "TX-3"]})
    verdicts = _verdicts(
        ("TX-1", "confirmed_fraud", "2026-01-02", 1.0),
        # re-resolved: latest verdict (false_positive) must win
        ("TX-3", "confirmed_fraud", "2026-01-02", 1.0),
        ("TX-3", "false_positive", "2026-01-05", 0.0),
        # verdict for a subject never scored in this experiment: dropped
        ("TX-9", "confirmed_fraud", "2026-01-03", 1.0),
    )
    joined = prod.join_outcomes(preds, verdicts)
    assert set(joined.columns) == {"subject_id", "outcome"}
    assert dict(zip(joined["subject_id"], joined["outcome"])) == \
        {"TX-1": 1.0, "TX-3": 0.0}
    # empty inputs never crash
    assert prod.join_outcomes(pd.DataFrame(), verdicts).empty
    assert prod.join_outcomes(preds, pd.DataFrame()).empty
    assert prod.join_outcomes(None, None).empty


# --------------------------------------------------------------------------- #
# End-to-end production
# --------------------------------------------------------------------------- #
@pytest.fixture
def env(tmp_path, monkeypatch):
    results_root = str(tmp_path / "ab_results")
    lh_root = str(tmp_path / "lakehouse")
    exp_path = str(tmp_path / "experiments.json")
    ab_testing.create_experiment(
        "fraud-rollout", "fraud", champion_version="v1",
        challenger_version="v2", traffic_split=0.5, path=exp_path)
    ab_testing.create_experiment(
        "fraud-done", "fraud", champion_version="v1",
        challenger_version="v2", traffic_split=0.5, path=exp_path)
    # mark the second experiment completed — producer must skip it
    data = ab_testing.load_experiments(exp_path)
    for e in data["experiments"]:
        if e["name"] == "fraud-done":
            e["status"] = "completed"
    ab_testing.save_experiments(data, exp_path)
    # logged predictions
    for i in range(4):
        ab_testing.log_result("fraud-rollout", {
            "subject_id": f"TX-{i}", "model": "fraud",
            "variant": "champion" if i % 2 else "challenger",
            "model_version": "v1", "probability": 0.1 * i,
            "latency_ms": 1.0}, root=results_root)
    ab_testing.log_result("fraud-done", {
        "subject_id": "TX-0", "model": "fraud", "variant": "champion",
        "model_version": "v1", "probability": 0.5, "latency_ms": 1.0},
        root=results_root)
    return {"results_root": results_root, "lh_root": lh_root,
            "exp_path": exp_path}


def test_produce_outcomes_writes_exact_format(env, monkeypatch):
    batch = pd.DataFrame([
        {"subject_id": "TX-1", "verdict_status": "confirmed_fraud",
         "verdict_updated_at": "2026-02-01 10:00:00", "outcome": 1.0},
        {"subject_id": "TX-3", "verdict_status": "false_positive",
         "verdict_updated_at": "2026-02-02 10:00:00", "outcome": 0.0},
        {"subject_id": "TX-404", "verdict_status": "confirmed_fraud",
         "verdict_updated_at": "2026-02-03 10:00:00", "outcome": 1.0},
    ])
    monkeypatch.setattr(prod, "fetch_verdict_outcomes", lambda since: batch)

    summary = prod.produce_experiment_outcomes(
        experiments_path=env["exp_path"], results_root=env["results_root"],
        lakehouse_root=env["lh_root"])
    # TX-404 was never scored -> dropped; TX-0 belongs to the completed
    # experiment -> no outcomes for it
    assert summary["experiments"] == {"fraud-rollout": 2}
    assert summary["outcomes_written"] == 2

    # exact format the promotion logic reads
    opath = os.path.join(env["results_root"], "fraud-rollout_outcomes.jsonl")
    with open(opath) as f:
        rows = [json.loads(l) for l in f]
    assert all(set(r) == {"ts", "subject_id", "outcome"} for r in rows)
    assert {r["subject_id"]: r["outcome"]
            for r in rows} == {"TX-1": 1.0, "TX-3": 0.0}

    # ab_testing's own loader consumes them
    labeled = ab_testing.load_labeled_results("fraud-rollout",
                                              root=env["results_root"])
    assert len(labeled) == 2
    assert set(labeled["outcome"]) == {0.0, 1.0}

    # watermark advanced to the max verdict timestamp
    wm = lakehouse.load_watermark(prod.WATERMARK, root=env["lh_root"])
    assert wm is not None and "2026-02-03" in wm

    # completed experiment got NO outcomes file
    assert not os.path.exists(os.path.join(env["results_root"],
                                           "fraud-done_outcomes.jsonl"))


def test_produce_outcomes_no_new_verdicts(env, monkeypatch):
    monkeypatch.setattr(prod, "fetch_verdict_outcomes",
                        lambda since: pd.DataFrame(
                            columns=["subject_id", "verdict_status",
                                     "verdict_updated_at", "outcome"]))
    summary = prod.produce_experiment_outcomes(
        experiments_path=env["exp_path"], results_root=env["results_root"],
        lakehouse_root=env["lh_root"])
    assert summary["verdicts_fetched"] == 0
    assert lakehouse.load_watermark(prod.WATERMARK,
                                    root=env["lh_root"]) is None


def test_produce_outcomes_db_down_returns_none(env, monkeypatch):
    monkeypatch.setattr(prod, "fetch_verdict_outcomes", lambda since: None)
    assert prod.produce_experiment_outcomes(
        experiments_path=env["exp_path"], results_root=env["results_root"],
        lakehouse_root=env["lh_root"]) is None
