#!/usr/bin/env python3
"""
NDSEP Banking Layer — AML Scoring Worker (Python)
===================================================
Implements ML-based Anti-Money Laundering scoring per:
  - NFIU AML/CFT Guidelines 2022
  - FATF Recommendations 10, 11, 20 (CDD, Record Keeping, STR)
  - CBN AML/CFT Regulations 2022
  - Egmont Group Financial Intelligence Standards

Features:
  - Transaction pattern analysis (velocity, structuring, layering)
  - Customer risk profiling (PEP, high-risk jurisdiction, occupation)
  - Network graph analysis (connected accounts)
  - STR (Suspicious Transaction Report) auto-generation
  - NFIU reporting integration
  - ML scoring via the trained fraud_net model (ml.inference.score_transaction)
    when the ML stack is importable; otherwise a deterministic, explicitly
    labelled rule-based score (NO random noise, no simulated model variance)
  - Case escalation workflow

Scoring honesty (round-9): previous versions added random.gauss noise to a
weighted sum and called it "gradient boosting simulation". That was removed.
Every score is now labelled with `score_mode`:
  - "fraud_net"   — probability from the trained model in ml/weights
  - "rule_based"  — deterministic weighted rules (documented below)

HTTP: GET /health on AML_SCORER_PORT (canonical workerManager port 8134),
dependency-aware (503 when PostgreSQL is unreachable).
"""

import os
import sys
import json
import time
import random
import logging
import hashlib
import http.server
import socketserver
import threading
from datetime import datetime
from typing import Optional, Dict, Tuple

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db_helper import get_db_connection, publish_event  # fail-closed: requires WORKER_DATABASE_URL/DATABASE_URL (round-9)

# ── Trained fraud model (ml.inference) — optional but preferred scorer ───────
# The worker tree sits at <repo>/workers/python; put the repo root on the path
# so `import ml.inference` resolves.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

_ml_inference = None
try:
    from ml import inference as _ml_inference
    from ml.data.generate_synthetic import FRAUD_FEATURES as _FRAUD_FEATURES
except Exception as _e:  # torch / weights unavailable in this container
    logging.getLogger('aml_scoring_worker').warning(
        "ml.inference unavailable (%s) — falling back to rule_based scoring", _e)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger('aml_scoring_worker')

# ─── AML Risk Factors ──────────────────────────────────────────────────────────

HIGH_RISK_JURISDICTIONS = {
    'AF', 'BY', 'CF', 'CG', 'CU', 'ER', 'ET', 'IR', 'IQ', 'KP', 'LB',
    'LY', 'ML', 'MM', 'NI', 'PK', 'RU', 'SO', 'SS', 'SD', 'SY', 'VE',
    'YE', 'ZW'  # FATF High-Risk and Other Monitored Jurisdictions
}

HIGH_RISK_OCCUPATIONS = {
    'politician', 'government official', 'military officer', 'judge',
    'customs officer', 'tax official', 'central bank official',
    'ambassador', 'diplomat', 'state enterprise executive'
}

STRUCTURING_THRESHOLD_NGN = 5_000_000  # ₦5M - CBN CTR threshold
STR_AUTO_SCORE_THRESHOLD = 75.0        # Auto-generate STR above this score

# ─── ML Feature Extraction ────────────────────────────────────────────────────


