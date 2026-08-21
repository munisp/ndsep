/**
 * NDSEP Database — Monitoring Domain Queries
 * =============================================
 * System health, worker status, SLA tracking.
 *
 * Recommendation H4: Domain module extraction
 */

import { getPool } from "../db";
import { handleError } from "../errorClassifier";
import { getPoolMetrics, type PoolMetrics } from "../connectionPool";

export interface SystemHealth {
  databaseHealthy: boolean;
  poolMetrics: PoolMetrics | null;
  activeWorkers: number;
  slaBreaches: number;
  driftAlerts: number;
}

/** Get system health overview */
export async function getSystemHealth(): Promise<SystemHealth> {
  const pool = getPool();
  if (!pool) return { databaseHealthy: false, poolMetrics: null, activeWorkers: 0, slaBreaches: 0, driftAlerts: 0 };

  try {
    const poolMetrics = getPoolMetrics(pool);

    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM worker_heartbeats WHERE last_heartbeat > NOW() - INTERVAL '5 minutes') as active_workers,
        (SELECT COUNT(*) FROM sla_breach_alerts WHERE status = 'open') as sla_breaches,
        (SELECT COUNT(*) FROM drift_alerts WHERE status = 'open') as drift_alerts
    `);
    const row = result.rows[0];

    return {
      databaseHealthy: true,
      poolMetrics,
      activeWorkers: parseInt(row.active_workers ?? "0", 10),
      slaBreaches: parseInt(row.sla_breaches ?? "0", 10),
      driftAlerts: parseInt(row.drift_alerts ?? "0", 10),
    };
  } catch (err) {
    handleError(err, { module: "db/monitoring", action: "getSystemHealth" });
    return { databaseHealthy: false, poolMetrics: null, activeWorkers: 0, slaBreaches: 0, driftAlerts: 0 };
  }
}
