#!/usr/bin/env python3
"""Case-outcome label builders (round 12, wave 5 — roadmap §4.2/§4.5).

Turn FINAL platform outcomes into training frames under
ml/lakehouse/labels/<name>/ (lakehouse snapshots, parquet with CSV fallback,
watermarked so re-runs are incremental):

  triage            one row per complaint: predicted vs final assigned
                    team/category from complaint_events 'assigned' history,
                    plus resolution_notes presence (a proxy for "triage led
                    to a handled case").
  settlement        one row per TERMINAL settlement (fulfilled=1 /
                    defaulted=0; 'void' and in-flight states excluded),
                    with terms-derived features (amount, instalments,
                    obligations, reduction ratio).
  penalty_survival  one row per adjudicated appeal: penalty upheld=1 /
                    reduced-or-void=0, from appeal_hearings.outcome and
                    tribunal_escalations decisions.

PRIVACY (fail-closed): no raw PII leaves these builders. All identifiers
(complaint reference, officer names, settlement refs, org/appeal ids) are
pseudonymized with sha256(salt || value). ml/ has no existing HMAC helper,
so the salt comes from env NDSEP_LABEL_HASH_SALT (or ANONYMIZATION_SALT as
a fallback, matching server/dataAnonymization.ts); when no salt is set the
pseudonymizer RAISES — better no labels than leaked identifiers.

Every production run is recorded in the label_runs audit table (migration
0133) when the DB is reachable; the audit write is best-effort and never
blocks label production.

    python -m ml.labels.case_outcome_labels            # all three, incremental
    python -m ml.labels.case_outcome_labels --only triage
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime

import numpy as np
import pandas as pd

from ml.training import lakehouse

LABEL_DATASETS = {
    "triage": "labels/triage",
    "settlement": "labels/settlement_outcome",
    "penalty_survival": "labels/penalty_survival",
}
WATERMARKS = {
    "triage": "label_triage",
    "settlement": "label_settlement",
    "penalty_survival": "label_penalty_survival",
}

# --------------------------------------------------------------------------- #
# Pseudonymization (fail-closed)
# --------------------------------------------------------------------------- #
SALT_ENV_VARS = ("NDSEP_LABEL_HASH_SALT", "ANONYMIZATION_SALT")


def _salt() -> str:
    for var in SALT_ENV_VARS:
        val = os.environ.get(var)
        if val:
            return val
    raise RuntimeError(
        "no label hash salt configured — set NDSEP_LABEL_HASH_SALT "
        "(or ANONYMIZATION_SALT). Refusing to emit identifiers unpseudonymized.")


def pseudonymize(value) -> str | None:
    """Deterministic salted sha256 pseudonym; None stays None.

    Raises RuntimeError when no salt is configured (fail-closed).
    """
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    s = str(value)
    if not s:
        return None
    return hashlib.sha256((_salt() + ":" + s).encode()).hexdigest()


# --------------------------------------------------------------------------- #
# (a) Triage labels from complaint_events + public_complaints
# --------------------------------------------------------------------------- #
def _detail_str(details, keys: tuple[str, ...]) -> str | None:
    """First non-empty string value among `keys` in an event details dict."""
    if isinstance(details, str):
        try:
            details = json.loads(details)
        except ValueError:
            return None
    if not isinstance(details, dict):
        return None
    for k in keys:
        v = details.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def build_triage_labels(complaints: pd.DataFrame,
                        events: pd.DataFrame) -> pd.DataFrame:
    """One label row per complaint.

    complaints columns used: id, reference_code, category, channel (opt),
    state (opt), resolution_notes, updated_at.
    events columns used: complaint_id, event_type, details, created_at.
    """
    out_cols = ["complaint_ref_hash", "category", "predicted_category",
                "final_category", "predicted_team", "final_team",
                "has_resolution_notes", "triage_correct", "updated_at"]
    if not len(complaints):
        return pd.DataFrame(columns=out_cols)

    ev = events.copy()
    if len(ev):
        ev = ev.sort_values("created_at")
        assigned = ev[ev["event_type"] == "assigned"]
        # latest 'assigned' event per complaint = the FINAL routing decision;
        # the earliest = what triage (human or AI) first proposed.
        first = assigned.drop_duplicates("complaint_id", keep="first")
        last = assigned.drop_duplicates("complaint_id", keep="last")
    else:
        first = last = ev

    def _per_complaint(sub, keys):
        return pd.Series(
            {cid: _detail_str(g.iloc[0]["details"], keys)
             for cid, g in sub.groupby("complaint_id")})

    pred_cat = _per_complaint(first, ("predicted_category", "suggested_category",
                                      "ai_category"))
    pred_team = _per_complaint(first, ("predicted_team", "suggested_team",
                                       "ai_team"))
    final_cat = _per_complaint(last, ("category", "final_category",
                                      "assigned_category"))
    final_team = _per_complaint(last, ("team", "assigned_team", "final_team",
                                       "assignee_team"))

    df = complaints.copy()
    df["complaint_ref_hash"] = df["reference_code"].map(pseudonymize) \
        if "reference_code" in df.columns else \
        df["id"].map(lambda v: pseudonymize(f"complaint:{v}"))
    df["predicted_category"] = df["id"].map(pred_cat)
    df["final_category"] = df["id"].map(final_cat)
    df["predicted_team"] = df["id"].map(pred_team)
    df["final_team"] = df["id"].map(final_team)
    # Final category falls back to the complaint's own recorded category
    # when no assignment event captured one.
    if "category" in df.columns:
        df["final_category"] = df["final_category"].fillna(df["category"])
    notes = df.get("resolution_notes")
    df["has_resolution_notes"] = (
        notes.fillna("").astype(str).str.strip().ne("").astype(int)
        if notes is not None else 0)
    both = df["predicted_category"].notna() & df["final_category"].notna()
    df["triage_correct"] = np.where(
        both, (df["predicted_category"] == df["final_category"]).astype(float),
        np.nan)
    keep = [c for c in out_cols if c in df.columns or c == "updated_at"]
    if "updated_at" not in df.columns:
        df["updated_at"] = pd.NaT
    for c in ("category", "channel", "state"):
        if c in df.columns and c not in keep:
            keep.insert(1, c)
    return df[keep].reset_index(drop=True)


# --------------------------------------------------------------------------- #
# (b) Settlement outcome labels
# --------------------------------------------------------------------------- #
def build_settlement_labels(settlements: pd.DataFrame,
                            terms: pd.DataFrame) -> pd.DataFrame:
    """One label row per settlement in a terminal state.

    Label: fulfilled=1, defaulted=0; 'void' and in-flight statuses are
    EXCLUDED (a voided negotiation carries no outcome signal).
    settlements columns used: id, settlement_ref, org_id, status,
    original_amount, reduction_amount, current_terms_version, updated_at.
    terms columns used: settlement_id, version, monetary_amount,
    non_monetary_obligations, instalment_schedule, confidentiality_flag.
    """
    out_cols = ["settlement_ref_hash", "org_hash", "settled_fulfilled",
                "monetary_amount", "n_instalments", "n_obligations",
                "confidential", "reduction_ratio", "updated_at"]
    df = settlements[settlements["status"].isin(["fulfilled", "defaulted"])] \
        .copy()
    if not len(df):
        return pd.DataFrame(columns=out_cols)

    t = terms.copy()
    if len(t):
        # current agreed terms = highest version per settlement
        t = (t.sort_values("version")
              .drop_duplicates("settlement_id", keep="last")
              .set_index("settlement_id"))
    def _t(col, sid, default=None):
        try:
            v = t.at[sid, col]
            return default if (v is None or (isinstance(v, float)
                                             and np.isnan(v))) else v
        except Exception:
            return default

    def _jlen(v):
        if isinstance(v, str):
            try:
                v = json.loads(v)
            except ValueError:
                return 0
        return len(v) if isinstance(v, (list, dict)) else 0

    df["settlement_ref_hash"] = df["settlement_ref"].map(pseudonymize) \
        if "settlement_ref" in df.columns else \
        df["id"].map(lambda v: pseudonymize(f"settlement:{v}"))
    df["org_hash"] = (df["org_id"].map(lambda v: pseudonymize(f"org:{v}"))
                      if "org_id" in df.columns else None)
    df["settled_fulfilled"] = (df["status"] == "fulfilled").astype(int)
    df["monetary_amount"] = df["id"].map(
        lambda sid: float(_t("monetary_amount", sid, 0.0) or 0.0))
    df["n_instalments"] = df["id"].map(
        lambda sid: _jlen(_t("instalment_schedule", sid, [])))
    df["n_obligations"] = df["id"].map(
        lambda sid: _jlen(_t("non_monetary_obligations", sid, [])))
    df["confidential"] = df["id"].map(
        lambda sid: int(bool(_t("confidentiality_flag", sid, False))))
    orig = pd.to_numeric(df.get("original_amount"), errors="coerce")
    red = pd.to_numeric(df.get("reduction_amount"), errors="coerce").fillna(0)
    df["reduction_ratio"] = np.where(orig > 0, (red / orig).clip(0, 1), 0.0)
    if "updated_at" not in df.columns:
        df["updated_at"] = pd.NaT
    return df[out_cols].reset_index(drop=True)


# --------------------------------------------------------------------------- #
# (c) Penalty-survival labels (appeals + tribunal)
# --------------------------------------------------------------------------- #
_UPHELD_TOKENS = ("upheld", "dismissed", "affirmed", "confirmed", "struck")
_REDUCED_TOKENS = ("reduced", "partial", "quash", "overturn", "void",
                   "allowed", "set aside", "remit", "vary", "varied",
                   "cancel")


def normalize_adjudication(text: str | None) -> int | None:
    """Map a free-text appeal/tribunal outcome to a penalty-survival label.

    1 = penalty upheld (appeal dismissed / penalty affirmed),
    0 = penalty reduced or voided (appeal allowed, amount varied, quashed),
    None = unmappable (caller excludes the row).
    """
    if not text:
        return None
    s = str(text).lower()
    if any(tok in s for tok in _REDUCED_TOKENS):
        return 0
    if any(tok in s for tok in _UPHELD_TOKENS):
        return 1
    return None


def build_penalty_survival_labels(hearings: pd.DataFrame,
                                  escalations: pd.DataFrame) -> pd.DataFrame:
    """One label row per adjudicated appeal.

    Sources:
      appeal_hearings (status='held', outcome recorded)
      tribunal_escalations (status='decided', decision recorded)
    Latest decision per appeal_id wins (tribunal outranks a hearing).
    """
    out_cols = ["appeal_hash", "penalty_hash", "source", "penalty_upheld",
                "decided_at"]
    frames = []
    if len(hearings):
        h = hearings.copy()
        h = h[(h["status"] == "held") & h["outcome"].notna()]
        h["penalty_upheld"] = h["outcome"].map(normalize_adjudication)
        h = h[h["penalty_upheld"].notna()]
        h["source"] = "appeal_hearing"
        h["decided_at"] = h.get("updated_at", pd.NaT)
        h["penalty_hash"] = None
        frames.append(h[["appeal_id", "penalty_hash", "source",
                         "penalty_upheld", "decided_at"]])
    if len(escalations):
        e = escalations.copy()
        e = e[e["status"] == "decided"]
        dec_src = e["decision"] if "decision" in e.columns else None
        e["penalty_upheld"] = (dec_src.map(normalize_adjudication)
                               if dec_src is not None else None)
        e = e[e["penalty_upheld"].notna()]
        e["source"] = "tribunal"
        e["decided_at"] = e["decided_at"] if "decided_at" in e.columns \
            else e.get("updated_at", pd.NaT)
        e["penalty_hash"] = (e["penalty_id"].map(
            lambda v: pseudonymize(f"penalty:{v}"))
            if "penalty_id" in e.columns else None)
        frames.append(e[["appeal_id", "penalty_hash", "source",
                         "penalty_upheld", "decided_at"]])
    if not frames:
        return pd.DataFrame(columns=out_cols)
    df = pd.concat(frames, ignore_index=True)
    df["penalty_upheld"] = df["penalty_upheld"].astype(int)
    df = df.sort_values("decided_at").drop_duplicates("appeal_id", keep="last")
    df["appeal_hash"] = df["appeal_id"].map(lambda v: pseudonymize(f"appeal:{v}"))
    return df[out_cols].reset_index(drop=True)


# --------------------------------------------------------------------------- #
# DB extraction + production orchestration
# --------------------------------------------------------------------------- #
_QUERIES = {
    "triage": (
        """SELECT id, reference_code, category, state,
                  resolution_notes, updated_at
           FROM public_complaints
           WHERE (%s::timestamptz IS NULL OR updated_at > %s::timestamptz)
           ORDER BY updated_at LIMIT 100000""",
        """SELECT complaint_id, event_type, details, created_at
           FROM complaint_events
           WHERE (%s::timestamptz IS NULL OR created_at > %s::timestamptz)
           ORDER BY created_at LIMIT 500000"""),
    "settlement": (
        """SELECT id, settlement_ref, org_id, status, original_amount,
                  reduction_amount, current_terms_version, updated_at
           FROM settlements
           WHERE (%s::timestamptz IS NULL OR updated_at > %s::timestamptz)
           ORDER BY updated_at LIMIT 100000""",
        """SELECT settlement_id, version, monetary_amount,
                  non_monetary_obligations, instalment_schedule,
                  confidentiality_flag
           FROM settlement_terms LIMIT 500000"""),
    "penalty_survival": (
        """SELECT id AS appeal_id, status, outcome, updated_at
           FROM appeal_hearings
           WHERE (%s::timestamptz IS NULL OR updated_at > %s::timestamptz)
           ORDER BY updated_at LIMIT 200000""",
        """SELECT appeal_id, penalty_id, status, decision, decided_at,
                  updated_at
           FROM tribunal_escalations
           WHERE (%s::timestamptz IS NULL OR updated_at > %s::timestamptz)
           ORDER BY updated_at LIMIT 200000"""),
}

_BUILDERS = {"triage": build_triage_labels,
             "settlement": build_settlement_labels,
             "penalty_survival": build_penalty_survival_labels}


def _db_connect():
    dsn = (os.environ.get("DATABASE_URL") or os.environ.get("WORKER_DATABASE_URL"))
    if not dsn:
        return None
    import psycopg2
    return psycopg2.connect(dsn, connect_timeout=3)


def _fetch(conn, sql: str, since: str | None) -> pd.DataFrame:
    with conn.cursor() as cur:
        cur.execute(sql, (since, since))
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description]
    return pd.DataFrame(rows, columns=cols)


def record_label_run(conn, labeler: str, rows_produced: int,
                     watermark: str | None, started_at: str) -> None:
    """Best-effort audit row in label_runs (migration 0133). Never raises."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO label_runs
                       (labeler, rows_produced, watermark, started_at,
                        finished_at)
                   VALUES (%s, %s, %s, %s::timestamptz, NOW())""",
                (labeler, int(rows_produced), watermark, started_at))
        conn.commit()
    except Exception as e:
        print(f"[labels] label_runs audit write skipped: {e}")
        try:
            conn.rollback()
        except Exception:
            pass


def _merge_history(dataset: str, new: pd.DataFrame, key: str,
                   root: str) -> pd.DataFrame:
    """Combine the new label batch with prior snapshots (latest per key)."""
    snaps = lakehouse.list_snapshots(dataset, root=root)
    if snaps:
        old = pd.concat([lakehouse.load_snapshot(dataset, s["snapshot_id"],
                                                 root=root) for s in snaps],
                        ignore_index=True)
        new = pd.concat([old, new], ignore_index=True)
    return new.drop_duplicates(key, keep="last")


_KEY_COL = {"triage": "complaint_ref_hash",
            "settlement": "settlement_ref_hash",
            "penalty_survival": "appeal_hash"}
_WM_COL = {"triage": "updated_at", "settlement": "updated_at",
           "penalty_survival": "decided_at"}


def produce_labels(only: list[str] | None = None,
                   root: str = lakehouse.DEFAULT_ROOT) -> dict | None:
    """Incrementally (re)build all requested label frames.

    Watermarks advance ONLY after the snapshot has been persisted; each run
    is audited to label_runs when the table exists. Returns per-labeler
    summaries, or None when the DB is unreachable.
    """
    conn = _db_connect()
    if conn is None:
        print("[labels] DATABASE_URL not set — cannot produce labels")
        return None
    summaries = {}
    try:
        for name in (only or list(LABEL_DATASETS)):
            started = datetime.utcnow().isoformat() + "Z"
            wm = lakehouse.load_watermark(WATERMARKS[name], root=root)
            q_main, q_aux = _QUERIES[name]
            main_df = _fetch(conn, q_main, wm)
            # aux tables (events/terms) are cheap dimension reads; watermark
            # them on their own clock where the schema has one.
            aux_df = _fetch(conn, q_aux, wm if name != "settlement" else None)
            labels = _BUILDERS[name](main_df, aux_df)
            if len(labels):
                merged = _merge_history(LABEL_DATASETS[name], labels,
                                        _KEY_COL[name], root)
                entry = lakehouse.save_snapshot(
                    merged, LABEL_DATASETS[name], root=root,
                    # microseconds: avoid same-second snapshot-id collisions
                    snapshot_id="v" + datetime.utcnow().strftime("%Y%m%dT%H%M%S%f"),
                    meta={"kind": f"outcome_labels:{name}"})
                print(f"[labels] {name}: {len(labels)} new rows "
                      f"({len(merged)} total) -> {entry['snapshot_id']}")
                wm_col = _WM_COL[name]
                if wm_col in labels.columns and labels[wm_col].notna().any():
                    wm = str(pd.to_datetime(labels[wm_col]).max())
                    lakehouse.save_watermark(WATERMARKS[name], wm, root=root)
            else:
                print(f"[labels] {name}: no new labeled rows since {wm}")
            record_label_run(conn, name, len(labels), wm, started)
            summaries[name] = {"rows_produced": int(len(labels)),
                               "watermark": wm}
    finally:
        conn.close()
    return summaries


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", choices=list(LABEL_DATASETS), nargs="+",
                    default=None)
    args = ap.parse_args()
    summaries = produce_labels(only=args.only)
    if summaries is not None:
        print(json.dumps(summaries, indent=2, default=str))


if __name__ == "__main__":
    main()
