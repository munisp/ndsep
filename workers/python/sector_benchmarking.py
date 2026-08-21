#!/usr/bin/env python3
"""
Sector Benchmarking Analytics Worker — NDSEP Enhancement
Computes compliance percentile rankings and comparative analytics per sector.
"""
import os
import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional
import psycopg2
from psycopg2.extras import RealDictCursor

logging.basicConfig(level=logging.INFO, format="%(asctime)s [sector_benchmarking] %(levelname)s %(message)s")
log = logging.getLogger(__name__)

DB_URL = os.environ.get(
    "NDSEP_PG_URL",
    "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"
)

SECTOR_LABELS = {
    "fintech":       "Financial Technology",
    "healthcare":    "Healthcare & Pharma",
    "telco":         "Telecommunications",
    "government":    "Government & Public Sector",
    "ecommerce":     "E-Commerce & Retail",
    "education":     "Education",
    "energy":        "Energy & Utilities",
    "media":         "Media & Entertainment",
    "logistics":     "Logistics & Transport",
    "agriculture":   "Agriculture",
}


def get_connection():
    return psycopg2.connect(DB_URL, cursor_factory=RealDictCursor)


def ensure_benchmarks_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sector_benchmark_snapshots (
                id SERIAL PRIMARY KEY,
                sector TEXT NOT NULL,
                org_count INTEGER DEFAULT 0,
                avg_compliance_score NUMERIC(5,1),
                median_compliance_score NUMERIC(5,1),
                p90_compliance_score NUMERIC(5,1),
                breach_rate_pct NUMERIC(5,2),
                avg_dsar_response_days NUMERIC(5,1),
                active_dpco_pct NUMERIC(5,2),
                avg_penalty_ngn BIGINT,
                snapshot_date DATE DEFAULT CURRENT_DATE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_sector_bench_sector ON sector_benchmark_snapshots(sector);
            CREATE INDEX IF NOT EXISTS idx_sector_bench_date ON sector_benchmark_snapshots(snapshot_date);
        """)
        conn.commit()


def compute_sector_benchmarks():
    """Compute per-sector benchmarks from live data and persist snapshots."""
    conn = get_connection()
    ensure_benchmarks_table(conn)
    try:
        with conn.cursor() as cur:
            # Get distinct sectors from organisations
            cur.execute("""
                SELECT DISTINCT sector FROM organisations
                WHERE sector IS NOT NULL AND sector != ''
            """)
            sectors = [r["sector"] for r in cur.fetchall()]

        if not sectors:
            log.info("No sectors found in organisations table.")
            return []

        results = []
        for sector in sectors:
            with conn.cursor() as cur:
                # Organisation-level compliance stats
                cur.execute("""
                    SELECT
                        COUNT(*) AS org_count,
                        AVG(compliance_score) AS avg_score,
                        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY compliance_score) AS median_score,
                        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY compliance_score) AS p90_score
                    FROM organisations
                    WHERE sector = %s AND compliance_score IS NOT NULL
                """, (sector,))
                stats = dict(cur.fetchone() or {})

                # Breach rate
                cur.execute("""
                    SELECT
                        COUNT(DISTINCT bn.org_id)::FLOAT / NULLIF(COUNT(DISTINCT o.id), 0) * 100 AS breach_rate
                    FROM organisations o
                    LEFT JOIN breach_notifications bn ON bn.org_id = o.id
                        AND bn.created_at > NOW() - INTERVAL '12 months'
                    WHERE o.sector = %s
                """, (sector,))
                breach = dict(cur.fetchone() or {})

                # DSAR response time
                cur.execute("""
                    SELECT AVG(
                        EXTRACT(EPOCH FROM (cr.resolved_at - cr.created_at)) / 86400
                    ) AS avg_days
                    FROM citizen_requests cr
                    JOIN organisations o ON o.id = cr.org_id
                    WHERE o.sector = %s AND cr.resolved_at IS NOT NULL
                """, (sector,))
                dsar = dict(cur.fetchone() or {})

                # DPCO active rate
                cur.execute("""
                    SELECT
                        COUNT(CASE WHEN dpco.accreditation_status = 'active' THEN 1 END)::FLOAT
                        / NULLIF(COUNT(*), 0) * 100 AS dpco_pct
                    FROM organisations o
                    LEFT JOIN dpco_organisations dpco ON dpco.registered_name = o.name
                    WHERE o.sector = %s
                """, (sector,))
                dpco = dict(cur.fetchone() or {})

                # Average penalty
                cur.execute("""
                    SELECT AVG(amount) AS avg_penalty
                    FROM penalties p
                    JOIN organisations o ON o.id = p.org_id
                    WHERE o.sector = %s AND p.status = 'paid'
                """, (sector,))
                penalty = dict(cur.fetchone() or {})

            snapshot = {
                "sector": sector,
                "org_count": int(stats.get("org_count") or 0),
                "avg_compliance_score": round(float(stats.get("avg_score") or 0), 1),
                "median_compliance_score": round(float(stats.get("median_score") or 0), 1),
                "p90_compliance_score": round(float(stats.get("p90_score") or 0), 1),
                "breach_rate_pct": round(float(breach.get("breach_rate") or 0), 2),
                "avg_dsar_response_days": round(float(dsar.get("avg_days") or 0), 1),
                "active_dpco_pct": round(float(dpco.get("dpco_pct") or 0), 2),
                "avg_penalty_ngn": int(penalty.get("avg_penalty") or 0),
            }

            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO sector_benchmark_snapshots
                        (sector, org_count, avg_compliance_score, median_compliance_score,
                         p90_compliance_score, breach_rate_pct, avg_dsar_response_days,
                         active_dpco_pct, avg_penalty_ngn, snapshot_date)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_DATE)
                    ON CONFLICT DO NOTHING
                """, (
                    snapshot["sector"],
                    snapshot["org_count"],
                    snapshot["avg_compliance_score"],
                    snapshot["median_compliance_score"],
                    snapshot["p90_compliance_score"],
                    snapshot["breach_rate_pct"],
                    snapshot["avg_dsar_response_days"],
                    snapshot["active_dpco_pct"],
                    snapshot["avg_penalty_ngn"],
                ))
            conn.commit()
            log.info(f"Benchmarked sector {sector}: {snapshot['org_count']} orgs, avg score {snapshot['avg_compliance_score']}")
            results.append(snapshot)

        return results
    finally:
        conn.close()


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "run":
        results = compute_sector_benchmarks()
        print(json.dumps(results, indent=2, default=str))
    else:
        log.info("Starting sector benchmarking daemon (interval: 24h)")
        while True:
            try:
                results = compute_sector_benchmarks()
                log.info(f"Benchmarked {len(results)} sectors")
            except Exception as e:
                log.error(f"Benchmarking run failed: {e}")
            time.sleep(24 * 3600)