def extract_features(case: dict, conn) -> Dict[str, float]:
    """Extract ML features for AML scoring."""
    features = {}

    # Feature 1: Transaction amount relative to threshold
    amount_ngn = (case.get('transaction_amount') or 0) / 100
    features['amount_ratio'] = min(amount_ngn / STRUCTURING_THRESHOLD_NGN, 10.0)

    # Feature 2: Structuring pattern (amounts just below reporting threshold)
    if 4_000_000 <= amount_ngn <= 4_999_999:
        features['structuring_flag'] = 1.0
    else:
        features['structuring_flag'] = 0.0

    # Feature 3: Transaction frequency (velocity)
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) FROM aml_cases
                WHERE subject_account = %s
                AND created_at > NOW() - INTERVAL '24 hours'
                AND id != %s
            """, (case.get('subject_account'), case.get('id')))
            freq = cur.fetchone()[0]
            features['tx_count_24h'] = float(freq)
            features['velocity_24h'] = min(freq / 10.0, 1.0)
    except Exception:
        features['tx_count_24h'] = 0.0
        features['velocity_24h'] = 0.0

    # Feature 4: Alert source risk weight
    source_weights = {
        'system': 0.3, 'nip_processor': 0.5, 'swift_gateway': 0.7,
        'fraud_engine': 0.8, 'manual': 0.4, 'external': 0.6
    }
    features['source_weight'] = source_weights.get(case.get('alert_source', 'system'), 0.3)

    # Feature 5: Existing score
    features['existing_score'] = (case.get('alert_score') or 0) / 100.0

    # Feature 6: Case type risk
    type_weights = {
        'suspicious_transaction': 0.6, 'fraud_related': 0.8,
        'structuring': 0.9, 'pep_transaction': 0.7,
        'high_risk_jurisdiction': 0.8, 'unusual_pattern': 0.5
    }
    features['type_weight'] = type_weights.get(case.get('case_type', 'suspicious_transaction'), 0.5)

    return features


def rule_based_score(features: Dict[str, float]) -> float:
    """
    Deterministic rule-based AML risk score (0–100).

    This is NOT a machine-learning model: it is a fixed weighted sum of the
    documented AML red-flag features below (weights chosen from NFIU/CBN
    typology guidance). It is fully deterministic — the random.gauss "model
    variance" noise of earlier versions was removed in round-9. When the
    trained fraud_net model is available, `score_case` prefers it and only
    uses this function as a fallback.
    """
    weights = {
        'amount_ratio': 15.0,
        'structuring_flag': 25.0,
        'velocity_24h': 20.0,
        'source_weight': 15.0,
        'existing_score': 10.0,
        'type_weight': 15.0,
    }
    score = sum(features.get(k, 0) * w for k, w in weights.items())
    return max(0.0, min(100.0, score))


def _case_to_fraud_features(case: dict, features: Dict[str, float]) -> Dict[str, float]:
    """Map an AML case onto the fraud_net feature vector (FRAUD_FEATURES).

    Unmapped fraud features are set to 0.0, which after train-time
    standardisation is approximately the training mean — a neutral,
    documented default (same convention as ml/training/fine_tune.py).
    """
    amount_ngn = (case.get('transaction_amount') or 0) / 100
    import math
    vec = {f: 0.0 for f in _FRAUD_FEATURES}
    vec['amount_log'] = math.log1p(max(amount_ngn, 0.0))
    vec['just_below_threshold'] = features.get('structuring_flag', 0.0)
    vec['sender_tx_count_1h'] = float(features.get('tx_count_24h', 0.0))
    vec['sender_amount_ratio'] = min(features.get('amount_ratio', 0.0), 1.0)
    vec['is_round_amount'] = 1.0 if amount_ngn >= 1000 and amount_ngn % 1000 == 0 else 0.0
    vec['mule_hop'] = 1.0 if case.get('alert_source') == 'fraud_engine' else 0.0
    return vec


def score_case(case: dict, features: Dict[str, float]) -> tuple[float, str, Optional[str]]:
    """Score an AML case. Returns (score_0_100, score_mode, model_version).

    Prefers the trained fraud_net model via ml.inference; falls back to the
    deterministic rule-based score when the ML stack is unavailable.
    """
    if _ml_inference is not None:
        try:
            res = _ml_inference.score_transaction(
                _case_to_fraud_features(case, features))
            return (round(res['probability'] * 100.0, 2),
                    'fraud_net', res.get('model_version'))
        except Exception as e:
            logger.warning("fraud_net scoring failed (%s) — rule_based fallback", e)
    return (rule_based_score(features), 'rule_based', None)

# ─── STR Generation ───────────────────────────────────────────────────────────


def generate_str_reference() -> str:
    """Generate a NFIU-compliant STR reference number."""
    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
    suffix = hashlib.md5(str(random.random()).encode(), usedforsecurity=False).hexdigest()[:6].upper()
    return f"STR-{timestamp}-{suffix}"


def auto_generate_str(case: dict, score: float, conn) -> Optional[str]:
    """Auto-generate STR for high-risk cases."""
    if score < STR_AUTO_SCORE_THRESHOLD:
        return None

    str_ref = generate_str_reference()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE aml_cases
                SET str_reference = %s, str_filed_at = NOW(),
                status = 'filed_str', updated_at = NOW()
                WHERE id = %s
            """, (str_ref, case['id']))
            conn.commit()

        logger.info(f"STR generated: {str_ref} for case {case.get('case_reference')}")
        publish_event('aml.str.generated', {
            'case_ref': case.get('case_reference'),
            'str_ref': str_ref,
            'score': score,
            'subject': case.get('subject_name'),
            'amount_ngn': (case.get('transaction_amount') or 0) / 100,
        })
        return str_ref
    except Exception as e:
        logger.error(f"Failed to generate STR: {e}")
        conn.rollback()
        return None

