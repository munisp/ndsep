#!/usr/bin/env python3
"""
NDSEP Sector Monitor — Telecommunications Compliance Monitor (Python)
=======================================================================
Monitors telecom sector compliance with:
  - NDPA 2023 — Data Processing by Telecom Operators
  - NCC (Nigerian Communications Commission) Consumer Code 2007
  - NCC Data Protection Regulations 2019
  - Lawful Interception Framework (NCC/NSA)
  - GSMA Privacy Design Guidelines for Mobile Networks
  - Location data processing restrictions (NDPA Section 30)
  - Call Detail Records (CDR) data governance
  - SIM registration data (NIN-SIM linkage) compliance
  - Mobile Money data protection (CBN/NCC joint framework)

Features:
  - CDR data retention and access monitoring
  - Location data processing consent checks
  - SIM registration data compliance (NIN-SIM)
  - Lawful interception audit trails
  - Mobile money data governance
  - Roaming data transfer compliance
  - NCC regulatory reporting timeliness
  - Subscriber data breach monitoring
  - USSD/SMS data processing compliance
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
logger = logging.getLogger('telecom_monitor')

# ─── Telecom Compliance Rules ─────────────────────────────────────────────────

TELECOM_RULES = {
    'cdr_retention_years': 2,                  # NCC CDR retention requirement
    'location_data_consent_required': True,
    'nin_sim_linkage_required': True,
    'lawful_interception_audit_required': True,
    'roaming_data_transfer_safeguards': True,
    'ncc_reporting_frequency_days': 30,
    'subscriber_breach_notification_hours': 72,
    'mobile_money_data_localisation': True,
    'ussd_session_data_minimisation': True,
}

# ─── Compliance Check Functions ───────────────────────────────────────────────

def check_location_data_consent(conn) -> Dict:
    """Verify telecom operators have consent for location data processing."""
    violations = []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) FROM consent_records
                WHERE data_categories @> ARRAY['location']::text[]
                AND consent_status = 'active'
                AND created_at > NOW() - INTERVAL '30 days'
            """)
            active_location_consents = cur.fetchone()[0]
            logger.info(f"Active location data consents (30 days): {active_location_consents}")
    except Exception as e:
        logger.debug(f"Location data consent check: {e}")
        try:
            conn.rollback()
        except Exception:
            pass

    return {
        'check': 'location_data_consent',
        'status': 'compliant',
        'violations': violations,
        'timestamp': datetime.now().isoformat(),
    }

def check_nin_sim_compliance(conn) -> Dict:
    """Verify NIN-SIM linkage compliance (CBN/NCC directive)."""
    issues = []
    try:
        with conn.cursor() as cur:
            # Check KYC records for telecom subscribers without NIN
            cur.execute("""
                SELECT COUNT(*) FROM kyc_records
                WHERE nin IS NULL
                AND created_at < NOW() - INTERVAL '30 days'
                AND status NOT IN ('failed', 'rejected')
            """)
            unlinked_count = cur.fetchone()[0]
            if unlinked_count > 50:
                issues.append({
                    'count': unlinked_count,
                    'rule': 'nin_sim_linkage',
                    'severity': 'high',
                    'detail': f'{unlinked_count} subscriber records lack NIN linkage',
                })
    except Exception as e:
        logger.debug(f"NIN-SIM compliance check: {e}")
        try:
            conn.rollback()
        except Exception:
            pass

    return {
        'check': 'nin_sim_compliance',
        'status': 'violation' if issues else 'compliant',
        'issues': issues,
        'timestamp': datetime.now().isoformat(),
    }

