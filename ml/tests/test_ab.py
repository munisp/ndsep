"""Tests for the A/B testing infrastructure (ml/ab_testing.py + inference).

Uses a tiny trained fraud model (2 epochs) in a tmp weights dir, mirroring
ml/tests/test_pipeline.py. Runs in well under a minute on CPU.

    pytest ml/tests/test_ab.py -v
"""

from __future__ import annotations

import json
import os
import shutil
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))  # repo root on path

from ml.data.generate_synthetic import FRAUD_FEATURES, generate  # noqa: E402


@pytest.fixture(scope="module")
def env(tmp_path_factory):
    base = tmp_path_factory.mktemp("ab")
    data_dir = str(base / "data")
    weights_dir = str(base / "weights")
    os.environ["ML_LAKEHOUSE_ROOT"] = str(base / "lakehouse")
    os.makedirs(weights_dir)
    generate(data_dir, n_transactions=400, n_orgs=60, seed=99,
             fraud_rate=0.05)
    from ml.training.train import train_fraud
    res = train_fraud(data_dir=data_dir, weights_dir=weights_dir, epochs=2)
    champion = res["version"]
    # a "challenger": fine-tuned weights saved under a new version tag
    challenger = champion + "_challenger"
    shutil.copy(os.path.join(weights_dir, "fraud_net.pt"),
                os.path.join(weights_dir, f"fraud_net_{challenger}.pt"))
    shutil.copy(os.path.join(weights_dir, "fraud_net_config.json"),
                os.path.join(weights_dir,
                             f"fraud_net_{challenger}_config.json"))
    return {"data_dir": data_dir, "weights_dir": weights_dir,
            "champion": champion, "challenger": challenger,
            "exp_path": os.path.join(weights_dir, "experiments.json"),
            "results_root": str(base / "lakehouse" / "ab_results")}


def _make_experiment(env, name="t-exp", split=0.5):
    from ml import ab_testing
    return ab_testing.create_experiment(
        name, "fraud", env["challenger"], champion_version=env["champion"],
        traffic_split=split, path=env["exp_path"])


def test_create_and_persist_experiment(env):
    exp = _make_experiment(env)
    assert exp["status"] == "running"
    assert exp["champion_version"] == env["champion"]
    from ml import ab_testing
    loaded = ab_testing.get_experiment("t-exp", path=env["exp_path"])
    assert loaded["challenger_version"] == env["challenger"]
    with pytest.raises(ValueError):
        _make_experiment(env, name="bad", split=1.5)


def test_deterministic_assignment(env):
    from ml import ab_testing
    exp = _make_experiment(env)
    v1 = ab_testing.assign_variant(exp, "subject-42")
    v2 = ab_testing.assign_variant(exp, "subject-42")
    assert v1 == v2 and v1 in ("champion", "challenger")
    # split roughly honoured over many subjects
    variants = [ab_testing.assign_variant(exp, f"s-{i}") for i in range(400)]
    frac = np.mean([v == "challenger" for v in variants])
    assert 0.35 < frac < 0.65
    # completed experiment always routes to champion
    exp["status"] = "completed"
    assert ab_testing.assign_variant(exp, "subject-42") == "champion"


def test_inference_routes_and_logs(env):
    import ml.inference as inference
    from ml import ab_testing
    _make_experiment(env, name="infer-exp")
    feats = {f: 0.0 for f in FRAUD_FEATURES}
    r = inference.score_transaction(feats, weights_dir=env["weights_dir"],
                                    experiment="infer-exp",
                                    subject_id="tx-abc")
    assert 0.0 <= r["probability"] <= 1.0
    assert r["variant"] in ("champion", "challenger")
    assert r["experiment"] == "infer-exp"
    expected_version = (env["champion"] if r["variant"] == "champion"
                        else env["challenger"])
    assert r["model_version"] == expected_version
    # same subject again -> same variant, second log line appended
    r2 = inference.score_transaction(feats, weights_dir=env["weights_dir"],
                                     experiment="infer-exp",
                                     subject_id="tx-abc")
    assert r2["variant"] == r["variant"]
    logged = ab_testing.load_results("infer-exp", root=env["results_root"])
    assert len(logged) == 2
    assert set(logged["variant"]) <= {"champion", "challenger"}
    assert (logged["latency_ms"] > 0).all()