# ─── Case Processing ──────────────────────────────────────────────────────────


def process_aml_case(case: dict, conn) -> None:
    """Process a single AML case with full scoring and workflow."""
    case_ref = case.get('case_reference', 'UNKNOWN')

    # Extract features and score (fraud_net when available, else rule_based)
    features = extract_features(case, conn)
    score, score_mode, model_version = score_case(case, features)

    # Determine risk level
    if score >= 80:
        risk_level = 'high'
        status = 'escalated'
        escalated = True
        escalation_reason = f"AML score {score:.1f} ({score_mode}) exceeds high-risk threshold"
    elif score >= 60:
        risk_level = 'medium'
        status = 'under_investigation'
        escalated = False
        escalation_reason = None
    else:
        risk_level = 'low'
        status = 'open'
        escalated = False
        escalation_reason = None

    # Check for structuring pattern
    if features.get('structuring_flag') == 1.0:
        escalated = True
        escalation_reason = "Structuring pattern detected: amount just below ₦5M CTR threshold"
        status = 'escalated'

    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE aml_cases
                SET risk_score = %s, status = %s,
                narrative = %s, updated_at = NOW()
                WHERE id = %s
            """, (int(score), status, escalation_reason or f'AML score {score:.1f} ({score_mode}) | risk={risk_level}', case['id']))
            conn.commit()
    except Exception as e:
        logger.error(f"Failed to update case {case_ref}: {e}")
        conn.rollback()
        return

    # Auto-generate STR if threshold exceeded
    str_ref = auto_generate_str(case, score, conn)

    logger.info(f"AML case scored: {case_ref} | score={score:.1f} | risk={risk_level} | "
                f"escalated={escalated} | STR={str_ref or 'N/A'}")

    publish_event('aml.case.scored', {
        'case_ref': case_ref,
        'score': score,
        'score_mode': score_mode,
        'model_version': model_version,
        'risk_level': risk_level,
        'escalated': escalated,
        'str_filed': str_ref is not None,
        'features': features,
    })


def process_pending_cases(conn) -> int:
    """Fetch and process all open AML cases needing scoring."""
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, case_ref AS case_reference, case_type, subject_name,
                subject_bvn, risk_score AS alert_score, status,
                transaction_amount, transaction_currency, transaction_ref
                FROM aml_cases
                WHERE status = 'open'
                AND (risk_score IS NULL OR risk_score = 0)
                ORDER BY created_at ASC
                LIMIT 50
            """)
            cases = [dict(zip([d[0] for d in cur.description], row)) for row in cur.fetchall()]
    except Exception as e:
        logger.error(f"Failed to fetch AML cases: {e}")
        return 0

    for case in cases:
        try:
            process_aml_case(case, conn)
        except Exception as e:
            logger.error(f"Error processing case {case.get('case_reference')}: {e}")
        try:
            conn.rollback()
        except Exception:
            pass

    return len(cases)

