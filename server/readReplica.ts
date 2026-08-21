/**
 * NDSEP Read Replica Configuration
 * ==================================
 * Routes read-only queries to a replica database to reduce load on the primary.
 *
 * Recommendation E7: Read replica for heavy query workloads
 *
 * Environment:
 *   DATABASE_REPLICA_URL — PostgreSQL connection string for read replica
 */

import pg from "pg";
import { getPgSslConfig } from "./dbSslConfig";
import { logger } from "./logger";
import { handleError } from "./errorClassifier";

let _readPool: pg.Pool | null = null;
let _replicaAvailable = false;

/** Initialize the read replica pool (if configured) */
export function initReadReplica(): boolean {
  const replicaUrl = process.env.DATABASE_REPLICA_URL;
  if (!replicaUrl) {
    logger.info("[ReadReplica] DATABASE_REPLICA_URL not set — using primary for all queries");
    return false;
  }

  try {
    _readPool = new pg.Pool({
      connectionString: replicaUrl,
      ssl: getPgSslConfig(),
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    _readPool.on("error", (err) => {
      handleError(err, { module: "readReplica", action: "pool-error" });
      _replicaAvailable = false;
    });

    _replicaAvailable = true;
    logger.info("[ReadReplica] Read replica pool initialized");
    return true;
  } catch (err) {
    handleError(err, { module: "readReplica", action: "init" });
    return false;
  }
}

/**
 * Get the read pool — returns replica if available, primary as fallback.
 * Use this for all read-only queries (lists, stats, reports, dashboards).
 */
export function getReadPool(primaryPool: pg.Pool): pg.Pool {
  if (_replicaAvailable && _readPool) return _readPool;
  return primaryPool;
}

/** Check if read replica is available */
export function isReplicaAvailable(): boolean {
  return _replicaAvailable;
}

/** Close the read replica pool */
export async function closeReadReplica(): Promise<void> {
  if (_readPool) {
    await _readPool.end();
    _readPool = null;
    _replicaAvailable = false;
    logger.info("[ReadReplica] Pool closed");
  }
}
