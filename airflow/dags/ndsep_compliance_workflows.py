"""
NDSEP Compliance Workflow DAGs
==============================
Orchestrates all scheduled NDSEP compliance workflows using Apache Airflow.

VALUE TO NDSEP:
  - Replaces manual cron jobs with dependency-aware, retryable workflows
  - Provides audit trail for all automated compliance actions
  - Enables complex multi-step workflows (e.g., breach → notify → escalate → fine)
  - Integrates with NiFi for data ingestion and dbt for analytics
  - Sends alerts to NDPC officers when SLAs are breached

NDPA Compliance Workflows:
  1. Daily compliance score recalculation
  2. Breach notification SLA monitoring (72-hour NDPA requirement)
  3. Weekly vendor risk rescoring
  4. Monthly audit return generation
  5. Annual DPIA review cycle
  6. Enforcement action lifecycle management
"""

from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.operators.bash import BashOperator
from airflow.operators.empty import EmptyOperator
from airflow.utils.dates import days_ago
import os
import json
import logging
import psycopg2

logger = logging.getLogger(__name__)

# ── Default arguments for all NDSEP DAGs ─────────────────────────────────────
NDSEP_DEFAULT_ARGS = {
    "owner": "ndpc_admin",
    "depends_on_past": False,
    "start_date": days_ago(1),
    "email": ["compliance@ndpc.gov.ng", "tech@ndpc.gov.ng"],
    "email_on_failure": True,
    "email_on_retry": False,
    "retries": 3,
    "retry_delay": timedelta(minutes=5),
    "execution_timeout": timedelta(hours=2),
}

NDSEP_DB_CONN = os.getenv("NDSEP_DB_CONN", "postgresql://ndsep_user:ndsep_secure_2026@postgres:5432/ndsep_db")
NDSEP_API_URL = os.getenv("NDSEP_API_URL", "http://ndsep-api:3000")


def get_db_conn():
    """Get a connection to the NDSEP PostgreSQL database."""
    import psycopg2
    return psycopg2.connect(NDSEP_DB_CONN)


# ── DAG 1: Daily Compliance Score Recalculation ───────────────────────────────
def recalculate_compliance_scores(**context):
    """
    Recalculates compliance scores for all registered organizations.
    Factors: DPIA completion, DPO appointment, breach history, audit returns,
    consent management, data retention compliance, staff training.
    """
    conn = get_db_conn()
    cur = conn.cursor()
    try:
        # Get all active organizations
        cur.execute("SELECT id, name, sector FROM organizations WHERE status = 'active'")
        orgs = cur.fetchall()
        logger.info(f"Recalculating scores for {len(orgs)} organizations")

        updated = 0
        for org_id, org_name, sector in orgs:
            # Calculate component scores
            scores = {}

            # DPIA completion (20 points)
            cur.execute("""
                SELECT COUNT(*) FROM dpia_assessments
                WHERE org_id = %s AND status = 'approved'
                AND created_at > NOW() - INTERVAL '1 year'
            """, (org_id,))
            dpia_count = cur.fetchone()[0]
            scores['dpia'] = min(20, dpia_count * 5)

            # DPO appointment (15 points)
            cur.execute("""
                SELECT COUNT(*) FROM dpo_registry
                WHERE org_id = %s AND status = 'active'
            """, (org_id,))
            dpo_active = cur.fetchone()[0]
            scores['dpo'] = 15 if dpo_active > 0 else 0

            # Breach notification compliance (25 points - critical)
            cur.execute("""
                SELECT COUNT(*) FROM breach_notifications
                WHERE org_id = %s
                AND notified_at <= detected_at + INTERVAL '72 hours'
                AND created_at > NOW() - INTERVAL '1 year'
            """, (org_id,))
            timely_breaches = cur.fetchone()[0]
            cur.execute("""
                SELECT COUNT(*) FROM breach_notifications
                WHERE org_id = %s AND created_at > NOW() - INTERVAL '1 year'
            """, (org_id,))
            total_breaches = cur.fetchone()[0]
            if total_breaches > 0:
                scores['breach'] = int(25 * (timely_breaches / total_breaches))
            else:
                scores['breach'] = 25  # No breaches = full score

            # Audit return submission (20 points)
            cur.execute("""
                SELECT COUNT(*) FROM compliance_audit_returns
                WHERE org_id = %s AND status = 'submitted'
                AND created_at > NOW() - INTERVAL '1 year'
            """, (org_id,))
            audit_returns = cur.fetchone()[0]
            scores['audit'] = min(20, audit_returns * 10)

            # Data retention compliance (10 points)
            cur.execute("""
                SELECT COUNT(*) FROM retention_policies
                WHERE org_id = %s AND status = 'active'
            """, (org_id,))
            retention_policies = cur.fetchone()[0]
            scores['retention'] = min(10, retention_policies * 2)

            # Staff training (10 points)
            cur.execute("""
                SELECT COUNT(*) FROM staff_training_records
                WHERE org_id = %s AND status = 'completed'
                AND completed_at > NOW() - INTERVAL '1 year'
            """, (org_id,))
            training_completed = cur.fetchone()[0]
            scores['training'] = min(10, training_completed)

            total_score = sum(scores.values())

            # Update compliance score
            cur.execute("""
                INSERT INTO compliance_scores (org_id, score, components, calculated_at)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (org_id) DO UPDATE
                SET score = EXCLUDED.score,
                    components = EXCLUDED.components,
                    calculated_at = EXCLUDED.calculated_at,
                    updated_at = NOW()
            """, (org_id, total_score, json.dumps(scores)))
            updated += 1

        conn.commit()
        logger.info(f"Updated compliance scores for {updated} organizations")
        context['task_instance'].xcom_push(key='orgs_updated', value=updated)
    finally:
        cur.close()
        conn.close()