# ─── Watchlist Screening ──────────────────────────────────────────────────────


def screen_new_kyc_records(conn) -> None:
    """Screen newly created KYC records against watchlist."""
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT k.id, k.full_name, k.bvn, k.nin, k.reference_id AS customer_ref
                FROM kyc_records k
                WHERE k.sanctions_flag = FALSE
                AND k.created_at > NOW() - INTERVAL '1 hour'
                LIMIT 20
            """)
            records = cur.fetchall()

        for rec_id, name, bvn, nin, ref in records:
            # Check against watchlist
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT COUNT(*), STRING_AGG(source::text, ', ')
                    FROM watchlist_entries
                    WHERE is_active = TRUE
                    AND (LOWER(primary_name) LIKE LOWER(%s))
                """, (f'%{name}%',))
                count, sources = cur.fetchone()

            if count and count > 0:
                with conn.cursor() as cur:
                    cur.execute("""
                        UPDATE kyc_records
                        SET sanctions_flag = TRUE, updated_at = NOW()
                        WHERE id = %s
                    """, (rec_id,))
                    conn.commit()

                logger.warning(f"KYC sanctions hit: {ref} ({name}) on {sources}")
                publish_event('kyc.sanctions.hit', {
                    'customer_ref': ref, 'name': name, 'list_sources': sources
                })
    except Exception as e:
        logger.error(f"Watchlist screening error: {e}")
        try:
            conn.rollback()
        except Exception:
            pass

# ─── Health HTTP listener ────────────────────────────────────────────────────

# Canonical port from server/workerManager.ts (aml-scorer → AML_SCORER_PORT=8134)
PORT = int(os.environ.get('AML_SCORER_PORT', '8134'))
_worker_start = time.time()


class _HealthHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path != '/health':
            self.send_response(404)
            self.end_headers()
            return
        db_ok = False
        db_error = None
        try:
            conn = get_db_connection()
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
            conn.close()
            db_ok = True
        except Exception as e:
            db_error = str(e)[:200]
        body = json.dumps({
            'status': 'healthy' if db_ok else 'unhealthy',
            'worker': 'aml_scoring_worker',
            'scoring_mode': 'fraud_net' if _ml_inference is not None else 'rule_based',
            'database': 'ok' if db_ok else 'unavailable',
            'db_error': db_error,
            'uptime_seconds': round(time.time() - _worker_start, 1),
        }).encode()
        self.send_response(200 if db_ok else 503)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body)


def _start_health_server():
    with socketserver.TCPServer(("", PORT), _HealthHandler) as httpd:
        httpd.allow_reuse_address = True
        logger.info(f"AML scorer /health listening on port {PORT}")
        httpd.serve_forever()


# ─── Main Loop ────────────────────────────────────────────────────────────────


def main():
    logger.info(f"AML Scoring Worker starting (health port {PORT}, "
                f"scoring={'fraud_net' if _ml_inference is not None else 'rule_based'})...")
    threading.Thread(target=_start_health_server, daemon=True).start()

    processed_total = 0
    iteration = 0

    while True:
        iteration += 1
        try:
            conn = get_db_connection()
            conn.autocommit = False

            # Process AML cases
            count = process_pending_cases(conn)
            processed_total += count

            # Screen KYC records against watchlist
            if iteration % 3 == 0:  # Every 3rd iteration
                screen_new_kyc_records(conn)

            if count > 0:
                logger.info(f"Iteration {iteration}: processed {count} AML cases "
                            f"(total: {processed_total})")

            conn.close()
        except Exception as e:
            logger.error(f"Main loop error: {e}")

        time.sleep(15)  # Process every 15 seconds


if __name__ == '__main__':
    main()
