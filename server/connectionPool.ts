/**
 * NDSEP Connection Pool Monitor & Optimizer
 * ============================================
 * Monitors PostgreSQL connection pool health and provides metrics.
 * Integrates with readiness probe for early saturation detection.
 *
 * Recommendation M10: Database connection pooling optimization
 */

import pg from "pg";
import { logger } from "./logger";

export interface PoolMetrics {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  activeCount: number;
  maxSize: number;
  utilizationPercent: number;
  isHealthy: boolean;
}

/** Get metrics from a pg.Pool instance */
export function getPoolMetrics(pool: pg.Pool): PoolMetrics {
  const totalCount = pool.totalCount;
  const idleCount = pool.idleCount;
  const waitingCount = pool.waitingCount;
  const activeCount = totalCount - idleCount;
  const maxSize = (pool as unknown as { options?: { max?: number } }).options?.max ?? 20;
  const utilizationPercent = maxSize > 0 ? Math.round((activeCount / maxSize) * 100) : 0;
  const isHealthy = utilizationPercent < 80 && waitingCount < 5;

  return { totalCount, idleCount, waitingCount, activeCount, maxSize, utilizationPercent, isHealthy };
}

/**
 * Start periodic pool health logging.
 * Warns when pool utilization exceeds 70%.
 */
export function startPoolMonitor(pool: pg.Pool, intervalMs: number = 60_000): NodeJS.Timeout {
  return setInterval(() => {
    const metrics = getPoolMetrics(pool);
    if (metrics.utilizationPercent > 70) {
      logger.warn({ ...metrics }, "[Pool] High utilization — consider increasing pool size");
    }
    if (metrics.waitingCount > 0) {
      logger.warn({ waitingCount: metrics.waitingCount }, "[Pool] Queries waiting for connections");
    }
  }, intervalMs);
}

/**
 * Optimal pool configuration for NDSEP workload.
 * Based on PostgreSQL best practices: max_connections / (num_instances * 2)
 */
export function getOptimalPoolConfig(): pg.PoolConfig {
  const maxConnections = parseInt(process.env.PG_MAX_CONNECTIONS ?? "100", 10);
  const instanceCount = parseInt(process.env.INSTANCE_COUNT ?? "1", 10);

  return {
    max: Math.floor(maxConnections / (instanceCount * 2)),
    min: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Statement-level timeout to prevent runaway queries
    statement_timeout: 30_000,
    // Idle in transaction timeout
    idle_in_transaction_session_timeout: 60_000,
  };
}