def test_outcome_join(env):
    from ml import ab_testing
    _make_experiment(env, name="join-exp")
    root = env["results_root"]
    for i in range(10):
        ab_testing.log_result("join-exp", {
            "subject_id": f"s-{i}", "model": "fraud",
            "variant": "champion" if i % 2 else "challenger",
            "model_version": "v", "probability": 0.1 * i,
            "latency_ms": 1.0}, root=root)
    ab_testing.record_outcome("join-exp", "s-3", 1, root=root)
    labeled = ab_testing.load_labeled_results("join-exp", root=root)
    assert len(labeled) == 1
    assert labeled.iloc[0]["subject_id"] == "s-3"
    assert labeled.iloc[0]["outcome"] == 1.0


def test_evaluate_proxy_fallback(env):
    """With too few logged outcomes, evaluation falls back to the proxy
    holdout AUC (lakehouse) and does not crash."""
    from ml import ab_testing
    _make_experiment(env, name="proxy-exp")
    ev = ab_testing.evaluate("proxy-exp", path=env["exp_path"],
                             root=env["results_root"], min_samples=200,
                             weights_dir=env["weights_dir"])
    assert ev["metric"] == "proxy_holdout_auc"
    assert set(ev["variants"]) == {"champion", "challenger"}
    assert all(0.0 <= v["auc"] <= 1.0 for v in ev["variants"].values())
    # identical weights -> tie -> champion keeps the throne
    assert ev["winner"] == "champion"


def test_promote_winning_challenger(env):
    """Logged outcomes where the challenger is clearly better -> promotion
    updates experiments.json and appends a registry entry."""
    from ml import ab_testing
    from ml.registry import list_runs
    exp = _make_experiment(env, name="promote-exp")
    root = env["results_root"]
    rng = np.random.default_rng(0)
    n = 60
    for variant, good in (("champion", False), ("challenger", True)):
        for i in range(n):
            y = int(rng.random() < 0.2)
            p = (0.7 + 0.25 * rng.random()) if (y and good) else \
                (0.05 + 0.2 * rng.random()) if good else rng.random()
            sid = f"{variant}-{i}"
            ab_testing.log_result("promote-exp", {
                "subject_id": sid, "model": "fraud", "variant": variant,
                "model_version": "v", "probability": float(p),
                "latency_ms": 1.0}, root=root)
            ab_testing.record_outcome("promote-exp", sid, y, root=root)
    ev = ab_testing.evaluate("promote-exp", path=env["exp_path"], root=root,
                             min_samples=30, weights_dir=env["weights_dir"])
    assert ev["metric"] == "logged_outcome_auc"
    assert ev["winner"] == "challenger"
    assert ev["challenger_auc"] > ev["champion_auc"]

    dec = ab_testing.promote("promote-exp", path=env["exp_path"], root=root,
                             min_samples=30, weights_dir=env["weights_dir"])
    assert dec["promoted"] is True
    updated = ab_testing.get_experiment("promote-exp", path=env["exp_path"])
    assert updated["status"] == "completed"
    assert updated["champion_version"] == exp["challenger_version"]
    runs = list_runs(os.path.join(env["weights_dir"], "registry.json"))
    promo = [r for r in runs
             if r.get("data_snapshot_id") == "ab_promotion:promote-exp"]
    assert promo and promo[-1]["version"] == exp["challenger_version"]


def test_no_promotion_when_challenger_loses(env):
    from ml import ab_testing
    _make_experiment(env, name="keep-exp")
    root = env["results_root"]
    rng = np.random.default_rng(1)
    for variant, good in (("champion", True), ("challenger", False)):
        for i in range(40):
            y = int(rng.random() < 0.2)
            p = (0.7 + 0.25 * rng.random()) if (y and good) else \
                (0.05 + 0.2 * rng.random()) if good else rng.random()
            sid = f"{variant}-{i}"
            ab_testing.log_result("keep-exp", {
                "subject_id": sid, "model": "fraud", "variant": variant,
                "model_version": "v", "probability": float(p),
                "latency_ms": 1.0}, root=root)
            ab_testing.record_outcome("keep-exp", sid, y, root=root)
    dec = ab_testing.promote("keep-exp", path=env["exp_path"], root=root,
                             min_samples=30, weights_dir=env["weights_dir"])
    assert dec["promoted"] is False
    updated = ab_testing.get_experiment("keep-exp", path=env["exp_path"])
    assert updated["status"] == "running"
    assert updated["champion_version"] == env["champion"]
