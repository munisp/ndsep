"""Run the NDSEP Bayesian/MCMC analyses end-to-end and write results.

    python3 -m ml.bayesian.run_analysis [--seed 42] [--output-dir ml/bayesian/results]

Data: loads `transactions` + `organizations` from the lakehouse
(``ml.training.lakehouse.load_latest``); if that fails (e.g. no parquet
engine in a bare sandbox), falls back to regenerating the synthetic
corpus with ``ml.data.generate_synthetic.generate`` (CSV fallback).

Analyses
--------
1. Per-sector fraud base rates (Beta-Binomial, conjugate + MH check)
2. Change-point on the weekly flagged-violation series (Poisson, exact
   grid posterior over the change location)
3. Per-organization insider-ring event-rate shrinkage (Gamma-Poisson,
   empirical Bayes) — officer-level proxy until the insider-threat
   module supplies per-officer counts

Outputs: ``sector_fraud_rates.json``, ``changepoint_violations.json``,
``insider_risk_shrinkage.json``, and ``SUMMARY.md`` in the output dir.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile

import numpy as np
import pandas as pd

from ml.bayesian import models

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "results")


# --------------------------------------------------------------------------- #
# Data loading
# --------------------------------------------------------------------------- #
def load_corpus(seed: int = 42, n_transactions: int = 120_000
                ) -> tuple[pd.DataFrame, pd.DataFrame, str]:
    """Return (transactions, organizations, source_description)."""
    try:
        from ml.training.lakehouse import load_latest
        tx = load_latest("transactions")
        orgs = load_latest("organizations")
        return tx, orgs, "lakehouse (ml/lakehouse latest snapshots)"
    except Exception as exc:  # noqa: BLE001 - any lakehouse failure falls back
        from ml.data.generate_synthetic import generate
        tmp = tempfile.mkdtemp(prefix="ndsep_bayes_")
        generate(tmp, n_transactions=n_transactions, n_orgs=800, seed=seed)
        tx = pd.read_csv(os.path.join(tmp, "transactions.csv"))
        orgs = pd.read_csv(os.path.join(tmp, "organizations.csv"))
        reason = str(exc).splitlines()[0] if str(exc) else type(exc).__name__
        return tx, orgs, (f"generator fallback, seed={seed} "
                          f"(lakehouse unreadable: {reason})")


# --------------------------------------------------------------------------- #
# Analyses
# --------------------------------------------------------------------------- #
def sector_fraud(tx: pd.DataFrame, orgs: pd.DataFrame, seed: int) -> dict:
    sector_of = orgs.set_index("org_id")["sector"]
    df = tx[["sender_org", "is_fraud"]].copy()
    df["sector"] = df["sender_org"].map(sector_of)
    g = df.groupby("sector")["is_fraud"].agg(["sum", "count"])
    res = models.beta_binomial_rates(g["sum"].to_numpy(),
                                     g["count"].to_numpy(), seed=seed)
    for name, entry in zip(g.index, res["sectors"]):
        entry["sector"] = name
    res["sectors"].sort(key=lambda e: -e["posterior_mean"])
    pooled = g["sum"].sum() / g["count"].sum()
    res["pooled_raw_rate"] = float(pooled)
    # posterior probability each sector exceeds the pooled raw rate
    rng = np.random.default_rng(seed)
    for e in res["sectors"]:
        draws = rng.beta(e["alpha_post"], e["beta_post"], size=100_000)
        e["p_above_pooled"] = float((draws > pooled).mean())
    return res


def weekly_changepoint(tx: pd.DataFrame, seed: int) -> dict:
    ts = pd.to_datetime(tx["timestamp"])
    week = ((ts - ts.min()).dt.days // 7).to_numpy()
    fraud = tx["is_fraud"].to_numpy()
    n_weeks = int(week.max()) + 1
    counts = np.bincount(week[fraud == 1], minlength=n_weeks)
    res = models.poisson_changepoint(counts, seed=seed)
    res["series"] = {
        "week_index": list(range(n_weeks)),
        "flagged_counts": counts.tolist(),
        "definition": ("weekly count of transactions flagged is_fraud=1 "
                       "(compliance-violation proxy series)"),
    }
    res["interpretation"] = (
        "tau is the last week of the first regime: weeks 0..tau-1 have rate "
        "lam1, weeks tau..T-1 have rate lam2 (0-based week index)."
    )
    return res


def insider_risk(tx: pd.DataFrame, orgs: pd.DataFrame, seed: int) -> dict:
    g = tx.groupby("sender_org").agg(
        events=("is_insider_ring", "sum"), exposure=("tx_id", "count"))
    res = models.gamma_poisson_shrinkage(g["events"].to_numpy(),
                                         g["exposure"].to_numpy())
    name_of = orgs.set_index("org_id")["name"]
    sector_of = orgs.set_index("org_id")["sector"]
    for oid, unit in zip(g.index, res["units"]):
        unit["org_id"] = oid
        unit["name"] = str(name_of.get(oid, oid))
        unit["sector"] = str(sector_of.get(oid, "?"))
    res["units"].sort(key=lambda u: -u["posterior_mean"])
    res["definition"] = (
        "events = transactions flagged is_insider_ring=1 sent by the org; "
        "exposure = total sent transactions. Per-organization units stand "
        "in for per-officer counts until the insider-threat module "
        "supplies officer-level data."
    )
    res["flagged_units"] = [u for u in res["units"] if u["flagged"]]
    return res


# --------------------------------------------------------------------------- #
# Summary
# --------------------------------------------------------------------------- #
def write_summary(out_dir: str, source: str, sector: dict, cp: dict,
                  insider: dict) -> str:
    lines = [
        "# Bayesian/MCMC analysis — NDSEP",
        "",
        f"Data source: {source}",
        "",
        "## 1. Per-sector fraud base rates (Beta-Binomial)",
        "",
        "| sector | tx | fraud | raw rate | posterior mean | 95% HDI | "
        "P(rate > pooled) | R-hat | ESS |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for e in sector["sectors"]:
        lines.append(
            "| {sector} | {n} | {k} | {raw:.4%} | {pm:.4%} | "
            "[{lo:.4%}, {hi:.4%}] | {p:.3f} | {rh:.3f} | {ess:.0f} |".format(
                sector=e["sector"], n=e["n_transactions"], k=e["n_fraud"],
                raw=e["raw_rate"], pm=e["posterior_mean"],
                lo=e["hdi_95"][0], hi=e["hdi_95"][1],
                p=e["p_above_pooled"], rh=e["mcmc_check"]["rhat"],
                ess=e["mcmc_check"]["ess"]))
    lines += [
        "",
        f"Pooled raw fraud rate: {sector['pooled_raw_rate']:.4%}. "
        "Prior: Beta(1, 300) per sector.",
        "",
        "## 2. Change-point on weekly flagged-violation series",
        "",
        f"- Series length T = {cp['T']} weeks.",
        f"- MAP change-point: after week index {cp['map_tau'] - 1} "
        f"(tau = {cp['map_tau']}); posterior mean tau = {cp['mean_tau']:.1f}; "
        f"95% grid interval [{cp['tau_hdi_95_grid'][0]}, "
        f"{cp['tau_hdi_95_grid'][1]}].",
        f"- Rate before: {cp['lam1']['mean']:.2f}/week "
        f"(95% HDI [{cp['lam1']['hdi_95'][0]:.2f}, "
        f"{cp['lam1']['hdi_95'][1]:.2f}]); after: {cp['lam2']['mean']:.2f}"
        f"/week (95% HDI [{cp['lam2']['hdi_95'][0]:.2f}, "
        f"{cp['lam2']['hdi_95'][1]:.2f}]).",
        f"- P(rate increased after change) = {cp['p_lam2_gt_lam1']:.3f}.",
        "",
        "## 3. Insider-risk event-rate shrinkage (Gamma-Poisson, EB)",
        "",
        f"- Population prior Gamma(a={insider['population']['gamma_a']:.2f}, "
        f"b={insider['population']['gamma_b']:.0f}); mean rate "
        f"{insider['population']['mean_rate']:.5f}/tx; 99% population bound "
        f"{insider['population']['bound_99pct']:.5f}/tx.",
        f"- Units flagged above the bound: {insider['n_flagged']}.",
        "",
    ]
    if insider["flagged_units"]:
        lines += ["| org | sector | events | exposure | raw rate | "
                  "posterior mean | 95% HDI |", "|---|---|---|---|---|---|---|"]
        for u in insider["flagged_units"][:20]:
            lines.append(
                "| {name} | {sector} | {ev} | {ex} | {raw:.5f} | {pm:.5f} | "
                "[{lo:.5f}, {hi:.5f}] |".format(
                    name=u["name"], sector=u["sector"], ev=u["events"],
                    ex=int(u["exposure"]), raw=u["raw_rate"],
                    pm=u["posterior_mean"], lo=u["hdi_95"][0],
                    hi=u["hdi_95"][1]))
        lines.append("")
    lines += [
        "---",
        "Honest limits: synthetic labels; random-walk MH (no NUTS) — check "
        "R-hat/ESS before trusting tails; tau posterior is exact (grid), "
        "not MCMC. See ml/README.md.",
    ]
    text = "\n".join(lines) + "\n"
    path = os.path.join(out_dir, "SUMMARY.md")
    with open(path, "w") as f:
        f.write(text)
    return path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--output-dir", default=DEFAULT_OUT)
    ap.add_argument("--n-transactions", type=int, default=120_000,
                    help="fallback generator size if lakehouse unreadable")
    args = ap.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    tx, orgs, source = load_corpus(seed=args.seed,
                                   n_transactions=args.n_transactions)
    print(f"[bayesian] data: {source} | tx={len(tx)} orgs={len(orgs)}")

    sector = sector_fraud(tx, orgs, seed=args.seed)
    cp = weekly_changepoint(tx, seed=args.seed)
    insider = insider_risk(tx, orgs, seed=args.seed)

    for name, obj in [("sector_fraud_rates", sector),
                      ("changepoint_violations", cp),
                      ("insider_risk_shrinkage", insider)]:
        path = os.path.join(args.output_dir, f"{name}.json")
        with open(path, "w") as f:
            json.dump(obj, f, indent=2)
        print(f"[bayesian] wrote {path}")

    summary = write_summary(args.output_dir, source, sector, cp, insider)
    print(f"[bayesian] wrote {summary}")

    top = sector["sectors"][0]
    print(f"[bayesian] highest sector fraud rate: {top['sector']} "
          f"{top['posterior_mean']:.4%} "
          f"HDI95 [{top['hdi_95'][0]:.4%}, {top['hdi_95'][1]:.4%}]")
    print(f"[bayesian] change-point MAP tau={cp['map_tau']} "
          f"P(rate up)={cp['p_lam2_gt_lam1']:.3f}")
    print(f"[bayesian] insider-risk flagged units: {insider['n_flagged']}")


if __name__ == "__main__":
    main()