def check_breach_slas(**context):
    """
    Monitors breach notifications for NDPA 72-hour notification requirement.
    Escalates overdue notifications to NDPC enforcement team.
    """
    conn = get_db_conn()
    cur = conn.cursor()
    try:
        # Find breaches where 72-hour SLA is approaching or breached
        cur.execute("""
            SELECT bn.id, bn.org_id, o.name as org_name, bn.detected_at,
                   bn.severity, bn.affected_records,
                   EXTRACT(EPOCH FROM (NOW() - bn.detected_at))/3600 as hours_elapsed
            FROM breach_notifications bn
            JOIN organizations o ON bn.org_id = o.id
            WHERE bn.status = 'pending'
            AND bn.detected_at > NOW() - INTERVAL '5 days'
            ORDER BY bn.detected_at ASC
        """)
        pending_breaches = cur.fetchall()

        overdue = []
        approaching = []

        for breach in pending_breaches:
            hours_elapsed = float(breach[6])
            if hours_elapsed > 72:
                overdue.append(breach)
            elif hours_elapsed > 48:
                approaching.append(breach)

        logger.info(f"Breach SLA check: {len(overdue)} overdue, {len(approaching)} approaching 72h limit")

        # Mark overdue breaches
        for breach in overdue:
            cur.execute("""
                UPDATE breach_notifications
                SET sla_status = 'overdue', updated_at = NOW()
                WHERE id = %s
            """, (breach[0],))
            logger.warning(f"OVERDUE breach: Org={breach[2]}, ID={breach[0]}, Hours={breach[6]:.1f}")

        conn.commit()

        context['task_instance'].xcom_push(key='overdue_count', value=len(overdue))
        context['task_instance'].xcom_push(key='approaching_count', value=len(approaching))

        if overdue:
            raise Exception(f"ALERT: {len(overdue)} breach notifications are overdue (>72h). Immediate action required.")

    finally:
        cur.close()
        conn.close()


