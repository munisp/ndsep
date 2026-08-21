#!/usr/bin/env python3
"""
NDSEP Monthly Framework Compliance Report Scheduler
Runs on the 1st of each month, generates a Markdown compliance report,
and sends it to the platform owner via the notification API.
Port: 8117
"""

import os
import json
import time
import datetime
import threading
import logging
import http.server
import socketserver
import urllib.request
import urllib.error
import psycopg2
import psycopg2.extras

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [monthly-report-scheduler] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("monthly-report-scheduler")

PORT = 8117
PG_DSN = "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"

FRAMEWORKS = ["NDPR", "GDPR", "ISO 27001", "SOC 2"]


def get_db():
    try:
        conn = psycopg2.connect(PG_DSN)
        return conn
    except Exception as e:
        log.warning(f"DB connection failed: {e}")
        return None


def generate_report(framework: str) -> dict:
    """Generate a compliance report for the given framework."""
    conn = get_db()
    stats = {}
    if conn:
        try:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            # Org stats
            cur.execute("""
                SELECT
                    COUNT(*) AS total_orgs,
                    AVG(compliance_score) AS avg_score,
                    COUNT(*) FILTER (WHERE compliance_status = 'compliant') AS compliant,
                    COUNT(*) FILTER (WHERE compliance_status = 'non_compliant') AS non_compliant
                FROM organizations
            """)
            org_row = cur.fetchone()
            # Violation stats
            cur.execute("""
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE severity = 'critical') AS critical,
                    COUNT(*) FILTER (WHERE severity = 'high') AS high
                FROM compliance_violations
            """)
            viol_row = cur.fetchone()
            # TIA stats
            cur.execute("""
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status = 'approved') AS approved,
                    COUNT(*) FILTER (WHERE status = 'submitted') AS pending
                FROM tia_assessments
            """)
            tia_row = cur.fetchone()
            conn.close()
            stats = {
                "total_orgs": int(org_row["total_orgs"] or 0),
                "avg_score": round(float(org_row["avg_score"] or 0), 1),
                "compliant": int(org_row["compliant"] or 0),
                "non_compliant": int(org_row["non_compliant"] or 0),
                "total_violations": int(viol_row["total"] or 0),
                "critical_violations": int(viol_row["critical"] or 0),
                "high_violations": int(viol_row["high"] or 0),
                "total_tia": int(tia_row["total"] or 0),
                "approved_tia": int(tia_row["approved"] or 0),
                "pending_tia": int(tia_row["pending"] or 0),
            }
        except Exception as e:
            log.error(f"DB query error: {e}")
            if conn:
                conn.close()

    now = datetime.datetime.utcnow().strftime("%Y-%m-%d")
    month = datetime.datetime.utcnow().strftime("%B %Y")
    avg_score = stats.get("avg_score", 0)
    posture = "COMPLIANT" if avg_score >= 80 else "PARTIALLY COMPLIANT" if avg_score >= 60 else "NON-COMPLIANT"

    report_md = f"""# NDSEP Monthly Compliance Report — {framework}
**Period:** {month}
**Generated:** {now}
**Authority:** NITDA / National Data Sovereignty Enforcement Platform

---

## Executive Summary

This automated monthly report presents the compliance posture of **{stats.get('total_orgs', 0)} registered organizations** against the **{framework}** framework for {month}.

| Metric | Value |
|--------|-------|
| Overall Compliance Score | {avg_score}% |
| Compliant Organizations | {stats.get('compliant', 0)} |
| Non-Compliant Organizations | {stats.get('non_compliant', 0)} |
| Total Open Violations | {stats.get('total_violations', 0)} |
| Critical Violations | {stats.get('critical_violations', 0)} |
| High Severity Violations | {stats.get('high_violations', 0)} |
| TIA Assessments (Total) | {stats.get('total_tia', 0)} |
| TIA Assessments (Approved) | {stats.get('approved_tia', 0)} |
| TIA Assessments (Pending) | {stats.get('pending_tia', 0)} |

## Compliance Status

The national average compliance score is **{avg_score}%**. The overall posture is **{posture}**.

{"All monitored organizations meet the minimum compliance threshold." if avg_score >= 80 else "Remediation actions are required for non-compliant organizations." if avg_score >= 60 else "Immediate enforcement action is required for non-compliant organizations."}

## Critical Findings

{"No critical violations recorded this period." if stats.get('critical_violations', 0) == 0 else f"There are **{stats.get('critical_violations', 0)} critical violations** requiring immediate attention."}

## Recommendations

1. Organizations with compliance scores below 60% should be placed under enhanced monitoring.
2. All critical violations must be remediated within 30 days per NDPR enforcement guidelines.
3. Cross-border data transfers must be reviewed against {framework} transfer controls.
4. Evidence packages should be generated for all compliant organizations to support audit trails.
5. TIA assessments pending review ({stats.get('pending_tia', 0)}) should be processed promptly.

---
*This report was automatically generated by the NDSEP Monthly Report Scheduler. For official submissions, obtain a certified copy from NITDA.*
"""
    return {
        "framework": framework,
        "period": month,
        "generated_at": now,
        "avg_score": avg_score,
        "posture": posture,
        "stats": stats,
        "report_md": report_md,
    }


