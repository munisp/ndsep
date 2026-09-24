"""Codified (non-ML) insider-threat process controls for NDSEP.

These rules encode *policy*, not learned behavior — they fire regardless
of what any model thinks:

  1. Segregation-of-duties (SoD) matrix — conflicting steps of one
     business process must be performed by different actors:
       * penalty lifecycle: issuer != approver != payment recorder
       * appeals: reviewer != original decision maker
       * DPCO accreditation: reviewer != applicant-affiliated officer
  2. Maker-checker — sensitive actions (fine settlement, DPCO approval,
     role grants, vault sealing overrides) require TWO distinct approvers,
     neither of whom is the requester.
  3. Dormant-account reactivation watch — an account inactive for more
     than DORMANCY_THRESHOLD_DAYS that authenticates again is flagged.
  4. Privilege-escalation watch — grants of elevated roles without a
     distinct second approver are flagged.

Every rule is a pure function over platform data (list-of-dict records)
returning violations with evidence references. No timestamps are invented
inside the rules: ``detected_at`` is only set by callers that persist.

The module also hosts :class:`DualControlRequest`, the maker-checker
state machine mirrored by server/routers/insiderThreat.ts — keeping the
rules in one place lets the Python detector and the tRPC router share a
single, testable definition of "two distinct approvers, no self-approval,
expiry".
"""

from __future__ import annotations

import datetime as _dt
from typing import Iterable, Optional

# --------------------------------------------------------------------------- #
# Policy constants
# --------------------------------------------------------------------------- #
SOD_MATRIX = [
    {
        "process": "penalty_lifecycle",
        "description": "Penalty issuer, approver and payment recorder must "
                       "be three different officers for the same penalty.",
        "scope": "penalty",
        "steps": [
            {"role": "penalty_issuer",
             "action_types": ["issue_penalty", "create_financial_penalty"]},
            {"role": "penalty_approver",
             "action_types": ["approve_penalty", "confirm_penalty"]},
            {"role": "payment_recorder",
             "action_types": ["record_penalty_payment", "settle_fine"]},
        ],
    },
    {
        "process": "appeals",
        "description": "An appeal must be reviewed by someone other than "
                       "the original decision maker.",
        "scope": "case",
        "steps": [
            {"role": "original_decision_maker",
             "action_types": ["issue_penalty", "decide_case",
                              "reject_dsar", "deny_request"]},
            {"role": "appeal_reviewer",
             "action_types": ["review_appeal", "decide_appeal"]},
        ],
    },
    {
        "process": "dpco_accreditation",
        "description": "DPCO accreditation reviewer must not be affiliated "
                       "with the applicant organisation.",
        "scope": "application",
        "steps": [
            {"role": "applicant_affiliate",
             "action_types": ["submit_dpco_application",
                              "upload_dpco_evidence"]},
            {"role": "accreditation_reviewer",
             "action_types": ["approve_dpco_accreditation",
                              "reject_dpco_accreditation"]},
        ],
    },
]

#: Sensitive actions that must go through maker-checker dual control.
MAKER_CHECKER_ACTIONS = [
    "fine_settlement",
    "dpco_approval",
    "role_grant",
    "vault_sealing_override",
]

ELEVATED_ROLES = ("admin", "government_staff", "auditor")
DORMANCY_THRESHOLD_DAYS = 90

SEVERITY_WEIGHT = {"high": 0.7, "medium": 0.4, "low": 0.2}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _ts(value) -> _dt.datetime:
    """Coerce ISO strings / datetimes to an aware UTC datetime."""
    if isinstance(value, _dt.datetime):
        return value if value.tzinfo else value.replace(
            tzinfo=_dt.timezone.utc)
    s = str(value).replace("Z", "+00:00")
    dt = _dt.datetime.fromisoformat(s)
    return dt if dt.tzinfo else dt.replace(tzinfo=_dt.timezone.utc)


def _violation(rule: str, severity: str, subjects: dict,
               evidence: dict, description: str) -> dict:
    return {"rule": rule, "severity": severity, "subjects": subjects,
            "evidence": evidence, "description": description}