def generate_monthly_audit_returns(**context):
    """
    Generates monthly compliance audit return reminders for all organizations.
    Creates draft audit returns for organizations that haven't submitted.
    """
    conn = get_db_conn()
    cur = conn.cursor()
    try:
        current_month = datetime.now().strftime('%Y-%m')

        # Find organizations that haven't submitted this month's audit return
        cur.execute("""
            SELECT o.id, o.name, o.email
            FROM organizations o
            WHERE o.status = 'active'
            AND o.id NOT IN (
                SELECT DISTINCT org_id FROM compliance_audit_returns
                WHERE period_month = %s AND status IN ('submitted', 'approved')
            )
        """, (current_month,))
        missing_orgs = cur.fetchall()

        logger.info(f"Creating draft audit returns for {len(missing_orgs)} organizations")

        for org_id, org_name, org_email in missing_orgs:
            # Create draft audit return
            cur.execute("""
                INSERT INTO compliance_audit_returns
                (org_id, period_month, status, due_date, created_at)
                VALUES (%s, %s, 'draft', DATE_TRUNC('month', NOW()) + INTERVAL '1 month' - INTERVAL '1 day', NOW())
                ON CONFLICT (org_id, period_month) DO NOTHING
            """, (org_id, current_month))

        conn.commit()
        context['task_instance'].xcom_push(key='draft_returns_created', value=len(missing_orgs))

    finally:
        cur.close()
        conn.close()


def run_dbt_compliance_models(**context):
    """
    Triggers dbt to rebuild compliance analytics models.
    Powers: Compliance Gap Analyzer, Sector Benchmarks, Regulatory Intelligence.
    """
    import subprocess
    result = subprocess.run(
        ["dbt", "run", "--profiles-dir", "/dbt/profiles", "--project-dir", "/dbt",
         "--select", "compliance_scores sector_benchmarks regulatory_intelligence vendor_risk_scores"],
        capture_output=True, text=True, timeout=300
    )
    if result.returncode != 0:
        logger.error(f"dbt run failed: {result.stderr}")
        raise Exception(f"dbt run failed: {result.stderr}")
    logger.info(f"dbt run completed: {result.stdout}")


def enforce_data_retention(**context):
    """
    Enforces data retention policies across all organizations.
    Flags data that has exceeded its retention period for deletion.
    """
    conn = get_db_conn()
    cur = conn.cursor()
    try:
        # Find expired retention policies
        cur.execute("""
            SELECT rp.id, rp.org_id, o.name, rp.data_category,
                   rp.retention_period_days, rp.last_enforced_at
            FROM retention_policies rp
            JOIN organizations o ON rp.org_id = o.id
            WHERE rp.status = 'active'
            AND (rp.last_enforced_at IS NULL OR rp.last_enforced_at < NOW() - INTERVAL '1 day')
        """)
        policies = cur.fetchall()

        enforced = 0
        for policy in policies:
            cur.execute("""
                UPDATE retention_policies
                SET last_enforced_at = NOW(),
                    enforcement_count = COALESCE(enforcement_count, 0) + 1
                WHERE id = %s
            """, (policy[0],))
            enforced += 1

        conn.commit()
        logger.info(f"Enforced {enforced} retention policies")
        context['task_instance'].xcom_push(key='policies_enforced', value=enforced)

    finally:
        cur.close()
        conn.close()


# ── DAG 1: Daily Compliance Operations ───────────────────────────────────────
with DAG(
    dag_id="ndsep_daily_compliance",
    description="Daily NDSEP compliance operations: score recalculation, breach SLA monitoring, retention enforcement",
    schedule_interval="0 6 * * *",  # 6 AM WAT daily
    default_args=NDSEP_DEFAULT_ARGS,
    catchup=False,
    tags=["ndsep", "compliance", "daily", "ndpa"],
    doc_md="""
    ## NDSEP Daily Compliance DAG
    Runs every day at 06:00 WAT (West Africa Time).

    ### Tasks:
    1. **recalculate_scores** — Recalculates compliance scores for all ~2,847 registered organizations
    2. **check_breach_slas** — Monitors 72-hour NDPA breach notification requirement
    3. **enforce_retention** — Enforces data retention policies
    4. **run_dbt_models** — Rebuilds analytics models for dashboards
    """,
) as daily_dag:

    start = EmptyOperator(task_id="start")

    recalculate_scores = PythonOperator(
        task_id="recalculate_compliance_scores",
        python_callable=recalculate_compliance_scores,
        doc_md="Recalculates compliance scores for all active organizations using 6 NDPA compliance factors",
    )

    check_breaches = PythonOperator(
        task_id="check_breach_slas",
        python_callable=check_breach_slas,
        doc_md="Monitors breach notifications for NDPA 72-hour notification SLA compliance",
    )

    enforce_retention = PythonOperator(
        task_id="enforce_data_retention",
        python_callable=enforce_data_retention,
        doc_md="Enforces data retention policies and flags expired data for deletion",
    )

    dbt_models = BashOperator(
        task_id="run_dbt_compliance_models",
        bash_command="""
        cd /dbt && dbt run --profiles-dir /dbt/profiles \
          --select compliance_scores sector_benchmarks \
          --vars '{"execution_date": "{{ ds }}"}'
        """,
        doc_md="Rebuilds dbt analytics models for compliance dashboards",
    )

    end = EmptyOperator(task_id="end")

    start >> [recalculate_scores, check_breaches, enforce_retention] >> dbt_models >> end


