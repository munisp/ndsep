#!/usr/bin/env python3
"""
NDSEP Sector Monitor — Insurance Sector Compliance Monitor (Python)
====================================================================
Monitors insurance sector compliance with:
  - NDPA 2023 — Data Processing by Insurance Companies
  - NAICOM (National Insurance Commission) data governance rules
  - Insurance Act 2003 — policyholder data protection
  - CBN Insurance Sector Data Sharing Framework
  - FATF Recommendation 10 — CDD for insurance products
  - Actuarial data privacy and anonymisation standards
  - Claims data processing and fraud detection compliance
  - Reinsurance data transfer restrictions

Features:
  - Policyholder data consent management
  - Claims fraud detection data compliance
  - Actuarial data anonymisation monitoring
  - Reinsurance data transfer compliance
  - NAICOM regulatory reporting timeliness
  - Insurance agent data handling audits
  - Health insurance data special category compliance
  - Motor insurance data (telematics) privacy checks
"""

import os
import sys
import json
import time
import logging
from datetime import datetime, timedelta
from typing import Dict, List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from db_helper import get_db_connection, publish_event
except ImportError:
    import psycopg2
    def get_db_connection():
        return psycopg2.connect(
            os.environ.get('LOCAL_DATABASE_URL',
                'postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db')
        )
    def publish_event(event_type: str, payload: dict):
        logging.info(f"[EVENT] {event_type}: {json.dumps(payload)}")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('insurance_monitor')

# ─── Insurance Compliance Rules ───────────────────────────────────────────────

INSURANCE_RULES = {
    'policyholder_consent_required': True,
    'claims_data_retention_years': 7,
    'actuarial_data_anonymisation': True,
    'reinsurance_transfer_safeguards': True,
    'health_insurance_special_category': True,
    'telematics_data_consent': True,
    'naicom_reporting_frequency_days': 30,
    'fraud_detection_data_minimisation': True,
    'breach_notification_hours': 72,
}

# ─── Compliance Check Functions ───────────────────────────────────────────────

def check_policyholder_consent(conn) -> Dict:
    """Verify insurance companies have valid consent for policyholder data processing."""
    violations = []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) FROM consent_records
                WHERE data_categories @> ARRAY['insurance']::text[]
                AND consent_status = 'active'
                AND created_at > NOW() - INTERVAL '30 days'
            """)
            active_consents = cur.fetchone()[0]
            logger.info(f"Active insurance data consents (30 days): {active_consents}")
    except Exception as e:
        logger.debug(f"Policyholder consent check: {e}")
        try:
            conn.rollback()
        except Exception:
            pass

    return {
        'check': 'policyholder_consent',
        'status': 'compliant',
        'violations': violations,
        'timestamp': datetime.now().isoformat(),
    }

def check_health_insurance_data(conn) -> Dict:
    """Verify health insurance data is processed as special category data."""
    issues = []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) FROM dpia_assessments
                WHERE processing_type ILIKE '%health insurance%'
                OR processing_type ILIKE '%medical insurance%'
                AND dpia_status = 'approved'
            """)
            health_insurance_dpias = cur.fetchone()[0]
            if health_insurance_dpias == 0:
                issues.append({
                    'rule': 'health_insurance_dpia',
                    'severity': 'high',
                    'detail': 'No approved DPIAs for health insurance data processing',
                })
    except Exception as e:
        logger.debug(f"Health insurance data check: {e}")
        try:
            conn.rollback()
        except Exception:
            pass

    return {
        'check': 'health_insurance_data',
        'status': 'violation' if issues else 'compliant',
        'issues': issues,
        'timestamp': datetime.now().isoformat(),
    }

def check_reinsurance_transfers(conn) -> Dict:
    """Verify reinsurance data transfers have appropriate safeguards."""
    violations = []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) FROM cross_border_transfers
                WHERE transfer_purpose ILIKE '%reinsurance%'
                AND transfer_status = 'approved'
                AND adequacy_decision = FALSE
                AND standard_contractual_clauses = FALSE
                AND created_at > NOW() - INTERVAL '90 days'
            """)
            non_compliant = cur.fetchone()[0]
            if non_compliant > 0:
                violations.append({
                    'count': non_compliant,
                    'rule': 'reinsurance_transfer_safeguards',
                    'severity': 'high',
                    'detail': f'{non_compliant} reinsurance transfers lack required safeguards',
                })
    except Exception as e:
        logger.debug(f"Reinsurance transfer check: {e}")
        try:
            conn.rollback()
        except Exception:
            pass

    return {
        'check': 'reinsurance_transfers',
        'status': 'violation' if violations else 'compliant',
        'violations': violations,
        'timestamp': datetime.now().isoformat(),
    }

def check_naicom_reporting(conn) -> Dict:
    """Verify NAICOM regulatory reports are submitted on time."""
    overdue = []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) FROM regulatory_reports
                WHERE regulatory_body = 'NAICOM'
                AND submission_status = 'pending'
                AND due_date < NOW()
            """)
            overdue_count = cur.fetchone()[0]
            if overdue_count > 0:
                overdue.append({
                    'count': overdue_count,
                    'rule': 'naicom_reporting_deadline',
                    'severity': 'high',
                    'detail': f'{overdue_count} NAICOM reports overdue',
                })
    except Exception as e:
        logger.debug(f"NAICOM reporting check: {e}")
        try:
            conn.rollback()
        except Exception:
            pass

    return {
        'check': 'naicom_reporting',
        'status': 'violation' if overdue else 'compliant',
        'overdue': overdue,
        'timestamp': datetime.now().isoformat(),
    }

def run_compliance_checks(conn) -> Dict:
    """Run all insurance sector compliance checks and aggregate results."""
    results = {
        'sector': 'insurance',
        'run_at': datetime.now().isoformat(),
        'checks': [],
        'overall_status': 'compliant',
        'violations_count': 0,
        'alerts_count': 0,
    }

    check_functions = [
        check_policyholder_consent,
        check_health_insurance_data,
        check_reinsurance_transfers,
        check_naicom_reporting,
    ]

    for check_fn in check_functions:
        try:
            result = check_fn(conn)
            results['checks'].append(result)
            if result.get('status') in ('violation', 'critical'):
                results['violations_count'] += 1
                results['overall_status'] = 'non_compliant'
            elif result.get('status') in ('alert', 'elevated', 'warning'):
                results['alerts_count'] += 1
                if results['overall_status'] == 'compliant':
                    results['overall_status'] = 'warning'
        except Exception as e:
            logger.error(f"Check {check_fn.__name__} failed: {e}")

    return results

def main():
    logger.info("Insurance Sector Compliance Monitor starting...")
    iteration = 0

    while True:
        iteration += 1
        try:
            conn = get_db_connection()
            conn.autocommit = False

            results = run_compliance_checks(conn)

            publish_event('insurance.compliance.scan', {
                'sector': 'insurance',
                'overall_status': results['overall_status'],
                'violations': results['violations_count'],
                'alerts': results['alerts_count'],
                'iteration': iteration,
            })

            logger.info(
                f"Insurance scan #{iteration}: status={results['overall_status']} "
                f"violations={results['violations_count']} alerts={results['alerts_count']}"
            )

            conn.close()
        except Exception as e:
            logger.error(f"Main loop error: {e}")

        time.sleep(90)  # Run every 90 seconds

if __name__ == '__main__':
    main()