# --------------------------------------------------------------------------- #
# Rule 1: segregation of duties
# --------------------------------------------------------------------------- #
def check_sod_violations(actions: Iterable[dict],
                         matrix: Optional[list] = None) -> list[dict]:
    """Flag actors who performed two conflicting steps on the same scope.

    ``actions`` records: {action_type, actor_id, scope_ref, timestamp?}
    where ``scope_ref`` identifies the penalty / case / application the
    action belongs to (e.g. "penalty:1042").
    """
    matrix = matrix or SOD_MATRIX
    violations = []
    for entry in matrix:
        role_of_action = {}
        for step in entry["steps"]:
            for at in step["action_types"]:
                role_of_action[at] = step["role"]
        # (scope_ref) -> {role: set(actors)}
        by_scope: dict[str, dict[str, set]] = {}
        for a in actions:
            role = role_of_action.get(a.get("action_type"))
            if role is None:
                continue
            scope = str(a.get("scope_ref", ""))
            slot = by_scope.setdefault(scope, {})
            slot.setdefault(role, set()).add(str(a.get("actor_id")))
        for scope, roles in sorted(by_scope.items()):
            for i, s1 in enumerate(entry["steps"]):
                for s2 in entry["steps"][i + 1:]:
                    shared = (roles.get(s1["role"], set())
                              & roles.get(s2["role"], set()))
                    for actor in sorted(shared):
                        violations.append(_violation(
                            rule=f"sod:{entry['process']}",
                            severity="high",
                            subjects={"actor_id": actor,
                                      "roles": [s1["role"], s2["role"]],
                                      "scope": entry["scope"],
                                      "scope_ref": scope},
                            evidence={"process": entry["process"],
                                      "scope_ref": scope,
                                      "conflicting_roles": [s1["role"],
                                                            s2["role"]],
                                      "action_types": [s1["action_types"],
                                                       s2["action_types"]]},
                            description=(
                                f"{actor} performed both '{s1['role']}' and "
                                f"'{s2['role']}' on {entry['scope']} {scope}")))
    return violations


# --------------------------------------------------------------------------- #
# Rule 2: maker-checker
# --------------------------------------------------------------------------- #
def check_maker_checker(actions: Iterable[dict],
                        required: Optional[list] = None) -> list[dict]:
    """Flag sensitive actions executed without two distinct approvers.

    ``actions`` records: {action_type, actor_id (requester/executor),
    scope_ref, approver_ids: [..] (optional)}. A violation fires when the
    action is in MAKER_CHECKER_ACTIONS and there are fewer than two
    distinct approvers, or any approver equals the requester.
    """
    required = required or MAKER_CHECKER_ACTIONS
    violations = []
    for a in actions:
        at = a.get("action_type")
        if at not in required:
            continue
        requester = str(a.get("actor_id"))
        approvers = [str(x) for x in (a.get("approver_ids") or [])]
        distinct = set(approvers) - {requester}
        problems = []
        if requester in approvers:
            problems.append("self-approval attempt")
        if len(distinct) < 2:
            problems.append(
                f"only {len(distinct)} distinct approver(s), need 2")
        if problems:
            violations.append(_violation(
                rule=f"maker_checker:{at}",
                severity="high" if requester in approvers else "medium",
                subjects={"actor_id": requester,
                          "scope_ref": str(a.get("scope_ref", ""))},
                evidence={"action_type": at,
                          "requester": requester,
                          "approver_ids": approvers,
                          "problems": problems},
                description=(f"{at} on {a.get('scope_ref')} by {requester}: "
                             + "; ".join(problems))))
    return violations


# --------------------------------------------------------------------------- #
# Rule 3: dormant-account reactivation watch
# --------------------------------------------------------------------------- #
def check_dormant_reactivation(
        accounts: Iterable[dict],
        threshold_days: int = DORMANCY_THRESHOLD_DAYS) -> list[dict]:
    """Flag accounts re-authenticating after > threshold_days of inactivity.

    ``accounts`` records: {user_id, last_active_at, reactivated_at,
    reactivated_by? (optional, for admin-triggered reactivation)}.
    """
    violations = []
    for acct in accounts:
        last = acct.get("last_active_at")
        reactivated = acct.get("reactivated_at")
        if not last or not reactivated:
            continue
        gap = (_ts(reactivated) - _ts(last)).days
        if gap > threshold_days:
            uid = str(acct.get("user_id"))
            violations.append(_violation(
                rule="watch:dormant_reactivation",
                severity="medium",
                subjects={"actor_id": uid},
                evidence={"user_id": uid,
                          "last_active_at": str(last),
                          "reactivated_at": str(reactivated),
                          "dormant_days": gap,
                          "reactivated_by": acct.get("reactivated_by"),
                          "threshold_days": threshold_days},
                description=(f"account {uid} reactivated after {gap} "
                             f"dormant days (threshold {threshold_days})")))
    return violations