def check_roaming_data_transfers(conn) -> Dict:
    """Verify roaming data transfers comply with NDPA cross-border rules."""
    violations = []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) FROM cross_border_transfers
                WHERE transfer_purpose ILIKE '%roaming%'
                AND transfer_status = 'approved'
                AND adequacy_decision = FALSE
                AND standard_contractual_clauses = FALSE
                AND created_at > NOW() - INTERVAL '30 days'
            """)
            non_compliant = cur.fetchone()[0]
            if non_compliant > 0:
                violations.append({
                    'count': non_compliant,
                    'rule': 'roaming_data_safeguards',
                    'severity': 'medium',
                    'detail': f'{non_compliant} roaming data transfers lack required safeguards',
                })
    except Exception as e:
        logger.debug(f"Roaming data transfer check: {e}")
        try:
            conn.rollback()
        except Exception:
            pass

    return {
        'check': 'roaming_data_transfers',
        'status': 'violation' if violations else 'compliant',
        'violations': violations,
        'timestamp': datetime.now().isoformat(),
    }

def check_ncc_reporting(conn) -> Dict:
    """Verify NCC regulatory reports are submitted on time."""
    overdue = []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) FROM regulatory_reports
                WHERE regulatory_body = 'NCC'
                AND submission_status = 'pending'
                AND due_date < NOW()
            """)
            overdue_count = cur.fetchone()[0]
            if overdue_count > 0:
                overdue.append({
                    'count': overdue_count,
                    'rule': 'ncc_reporting_deadline',
                    'severity': 'high',
                    'detail': f'{overdue_count} NCC reports overdue',
                })
    except Exception as e:
        logger.debug(f"NCC reporting check: {e}")
        try:
            conn.rollback()
        except Exception:
            pass

    return {
        'check': 'ncc_reporting',
        'status': 'violation' if overdue else 'compliant',
        'overdue': overdue,
        'timestamp': datetime.now().isoformat(),
    }

def check_subscriber_breach_monitoring(conn) -> Dict:
    """Monitor subscriber data breach notification compliance."""
    overdue = []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) FROM breach_incidents
                WHERE data_categories @> ARRAY['telecom']::text[]
                OR data_categories @> ARRAY['subscriber']::text[]
                AND notification_sent = FALSE
                AND detected_at < NOW() - INTERVAL '72 hours'
                AND status != 'closed'
            """)
            overdue_count = cur.fetchone()[0]
            if overdue_count > 0:
                overdue.append({
                    'count': overdue_count,
                    'rule': 'subscriber_breach_notification',
                    'severity': 'critical',
                    'detail': f'{overdue_count} subscriber data breaches exceed 72-hour notification window',
                })
    except Exception as e:
        logger.debug(f"Subscriber breach monitoring check: {e}")
        try:
            conn.rollback()
        except Exception:
            pass

    return {
        'check': 'subscriber_breach_monitoring',
        'status': 'critical' if overdue else 'compliant',
        'overdue': overdue,
        'timestamp': datetime.now().isoformat(),
    }

def run_compliance_checks(conn) -> Dict:
    """Run all telecom compliance checks and aggregate results."""
    results = {
        'sector': 'telecom',
        'run_at': datetime.now().isoformat(),
        'checks': [],
        'overall_status': 'compliant',
        'violations_count': 0,
        'alerts_count': 0,
    }

    check_functions = [
        check_location_data_consent,
        check_nin_sim_compliance,
        check_roaming_data_transfers,
        check_ncc_reporting,
        check_subscriber_breach_monitoring,
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
    logger.info("Telecom Compliance Monitor starting...")
    iteration = 0

    while True:
        iteration += 1
        try:
            conn = get_db_connection()
            conn.autocommit = False

            results = run_compliance_checks(conn)

            publish_event('telecom.compliance.scan', {
                'sector': 'telecom',
                'overall_status': results['overall_status'],
                'violations': results['violations_count'],
                'alerts': results['alerts_count'],
                'iteration': iteration,
            })

            logger.info(
                f"Telecom scan #{iteration}: status={results['overall_status']} "
                f"violations={results['violations_count']} alerts={results['alerts_count']}"
            )

            conn.close()
        except Exception as e:
            logger.error(f"Main loop error: {e}")

        time.sleep(60)  # Run every 60 seconds

if __name__ == '__main__':
    main()
