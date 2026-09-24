"""Tests for the insider-threat & fraud-fusion capability (ml/insider/).

    pytest ml/tests/test_insider.py -v

Coverage:
- fusion weight sanity (sum to 1) and score bounds
- fusion determinism: same inputs -> identical register
- planted synthetic insiders rank above benign staff
- SoD matrix catches planted self-approval (issuer == approver)
- appeal SoD: original decision maker cannot review the appeal
- maker-checker: two distinct approvers required, self-approval caught
- dual-control state machine: no self-approval, distinct approvers, expiry
- dormant-account reactivation + privilege-escalation watches
- Bayesian shrinkage flag integration into the fused register
"""

from __future__ import annotations

import datetime as dt
import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))  # repo root on path

from ml.insider import features as F
from ml.insider import fusion as FU
from ml.insider import process_controls as PC

UTC = dt.timezone.utc


@pytest.fixture(scope="module")
def feature_frame() -> pd.DataFrame:
    subjects = [f"OFF-{k:06d}" for k in range(36)]
    return F.build_officer_features(db_url=None, subjects=subjects, seed=42)


@pytest.fixture(scope="module")
def ledger(feature_frame):
    return PC.synthetic_action_records(
        feature_frame["subject_id"].tolist(), seed=42)


@pytest.fixture(scope="module")
def violations(ledger):
    return PC.run_all_rules(ledger["actions"], ledger["accounts"],
                            ledger["role_changes"])


# --------------------------------------------------------------------------- #
# Fusion: weights, bounds, determinism
# --------------------------------------------------------------------------- #
def test_fusion_weights_sum_to_one():
    assert pytest.approx(sum(FU.FUSION_WEIGHTS.values()), abs=1e-9) == 1.0
    assert all(0.0 < w < 1.0 for w in FU.FUSION_WEIGHTS.values())


def test_fusion_rejects_bad_weights(feature_frame):
    bad = dict(FU.FUSION_WEIGHTS, behavioral=0.9)
    with pytest.raises(ValueError):
        FU.fuse_scores(feature_frame, [], weights=bad, use_gnn=False)


def test_fused_scores_in_unit_interval(feature_frame, violations):
    reg = FU.fuse_scores(feature_frame, violations, use_gnn=False)
    assert reg["fused_score"].between(0.0, 1.0).all()
    for comps in reg["components"]:
        assert all(0.0 <= v <= 1.0 for v in comps.values())
    assert set(reg["recommended_action"]) <= {
        "monitor", "require_dual_approval", "suspend_privileges",
        "investigate"}


def test_fusion_deterministic(feature_frame, violations):
    r1 = FU.fuse_scores(feature_frame, violations, use_gnn=False)
    r2 = FU.fuse_scores(feature_frame, violations, use_gnn=False)
    assert r1["subject_id"].tolist() == r2["subject_id"].tolist()
    assert np.array_equal(r1["fused_score"].to_numpy(),
                          r2["fused_score"].to_numpy())
    assert r1["explanation"].tolist() == r2["explanation"].tolist()


def test_proxy_gnn_deterministic(feature_frame):
    p1 = FU._proxy_scores(feature_frame)
    p2 = FU._proxy_scores(feature_frame)
    assert np.array_equal(p1, p2)
    assert np.all((p1 >= 0) & (p1 <= 1))


def test_planted_insiders_rank_high(feature_frame, violations):
    """Synthetic planted insiders must out-rank the benign population."""
    reg = FU.fuse_scores(feature_frame, violations, use_gnn=False)
    planted = set(feature_frame.loc[feature_frame["planted_insider"],
                                    "subject_id"])
    median_benign = reg.loc[~reg["subject_id"].isin(planted),
                            "fused_score"].median()
    planted_scores = reg.loc[reg["subject_id"].isin(planted), "fused_score"]
    assert (planted_scores > median_benign).all()
    # at least one planted subject lands in the top 5
    assert planted & set(reg.head(5)["subject_id"])


