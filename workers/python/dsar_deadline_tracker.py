#!/usr/bin/env python3
"""
DSAR Deadline Tracker — NDSEP Enhancement
Monitors citizen data subject access requests (DSARs) for statutory deadline compliance.
NDPA Section 34: DPCOs must respond within 30 days (extendable to 90 days with notice).
Sends escalation alerts for overdue requests.
"""
import os
import json
import logging
import time
import requests
from datetime import datetime, timezone, timedelta
import psycopg2
from psycopg2.extras import RealDictCursor

logging.basicConfig(level=logging.INFO, format="%(asctime)s [dsar_deadline_tracker] %(levelname)s %(message)s")
log = logging.getLogger(__name__)

DB_URL = os.environ.get(
    "NDSEP_PG_URL",
    "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"
)

STANDARD_DEADLINE_DAYS = 30
EXTENDED_DEADLINE_DAYS = 90
CHECK_INTERVAL_SECONDS = 3600  # run every hour


def get_connection():
    return psycopg2.connect(DB_URL, cursor_factory=RealDictCursor)


def ensure_escalation_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS dsar_escalations (
                id SERIAL PRIMARY KEY,
                request_id INTEGER NOT NULL,
                escalation_type TEXT NOT NULL,  -- 'warning_7d', 'overdue', 'critical'
                days_overdue INTEGER,
                notified_at TIMESTAMPTZ DEFAULT NOW(),
                resolved BOOLEAN DEFAULT FALSE
            );
            CREATE INDEX IF NOT EXISTS idx_dsar_esc_request ON dsar_escalations(request_id);
        """)
        conn.commit()


def check_deadlines():
    """Check all open DSARs for deadline compliance and escalate overdue ones."""
    conn = get_connection()
    ensure_escalation_table(conn)
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT cr.*, o.name AS org_name, o.email AS org_email
                FROM citizen_requests cr
                LEFT JOIN organisations o ON o.id = cr.org_id
                WHERE cr.status NOT IN ('resolved', 'closed', 'rejected')
                  AND cr.created_at IS NOT NULL
            """)
            open_requests = cur.fetchall()

        now = datetime.now(timezone.utc)
        escalated = []

        for req in open_requests:
            req = dict(req)
            created_at = req["created_at"]
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)

            # Determine deadline
            deadline_days = EXTENDED_DEADLINE_DAYS if req.get("extension_granted") else STANDARD_DEADLINE_DAYS
            deadline = created_at + timedelta(days=deadline_days)
            days_until_deadline = (deadline - now).days
            days_overdue = -days_until_deadline if days_until_deadline < 0 else 0

            escalation_type = None
            if days_overdue > 30:
                escalation_type = "critical"
            elif days_overdue > 0:
                escalation_type = "overdue"
            elif days_until_deadline <= 7:
                escalation_type = "warning_7d"

            if escalation_type:
                # Check if already escalated today
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT id FROM dsar_escalations
                        WHERE request_id = %s
                          AND escalation_type = %s
                          AND notified_at > NOW() - INTERVAL '24 hours'
                          AND resolved = FALSE
                    """, (req["id"], escalation_type))
                    existing = cur.fetchone()

                if not existing:
                    with conn.cursor() as cur:
                        cur.execute("""
                            INSERT INTO dsar_escalations
                                (request_id, escalation_type, days_overdue)
                            VALUES (%s, %s, %s)
                        """, (req["id"], escalation_type, days_overdue))
                    conn.commit()

                    log.warning(
                        f"DSAR #{req['id']} ({req.get('request_type','unknown')}) "
                        f"from {req.get('requester_name','?')} — "
                        f"{escalation_type}: {days_overdue}d overdue / {days_until_deadline}d remaining"
                    )
                    escalated.append({
                        "request_id": req["id"],
                        "escalation_type": escalation_type,
                        "days_overdue": days_overdue,
                        "org_name": req.get("org_name"),
                    })

        log.info(f"Checked {len(open_requests)} DSARs, escalated {len(escalated)}")
        return escalated
    finally:
        conn.close()


def get_overdue_summary() -> dict:
    """Return a summary of overdue DSARs by organisation."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    o.name AS org_name,
                    COUNT(*) AS overdue_count,
                    MAX(EXTRACT(EPOCH FROM (NOW() - cr.created_at)) / 86400)::INT AS max_days_open
                FROM citizen_requests cr
                LEFT JOIN organisations o ON o.id = cr.org_id
                WHERE cr.status NOT IN ('resolved', 'closed', 'rejected')
                  AND cr.created_at < NOW() - INTERVAL '30 days'
                GROUP BY o.name
                ORDER BY overdue_count DESC
            """)
            return {"overdue_by_org": [dict(r) for r in cur.fetchall()]}
    finally:
        conn.close()


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "check":
        results = check_deadlines()
        print(json.dumps(results, indent=2, default=str))
    elif len(sys.argv) > 1 and sys.argv[1] == "summary":
        summary = get_overdue_summary()
        print(json.dumps(summary, indent=2, default=str))
    else:
        log.info("Starting DSAR deadline tracker daemon (interval: 1h)")
        while True:
            try:
                check_deadlines()
            except Exception as e:
                log.error(f"DSAR deadline check failed: {e}")
            time.sleep(CHECK_INTERVAL_SECONDS)
