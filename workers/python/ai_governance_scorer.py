#!/usr/bin/env python3
"""
AI Governance Risk Scorer — NDSEP Enhancement
Implements NDPA Article 24 automated decision-making risk assessment.
Scores AI systems on fairness, transparency, accountability, and data minimisation.
"""
import os
import json
import logging
import time
import hashlib
from datetime import datetime, timezone
from typing import Optional
import psycopg2
from psycopg2.extras import RealDictCursor

logging.basicConfig(level=logging.INFO, format="%(asctime)s [ai_governance_scorer] %(levelname)s %(message)s")
log = logging.getLogger(__name__)

DB_URL = os.environ.get(
    "NDSEP_PG_URL",
    "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"
)

# ─── Risk Scoring Rubric ──────────────────────────────────────────────────────
# Each dimension scored 0-100. Composite = weighted average.
DIMENSION_WEIGHTS = {
    "transparency":     0.25,   # Is the model explainable? Are decisions communicated?
    "fairness":         0.25,   # Bias testing, demographic parity checks
    "accountability":   0.20,   # Audit trails, human oversight, DPO involvement
    "data_minimisation":0.15,   # Minimum data used, retention limits enforced
    "security":         0.15,   # Encryption, access controls, adversarial robustness
}

RISK_THRESHOLDS = {
    "low":      80,   # score >= 80 → low risk
    "medium":   60,   # score >= 60 → medium risk
    "high":     40,   # score >= 40 → high risk
    "critical": 0,    # score < 40  → critical risk
}


def score_ai_system(system: dict) -> dict:
    """
    Score an AI system record from the ai_systems table.
    Returns a dict with per-dimension scores, composite score, risk level, and recommendations.
    """
    scores = {}
    recommendations = []

    # ── Transparency ──────────────────────────────────────────────────────────
    t_score = 50
    if system.get("is_explainable"):
        t_score += 20
    if system.get("decision_communication_method") in ("written_notice", "portal", "email"):
        t_score += 15
    if system.get("has_privacy_notice"):
        t_score += 15
    scores["transparency"] = min(100, t_score)
    if t_score < 60:
        recommendations.append("Implement explainability layer (SHAP/LIME) and publish model card.")

    # ── Fairness ─────────────────────────────────────────────────────────────
    f_score = 40
    if system.get("bias_testing_conducted"):
        f_score += 30
    if system.get("demographic_parity_checked"):
        f_score += 20
    if system.get("fairness_metric") in ("equalized_odds", "demographic_parity", "calibration"):
        f_score += 10
    scores["fairness"] = min(100, f_score)
    if f_score < 60:
        recommendations.append("Conduct bias audit across protected attributes (gender, ethnicity, age).")

    # ── Accountability ────────────────────────────────────────────────────────
    a_score = 30
    if system.get("has_audit_trail"):
        a_score += 25
    if system.get("human_oversight_enabled"):
        a_score += 25
    if system.get("dpo_reviewed"):
        a_score += 20
    scores["accountability"] = min(100, a_score)
    if a_score < 60:
        recommendations.append("Establish human-in-the-loop review process and DPO sign-off procedure.")

    # ── Data Minimisation ─────────────────────────────────────────────────────
    dm_score = 50
    if system.get("uses_minimum_data"):
        dm_score += 25
    if system.get("retention_policy_enforced"):
        dm_score += 25
    scores["data_minimisation"] = min(100, dm_score)
    if dm_score < 60:
        recommendations.append("Review training data scope; enforce automated deletion after retention period.")

    # ── Security ─────────────────────────────────────────────────────────────
    s_score = 40
    if system.get("model_encrypted_at_rest"):
        s_score += 20
    if system.get("access_controls_enforced"):
        s_score += 20
    if system.get("adversarial_testing_done"):
        s_score += 20
    scores["security"] = min(100, s_score)
    if s_score < 60:
        recommendations.append("Encrypt model artefacts at rest and conduct adversarial robustness testing.")

    # ── Composite ─────────────────────────────────────────────────────────────
    composite = sum(scores[dim] * DIMENSION_WEIGHTS[dim] for dim in DIMENSION_WEIGHTS)
    composite = round(composite, 1)

    risk_level = "critical"
    for level, threshold in RISK_THRESHOLDS.items():
        if composite >= threshold:
            risk_level = level
            break

    return {
        "system_id": system.get("id"),
        "system_name": system.get("name", "Unknown"),
        "composite_score": composite,
        "risk_level": risk_level,
        "dimension_scores": scores,
        "recommendations": recommendations,
        "scored_at": datetime.now(timezone.utc).isoformat(),
    }


def get_connection():
    return psycopg2.connect(DB_URL, cursor_factory=RealDictCursor)


def ensure_scores_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS ai_governance_scores (
                id SERIAL PRIMARY KEY,
                system_id INTEGER,
                system_name TEXT,
                composite_score NUMERIC(5,1),
                risk_level TEXT,
                dimension_scores JSONB,
                recommendations JSONB,
                scored_at TIMESTAMPTZ DEFAULT NOW(),
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_ai_gov_scores_system ON ai_governance_scores(system_id);
            CREATE INDEX IF NOT EXISTS idx_ai_gov_scores_risk ON ai_governance_scores(risk_level);
        """)
        conn.commit()
        log.info("ai_governance_scores table ensured")


def score_all_systems():
    """Score all AI systems in the database and persist results."""
    conn = get_connection()
    ensure_scores_table(conn)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM ai_systems ORDER BY id")
            systems = cur.fetchall()

        if not systems:
            log.info("No AI systems found to score.")
            return []

        results = []
        for system in systems:
            result = score_ai_system(dict(system))
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO ai_governance_scores
                        (system_id, system_name, composite_score, risk_level, dimension_scores, recommendations, scored_at)
                    VALUES (%s, %s, %s, %s, %s, %s, NOW())
                """, (
                    result["system_id"],
                    result["system_name"],
                    result["composite_score"],
                    result["risk_level"],
                    json.dumps(result["dimension_scores"]),
                    json.dumps(result["recommendations"]),
                ))
            conn.commit()
            log.info(f"Scored AI system {result['system_name']}: {result['composite_score']} ({result['risk_level']})")
            results.append(result)

        return results
    finally:
        conn.close()


def get_latest_scores() -> list:
    """Return the latest score for each AI system."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT ON (system_id) *
                FROM ai_governance_scores
                ORDER BY system_id, scored_at DESC
            """)
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "score":
        results = score_all_systems()
        print(json.dumps(results, indent=2, default=str))
    elif len(sys.argv) > 1 and sys.argv[1] == "list":
        scores = get_latest_scores()
        print(json.dumps(scores, indent=2, default=str))
    else:
        # Daemon mode: score every 6 hours
        log.info("Starting AI governance scorer daemon (interval: 6h)")
        while True:
            try:
                results = score_all_systems()
                log.info(f"Scored {len(results)} AI systems")
            except Exception as e:
                log.error(f"Scoring run failed: {e}")
            time.sleep(6 * 3600)
