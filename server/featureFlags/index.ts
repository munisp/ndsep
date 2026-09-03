/**
 * NDSEP Feature Flags — Progressive rollout and kill switches
 *
 * Provides:
 * - Toggle features per organization/sector/percentage
 * - Kill switches for problematic features
 * - A/B testing support
 * - Audit trail for flag changes
 *
 * Compatible with Unleash self-hosted or uses built-in flag store.
 */
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../logger";

// ── Types ───────────────────────────────────────────────────────────────────

export type FlagStrategy = "on" | "off" | "percentage" | "org_list" | "sector" | "gradual";

export type FeatureFlag = {
  name: string;
  description: string;
  enabled: boolean;
  strategy: FlagStrategy;
  parameters: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

// ── Migration readiness ─────────────────────────────────────────────────────

const REQUIRED_FEATURE_FLAG_COLUMNS = ["key", "enabled", "strategy", "parameters"] as const;

async function assertFeatureFlagSchema(): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Feature flag database is unavailable");

  const result = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'feature_flags'
      AND column_name IN ('key', 'enabled', 'strategy', 'parameters')
  `);
  const found = new Set(result.rows.map((row) => String((row as { column_name: string }).column_name)));
  const missing = REQUIRED_FEATURE_FLAG_COLUMNS.filter((column) => !found.has(column));
  if (missing.length > 0) {
    throw new Error(`Feature flag migration 0044 is incomplete; missing columns: ${missing.join(", ")}`);
  }
}

export async function initFeatureFlags(): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    logger.info("Feature flag migration verification skipped in explicit test mode");
    return;
  }

  await assertFeatureFlagSchema();
  await seedDefaultFlags();
  logger.info("Feature flags initialized from migration-owned schema");
}

async function seedDefaultFlags(): Promise<void> {
  const db = (await getDb())!;
  const defaults: Array<{ name: string; description: string; strategy: FlagStrategy; enabled: boolean; params: Record<string, unknown> }> = [
    { name: "wiredigg_network_intelligence", description: "Real-time network packet capture and threat detection", strategy: "on", enabled: true, params: {} },
    { name: "liveness_verification", description: "Biometric liveness detection for KYC", strategy: "on", enabled: true, params: {} },
    { name: "ai_compliance_engine", description: "LLM-powered compliance queries and DPIA generation", strategy: "percentage", enabled: true, params: { percentage: 50 } },
    { name: "federated_learning", description: "Cross-organization threat intelligence sharing", strategy: "sector", enabled: false, params: { sectors: ["banking", "telecom"] } },
    { name: "quantum_crypto", description: "Post-quantum cryptographic operations", strategy: "off", enabled: false, params: {} },
    { name: "digital_twin_simulation", description: "Data ecosystem simulation engine", strategy: "org_list", enabled: true, params: { org_ids: [1, 2, 3] } },
    { name: "blockchain_audit_trail", description: "Merkle tree anchored audit logs", strategy: "gradual", enabled: true, params: { current_percentage: 10, target_percentage: 100, increment_per_day: 5 } },
    { name: "multi_tenant_schema_isolation", description: "Schema-per-tenant for sensitive sectors", strategy: "sector", enabled: true, params: { sectors: ["banking", "healthcare"] } },
    { name: "websocket_realtime", description: "WebSocket push for live data (replaces polling)", strategy: "percentage", enabled: true, params: { percentage: 30 } },
    { name: "nigerian_language_ui", description: "Yoruba, Hausa, Igbo interface translations", strategy: "on", enabled: true, params: {} },
  ];

  for (const f of defaults) {
    const rolloutPercentage = f.strategy === "on"
      ? 100
      : f.strategy === "percentage"
        ? Number(f.params.percentage ?? 0)
        : f.strategy === "gradual"
          ? Number(f.params.current_percentage ?? 0)
          : 0;
    await db.execute(sql`
      INSERT INTO feature_flags (key, description, enabled, rollout_percentage, strategy, parameters)
      VALUES (${f.name}, ${f.description}, ${f.enabled}, ${rolloutPercentage}, ${f.strategy}, ${JSON.stringify(f.params)}::jsonb)
      ON CONFLICT (key) DO NOTHING
    `);
  }
}

// ── Flag Evaluation ─────────────────────────────────────────────────────────

function stableRolloutBucket(
  flagName: string,
  context?: { orgId?: number; sector?: string; userId?: number },
): number {
  const subject = context?.orgId ?? context?.userId ?? context?.sector ?? "anonymous";
  let hash = 0;
  for (const character of `${flagName}:${subject}`) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash % 100;
}

export async function isEnabled(
  flagName: string,
  context?: { orgId?: number; sector?: string; userId?: number },
): Promise<boolean> {
  const db = (await getDb())!;
  const result = await db.execute(sql`
    SELECT enabled, strategy, parameters FROM feature_flags WHERE key = ${flagName}
  `);

  if (result.rows.length === 0) return false;

  const row = result.rows[0] as { enabled: boolean; strategy: string; parameters: Record<string, unknown> };
  if (!row.enabled) return false;

  switch (row.strategy) {
    case "on":
      return true;
    case "off":
      return false;
    case "percentage": {
      const pct = Number(row.parameters.percentage) || 0;
      return stableRolloutBucket(flagName, context) < pct;
    }
    case "org_list": {
      const orgIds = (row.parameters.org_ids as number[]) ?? [];
      return context?.orgId != null && orgIds.includes(context.orgId);
    }
    case "sector": {
      const sectors = (row.parameters.sectors as string[]) ?? [];
      return context?.sector != null && sectors.includes(context.sector.toLowerCase());
    }
    case "gradual": {
      const current = Number(row.parameters.current_percentage) || 0;
      return stableRolloutBucket(flagName, context) < current;
    }
    default:
      return row.enabled;
  }
}

// ── Flag Management ─────────────────────────────────────────────────────────

export async function setFlag(
  name: string,
  enabled: boolean,
  strategy?: FlagStrategy,
  parameters?: Record<string, unknown>,
  changedBy?: number,
): Promise<void> {
  const db = (await getDb())!;

  // Get old value for audit
  const old = await db.execute(sql`SELECT * FROM feature_flags WHERE key = ${name}`);
  const oldValue = old.rows[0] ?? null;

  await db.execute(sql`
    UPDATE feature_flags
    SET enabled = ${enabled},
        strategy = COALESCE(${strategy ?? null}, strategy),
        parameters = COALESCE(${parameters ? JSON.stringify(parameters) : null}::jsonb, parameters),
        updated_at = NOW()
    WHERE key = ${name}
  `);

  // Audit log
  await db.execute(sql`
    INSERT INTO feature_flag_audit (flag_name, action, old_value, new_value, changed_by)
    VALUES (${name}, ${enabled ? "enabled" : "disabled"}, ${JSON.stringify(oldValue)}::jsonb, ${JSON.stringify({ enabled, strategy, parameters })}::jsonb, ${changedBy ?? null})
  `);

  logger.info({ flag: name, enabled, strategy }, "Feature flag updated");
}

export async function getAllFlags(): Promise<FeatureFlag[]> {
  const db = (await getDb())!;
  const result = await db.execute(sql`
    SELECT key AS name, description, enabled, strategy, parameters, created_at, updated_at
    FROM feature_flags ORDER BY key
  `);
  return result.rows as FeatureFlag[];
}