def test_explanations_have_top_signals(feature_frame, violations):
    reg = FU.fuse_scores(feature_frame, violations, use_gnn=False)
    for expl in reg["explanation"]:
        assert 1 <= len(expl) <= 5
        contribs = [s["contribution"] for s in expl]
        assert contribs == sorted(contribs, reverse=True)


# --------------------------------------------------------------------------- #
# Process controls: SoD matrix
# --------------------------------------------------------------------------- #
def test_sod_catches_planted_self_approval():
    actions = [
        {"action_type": "issue_penalty", "actor_id": "OFF-1",
         "scope_ref": "penalty:1"},
        {"action_type": "approve_penalty", "actor_id": "OFF-1",
         "scope_ref": "penalty:1"},
    ]
    viol = PC.check_sod_violations(actions)
    assert len(viol) == 1
    assert viol[0]["rule"] == "sod:penalty_lifecycle"
    assert viol[0]["subjects"]["actor_id"] == "OFF-1"
    assert viol[0]["evidence"]["scope_ref"] == "penalty:1"


def test_sod_clean_separation_passes():
    actions = [
        {"action_type": "issue_penalty", "actor_id": "OFF-1",
         "scope_ref": "penalty:1"},
        {"action_type": "approve_penalty", "actor_id": "OFF-2",
         "scope_ref": "penalty:1"},
        {"action_type": "record_penalty_payment", "actor_id": "OFF-3",
         "scope_ref": "penalty:1"},
    ]
    assert PC.check_sod_violations(actions) == []


def test_sod_is_scoped_per_case():
    """Same officer issuing penalty A and approving penalty B is fine."""
    actions = [
        {"action_type": "issue_penalty", "actor_id": "OFF-1",
         "scope_ref": "penalty:A"},
        {"action_type": "approve_penalty", "actor_id": "OFF-1",
         "scope_ref": "penalty:B"},
    ]
    assert PC.check_sod_violations(actions) == []


def test_appeal_reviewer_must_not_be_decision_maker():
    actions = [
        {"action_type": "decide_case", "actor_id": "OFF-9",
         "scope_ref": "case:5"},
        {"action_type": "review_appeal", "actor_id": "OFF-9",
         "scope_ref": "case:5"},
    ]
    viol = PC.check_sod_violations(actions)
    assert [v["rule"] for v in viol] == ["sod:appeals"]


# --------------------------------------------------------------------------- #
# Process controls: maker-checker + watches
# --------------------------------------------------------------------------- #
def test_maker_checker_requires_two_distinct_approvers():
    actions = [
        {"action_type": "fine_settlement", "actor_id": "OFF-1",
         "scope_ref": "s:1", "approver_ids": []},                     # none
        {"action_type": "role_grant", "actor_id": "OFF-2",
         "scope_ref": "s:2", "approver_ids": ["OFF-2", "OFF-3"]},     # self
        {"action_type": "dpco_approval", "actor_id": "OFF-3",
         "scope_ref": "s:3", "approver_ids": ["OFF-4", "OFF-4"]},     # dup
        {"action_type": "vault_sealing_override", "actor_id": "OFF-4",
         "scope_ref": "s:4", "approver_ids": ["OFF-5", "OFF-6"]},     # clean
    ]
    viol = PC.check_maker_checker(actions)
    by_scope = {v["evidence"]["scope_ref"] if "scope_ref" in v["evidence"]
                else v["subjects"]["scope_ref"]: v for v in viol}
    assert len(viol) == 3
    assert not any(v["subjects"]["scope_ref"] == "s:4" for v in viol)
    self_v = [v for v in viol if v["subjects"]["scope_ref"] == "s:2"][0]
    assert self_v["severity"] == "high"
    assert "self-approval attempt" in self_v["evidence"]["problems"]
    assert by_scope  # evidence present


