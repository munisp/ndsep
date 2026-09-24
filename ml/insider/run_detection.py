"""Insider-threat detection sweep CLI (NDSEP).

Runs the full insider-risk pipeline end to end:

    subjects   — staff/officer universe: officer nodes of the compliance
                 graph when available, else deterministic synthetic ids
    features   — ml.insider.features.build_officer_features
                 (Postgres audit_logs when reachable, synthetic fallback)
    controls   — ml.insider.process_controls.run_all_rules over the
                 action ledger (DB-derived best-effort, else the
                 deterministic synthetic ledger with planted violations)
    fusion     — ml.insider.fusion.fuse_scores -> risk register

Outputs:
    * JSON risk register (default ml/insider/output/risk_register.json)
    * optional Postgres insert into insider_risk_scores + sod_violations
      (migration 0080) with --insert (requires a driver + reachable DB)

Usage:
    python -m ml.insider.run_detection --once
    python -m ml.insider.run_detection --once --json-out /tmp/reg.json
    python -m ml.insider.run_detection --once --insert \
        --db-url postgresql://user:pass@host/ndsep

The tRPC router (server/routers/insiderThreat.ts runSweep) invokes this
module as a child process with a timeout and reads the JSON output.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
import sys

import pandas as pd

log = logging.getLogger("ml.insider.run_detection")

DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "output", "risk_register.json")


# --------------------------------------------------------------------------- #
# Subject universe + action ledger sources
# --------------------------------------------------------------------------- #
def _graph_officer_subjects(limit: int) -> list[str]:
    """Officer node ref_ids from the compliance graph (deterministic order)."""
    from ml.graph.graph_source import load_training_graph
    nodes, _e, _l, _src = load_training_graph()
    officers = sorted(nodes.loc[nodes["node_type"] == "officer",
                                "ref_id"].astype(str).tolist())
    return officers[:limit]


def _db_action_records(db_url: str, window_days: int) -> dict:
    """Best-effort SoD/maker-checker action ledger from audit_logs."""
    from ml.insider.features import _connect
    conn = _connect(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT action AS action_type,
                          user_id::text AS actor_id,
                          COALESCE(resource_type, '') || ':' ||
                            COALESCE(resource_id::text, '') AS scope_ref,
                          created_at AS timestamp
                     FROM audit_logs
                    WHERE created_at >= now() - make_interval(days => %s)
                      AND user_id IS NOT NULL
                    ORDER BY created_at""", (int(window_days),))
            cols = [d[0] for d in cur.description]
            actions = [dict(zip(cols, row)) for row in cur.fetchall()]
            cur.execute(
                """SELECT id::text AS user_id, last_signed_in AS last_active_at,
                          updated_at AS reactivated_at
                     FROM users WHERE is_active""")
            cols = [d[0] for d in cur.description]
            accounts = [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        conn.close()
    return {"actions": actions, "accounts": accounts, "role_changes": []}


# --------------------------------------------------------------------------- #
# Optional Postgres persistence (migration 0080 tables)
# --------------------------------------------------------------------------- #
def insert_register(db_url: str, register: pd.DataFrame,
                    violations: list[dict]) -> dict:
    """Insert the sweep into insider_risk_scores + sod_violations."""
    from ml.insider.features import _connect
    conn = _connect(db_url)
    n_scores = n_viol = 0
    try:
        with conn:
            with conn.cursor() as cur:
                for _, r in register.iterrows():
                    cur.execute(
                        """INSERT INTO insider_risk_scores
                             (subject_id, subject_type, fused_score,
                              components, explanation, recommended_action,
                              computed_at)
                           VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                        (r["subject_id"], r.get("subject_type", "officer"),
                         float(r["fused_score"]), json.dumps(r["components"]),
                         json.dumps(r["explanation"]),
                         r["recommended_action"],
                         dt.datetime.now(dt.timezone.utc)))
                    n_scores += 1
                for v in violations:
                    cur.execute(
                        """INSERT INTO sod_violations
                             (rule, subject_refs, evidence, status,
                              detected_at)
                           VALUES (%s,%s,%s,'open',%s)""",
                        (v["rule"], json.dumps(v["subjects"]),
                         json.dumps(v["evidence"]),
                         dt.datetime.now(dt.timezone.utc)))
                    n_viol += 1
    finally:
        conn.close()
    return {"scores_inserted": n_scores, "violations_inserted": n_viol}


# --------------------------------------------------------------------------- #
# Sweep
# --------------------------------------------------------------------------- #
def run_sweep(db_url: str | None = None, seed: int = 42,
              n_subjects: int = 60, window_days: int = 30,
              use_gnn: bool = True) -> dict:
    from ml.insider.features import build_officer_features
    from ml.insider.process_controls import (run_all_rules,
                                             synthetic_action_records)
    from ml.insider.fusion import FUSION_WEIGHTS, fuse_scores

    # 1) subject universe
    try:
        subjects = _graph_officer_subjects(n_subjects)
        subject_source = "compliance_graph"
    except Exception as exc:
        log.warning("graph subjects unavailable (%s); synthetic ids", exc)
        subjects = [f"OFF-{k:06d}" for k in range(n_subjects)]
        subject_source = "synthetic_ids"

    # 2) behavioral features (Postgres when reachable)
    features = build_officer_features(db_url=db_url, window_days=window_days,
                                      subjects=subjects, seed=seed)
    feature_source = str(features["source"].iloc[0]) if len(features) \
        else "empty"

    # 3) process controls
    ledger = None
    if db_url:
        try:
            ledger = _db_action_records(db_url, window_days)
            ledger_source = "postgres"
        except Exception as exc:
            log.warning("DB action ledger unavailable (%s); synthetic", exc)
    if ledger is None:
        ledger = synthetic_action_records(subjects, seed=seed)
        ledger_source = "synthetic"
    violations = run_all_rules(ledger["actions"], ledger["accounts"],
                               ledger["role_changes"])

    # 4) fusion
    register = fuse_scores(features, violations, use_gnn=use_gnn)

    counts = register["recommended_action"].value_counts().to_dict()
    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "seed": seed,
        "window_days": window_days,
        "sources": {"subjects": subject_source, "features": feature_source,
                    "action_ledger": ledger_source,
                    "gnn": register.attrs.get("gnn_source", "?")},
        "weights": FUSION_WEIGHTS,
        "bayesian_population": register.attrs.get("bayesian_population", {}),
        "n_subjects": int(len(register)),
        "n_bayesian_flagged": int(register["bayesian_flagged"].sum()),
        "action_counts": {k: int(v) for k, v in counts.items()},
        "violations": violations,
        "register": register.to_dict("records"),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="NDSEP insider-threat sweep")
    ap.add_argument("--once", action="store_true",
                    help="run one sweep and exit (default behaviour)")
    ap.add_argument("--json-out", default=DEFAULT_OUT,
                    help="path for the JSON risk register")
    ap.add_argument("--db-url", default=os.environ.get("DATABASE_URL"),
                    help="Postgres DSN (features + optional insert)")
    ap.add_argument("--insert", action="store_true",
                    help="insert results into insider_risk_scores / "
                         "sod_violations (requires --db-url + driver)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--n-subjects", type=int, default=60)
    ap.add_argument("--window-days", type=int, default=30)
    ap.add_argument("--no-gnn", action="store_true",
                    help="skip the GNN structural component (feature-proxy)")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)s %(name)s: %(message)s")

    result = run_sweep(db_url=args.db_url, seed=args.seed,
                       n_subjects=args.n_subjects,
                       window_days=args.window_days,
                       use_gnn=not args.no_gnn)

    os.makedirs(os.path.dirname(os.path.abspath(args.json_out)),
                exist_ok=True)
    with open(args.json_out, "w") as f:
        json.dump(result, f, indent=2, default=str)

    if args.insert:
        if not args.db_url:
            print("--insert requires --db-url / DATABASE_URL", file=sys.stderr)
            return 2
        try:
            import pandas as pd  # noqa: F401
            reg = pd.DataFrame(result["register"])
            ins = insert_register(args.db_url, reg, result["violations"])
            print(f"Postgres insert: {ins}")
        except Exception as exc:
            print(f"Postgres insert FAILED: {exc}", file=sys.stderr)
            return 3

    # summary to stdout (parsed by the tRPC runSweep procedure)
    top = result["register"][:5]
    print(json.dumps({
        "status": "ok",
        "json_out": os.path.abspath(args.json_out),
        "n_subjects": result["n_subjects"],
        "n_bayesian_flagged": result["n_bayesian_flagged"],
        "n_violations": len(result["violations"]),
        "action_counts": result["action_counts"],
        "sources": result["sources"],
        "top_subjects": [
            {"subject_id": r["subject_id"], "fused_score": r["fused_score"],
             "recommended_action": r["recommended_action"],
             "top_signal": (r["explanation"][0]["signal"]
                            if r["explanation"] else None)}
            for r in top],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
