/**
 * NDSEP Feature Flag System
 * ==========================
 * Provides gradual rollout, A/B testing, and kill-switch capabilities.
 *
 * Recommendation E1: Feature flag system for gradual rollouts
 */

import { Pool } from "pg";
import { logger } from "./logger";
import { handleError } from "./errorClassifier";

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  rolloutPercentage: number; // 0-100
  targetOrgs: number[];     // specific org IDs
  targetRoles: string[];    // specific roles
  environment: string[];    // "production", "staging", "development"
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

// In-memory cache with TTL
let flagCache: Map<string, FeatureFlag> = new Map();
let cacheExpiry = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  rollout_percentage INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percentage BETWEEN 0 AND 100),
  target_orgs INTEGER[] DEFAULT '{}',
  target_roles TEXT[] DEFAULT '{}',
  environment TEXT[] DEFAULT '{production,staging,development}',
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

export async function initFeatureFlags(pool: Pool): Promise<void> {
  try {
    await pool.query(CREATE_TABLE_SQL);
    await refreshFlagCache(pool);
    logger.info("[FeatureFlags] Initialized");
  } catch (err) {
    handleError(err, { module: "featureFlags", action: "init" });
  }
}

async function refreshFlagCache(pool: Pool): Promise<void> {
  try {
    const result = await pool.query("SELECT * FROM feature_flags");
    flagCache = new Map();
    for (const row of result.rows) {
      flagCache.set(row.key, {
        key: row.key,
        enabled: row.enabled,
        rolloutPercentage: row.rollout_percentage,
        targetOrgs: row.target_orgs ?? [],
        targetRoles: row.target_roles ?? [],
        environment: row.environment ?? [],
        description: row.description ?? "",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }
    cacheExpiry = Date.now() + CACHE_TTL_MS;
  } catch (err) {
    handleError(err, { module: "featureFlags", action: "refresh" });
  }
}

/** Check if a feature is enabled for a specific context */
export function isFeatureEnabled(
  key: string,
  context?: { userId?: string; orgId?: number; role?: string; environment?: string }
): boolean {
  const flag = flagCache.get(key);
  if (!flag) return false;
  if (!flag.enabled) return false;

  const env = context?.environment ?? process.env.NODE_ENV ?? "development";
  if (flag.environment.length > 0 && !flag.environment.includes(env)) return false;

  // Check org targeting
  if (flag.targetOrgs.length > 0 && context?.orgId) {
    if (flag.targetOrgs.includes(context.orgId)) return true;
  }

  // Check role targeting
  if (flag.targetRoles.length > 0 && context?.role) {
    if (flag.targetRoles.includes(context.role)) return true;
  }

  // Percentage rollout (deterministic hash based on userId or random)
  if (flag.rolloutPercentage >= 100) return true;
  if (flag.rolloutPercentage <= 0) return false;
  
  const seed = context?.userId ?? Math.random().toString();
  const hash = simpleHash(seed + key);
  return (hash % 100) < flag.rolloutPercentage;
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Set a feature flag value */
export async function setFeatureFlag(
  pool: Pool,
  key: string,
  update: Partial<Pick<FeatureFlag, "enabled" | "rolloutPercentage" | "targetOrgs" | "targetRoles" | "environment" | "description">>
): Promise<void> {
  await pool.query(
    `INSERT INTO feature_flags (key, enabled, rollout_percentage, target_orgs, target_roles, environment, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (key) DO UPDATE SET
       enabled = COALESCE($2, feature_flags.enabled),
       rollout_percentage = COALESCE($3, feature_flags.rollout_percentage),
       target_orgs = COALESCE($4, feature_flags.target_orgs),
       target_roles = COALESCE($5, feature_flags.target_roles),
       environment = COALESCE($6, feature_flags.environment),
       description = COALESCE($7, feature_flags.description),
       updated_at = NOW()`,
    [key, update.enabled ?? false, update.rolloutPercentage ?? 0, update.targetOrgs ?? [], update.targetRoles ?? [], update.environment ?? [], update.description ?? ""]
  );
  await refreshFlagCache(pool);
}

/** List all feature flags */
export async function listFeatureFlags(pool: Pool): Promise<FeatureFlag[]> {
  if (Date.now() > cacheExpiry) await refreshFlagCache(pool);
  return Array.from(flagCache.values());
}