def test_dormant_reactivation_watch():
    accounts = [
        {"user_id": "U1", "last_active_at": "2026-01-01T00:00:00+00:00",
         "reactivated_at": "2026-07-05T00:00:00+00:00"},   # 185 days -> flag
        {"user_id": "U2", "last_active_at": "2026-06-01T00:00:00+00:00",
         "reactivated_at": "2026-07-05T00:00:00+00:00"},   # 34 days -> ok
    ]
    viol = PC.check_dormant_reactivation(accounts)
    assert len(viol) == 1
    assert viol[0]["rule"] == "watch:dormant_reactivation"
    assert viol[0]["subjects"]["actor_id"] == "U1"
    assert viol[0]["evidence"]["dormant_days"] == 185


def test_privilege_escalation_watch():
    changes = [
        {"user_id": "U1", "old_role": "user", "new_role": "admin",
         "changed_by": "OFF-1", "approved_by": None},               # flag
        {"user_id": "U2", "old_role": "user", "new_role": "auditor",
         "changed_by": "OFF-1", "approved_by": "OFF-1"},            # self-ok? no
        {"user_id": "U3", "old_role": "user", "new_role": "admin",
         "changed_by": "OFF-1", "approved_by": "OFF-2"},            # clean
        {"user_id": "U4", "old_role": "user", "new_role": "user",
         "changed_by": "OFF-1", "approved_by": None},               # not elevated
    ]
    viol = PC.check_privilege_escalation(changes)
    assert len(viol) == 2
    assert {v["subjects"]["target_user_id"] for v in viol} == {"U1", "U2"}


def test_synthetic_ledger_plants_each_rule(violations):
    rules = {v["rule"] for v in violations}
    assert "sod:penalty_lifecycle" in rules
    assert "sod:appeals" in rules
    assert any(r.startswith("maker_checker:") for r in rules)
    assert "watch:dormant_reactivation" in rules
    assert "watch:privilege_escalation" in rules
    # exactly the planted violations — no false positives from the
    # benign background records
    assert len(violations) == 6


# --------------------------------------------------------------------------- #
# Dual-control state machine
# --------------------------------------------------------------------------- #
T0 = dt.datetime(2026, 1, 1, tzinfo=UTC)
T1 = T0 + dt.timedelta(hours=1)
T2 = T0 + dt.timedelta(hours=2)
T3 = T0 + dt.timedelta(hours=3)


def _req(ttl_hours=72.0):
    return PC.DualControlRequest(
        "fine_settlement", {"penalty_id": 1, "amount": 50000},
        requested_by="OFF-req",
        created_at=T0, ttl_hours=ttl_hours)


def test_dual_control_happy_path_two_distinct_approvers():
    r = _req()
    assert r.approve("OFF-a", now=T1) == "pending"   # one is not enough
    assert r.approve("OFF-b", now=T2) == "approved"
    assert r.decided_at is not None
    with pytest.raises(PC.DualControlError):          # already decided
        r.approve("OFF-c", now=T3)


def test_dual_control_no_self_approval():
    r = _req()
    with pytest.raises(PC.DualControlError):
        r.approve("OFF-req", now=T1)
    assert r.status == "pending"
    with pytest.raises(PC.DualControlError):
        r.reject("OFF-req", now=T1)


def test_dual_control_approver_cannot_approve_twice():
    r = _req()
    r.approve("OFF-a", now=T1)
    with pytest.raises(PC.DualControlError):
        r.approve("OFF-a", now=T2)
    assert r.status == "pending"


def test_dual_control_expiry():
    r = _req(ttl_hours=24.0)
    later = dt.datetime(2026, 1, 3, tzinfo=UTC)   # 48h > 24h TTL
    with pytest.raises(PC.DualControlError):
        r.approve("OFF-a", now=later)
    assert r.status == "expired"
    with pytest.raises(PC.DualControlError):
        r.reject("OFF-b", now=later)


