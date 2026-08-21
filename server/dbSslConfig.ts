/**
 * Shared PostgreSQL SSL Configuration
 * ======================================
 * Centralizes SSL settings for all database connection pools.
 * In production, enables proper certificate verification.
 *
 * Environment variables:
 *   DB_SSL_CA              — Path to CA certificate file (enables full verification)
 *   DB_SSL_REJECT_UNAUTHORIZED — "true" (default in production) or "false"
 *   NODE_ENV               — "production" enables SSL by default
 */

import fs from "fs";
import { logger } from "./logger";

export interface PgSslConfig {
  rejectUnauthorized: boolean;
  ca?: string;
}

/**
 * Returns the SSL configuration for PostgreSQL connections.
 * - In production: SSL enabled with certificate verification (if CA is provided)
 * - In development: SSL disabled unless DATABASE_URL contains sslmode=require
 */
export function getPgSslConfig(): PgSslConfig | false {
  const isProduction = process.env.NODE_ENV === "production";
  const dbUrl = process.env.DATABASE_URL ?? "";
  const requiresSsl = dbUrl.includes("sslmode=require") || isProduction;

  if (!requiresSsl) return false;

  const caPath = process.env.DB_SSL_CA ?? "";
  const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false";

  const config: PgSslConfig = {
    rejectUnauthorized,
  };

  // Load CA certificate if provided
  if (caPath) {
    try {
      config.ca = fs.readFileSync(caPath, "utf8");
    } catch (err) {
      logger.warn({ data: err }, `[DB SSL] Failed to read CA certificate from ${caPath}:`);
    }
  }

  return config;
}
