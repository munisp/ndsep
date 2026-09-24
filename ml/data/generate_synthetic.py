#!/usr/bin/env python3
"""
Synthetic Nigerian financial / compliance data generator for the NDSEP ML stack.

IMPORTANT — THIS IS SYNTHETIC TRAINING DATA.
It stands in until production database pipelines (organizations,
compliance_violations, enforcement_actions, financial_penalties,
breach_incidents, transaction rails) feed real data. The schema and the
statistical properties below are modelled on realistic Nigerian patterns
(NIP instant transfers, CBN reporting thresholds, salary cycles, NDPC
enforcement structure) so models trained here transfer structurally, but
every row is fabricated by this script with a fixed seed.

Datasets written to ml/data/output/ as parquet (CSV fallback if pyarrow
is unavailable):

  organizations.parquet   — Nigerian banks / fintechs / telcos / etc.
  transactions.parquet    — NIP-style instant transfers with fraud labels
                            (structuring, account takeover, CNP fraud,
                            insider collusion, money-mule networks).
                            Base fraud rate ~0.3% (within 0.1–0.5%).
  credit_features.parquet — per-org credit/compliance features with a
                            default label drawn from a logistic function
                            of MULTIPLE features + noise (no leakage).
  graph_nodes.parquet     — compliance graph nodes (orgs, violations,
                            enforcement actions, officers).
  graph_edges.parquet     — HAS_VIOLATION, ENFORCED_BY, SECTOR_PEER,
                            TRANSACTS_WITH, EMPLOYS edges.
  graph_labels.parquet    — high-risk labels for org nodes, derived from
                            graph neighbourhoods (real signal for a GNN).

Usage:
    python -m ml.data.generate_synthetic [--output-dir ml/data/output] \
        [--n-transactions 120000] [--n-orgs 800] [--seed 42]
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

SEED = 42

SECTORS = ["bank", "fintech", "telco", "insurance", "mfb", "psp"]
# Relative sector sizes (rough share of the Nigerian regulated landscape)
SECTOR_P = [0.06, 0.30, 0.04, 0.10, 0.35, 0.15]
SECTOR_RISK = {"bank": 0.8, "fintech": 1.4, "telco": 1.0,
               "insurance": 1.1, "mfb": 1.5, "psp": 1.3}

NG_STATES = ["Lagos", "Abuja", "Kano", "Rivers", "Oyo", "Kaduna", "Enugu",
             "Delta", "Anambra", "Ogun", "Borno", "Edo", "Plateau", "Imo"]

# CBN / NFIU cash transaction reporting threshold (₦10m corporates)
REPORTING_THRESHOLD = 10_000_000.0

CHANNELS = ["nip_transfer", "mobile_app", "ussd", "pos", "web", "atm", "agent"]
CHANNEL_P = [0.34, 0.24, 0.10, 0.14, 0.08, 0.06, 0.04]

FRAUD_TYPES = ["structuring", "account_takeover", "cnp_fraud",
               "insider_collusion", "money_mule"]


# --------------------------------------------------------------------------- #
# Organizations
# --------------------------------------------------------------------------- #
def gen_organizations(rng: np.random.Generator, n_orgs: int) -> pd.DataFrame:
    sectors = rng.choice(SECTORS, size=n_orgs, p=SECTOR_P)
    states = rng.choice(NG_STATES, size=n_orgs,
                        p=None if True else None)  # uniform-ish
    orgs = pd.DataFrame({
        "org_id": [f"ORG-{i:05d}" for i in range(n_orgs)],
        "name": [f"{s.title()} Institution {i:04d}" for i, s in enumerate(sectors)],
        "sector": sectors,
        "state": states,
        # log-normal headcount: banks/telcos large, mfbs small
        "employees": np.maximum(3, rng.lognormal(
            mean=np.where(np.isin(sectors, ["bank", "telco"]), 6.0, 3.6),
            sigma=1.0, size=n_orgs)).astype(int),
        "years_active": np.clip(rng.gamma(3.0, 3.0, size=n_orgs), 0.25, 60),
        # monthly tx volume baseline (log scale differs per sector)
        "monthly_tx_volume": np.maximum(50, rng.lognormal(
            mean=np.where(sectors == "bank", 12.0,
                 np.where(sectors == "telco", 11.0,
                 np.where(sectors == "fintech", 10.0, 8.5))),
            sigma=0.9, size=n_orgs)).astype(int),
        "n_officers": np.maximum(1, rng.poisson(4, size=n_orgs) + 1),
    })
    return orgs


# --------------------------------------------------------------------------- #
# Transactions (NIP-style) + fraud typologies
# --------------------------------------------------------------------------- #
def _salary_cycle_weight(days: np.ndarray) -> np.ndarray:
    """Higher payment activity around month-end / month-start (salary cycle)."""
    dom = (days % 30) + 1
    w = np.ones_like(dom, dtype=float)
    w += 1.8 * np.exp(-0.5 * ((dom - 28) / 2.5) ** 2)   # month-end salaries
    w += 1.4 * np.exp(-0.5 * ((dom - 3) / 2.5) ** 2)     # month-start bills
    w += 0.6 * np.exp(-0.5 * ((dom - 15) / 2.0) ** 2)    # mid-month
    return w


def gen_transactions(rng: np.random.Generator, orgs: pd.DataFrame,
                     n_tx: int, fraud_rate: float = 0.003) -> pd.DataFrame:
    org_ids = orgs["org_id"].to_numpy()
    n_orgs = len(org_ids)
    # org popularity ~ proportional to tx volume (sender/receiver choice)
    pop = orgs["monthly_tx_volume"].to_numpy(dtype=float)
    pop = pop / pop.sum()

    senders = rng.choice(n_orgs, size=n_tx, p=pop)
    receivers = rng.choice(n_orgs, size=n_tx, p=pop)
    same = senders == receivers
    receivers[same] = (receivers[same] + 1) % n_orgs

    # --- timestamps: 180 days, business-hours + salary-cycle patterns --- #
    days = rng.choice(180, size=n_tx, p=_salary_cycle_weight(np.arange(180))
                      / _salary_cycle_weight(np.arange(180)).sum())
    # business hours 8–19 peak, some evening, little overnight
    hour_p = np.array([0.1, 0.05, 0.02, 0.01, 0.01, 0.02, 0.05, 0.15,
                       0.35, 0.6, 0.85, 1.0, 0.95, 0.9, 0.85, 0.8,
                       0.75, 0.7, 0.55, 0.4, 0.3, 0.25, 0.2, 0.15])
    hour_p = hour_p / hour_p.sum()
    hours = rng.choice(24, size=n_tx, p=hour_p)
    minutes = rng.integers(0, 60, size=n_tx)
    base = datetime(2024, 1, 1)
    ts = [base + timedelta(days=int(d), hours=int(h), minutes=int(m))
          for d, h, m in zip(days, hours, minutes)]

    # --- amounts: log-normal naira (median ~₦45k, heavy right tail) --- #
    amounts = rng.lognormal(mean=10.7, sigma=1.6, size=n_tx)
    amounts = np.clip(amounts, 100.0, 500_000_000.0)
    # round amounts common for transfers
    round_mask = rng.random(n_tx) < 0.18
    amounts[round_mask] = np.round(amounts[round_mask], -3)

    channels = rng.choice(CHANNELS, size=n_tx, p=CHANNEL_P)

    df = pd.DataFrame({
        "tx_id": [f"TX-{i:09d}" for i in range(n_tx)],
        "timestamp": ts,
        "sender_org": org_ids[senders],
        "receiver_org": org_ids[receivers],
        "amount_naira": np.round(amounts, 2),
        "channel": channels,
        "is_fraud": np.zeros(n_tx, dtype=int),
        "fraud_type": "legit",
        # latent ground-truth attributes used to derive model features
        "new_device": (rng.random(n_tx) < 0.03).astype(int),
        "new_location": (rng.random(n_tx) < 0.04).astype(int),
        "is_insider_ring": np.zeros(n_tx, dtype=int),
        "mule_hop": np.zeros(n_tx, dtype=int),
    })

    # --------------------------- fraud injection ------------------------- #
    n_fraud = int(n_tx * fraud_rate)
    per_type = np.diff(np.linspace(0, n_fraud, len(FRAUD_TYPES) + 1).astype(int))
    fraud_idx = rng.choice(n_tx, size=n_fraud, replace=False)
    cursor = 0
    ts_arr = df["timestamp"].to_numpy()

    for ftype, count in zip(FRAUD_TYPES, per_type):
        if count == 0:
            continue
        idx = fraud_idx[cursor:cursor + count]
        cursor += count
        df.loc[idx, "is_fraud"] = 1
        df.loc[idx, "fraud_type"] = ftype

        if ftype == "structuring":
            # amounts just below the ₦10m reporting threshold, repeated
            df.loc[idx, "amount_naira"] = np.round(
                rng.uniform(9_050_000, 9_990_000, size=len(idx)), 2)
            df.loc[idx, "channel"] = rng.choice(
                ["nip_transfer", "mobile_app", "web"], size=len(idx))
            # burst at quiet hours to avoid attention
            quiet = rng.choice([1, 2, 3, 4, 22, 23], size=len(idx))
            df.loc[idx, "timestamp"] = [
                t.replace(hour=int(h), minute=int(rng.integers(0, 60)))
                for t, h in zip(df.loc[idx, "timestamp"], quiet)]

        elif ftype == "account_takeover":
            # device + location change, velocity spike, odd hours, drain pattern
            df.loc[idx, "new_device"] = 1
            df.loc[idx, "new_location"] = 1
            df.loc[idx, "amount_naira"] = np.round(
                rng.lognormal(mean=13.0, sigma=0.8, size=len(idx)), 2)
            odd_hours = rng.choice([0, 1, 2, 3, 4, 5, 23], size=len(idx))
            df.loc[idx, "timestamp"] = [
                t.replace(hour=int(h), minute=int(rng.integers(0, 60)))
                for t, h in zip(df.loc[idx, "timestamp"], odd_hours)]

        elif ftype == "cnp_fraud":
            # card-not-present: web/mobile, elevated amounts, night-leaning
            df.loc[idx, "channel"] = rng.choice(["web", "mobile_app"],
                                                size=len(idx))
            df.loc[idx, "amount_naira"] = np.round(
                rng.lognormal(mean=11.8, sigma=0.9, size=len(idx)), 2)
            df.loc[idx, "new_device"] = (rng.random(len(idx)) < 0.55).astype(int)

        elif ftype == "insider_collusion":
            # employees steering transfers within a small ring of orgs
            df.loc[idx, "is_insider_ring"] = 1
            df.loc[idx, "amount_naira"] = np.round(
                rng.lognormal(mean=12.6, sigma=0.6, size=len(idx)), 2)

        elif ftype == "money_mule":
            # rapid pass-through chains: A -> mule -> B, second hop flagged
            half = len(idx) // 2
            df.loc[idx[:half], "mule_hop"] = 1
            df.loc[idx[half:2 * half], "mule_hop"] = 2
            df.loc[idx, "amount_naira"] = np.round(
                rng.lognormal(mean=12.2, sigma=0.7, size=len(idx)), 2)
            # hop 2 within 30 minutes of hop 1, amount slightly reduced (fee)
            if half > 0:
                t1 = ts_arr[idx[:half]]
                df.loc[idx[half:2 * half], "timestamp"] = [
                    pd.Timestamp(t) + pd.Timedelta(minutes=int(rng.integers(3, 30)))
                    for t in t1]
                df.loc[idx[half:2 * half], "amount_naira"] = (
                    df.loc[idx[:half], "amount_naira"].to_numpy()
                    * rng.uniform(0.92, 0.98, size=half)).round(2)

    df = df.sort_values("timestamp").reset_index(drop=True)
    return df


# --------------------------------------------------------------------------- #
# Feature engineering for the fraud model (kept here so train + inference
# use the exact same definitions).
# --------------------------------------------------------------------------- #
FRAUD_FEATURES = [
    "amount_log", "hour_of_day", "is_night", "is_weekend",
    "day_of_month", "salary_window", "channel_code",
    "sender_tx_count_1h", "sender_amount_ratio", "receiver_fan_in_24h",
    "new_device", "new_location", "just_below_threshold",
    "is_round_amount", "mule_hop", "is_insider_ring",
]


def engineer_fraud_features(tx: pd.DataFrame) -> pd.DataFrame:
    df = tx.copy()
    ts = pd.to_datetime(df["timestamp"])
    df["amount_log"] = np.log1p(df["amount_naira"])
    df["hour_of_day"] = ts.dt.hour
    df["is_night"] = ((ts.dt.hour < 6) | (ts.dt.hour >= 22)).astype(int)
    df["is_weekend"] = (ts.dt.dayofweek >= 5).astype(int)
    df["day_of_month"] = ts.dt.day
    df["salary_window"] = ((ts.dt.day >= 26) | (ts.dt.day <= 5)).astype(int)
    df["channel_code"] = pd.Categorical(df["channel"],
                                        categories=CHANNELS).codes
    df["just_below_threshold"] = (
        (df["amount_naira"] >= 0.90 * REPORTING_THRESHOLD)
        & (df["amount_naira"] < REPORTING_THRESHOLD)).astype(int)
    df["is_round_amount"] = (df["amount_naira"] % 1000 == 0).astype(int)

    # sender velocity + receiver fan-in + amount ratio: rolling time windows
    # per entity (explicit per-group loop — robust to pandas apply alignment)
    df = df.sort_values("timestamp").reset_index(drop=True)

    sender_cnt = pd.Series(1.0, index=df.index)
    receiver_cnt = pd.Series(1.0, index=df.index)
    amount_ratio = pd.Series(1.0, index=df.index)
    for _, g in df.groupby("sender_org", sort=False):
        s = g.set_index("timestamp")["tx_id"].rolling("1h").count()
        sender_cnt.loc[g.index] = s.to_numpy()
        r = g.set_index("timestamp")["amount_naira"]
        m = r.rolling("7d", min_periods=1).median().shift(1)
        m = m.fillna(r)
        amount_ratio.loc[g.index] = (r / m.replace(0, np.nan)).fillna(1.0).to_numpy()
    for _, g in df.groupby("receiver_org", sort=False):
        s = g.set_index("timestamp")["tx_id"].rolling("24h").count()
        receiver_cnt.loc[g.index] = s.to_numpy()

    df["sender_tx_count_1h"] = sender_cnt.fillna(1.0)
    df["receiver_fan_in_24h"] = receiver_cnt.fillna(1.0)
    df["sender_amount_ratio"] = amount_ratio.fillna(1.0)
    return df


# --------------------------------------------------------------------------- #
# Credit / compliance features per org + default label (NO leakage)
# --------------------------------------------------------------------------- #
CREDIT_FEATURES = [
    "log_tx_volume", "penalties_count_24m", "log_total_fines",
    "compliance_score", "violations_count_24m", "breach_incidents_24m",
    "sector_risk", "log_employees", "years_active", "audit_findings_open",
]


def gen_credit(rng: np.random.Generator, orgs: pd.DataFrame) -> pd.DataFrame:
    n = len(orgs)
    sector = orgs["sector"].to_numpy()
    sector_risk = np.array([SECTOR_RISK[s] for s in sector])

    compliance_score = np.clip(
        rng.normal(72 - 8 * np.log1p(sector_risk), 12, size=n), 5, 100)
    violations = rng.poisson(np.clip(3.2 * sector_risk
                                     * (100 - compliance_score) / 70, 0.05, 20))
    penalties = rng.poisson(np.clip(0.35 * violations, 0.02, 8))
    total_fines = penalties * rng.lognormal(15.5, 1.1, size=n)  # naira
    breaches = rng.poisson(np.clip(0.12 * violations
                                   * (100 - compliance_score) / 80, 0.0, 6))
    audit_open = rng.poisson(np.clip(violations * 0.4, 0.0, 10))

    df = pd.DataFrame({
        "org_id": orgs["org_id"],
        "sector": sector,
        "log_tx_volume": np.log1p(orgs["monthly_tx_volume"]),
        "penalties_count_24m": penalties,
        "log_total_fines": np.log1p(total_fines),
        "compliance_score": np.round(compliance_score, 2),
        "violations_count_24m": violations,
        "breach_incidents_24m": breaches,
        "sector_risk": sector_risk,
        "log_employees": np.log1p(orgs["employees"]),
        "years_active": np.round(orgs["years_active"], 2),
        "audit_findings_open": audit_open,
    })

    # Default probability: logistic over MULTIPLE standardised features.
    # Coefficients deliberately spread so no single feature determines the
    # label (this is the anti-leakage fix vs the old ray_ml_engine labels).
    X = df[CREDIT_FEATURES].to_numpy(dtype=float)
    Xs = (X - X.mean(axis=0)) / (X.std(axis=0) + 1e-9)
    beta = np.array([0.10, 0.55, 0.35, -0.75, 0.55, 0.45,
                     0.30, -0.15, -0.35, 0.40])
    logit = Xs @ beta - 3.1                      # intercept tuned ~8-10% base
    logit += rng.normal(0, 0.6, size=n)          # irreducible noise
    p_default = 1.0 / (1.0 + np.exp(-logit))
    df["default_24m"] = (rng.random(n) < p_default).astype(int)
    df["p_default_latent"] = np.round(p_default, 4)
    return df


# --------------------------------------------------------------------------- #
# Compliance graph
# --------------------------------------------------------------------------- #
NODE_FEATURE_DIM = 20


def gen_graph(rng: np.random.Generator, orgs: pd.DataFrame,
              credit: pd.DataFrame):
    """Compliance graph: orgs, violations, enforcement actions, officers.

    Org node features reuse credit features (real signal); high-risk labels
    are derived from neighbourhoods (violations + enforcement + risky
    peers), so a GNN that aggregates neighbour information has something
    real to learn beyond raw node features.
    """
    n_orgs = len(orgs)
    c = credit.set_index("org_id")

    nodes, edges = [], []

    # --- org nodes: features = [type one-hot (4) | scaled credit feats | pad]
    Xc = c[CREDIT_FEATURES].to_numpy(dtype=float)
    Xc = (Xc - Xc.mean(axis=0)) / (Xc.std(axis=0) + 1e-9)
    for i, oid in enumerate(orgs["org_id"]):
        feat = np.zeros(NODE_FEATURE_DIM)
        feat[0] = 1.0                       # node type: organization
        feat[4:4 + Xc.shape[1]] = Xc[i][:10]
        feat[14 + SECTORS.index(c.loc[oid, "sector"])] = 1.0  # sector one-hot
        nodes.append({"node_id": i, "ref_id": oid, "node_type": "organization",
                      **{f"f{j}": feat[j] for j in range(NODE_FEATURE_DIM)}})

    node_idx = n_orgs
    org_risk_latent = np.zeros(n_orgs)

    # --- violation nodes --- #
    n_viol = int(rng.poisson(1.8, n_orgs).sum()) + n_orgs // 2
    vio_orgs = rng.choice(n_orgs, size=n_viol,
                          p=(c["violations_count_24m"].to_numpy() + 0.3)
                          / (c["violations_count_24m"].sum() + 0.3 * n_orgs))
    for k in range(n_viol):
        o = vio_orgs[k]
        feat = np.zeros(NODE_FEATURE_DIM)
        feat[1] = 1.0                       # node type: violation
        feat[4] = rng.normal(1.0, 0.3)      # severity (standardised-ish)
        feat[5] = rng.uniform(-1, 1)        # age
        nodes.append({"node_id": node_idx, "ref_id": f"VIO-{k:06d}",
                      "node_type": "violation",
                      **{f"f{j}": feat[j] for j in range(NODE_FEATURE_DIM)}})
        edges.append({"src": int(o), "dst": node_idx, "edge_type": "HAS_VIOLATION"})
        org_risk_latent[o] += 1.0
        node_idx += 1

    # --- enforcement action nodes --- #
    n_enf = n_viol // 3
    enf_orgs = rng.choice(n_orgs, size=n_enf,
                          p=(org_risk_latent + 0.2) / (org_risk_latent.sum()
                                                       + 0.2 * n_orgs))
    for k in range(n_enf):
        o = enf_orgs[k]
        feat = np.zeros(NODE_FEATURE_DIM)
        feat[2] = 1.0                       # node type: enforcement
        feat[4] = rng.normal(1.4, 0.3)
        nodes.append({"node_id": node_idx, "ref_id": f"ENF-{k:06d}",
                      "node_type": "enforcement_action",
                      **{f"f{j}": feat[j] for j in range(NODE_FEATURE_DIM)}})
        edges.append({"src": node_idx, "dst": int(o), "edge_type": "ENFORCED_BY"})
        org_risk_latent[o] += 2.5
        node_idx += 1

    # --- officer nodes (insider collusion rings) --- #
    n_officers = int(orgs["n_officers"].sum())
    officer_of = np.repeat(np.arange(n_orgs), orgs["n_officers"].to_numpy())
    # a few collusion rings: officers sharing SECTOR_PEER-like dense links
    n_rings = max(3, n_orgs // 80)
    ring_orgs = rng.choice(n_orgs, size=n_rings, replace=False)
    ring_officers = set()
    for k in range(n_officers):
        feat = np.zeros(NODE_FEATURE_DIM)
        feat[3] = 1.0                       # node type: officer
        feat[4] = rng.normal(0, 1)
        nodes.append({"node_id": node_idx, "ref_id": f"OFF-{k:06d}",
                      "node_type": "officer",
                      **{f"f{j}": feat[j] for j in range(NODE_FEATURE_DIM)}})
        o = officer_of[k]
        edges.append({"src": int(o), "dst": node_idx, "edge_type": "EMPLOYS"})
        if o in ring_orgs:
            ring_officers.add(node_idx)
            org_risk_latent[o] += 0.8
        node_idx += 1
    # dense cross-links inside each ring (collusion communities)
    ring_officers = sorted(ring_officers)
    for a in ring_officers:
        for b in rng.choice(ring_officers,
                            size=min(4, len(ring_officers)), replace=False):
            if a != b:
                edges.append({"src": int(a), "dst": int(b),
                              "edge_type": "SECTOR_PEER"})

    # --- org-org edges: SECTOR_PEER + TRANSACTS_WITH --- #
    sector_of = orgs["sector"].to_numpy()
    for i in range(n_orgs):
        peers = np.where(sector_of == sector_of[i])[0]
        peers = peers[peers != i]
        for j in rng.choice(peers, size=min(2, len(peers)), replace=False):
            edges.append({"src": i, "dst": int(j), "edge_type": "SECTOR_PEER"})
        # transacting counterparties, preferentially same-ish risk profile
        n_partners = rng.integers(2, 6)
        for j in rng.choice(n_orgs, size=n_partners, replace=False):
            if i != j:
                edges.append({"src": i, "dst": int(j),
                              "edge_type": "TRANSACTS_WITH"})
                # risk is contagious: transacting with risky orgs adds risk
                org_risk_latent[i] += 0.15 * (org_risk_latent[j] > 2.5)

    nodes_df = pd.DataFrame(nodes)
    edges_df = pd.DataFrame(edges).drop_duplicates(subset=["src", "dst",
                                                           "edge_type"])

    # --- labels: high-risk org nodes from neighbourhood-derived latent --- #
    thresh = np.quantile(org_risk_latent, 0.85)
    noisy = org_risk_latent + rng.normal(0, 0.5, size=n_orgs)
    labels = (noisy >= thresh).astype(int)
    labels_df = pd.DataFrame({
        "org_id": orgs["org_id"],
        "node_id": np.arange(n_orgs),
        "high_risk": labels,
        "risk_latent": np.round(org_risk_latent, 3),
    })
    return nodes_df, edges_df, labels_df


# --------------------------------------------------------------------------- #
# Persistence (parquet with CSV fallback)
# --------------------------------------------------------------------------- #
def _write(df: pd.DataFrame, path_base: str) -> str:
    try:
        import pyarrow  # noqa: F401
        out = path_base + ".parquet"
        df.to_parquet(out, index=False)
        return out
    except Exception:
        out = path_base + ".csv"
        df.to_csv(out, index=False)
        return out


def generate(output_dir: str, n_transactions: int = 120_000,
             n_orgs: int = 800, seed: int = SEED,
             fraud_rate: float = 0.003) -> dict:
    rng = np.random.default_rng(seed)
    os.makedirs(output_dir, exist_ok=True)

    orgs = gen_organizations(rng, n_orgs)
    tx = gen_transactions(rng, orgs, n_transactions, fraud_rate=fraud_rate)
    tx_feat = engineer_fraud_features(tx)
    credit = gen_credit(rng, orgs)
    gnodes, gedges, glabels = gen_graph(rng, orgs, credit)

    written = {}
    for name, df in [("organizations", orgs), ("transactions", tx_feat),
                     ("credit_features", credit), ("graph_nodes", gnodes),
                     ("graph_edges", gedges), ("graph_labels", glabels)]:
        written[name] = _write(df, os.path.join(output_dir, name))

    manifest = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "seed": seed,
        "n_orgs": int(n_orgs),
        "n_transactions": int(len(tx_feat)),
        "fraud_rate": float(tx_feat["is_fraud"].mean()),
        "fraud_rate_target": fraud_rate,
        "fraud_type_counts": tx_feat[tx_feat["is_fraud"] == 1]["fraud_type"]
            .value_counts().to_dict(),
        "credit_default_rate": float(credit["default_24m"].mean()),
        "graph": {"n_nodes": int(len(gnodes)), "n_edges": int(len(gedges)),
                  "high_risk_rate": float(glabels["high_risk"].mean())},
        "files": written,
        "disclaimer": ("Synthetic data standing in until production DB "
                       "pipelines feed real data. See module docstring."),
    }
    with open(os.path.join(output_dir, "_manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2, default=str)
    return manifest


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--output-dir", default=os.path.join(
        os.path.dirname(__file__), "output"))
    ap.add_argument("--n-transactions", type=int, default=120_000)
    ap.add_argument("--n-orgs", type=int, default=800)
    ap.add_argument("--seed", type=int, default=SEED)
    args = ap.parse_args()
    manifest = generate(args.output_dir, args.n_transactions,
                        args.n_orgs, args.seed)
    print(json.dumps(manifest, indent=2, default=str))


if __name__ == "__main__":
    main()