# --------------------------------------------------------------------------- #
# Rule 4: privilege-escalation watch
# --------------------------------------------------------------------------- #
def check_privilege_escalation(
        role_changes: Iterable[dict],
        elevated_roles: tuple = ELEVATED_ROLES) -> list[dict]:
    """Flag elevated-role grants lacking a distinct second approver.

    ``role_changes`` records: {user_id, old_role, new_role, changed_by,
    approved_by?}.
    """
    violations = []
    for rc in role_changes:
        new_role = str(rc.get("new_role", ""))
        if new_role not in elevated_roles:
            continue
        changed_by = str(rc.get("changed_by"))
        approved_by = rc.get("approved_by")
        approved_by = str(approved_by) if approved_by else None
        if approved_by is None or approved_by == changed_by:
            violations.append(_violation(
                rule="watch:privilege_escalation",
                severity="high",
                subjects={"actor_id": changed_by,
                          "target_user_id": str(rc.get("user_id"))},
                evidence={"user_id": str(rc.get("user_id")),
                          "old_role": rc.get("old_role"),
                          "new_role": new_role,
                          "changed_by": changed_by,
                          "approved_by": approved_by},
                description=(
                    f"role grant to '{new_role}' for {rc.get('user_id')} by "
                    f"{changed_by} without a distinct second approver")))
    return violations


def run_all_rules(actions: Iterable[dict] = (),
                  accounts: Iterable[dict] = (),
                  role_changes: Iterable[dict] = ()) -> list[dict]:
    """Run every process control and return a stable-ordered violation list."""
    actions = list(actions)
    violations = (check_sod_violations(actions)
                  + check_maker_checker(actions)
                  + check_dormant_reactivation(accounts)
                  + check_privilege_escalation(role_changes))
    violations.sort(key=lambda v: (v["rule"],
                                   str(v["subjects"].get("actor_id")),
                                   str(v["evidence"].get("scope_ref", ""))))
    return violations


# --------------------------------------------------------------------------- #
# Dual-control state machine (mirrored by server/routers/insiderThreat.ts)
# --------------------------------------------------------------------------- #
class DualControlError(Exception):
    """Raised on illegal maker-checker transitions."""


class DualControlRequest:
    """Maker-checker request: two DISTINCT approvers, no self-approval.

    Status lifecycle: pending -> approved | rejected | expired.
    ``approve`` requires ``approvers_required`` distinct approvers, none of
    whom may be the requester; a request past ``expires_at`` transitions to
    ``expired`` on the next decision attempt and cannot be decided.
    """

    STATUSES = ("pending", "approved", "rejected", "expired")

    def __init__(self, action_type: str, payload: dict, requested_by: str,
                 approvers_required: int = 2, ttl_hours: float = 72.0,
                 created_at: Optional[_dt.datetime] = None):
        if action_type not in MAKER_CHECKER_ACTIONS:
            raise DualControlError(
                f"action '{action_type}' is not a maker-checker action")
        self.action_type = action_type
        self.payload = dict(payload)
        self.requested_by = str(requested_by)
        self.approvers_required = int(approvers_required)
        self.created_at = created_at or _dt.datetime.now(_dt.timezone.utc)
        self.expires_at = self.created_at + _dt.timedelta(hours=ttl_hours)
        self.approvers: list[str] = []
        self.rejected_by: Optional[str] = None
        self.reject_reason: Optional[str] = None
        self.status = "pending"
        self.decided_at: Optional[_dt.datetime] = None

    def _check_open(self, now: _dt.datetime) -> None:
        if self.status != "pending":
            raise DualControlError(
                f"request already {self.status}")
        if _ts(now) >= self.expires_at:
            self.status = "expired"
            self.decided_at = _ts(now)
            raise DualControlError("request expired")

    def approve(self, approver: str, now: Optional[_dt.datetime] = None
                ) -> str:
        now = _ts(now or _dt.datetime.now(_dt.timezone.utc))
        self._check_open(now)
        approver = str(approver)
        if approver == self.requested_by:
            raise DualControlError("self-approval is not permitted")
        if approver in self.approvers:
            raise DualControlError(f"{approver} already approved")
        self.approvers.append(approver)
        if len(self.approvers) >= self.approvers_required:
            self.status = "approved"
            self.decided_at = now
        return self.status

    def reject(self, approver: str, reason: str = "",
               now: Optional[_dt.datetime] = None) -> str:
        now = _ts(now or _dt.datetime.now(_dt.timezone.utc))
        self._check_open(now)
        approver = str(approver)
        if approver == self.requested_by:
            raise DualControlError("requester cannot reject their own "
                                   "request (ask a second officer)")
        self.status = "rejected"
        self.rejected_by = approver
        self.reject_reason = reason
        self.decided_at = now
        return self.status

    def to_dict(self) -> dict:
        return {
            "action_type": self.action_type,
            "payload": self.payload,
            "requested_by": self.requested_by,
            "approvers_required": self.approvers_required,
            "approvers": list(self.approvers),
            "status": self.status,
            "created_at": self.created_at.isoformat(),
            "expires_at": self.expires_at.isoformat(),
            "decided_at": self.decided_at.isoformat()
            if self.decided_at else None,
            "rejected_by": self.rejected_by,
            "reject_reason": self.reject_reason,
        }