def send_owner_notification(title: str, content: str):
    """Send notification to platform owner via the NDSEP notification API."""
    forge_url = os.environ.get("BUILT_IN_FORGE_API_URL", "")
    forge_key = os.environ.get("BUILT_IN_FORGE_API_KEY", "")
    app_id = os.environ.get("VITE_APP_ID", "")
    owner_open_id = os.environ.get("OWNER_OPEN_ID", "")

    if not all([forge_url, forge_key, app_id, owner_open_id]):
        log.warning("Missing env vars for notification — skipping owner notification")
        return False

    try:
        payload = json.dumps({
            "app_id": app_id,
            "open_id": owner_open_id,
            "title": title,
            "content": content,
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{forge_url}/v1/notification/send",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {forge_key}",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            log.info(f"Notification sent: {resp.status}")
            return True
    except Exception as e:
        log.error(f"Failed to send notification: {e}")
        return False


def run_monthly_report():
    """Generate and send the monthly NDPR compliance report."""
    log.info("Running monthly NDPR compliance report...")
    try:
        report = generate_report("NDPR")
        title = f"Monthly NDPR Compliance Report — {report['period']}"
        content = (
            f"Automated monthly report generated.\n"
            f"Period: {report['period']}\n"
            f"Overall Score: {report['avg_score']}%\n"
            f"Posture: {report['posture']}\n"
            f"Critical Violations: {report['stats'].get('critical_violations', 0)}\n"
            f"Full report available in the Framework Dashboard."
        )
        send_owner_notification(title, content)
        log.info(f"Monthly report complete: {report['posture']} ({report['avg_score']}%)")
        return report
    except Exception as e:
        log.error(f"Monthly report failed: {e}")
        return None


def scheduler_loop():
    """Check every hour if it's the 1st of the month and run the report."""
    last_run_month = None
    log.info("Scheduler loop started — will run on the 1st of each month")
    while True:
        now = datetime.datetime.utcnow()
        current_month = now.strftime("%Y-%m")
        if now.day == 1 and current_month != last_run_month:
            log.info(f"1st of month detected ({current_month}) — triggering report")
            run_monthly_report()
            last_run_month = current_month
        time.sleep(3600)  # Check every hour


class HealthHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress default HTTP logs

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "service": "monthly-report-scheduler"}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/api/report/trigger":
            # Manual trigger endpoint for testing
            content_len = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_len) if content_len else b"{}"
            try:
                data = json.loads(body)
                framework = data.get("framework", "NDPR")
                report = generate_report(framework)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "status": "ok",
                    "framework": report["framework"],
                    "period": report["period"],
                    "avg_score": report["avg_score"],
                    "posture": report["posture"],
                    "report_length": len(report["report_md"]),
                }).encode())
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    log.info(f"Monthly Report Scheduler starting on port {PORT}")

    # Start scheduler in background thread
    t = threading.Thread(target=scheduler_loop, daemon=True)
    t.start()

    # Start HTTP server for health checks and manual triggers
    with socketserver.TCPServer(("", PORT), HealthHandler) as httpd:
        httpd.allow_reuse_address = True
        log.info(f"HTTP server listening on :{PORT}")
        httpd.serve_forever()
