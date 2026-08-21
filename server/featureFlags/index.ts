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

// ── Schema ──────────────────────────────────────────────────────────────────

const FLAGS_DDL = `
CREATE TABLE IF NOT EXISTS feature_flags (
  name VARCHAR(128) PRIMARY KEY,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  strategy VARCHAR(32) NOT NULL DEFAULT 'off',
  parameters JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_flag_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_name VARCHAR(128) NOT NULL,
  action VARCHAR(16) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  changed_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export async function initFeatureFlags(): Promise<void> {
  const db = (await getDb())!;
  try {
    await db.execute(sql.raw(FLAGS_DDL));
    await seedDefaultFlags();
    logger.info("Feature flags initialized");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: msg }, "Feature flags init (tables may already exist)");
  }
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
    await db.execute(sql`
      INSERT INTO feature_flags (name, description, enabled, strategy, parameters)
      VALUES (${f.name}, ${f.description}, ${f.enabled}, ${f.strategy}, ${JSON.stringify(f.params)}::jsonb)
      ON CONFLICT (name) DO NOTHING
    `);
  }
}

// ── Flag Evaluation ─────────────────────────────────────────────────────────

export async function isEnabled(
  flagName: string,
  context?: { orgId?: number; sector?: string; userId?: number },
): Promise<boolean> {
  const db = (await getDb())!;
  const result = await db.execute(sql`
    SELECT enabled, strategy, parameters FROM feature_flags WHERE name = ${flagName}
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
      const hash = context?.orgId ?? context?.userId ?? Math.random() * 100;
      return (hash % 100) < pct;
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
      const hash = context?.orgId ?? Math.random() * 100;
      return (hash % 100) < current;
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
  const old = await db.execute(sql`SELECT * FROM feature_flags WHERE name = ${name}`);
  const oldValue = old.rows[0] ?? null;

  await db.execute(sql`
    UPDATE feature_flags
    SET enabled = ${enabled},
        strategy = COALESCE(${strategy ?? null}, strategy),
        parameters = COALESCE(${parameters ? JSON.stringify(parameters) : null}::jsonb, parameters),
        updated_at = NOW()
    WHERE name = ${name}
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
    SELECT name, description, enabled, strategy, parameters, created_at, updated_at
    FROM feature_flags ORDER BY name
  `);
  return result.rows as FeatureFlag[];
}