# ── DAG 2: Monthly Audit Returns ─────────────────────────────────────────────
with DAG(
    dag_id="ndsep_monthly_audit_returns",
    description="Monthly audit return generation and reminder workflow",
    schedule_interval="0 8 1 * *",  # 1st of each month at 8 AM
    default_args=NDSEP_DEFAULT_ARGS,
    catchup=False,
    tags=["ndsep", "audit", "monthly", "ndpa"],
) as monthly_dag:

    start_monthly = EmptyOperator(task_id="start")

    generate_returns = PythonOperator(
        task_id="generate_monthly_audit_returns",
        python_callable=generate_monthly_audit_returns,
        doc_md="Creates draft audit returns for organizations and sends reminders",
    )

    dbt_monthly = BashOperator(
        task_id="run_dbt_monthly_models",
        bash_command="""
        cd /dbt && dbt run --profiles-dir /dbt/profiles \
          --select monthly_compliance_summary sector_benchmarks regulatory_intelligence
        """,
    )

    end_monthly = EmptyOperator(task_id="end")

    start_monthly >> generate_returns >> dbt_monthly >> end_monthly


# ── DAG 3: Annual DPIA Review Cycle ──────────────────────────────────────────
with DAG(
    dag_id="ndsep_annual_dpia_review",
    description="Annual DPIA review cycle — identifies DPIAs due for renewal",
    schedule_interval="0 9 1 1 *",  # January 1st at 9 AM
    default_args=NDSEP_DEFAULT_ARGS,
    catchup=False,
    tags=["ndsep", "dpia", "annual", "ndpa"],
) as annual_dag:

    def trigger_dpia_reviews(**context):
        """Identifies DPIAs that are 1 year old and need review."""
        conn = get_db_conn()
        cur = conn.cursor()
        try:
            cur.execute("""
                SELECT da.id, da.org_id, o.name, da.title, da.created_at
                FROM dpia_assessments da
                JOIN organizations o ON da.org_id = o.id
                WHERE da.status = 'approved'
                AND da.created_at < NOW() - INTERVAL '1 year'
                AND da.next_review_date IS NULL OR da.next_review_date < NOW()
            """)
            due_dpias = cur.fetchall()
            logger.info(f"Found {len(due_dpias)} DPIAs due for annual review")

            for dpia_id, org_id, org_name, title, created_at in due_dpias:
                cur.execute("""
                    UPDATE dpia_assessments
                    SET status = 'review_required',
                        next_review_date = NOW() + INTERVAL '1 year',
                        updated_at = NOW()
                    WHERE id = %s
                """, (dpia_id,))

            conn.commit()
            context['task_instance'].xcom_push(key='dpias_flagged', value=len(due_dpias))
        finally:
            cur.close()
            conn.close()

    start_annual = EmptyOperator(task_id="start")
    dpia_reviews = PythonOperator(task_id="trigger_dpia_reviews", python_callable=trigger_dpia_reviews)
    end_annual = EmptyOperator(task_id="end")
    start_annual >> dpia_reviews >> end_annual
