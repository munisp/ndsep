#!/usr/bin/env python3
"""A/B testing (champion/challenger) infrastructure for the NDSEP ML stack.

Experiment definitions live in ml/weights/experiments.json:

    {"experiments": [
        {"name": "fraud-v2-rollout",
         "model": "fraud",
         "champion_version": "20260924T030640Z",
         "challenger_version": "20261001T020000Z",
         "traffic_split": 0.10,          # fraction routed to challenger
         "started_at": "...",
         "status": "running"}            # running | completed | aborted
    ]}

Traffic assignment is DETERMINISTIC: sha256("<experiment>:<subject_id>")
maps each subject (transaction, org, user) to a stable variant, so the
same subject always sees the same model — no flapping between requests.

Every scored request is appended to ml/lakehouse/ab_results/<name>.jsonl
(prediction, variant, model_version, latency). Outcomes (ground-truth
labels arriving later) go to <name>_outcomes.jsonl keyed by subject_id.

Promotion (`evaluate` / `promote`): when both variants have logged at
least `min_samples` outcomes, variants are compared on ROC-AUC over those
logged outcomes; with too few logged outcomes the comparison falls back
to a proxy metric — ROC-AUC of champion vs challenger weights scored
over a labeled holdout from the lakehouse. A winning challenger is
promoted: experiments.json is updated and the promotion is registered
in the model registry (ml/registry.py), so the audit trail is complete.

    python -m ml.ab_testing --list
    python -m ml.ab_testing --create fraud-v2 --model fraud \
        --challenger 20261001T020000Z --split 0.1
    python -m ml.ab_testing --evaluate fraud-v2
    python -m ml.ab_testing --promote fraud-v2 --min-samples 200
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from datetime import datetime

import numpy as np
import pandas as pd

ML_ROOT = os.path.dirname(os.path.abspath(__file__))
WEIGHTS_DIR = os.path.join(ML_ROOT, "weights")
EXPERIMENTS_PATH = os.path.join(WEIGHTS_DIR, "experiments.json")
LAKEHOUSE_ROOT = (os.environ.get("ML_LAKEHOUSE_ROOT")
                  or os.path.join(ML_ROOT, "lakehouse"))
AB_RESULTS_DIR = os.path.join(LAKEHOUSE_ROOT, "ab_results")

STATUSES = {"running", "completed", "aborted"}


# --------------------------------------------------------------------------- #
# Experiment definitions
# --------------------------------------------------------------------------- #
def load_experiments(path: str = EXPERIMENTS_PATH) -> dict:
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {"experiments": []}


def save_experiments(data: dict, path: str = EXPERIMENTS_PATH) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def get_experiment(name: str, path: str = EXPERIMENTS_PATH) -> dict | None:
    for exp in load_experiments(path)["experiments"]:
        if exp["name"] == name:
            return exp
    return None


def create_experiment(name: str, model: str, challenger_version: str,
                      champion_version: str | None = None,
                      traffic_split: float = 0.1,
                      path: str = EXPERIMENTS_PATH) -> dict:
    """Create (or replace) a champion/challenger experiment definition."""
    if not 0.0 < traffic_split < 1.0:
        raise ValueError("traffic_split must be in (0, 1)")
    if champion_version is None:
        mpath = os.path.join(os.path.dirname(path),
                             f"{model}_net_metrics.json")
        with open(mpath) as f:
            champion_version = json.load(f)["version"]
    data = load_experiments(path)
    data["experiments"] = [e for e in data["experiments"]
                           if e["name"] != name]
    exp = {
        "name": name,
        "model": model,
        "champion_version": champion_version,
        "challenger_version": challenger_version,
        "traffic_split": float(traffic_split),
        "started_at": datetime.utcnow().isoformat() + "Z",
        "status": "running",
    }
    data["experiments"].append(exp)
    save_experiments(data, path)
    return exp


# --------------------------------------------------------------------------- #
# Deterministic assignment
# --------------------------------------------------------------------------- #
def assign_variant(experiment: dict | str, subject_id: str,
                   path: str = EXPERIMENTS_PATH) -> str:
    """Map a subject to 'champion' or 'challenger' deterministically."""
    exp = (get_experiment(experiment, path) if isinstance(experiment, str)
           else experiment)
    if exp is None:
        return "champion"
    if exp.get("status") != "running":
        return "champion"
    h = hashlib.sha256(f"{exp['name']}:{subject_id}".encode()).hexdigest()
    frac = int(h[:12], 16) / float(0xFFFFFFFFFFFF)
    return "challenger" if frac < float(exp["traffic_split"]) else "champion"


def version_for_variant(exp: dict, variant: str) -> str:
    return (exp["challenger_version"] if variant == "challenger"
            else exp["champion_version"])


# --------------------------------------------------------------------------- #
# Result + outcome logging (jsonl under the lakehouse)
# --------------------------------------------------------------------------- #
def _results_path(experiment: str, root: str = AB_RESULTS_DIR) -> str:
    return os.path.join(root, f"{experiment}.jsonl")


def _outcomes_path(experiment: str, root: str = AB_RESULTS_DIR) -> str:
    return os.path.join(root, f"{experiment}_outcomes.jsonl")


def log_result(experiment: str, record: dict,
               root: str = AB_RESULTS_DIR) -> str:
    """Append one scored request (prediction, variant, latency) to the log."""
    os.makedirs(root, exist_ok=True)
    rec = {"ts": datetime.utcnow().isoformat() + "Z", **record}
    with open(_results_path(experiment, root), "a") as f:
        f.write(json.dumps(rec, default=str) + "\n")
    return _results_path(experiment, root)


def record_outcome(experiment: str, subject_id: str, outcome: int | float,
                   root: str = AB_RESULTS_DIR) -> str:
    """Log a ground-truth outcome for a previously scored subject."""
    os.makedirs(root, exist_ok=True)
    rec = {"ts": datetime.utcnow().isoformat() + "Z",
           "subject_id": str(subject_id), "outcome": float(outcome)}
    with open(_outcomes_path(experiment, root), "a") as f:
        f.write(json.dumps(rec) + "\n")
    return _outcomes_path(experiment, root)


def load_results(experiment: str, root: str = AB_RESULTS_DIR) -> pd.DataFrame:
    path = _results_path(experiment, root)
    if not os.path.exists(path):
        return pd.DataFrame()
    return pd.read_json(path, lines=True)


def load_labeled_results(experiment: str,
                         root: str = AB_RESULTS_DIR) -> pd.DataFrame:
    """Join logged predictions with logged outcomes (latest outcome wins)."""
    res = load_results(experiment, root)
    opath = _outcomes_path(experiment, root)
    if res.empty or not os.path.exists(opath):
        return pd.DataFrame()
    outs = pd.read_json(opath, lines=True)
    outs = outs.sort_values("ts").drop_duplicates("subject_id", keep="last")
    res["subject_id"] = res["subject_id"].astype(str)
    return res.merge(outs[["subject_id", "outcome"]], on="subject_id",
                     how="inner")


# --------------------------------------------------------------------------- #
# Evaluation + promotion
# --------------------------------------------------------------------------- #
def _safe_auc(y, p) -> float:
    from sklearn.metrics import roc_auc_score
    try:
        return float(roc_auc_score(y, p))
    except ValueError:  # single-class slice
        return float("nan")


def _proxy_comparison(exp: dict, weights_dir: str, n_samples: int = 5000) -> dict:
    """Proxy metric: score a labeled lakehouse holdout with BOTH weight
    versions and compare ROC-AUC. Used when logged outcomes are scarce."""
    from ml.inference import score_batch
    from ml.training import lakehouse

    model = exp["model"]
    ds, label = {"fraud": ("transactions", "is_fraud"),
                 "credit": ("credit_features", "default_24m"),
                 "gnn": ("graph_labels", "high_risk")}[model]
    df = lakehouse.load_latest(ds)
    if len(df) > n_samples:
        df = df.sample(n_samples, random_state=0)
    out = {}
    for variant in ("champion", "challenger"):
        version = version_for_variant(exp, variant)
        prob = score_batch(model, df, weights_dir=weights_dir,
                           version=version)
        out[variant] = {"auc": _safe_auc(df[label].to_numpy(), prob),
                        "n": int(len(df))}
    return {"metric": "proxy_holdout_auc", "variants": out}


def evaluate(experiment: str, path: str = EXPERIMENTS_PATH,
             root: str = AB_RESULTS_DIR, min_samples: int = 200,
             weights_dir: str = WEIGHTS_DIR) -> dict:
    """Compare champion vs challenger for an experiment.

    Primary: ROC-AUC on logged outcomes (needs >= min_samples per variant).
    Fallback: proxy holdout AUC from the lakehouse (flagged as proxy).
    """
    exp = get_experiment(experiment, path)
    if exp is None:
        raise KeyError(f"experiment '{experiment}' not found in {path}")
    labeled = load_labeled_results(experiment, root)
    counts = (labeled.groupby("variant")["outcome"].count().to_dict()
              if not labeled.empty else {})
    if (counts.get("champion", 0) >= min_samples
            and counts.get("challenger", 0) >= min_samples):
        variants = {}
        for variant, g in labeled.groupby("variant"):
            variants[variant] = {
                "auc": _safe_auc(g["outcome"].to_numpy(),
                                 g["probability"].to_numpy()),
                "n": int(len(g)),
                "mean_score": float(g["probability"].mean()),
                "mean_latency_ms": float(g.get("latency_ms",
                                               pd.Series([0])).mean()),
            }
        comparison = {"metric": "logged_outcome_auc", "variants": variants}
    else:
        comparison = _proxy_comparison(exp, weights_dir)
        comparison["note"] = (
            f"logged outcomes insufficient (need {min_samples}/variant, "
            f"have {counts}); used proxy holdout AUC instead")
    c_auc = comparison["variants"].get("champion", {}).get("auc", float("nan"))
    h_auc = comparison["variants"].get("challenger", {}).get("auc", float("nan"))
    winner = ("challenger" if (not np.isnan(h_auc) and not np.isnan(c_auc)
                               and h_auc > c_auc) else "champion")
    return {"experiment": experiment, "status": exp.get("status"),
            "logged_outcome_counts": counts, "winner": winner,
            "champion_auc": c_auc, "challenger_auc": h_auc,
            **comparison}


def promote(experiment: str, path: str = EXPERIMENTS_PATH,
            root: str = AB_RESULTS_DIR, min_samples: int = 200,
            weights_dir: str = WEIGHTS_DIR, dry_run: bool = False) -> dict:
    """Promote the challenger to champion when it wins the evaluation.

    Updates experiments.json (champion_version := challenger_version,
    status := completed) and records the promotion in the model registry.
    """
    ev = evaluate(experiment, path=path, root=root,
                  min_samples=min_samples, weights_dir=weights_dir)
    decision = {"experiment": experiment, "evaluation": ev,
                "promoted": False, "dry_run": dry_run}
    if ev["winner"] != "challenger":
        decision["reason"] = "challenger did not beat champion"
        return decision
    if dry_run:
        decision["promoted"] = True
        decision["reason"] = "dry run — no changes written"
        return decision

    data = load_experiments(path)
    for exp in data["experiments"]:
        if exp["name"] == experiment:
            old = exp["champion_version"]
            exp["champion_version"] = exp["challenger_version"]
            exp["status"] = "completed"
            exp["completed_at"] = datetime.utcnow().isoformat() + "Z"
            exp["promotion"] = {"from": old, "to": exp["challenger_version"],
                                "metric": ev["metric"],
                                "champion_auc": ev["champion_auc"],
                                "challenger_auc": ev["challenger_auc"]}
            model = exp["model"]
            new_version = exp["challenger_version"]
            break
    save_experiments(data, path)

    # audit trail in the model registry
    from ml.registry import register_run
    register_run(
        model, {"roc_auc": ev["challenger_auc"]},
        os.path.join(weights_dir, f"{model}_net_{new_version}.pt"),
        data_snapshot_id=f"ab_promotion:{experiment}",
        version=new_version,
        registry_path=os.path.join(weights_dir, "registry.json"),
        notes=(f"A/B promotion in experiment '{experiment}': "
               f"{ev['metric']} challenger={ev['challenger_auc']:.4f} "
               f"vs champion={ev['champion_auc']:.4f}"))
    decision.update(promoted=True,
                    reason=f"challenger {new_version} promoted on {ev['metric']}",
                    new_champion_version=new_version)
    return decision


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--create", metavar="NAME")
    ap.add_argument("--model", choices=["fraud", "credit", "gnn"])
    ap.add_argument("--champion", default=None)
    ap.add_argument("--challenger", default=None)
    ap.add_argument("--split", type=float, default=0.1)
    ap.add_argument("--evaluate", metavar="NAME")
    ap.add_argument("--promote", metavar="NAME")
    ap.add_argument("--min-samples", type=int, default=200)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.create:
        if not args.model or not args.challenger:
            ap.error("--create requires --model and --challenger")
        exp = create_experiment(args.create, args.model, args.challenger,
                                champion_version=args.champion,
                                traffic_split=args.split)
        print(json.dumps(exp, indent=2))
    elif args.evaluate:
        print(json.dumps(evaluate(args.evaluate,
                                  min_samples=args.min_samples), indent=2))
    elif args.promote:
        print(json.dumps(promote(args.promote, min_samples=args.min_samples,
                                 dry_run=args.dry_run), indent=2, default=str))
    else:
        print(json.dumps(load_experiments(), indent=2))


if __name__ == "__main__":
    main()
