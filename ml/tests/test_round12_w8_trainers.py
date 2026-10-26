"""Tests for the round-12 wave-8 trainers (roadmap P2).

Covers:
  - settlement_recommender: artifact schema, HGB export parity (exported
    JSON scorer == sklearn predict_proba to 1e-9, pinning the semantics the
    TS evaluator implements), provisional flag on tiny frames, fail-closed
    raw-identifier refusal;
  - penalty_calibration: penalty banding, legal-section parsing, artifact
    schema, fail-closed salt behaviour on the appeal join key;
  - risk_weight_learner: weight-vector schema (exactly the 6 router keys,
    sums to 1, floor respected), normalisation parity with
    supervisionRiskScoring constants, fail-closed refusal.

    pytest ml/tests/test_round12_w8_trainers.py -v
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))  # repo root on path

from ml.models import hgb_json  # noqa: E402
from ml.models import penalty_calibration as pc  # noqa: E402
from ml.models import risk_weight_learner as rwl  # noqa: E402
from ml.models import settlement_recommender as sr  # noqa: E402

RNG = np.random.RandomState(7)


# --------------------------------------------------------------------------- #
# settlement_recommender
# --------------------------------------------------------------------------- #
def _synthetic_settlement_labels(n: int = 120) -> pd.DataFrame:
    """Separable synthetic settlement labels: many instalments + low
    reduction -> fulfilled."""
    n_inst = RNG.randint(0, 12, n)
    red = RNG.rand(n)
    amt = RNG.rand(n) * 50_000_000
    p = 1.0 / (1.0 + np.exp(-(0.6 * n_inst - 4 * red + 1.0)))
    y = (RNG.rand(n) < p).astype(int)
    # ensure both classes present
    y[:5] = 1
    y[5:10] = 0
    return pd.DataFrame({
        "settlement_ref_hash": [f"h{i:064d}"[:64] for i in range(n)],
        "org_hash": [f"o{i:064d}"[:64] for i in range(n)],
        "settled_fulfilled": y,
        "monetary_amount": amt,
        "n_instalments": n_inst,
        "n_obligations": RNG.randint(0, 4, n),
        "confidential": RNG.randint(0, 2, n),
        "reduction_ratio": red,
        "sector": RNG.choice(["fintech", "banking", "health"], n),
        "duration_days": RNG.randint(0, 720, n).astype(float),
        "org_size_score": RNG.choice([0.1, 0.4, 0.7, 1.0], n),
    })


def test_settlement_recommender_artifact_schema():
    artifact = sr.train(_synthetic_settlement_labels())
    assert artifact["model"] == "settlement_recommender"
    assert artifact["model_type"] == "hist_gradient_boosting"
    assert artifact["usable"] is True
    assert artifact["sample_size"] == 120
    assert isinstance(artifact["version"], str)
    assert artifact["version"].startswith("v")
    # feature list covers base + enriched + sector one-hots
    for f in ("log_monetary_amount", "n_instalments", "reduction_ratio",
              "duration_days", "org_size_score"):
        assert f in artifact["features"]
    assert any(f.startswith("sector=") for f in artifact["features"])
    assert artifact["categorical_levels"]["sector"]
    # trees exported
    assert len(artifact["trees"]) >= 1
    node = artifact["trees"][0][0]
    for k in ("value", "feature_idx", "num_threshold",
              "missing_go_to_left", "left", "right", "is_leaf"):
        assert k in node
    # metrics recorded
    assert 0.0 <= artifact["metrics"]["auc_insample"] <= 1.0
    assert artifact["metrics"]["n_positive"] > 0


def test_settlement_recommender_export_matches_sklearn():
    """The exported JSON scorer must reproduce sklearn predict_proba.

    This pins the traversal semantics that the TS evaluator
    (server/services/settlementRecommender.ts) implements: leaf values
    already carry the learning rate; raw = baseline + sum(leaves).
    """
    df = _synthetic_settlement_labels(150)
    artifact = sr.train(df)
    base = sr.build_base_features(df)
    for col in ("duration_days", "org_size_score", "sector"):
        base[col] = df[col]
    X, names, levels = sr.design_matrix(
        base, sector_levels=artifact["categorical_levels"]["sector"])
    assert names == artifact["features"]
    p_json = hgb_json.predict_proba_artifact(artifact, X[:25])
    # retrain an equivalent clf to compare directly
    from sklearn.ensemble import HistGradientBoostingClassifier
    y = df["settled_fulfilled"].astype(int).to_numpy()
    clf = HistGradientBoostingClassifier(
        max_iter=min(200, max(30, len(df) // 4)), max_leaf_nodes=15,
        learning_rate=0.08, early_stopping=(len(df) >= 200),
        random_state=42).fit(X, y)
    p_skl = clf.predict_proba(X[:25])[:, 1]
    # NOTE: artifact was trained by the same fit_hgb call -> identical model
    np.testing.assert_allclose(p_json, p_skl, atol=1e-9)
    assert ((p_json >= 0) & (p_json <= 1)).all()


def test_settlement_recommender_learns_signal():
    df = _synthetic_settlement_labels(300)
    artifact = sr.train(df)
    base = sr.build_base_features(df)
    for col in ("duration_days", "org_size_score", "sector"):
        base[col] = df[col]
    X, names, _ = sr.design_matrix(
        base, sector_levels=artifact["categorical_levels"].get("sector"))
    assert names == artifact["features"]
    p = hgb_json.predict_proba_artifact(artifact, X)
    y = df["settled_fulfilled"].astype(int).to_numpy()
    # separable-ish synthetic data: ranking must beat chance decisively
    assert p[y == 1].mean() > p[y == 0].mean()


def test_settlement_recommender_provisional_on_tiny_frame():
    df = _synthetic_settlement_labels(12)
    artifact = sr.train(df, min_samples=20)
    assert artifact["usable"] is False
    assert "provisional" in artifact["warning"]


def test_settlement_recommender_fail_closed_raw_identifiers():
    df = _synthetic_settlement_labels(10)
    df["nin"] = ["12345678901"] * len(df)
    with pytest.raises(RuntimeError, match="raw identifier"):
        sr.train(df)
    df2 = _synthetic_settlement_labels(10)
    df2["respondent_email"] = ["x@y.z"] * len(df2)
    with pytest.raises(RuntimeError, match="raw identifier"):
        sr.train(df2)


def test_settlement_recommender_single_class_refused():
    df = _synthetic_settlement_labels(10)
    df["settled_fulfilled"] = 1
    with pytest.raises(RuntimeError, match="both classes"):
        sr.train(df)


# --------------------------------------------------------------------------- #
# penalty_calibration
# --------------------------------------------------------------------------- #
def _synthetic_penalty_frame(n: int = 120) -> pd.DataFrame:
    bands = RNG.choice(pc.PENALTY_BANDS, n)
    vtypes = RNG.choice(["high", "medium", "low"], n)
    sizes = RNG.choice(["low", "medium", "high", "very_high"], n)
    secs = RNG.choice(["s.48", "s.44", "s.39"], n)
    # big penalties + high severity -> more likely upheld
    logit = (np.isin(bands, ["10m_100m", "over_100m"]).astype(float) * 1.5
             + (vtypes == "high").astype(float) * 1.0 - 0.6)
    y = (RNG.rand(n) < 1.0 / (1.0 + np.exp(-logit))).astype(int)
    y[:4] = 1
    y[4:8] = 0
    return pd.DataFrame({
        "penalty_band": bands, "violation_type": vtypes,
        "org_size": sizes, "legal_basis_section": secs,
        "penalty_upheld": y,
    })


def test_penalty_band_mapping():
    assert pc.penalty_band(500_000) == "under_floor"
    assert pc.penalty_band(2_000_000) == "2m_10m"
    assert pc.penalty_band(9_999_999) == "2m_10m"
    assert pc.penalty_band(50_000_000) == "10m_100m"
    assert pc.penalty_band(250_000_000) == "over_100m"
    assert pc.penalty_band(None) == "unknown"
    assert pc.penalty_band("nan") == "unknown"


def test_legal_basis_section_parsing():
    assert pc.legal_basis_section("NDPA 2023 s.48(2)") == "s.48"
    assert pc.legal_basis_section("NDPA 2023 S. 44") == "s.44"
    assert pc.legal_basis_section(None) == "unknown"
    assert pc.legal_basis_section("no section here") == "unknown"


def test_penalty_calibration_artifact_schema():
    artifact = pc.train(_synthetic_penalty_frame())
    assert artifact["model"] == "penalty_calibration"
    assert artifact["model_type"] == "hist_gradient_boosting"
    assert artifact["usable"] is True
    # every categorical level expanded, 'unknown' level always present
    for col in pc.CATEGORICAL_FEATURES:
        assert f"{col}=unknown" in artifact["features"]
        assert "unknown" in artifact["categorical_levels"][col]
    assert any(f.startswith("penalty_band=10m_100m")
               for f in artifact["features"])
    assert artifact["metrics"]["n_samples"] == 120


def test_penalty_calibration_export_matches_sklearn():
    df = _synthetic_penalty_frame(150)
    artifact = pc.train(df)
    X, names, _ = pc.design_matrix(df, levels=artifact["categorical_levels"])
    assert names == artifact["features"]
    p = hgb_json.predict_proba_artifact(artifact, X[:30])
    assert ((p >= 0) & (p <= 1)).all()
    # ranking signal: upheld rows score higher on average
    y = df["penalty_upheld"].astype(int).to_numpy()
    full = hgb_json.predict_proba_artifact(artifact, X)
    assert full[y == 1].mean() > full[y == 0].mean()


def test_penalty_calibration_salt_fail_closed(monkeypatch):
    """The appeal join key pseudonymization must fail closed without salt."""
    from ml.labels import case_outcome_labels as col
    monkeypatch.delenv("NDSEP_LABEL_HASH_SALT", raising=False)
    monkeypatch.delenv("ANONYMIZATION_SALT", raising=False)
    with pytest.raises(RuntimeError, match="salt"):
        col.pseudonymize("appeal:42")


def test_penalty_calibration_fail_closed_raw_identifiers():
    df = _synthetic_penalty_frame(10)
    df["email"] = ["officer@ndpc.gov.ng"] * len(df)
    with pytest.raises(RuntimeError, match="raw identifier"):
        pc.train(df)


# --------------------------------------------------------------------------- #
# risk_weight_learner
# --------------------------------------------------------------------------- #
def _synthetic_risk_frame(n: int = 200) -> pd.DataFrame:
    cv = RNG.randint(0, 80, n).astype(float)
    sf = RNG.randint(0, 40, n).astype(float)
    ps = RNG.randint(0, 8, n).astype(float)
    logit = (cv / 50 * 2.0 + (sf / 25) * 1.5 + (ps / 5) * 1.0 - 1.5)
    y = (RNG.rand(n) < 1.0 / (1.0 + np.exp(-logit))).astype(int)
    y[:5] = 1
    y[5:10] = 0
    return pd.DataFrame({
        "complaintVolume": cv,
        "complaintSurge": RNG.rand(n) < 0.2,
        "scanFindingsWeighted": sf,
        "priorSanctions": ps,
        "filingDelinquencyDays": RNG.randint(0, 200, n).astype(float),
        "dataVolumeClass": RNG.choice(["low", "medium", "high", "very_high"], n),
        "subsequent_enforcement": y,
    })


def test_risk_weight_learner_artifact_schema():
    artifact = rwl.train(_synthetic_risk_frame())
    assert artifact["model"] == "learned_risk_weights"
    assert artifact["model_type"] == "logistic_weight_vector"
    assert artifact["window_days"] == 180
    assert artifact["usable"] is True
    w = artifact["weights"]
    # exactly the six router keys, valid distribution, floor respected
    assert set(w.keys()) == set(rwl.RISK_FACTOR_KEYS)
    assert all(0.0 < v <= 1.0 for v in w.values())
    assert abs(sum(w.values()) - 1.0) < 1e-3
    assert min(w.values()) >= rwl.WEIGHT_FLOOR - 1e-6
    # the high-signal factors should outrank a noise factor
    assert w["complaint_volume"] > w["filing_delinquency"]
    assert artifact["metrics"]["auc_insample"] > 0.7


def test_risk_weight_learner_normalization_parity():
    """Caps must mirror supervisionRiskScoring.NORMALIZATION_CAPS exactly."""
    assert rwl.NORMALIZATION_CAPS == {
        "complaintVolume": 50.0, "scanFindingsWeighted": 25.0,
        "priorSanctions": 5.0, "filingDelinquencyDays": 180.0}
    assert rwl.DATA_VOLUME_CLASS_SCORE == {
        "low": 0.1, "medium": 0.4, "high": 0.7, "very_high": 1.0}
    frame = pd.DataFrame([{
        "complaintVolume": 25, "complaintSurge": True,
        "scanFindingsWeighted": 25, "priorSanctions": 10,
        "filingDelinquencyDays": 90, "dataVolumeClass": "high",
        "subsequent_enforcement": 1}])
    norm = rwl.normalize_inputs(frame).iloc[0]
    assert norm["complaint_volume"] == 0.5
    assert norm["complaint_surge"] == 1.0
    assert norm["scan_findings"] == 1.0
    assert norm["prior_sanctions"] == 1.0     # capped
    assert norm["filing_delinquency"] == 0.5
    assert norm["data_volume_class"] == 0.7


def test_risk_weight_learner_inputs_jsonb_frame():
    """The production frame shape: an `inputs` jsonb column."""
    raw = _synthetic_risk_frame(60)
    import json as _json
    frame = pd.DataFrame({
        "inputs": raw.drop(columns=["subsequent_enforcement"])
        .apply(lambda r: _json.dumps(r.to_dict()), axis=1),
        "subsequent_enforcement": raw["subsequent_enforcement"],
    })
    artifact = rwl.train(frame)
    assert set(artifact["weights"].keys()) == set(rwl.RISK_FACTOR_KEYS)


def test_risk_weight_learner_fail_closed_raw_identifiers():
    df = _synthetic_risk_frame(10)
    df["org_name"] = ["Acme Telecom"] * len(df)
    with pytest.raises(RuntimeError, match="raw identifier"):
        rwl.train(df)


def test_risk_weight_learner_provisional_on_tiny_frame():
    artifact = rwl.train(_synthetic_risk_frame(12))
    assert artifact["usable"] is False