# --------------------------------------------------------------------------- #
# Deterministic synthetic action ledger (used when no DB is available)
# --------------------------------------------------------------------------- #
def synthetic_action_records(subjects: list[str], seed: int = 42
                             ) -> dict:
    """Small deterministic action/account/role-change ledger with a few
    PLANTED process violations so the sweep exercises every rule:

      * OFF-... self-approves a penalty (SoD penalty_lifecycle)
      * an appeal reviewed by the original decision maker (SoD appeals)
      * a fine settlement with no distinct approver (maker-checker)
      * a vault sealing override approved by the requester (self-approval)
      * a dormant account reactivation after 180 days
      * an admin role grant without second approver
    """
    import numpy as np

    rng = np.random.default_rng(seed + 7)
    n = len(subjects)
    base = _dt.datetime(2026, 1, 1, tzinfo=_dt.timezone.utc)

    def pick(k: int) -> list[str]:
        idx = rng.choice(n, size=min(k, n), replace=False)
        return [subjects[int(i)] for i in idx]

    actions: list[dict] = []
    accounts: list[dict] = []
    role_changes: list[dict] = []

    # benign background: properly separated penalty lifecycle
    for j in range(6):
        issuer, approver, recorder = pick(3)  # one draw => 3 distinct
        scope = f"penalty:{2000 + j}"
        actions += [
            {"action_type": "issue_penalty", "actor_id": issuer,
             "scope_ref": scope,
             "timestamp": (base + _dt.timedelta(days=j)).isoformat()},
            {"action_type": "approve_penalty", "actor_id": approver,
             "scope_ref": scope,
             "timestamp": (base + _dt.timedelta(days=j, hours=3)).isoformat()},
            {"action_type": "record_penalty_payment", "actor_id": recorder,
             "scope_ref": scope,
             "timestamp": (base + _dt.timedelta(days=j + 4)).isoformat()},
        ]
        # clean maker-checker settlement: requester distinct from both
        # approvers, approvers distinct from each other
        requester, ap1, ap2 = pick(3)
        actions.append({"action_type": "fine_settlement",
                        "actor_id": requester,
                        "scope_ref": f"settlement:{2000 + j}",
                        "approver_ids": [ap1, ap2],
                        "timestamp": (base + _dt.timedelta(days=j + 5))
                        .isoformat()})

    # PLANTED 1: self-approved penalty (SoD violation)
    bad = pick(1)[0]
    actions += [
        {"action_type": "issue_penalty", "actor_id": bad,
         "scope_ref": "penalty:9999",
         "timestamp": (base + _dt.timedelta(days=10)).isoformat()},
        {"action_type": "approve_penalty", "actor_id": bad,
         "scope_ref": "penalty:9999",
         "timestamp": (base + _dt.timedelta(days=10, hours=1)).isoformat()},
    ]
    # PLANTED 2: appeal reviewed by original decision maker
    actions += [
        {"action_type": "issue_penalty", "actor_id": bad,
         "scope_ref": "case:8888",
         "timestamp": (base + _dt.timedelta(days=11)).isoformat()},
        {"action_type": "review_appeal", "actor_id": bad,
         "scope_ref": "case:8888",
         "timestamp": (base + _dt.timedelta(days=12)).isoformat()},
    ]
    # PLANTED 3: fine settlement with no distinct approver
    solo = pick(1)[0]
    actions.append({"action_type": "fine_settlement", "actor_id": solo,
                    "scope_ref": "settlement:7777", "approver_ids": [],
                    "timestamp": (base + _dt.timedelta(days=13)).isoformat()})
    # PLANTED 4: vault sealing override approved only by the requester
    actions.append({"action_type": "vault_sealing_override",
                    "actor_id": bad, "scope_ref": "vault:sector-7",
                    "approver_ids": [bad],
                    "timestamp": (base + _dt.timedelta(days=14)).isoformat()})
    # PLANTED 5: dormant account reactivation after 180 days
    dormant = pick(1)[0]
    accounts.append({
        "user_id": dormant,
        "last_active_at": base.isoformat(),
        "reactivated_at": (base + _dt.timedelta(days=180)).isoformat(),
        "reactivated_by": None})
    # PLANTED 6: admin role grant without second approver
    granter = pick(1)[0]
    role_changes.append({"user_id": pick(1)[0], "old_role": "user",
                         "new_role": "admin", "changed_by": granter,
                         "approved_by": None})

    return {"actions": actions, "accounts": accounts,
            "role_changes": role_changes}