def test_dual_control_reject_path():
    r = _req()
    r.approve("OFF-a", now=T1)
    assert r.reject("OFF-b", reason="suspicious amount",
                    now=T2) == "rejected"
    assert r.rejected_by == "OFF-b"
    d = r.to_dict()
    assert d["status"] == "rejected" and d["approvers"] == ["OFF-a"]


def test_dual_control_rejects_unknown_action_type():
    with pytest.raises(PC.DualControlError):
        PC.DualControlRequest("read_report", {}, requested_by="OFF-x")


def test_maker_checker_action_list_matches_matrix():
    assert set(PC.MAKER_CHECKER_ACTIONS) == {
        "fine_settlement", "dpco_approval", "role_grant",
        "vault_sealing_override"}


# --------------------------------------------------------------------------- #
# Bayesian shrinkage integration
# --------------------------------------------------------------------------- #
def test_shrinkage_flag_integration():
    """A subject with an extreme event rate must be shrinkage-flagged and
    carry a high bayesian_rate component in the fused register."""
    n = 40  # large benign population so the EB prior stays tight enough
    rows = []
    for k in range(n):
        rows.append({"subject_id": f"OFF-{k:06d}", "subject_type": "officer",
                     "risk_event_count": 2, "exposure_days": 30.0,
                     **{f: 0.1 for f in F.INSIDER_FEATURES}})
    rows.append({"subject_id": "OFF-EXTREME", "subject_type": "officer",
                 "risk_event_count": 200, "exposure_days": 30.0,
                 **{f: 0.1 for f in F.INSIDER_FEATURES}})
    df = pd.DataFrame(rows)
    reg = FU.fuse_scores(df, [], use_gnn=False)
    extreme = reg.loc[reg["subject_id"] == "OFF-EXTREME"].iloc[0]
    assert extreme["bayesian_flagged"]
    assert extreme["components"]["bayesian_rate"] == 1.0  # clipped at bound
    # benign subjects are not flagged
    assert not reg.loc[reg["subject_id"] != "OFF-EXTREME",
                       "bayesian_flagged"].any()


def test_bayesian_scores_match_shrinkage_model():
    counts = np.array([2, 3, 2, 1, 2] * 8 + [200], dtype=float)
    exposures = np.full(len(counts), 30.0)
    df = pd.DataFrame({"risk_event_count": counts,
                       "exposure_days": exposures})
    scores, flagged, pop = FU.bayesian_scores(df)
    from ml.bayesian.models import gamma_poisson_shrinkage
    ref = gamma_poisson_shrinkage(counts, exposures)
    assert flagged[-1] and not flagged[:-1].any()
    assert scores[-1] == 1.0
    assert pop["bound_99pct"] == pytest.approx(
        ref["population"]["bound_99pct"])


# --------------------------------------------------------------------------- #
# Feature extraction
# --------------------------------------------------------------------------- #
def test_feature_frame_schema_and_determinism():
    subjects = [f"OFF-{k:06d}" for k in range(12)]
    d1 = F.build_officer_features(db_url=None, subjects=subjects, seed=7)
    d2 = F.build_officer_features(db_url=None, subjects=subjects, seed=7)
    pd.testing.assert_frame_equal(d1, d2)
    for col in F.INSIDER_FEATURES + ["risk_event_count", "exposure_days",
                                     "subject_id", "source"]:
        assert col in d1.columns
    assert (d1["source"] == "synthetic").all()
    assert d1["planted_insider"].sum() >= 2  # planted insiders exist


def test_process_scores_severity_weighting():
    df = pd.DataFrame({"subject_id": ["A", "B", "C"]})
    viols = [
        {"severity": "high", "subjects": {"actor_id": "A"}},
        {"severity": "medium", "subjects": {"actor_id": "A"}},
        {"severity": "low", "subjects": {"actor_id": "B"}},
    ]
    s = FU.process_scores(df, viols)
    assert s[0] == pytest.approx(min(1.0, 0.7 + 0.4))
    assert s[1] == pytest.approx(0.2)
    assert s[2] == 0.0
