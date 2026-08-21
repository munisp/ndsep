/**
 * NDSEP API Marketplace & Developer Ecosystem
 *
 * Provides:
 * - Developer portal with interactive API explorer
 * - API key management for third-party integrations
 * - Webhook marketplace (subscribe to compliance events)
 * - Plugin architecture for sector-specific modules
 * - SDK download endpoints
 * - Usage analytics and rate limit management
 */
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../logger";
import crypto from "crypto";
import type { Express, Request, Response } from "express";

// ── Types ───────────────────────────────────────────────────────────────────

export type ApiKeyScope = "read" | "write" | "admin";

export type WebhookEvent =
  | "breach.reported"
  | "breach.resolved"
  | "enforcement.created"
  | "enforcement.resolved"
  | "penalty.issued"
  | "penalty.paid"
  | "compliance.score_changed"
  | "audit.started"
  | "audit.completed"
  | "transfer.requested"
  | "transfer.approved"
  | "transfer.denied"
  | "dsar.received"
  | "dsar.completed"
  | "certificate.issued"
  | "certificate.revoked";

// ── Schema ──────────────────────────────────────────────────────────────────

const MARKETPLACE_DDL = `
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id INTEGER NOT NULL,
  name VARCHAR(128) NOT NULL,
  key_hash VARCHAR(64) NOT NULL UNIQUE,
  key_prefix VARCHAR(12) NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{read}',
  rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  total_requests INTEGER DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL,
  secret VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  failure_count INTEGER DEFAULT 0,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketplace_plugins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(128) NOT NULL UNIQUE,
  description TEXT,
  author VARCHAR(128),
  version VARCHAR(16) NOT NULL DEFAULT '1.0.0',
  sector VARCHAR(64),
  category VARCHAR(64),
  install_count INTEGER DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'published',
  manifest JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID REFERENCES api_keys(id),
  endpoint VARCHAR(256) NOT NULL,
  method VARCHAR(8) NOT NULL,
  status_code INTEGER,
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_log_api_key_id_fk ON api_usage_log (api_key_id);
`;

export async function initMarketplace(): Promise<void> {
  const db = (await getDb())!;
  try {
    await db.execute(sql.raw(MARKETPLACE_DDL));
    await seedPlugins();
    logger.info("API Marketplace initialized");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: msg }, "Marketplace init (tables may already exist)");
  }
}

async function seedPlugins(): Promise<void> {
  const db = (await getDb())!;
  const plugins = [
    { name: "banking-compliance-module", description: "CBN-specific compliance checks, BVN validation, AML monitoring", author: "NDSEP Core", sector: "banking", category: "compliance" },
    { name: "telecom-ncc-module", description: "NCC consumer code compliance, QoS monitoring, subscriber data protection", author: "NDSEP Core", sector: "telecom", category: "compliance" },
    { name: "healthcare-nhia-module", description: "NHIA data standards, health record protection, patient consent management", author: "NDSEP Core", sector: "healthcare", category: "compliance" },
    { name: "insurance-naicom-module", description: "NAICOM regulatory compliance, claims data protection, underwriter audit trail", author: "NDSEP Core", sector: "insurance", category: "compliance" },
    { name: "energy-nerc-module", description: "NERC smart meter data protection, SCADA security monitoring", author: "NDSEP Core", sector: "energy", category: "compliance" },
    { name: "gdpr-bridge", description: "GDPR-NDPA equivalence mapping for EU cross-border transfers", author: "NDSEP Core", sector: null, category: "integration" },
    { name: "soc2-evidence-export", description: "Auto-export NDSEP compliance evidence for SOC2 Type II audits", author: "NDSEP Core", sector: null, category: "integration" },
    { name: "slack-notifications", description: "Real-time Slack alerts for breaches, penalties, and audit findings", author: "NDSEP Core", sector: null, category: "notification" },
  ];

  for (const p of plugins) {
    await db.execute(sql`
      INSERT INTO marketplace_plugins (name, description, author, sector, category, manifest)
      VALUES (${p.name}, ${p.description}, ${p.author}, ${p.sector}, ${p.category}, ${JSON.stringify({ entry: `plugins/${p.name}/index.ts`, permissions: ["read:compliance", "read:organizations"] })}::jsonb)
      ON CONFLICT (name) DO NOTHING
    `);
  }
}

// ── API Key Management ──────────────────────────────────────────────────────

export async function createApiKey(
  orgId: number,
  name: string,
  scopes: ApiKeyScope[] = ["read"],
  rateLimitRpm = 60,
): Promise<{ key: string; keyPrefix: string; id: string }> {
  const db = (await getDb())!;
  const rawKey = `ndsep_${crypto.randomBytes(24).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 12);

  const result = await db.execute(sql`
    INSERT INTO api_keys (org_id, name, key_hash, key_prefix, scopes, rate_limit_rpm)
    VALUES (${orgId}, ${name}, ${keyHash}, ${keyPrefix}, ${scopes}, ${rateLimitRpm})
    RETURNING id
  `);

  return {
    key: rawKey,
    keyPrefix,
    id: String((result.rows[0] as { id: string }).id),
  };
}

export async function validateApiKey(key: string): Promise<{ valid: boolean; orgId?: number; scopes?: string[] }> {
  const db = (await getDb())!;
  const keyHash = crypto.createHash("sha256").update(key).digest("hex");

  const result = await db.execute(sql`
    SELECT id, org_id, scopes, rate_limit_rpm, status, expires_at
    FROM api_keys
    WHERE key_hash = ${keyHash} AND status = 'active'
  `);

  if (result.rows.length === 0) return { valid: false };

  const row = result.rows[0] as { id: string; org_id: number; scopes: string[]; expires_at: Date | null };

  if (row.expires_at && new Date(row.expires_at) < new Date()) return { valid: false };

  // Update usage
  await db.execute(sql`
    UPDATE api_keys SET last_used_at = NOW(), total_requests = total_requests + 1
    WHERE key_hash = ${keyHash}
  `);

  return { valid: true, orgId: row.org_id, scopes: row.scopes };
}

// ── Webhook Delivery ────────────────────────────────────────────────────────

export async function triggerWebhooks(event: WebhookEvent, payload: unknown): Promise<number> {
  const db = (await getDb())!;
  const subs = await db.execute(sql`
    SELECT id, url, secret FROM webhook_subscriptions
    WHERE ${event} = ANY(events) AND status = 'active'
  `);

  let delivered = 0;
  for (const row of subs.rows as { id: string; url: string; secret: string }[]) {
    const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
    const signature = crypto.createHmac("sha256", row.secret).update(body).digest("hex");

    try {
      const res = await fetch(row.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-NDSEP-Signature": signature,
          "X-NDSEP-Event": event,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        delivered++;
        await db.execute(sql`
          UPDATE webhook_subscriptions SET last_triggered_at = NOW(), failure_count = 0 WHERE id = ${row.id}::uuid
        `);
      } else {
        await db.execute(sql`
          UPDATE webhook_subscriptions SET failure_count = failure_count + 1 WHERE id = ${row.id}::uuid
        `);
      }
    } catch {
      await db.execute(sql`
        UPDATE webhook_subscriptions SET failure_count = failure_count + 1 WHERE id = ${row.id}::uuid
      `);
    }
  }

  return delivered;
}

// ── Express Routes for Developer Portal ─────────────────────────────────────

export function mountDeveloperPortal(app: Express): void {
  // SDK download stubs
  app.get("/api/marketplace/sdks", (_req: Request, res: Response) => {
    res.json({
      sdks: [
        { language: "python", version: "1.0.0", package: "ndsep-sdk", install: "pip install ndsep-sdk", docs: "/api/docs#python" },
        { language: "javascript", version: "1.0.0", package: "@ndsep/sdk", install: "npm install @ndsep/sdk", docs: "/api/docs#javascript" },
        { language: "go", version: "1.0.0", package: "github.com/ndsep/sdk-go", install: "go get github.com/ndsep/sdk-go", docs: "/api/docs#go" },
        { language: "java", version: "1.0.0", package: "ng.ndsep:sdk", install: "Maven/Gradle — see docs", docs: "/api/docs#java" },
        { language: "csharp", version: "1.0.0", package: "NDSEP.SDK", install: "dotnet add package NDSEP.SDK", docs: "/api/docs#csharp" },
      ],
    });
  });

  // Webhook events catalog
  app.get("/api/marketplace/webhook-events", (_req: Request, res: Response) => {
    res.json({
      events: [
        { name: "breach.reported", description: "Data breach reported by an organization", payload: { breach_id: "string", org_id: "number", severity: "string" } },
        { name: "breach.resolved", description: "Data breach marked as resolved", payload: { breach_id: "string", resolution: "string" } },
        { name: "enforcement.created", description: "New enforcement case opened", payload: { case_id: "string", org_id: "number", type: "string" } },
        { name: "penalty.issued", description: "Financial penalty issued", payload: { penalty_id: "string", amount: "number", currency: "string" } },
        { name: "compliance.score_changed", description: "Organization compliance score changed", payload: { org_id: "number", old_score: "number", new_score: "number" } },
        { name: "transfer.approved", description: "Cross-border data transfer approved", payload: { transfer_id: "string", source: "string", destination: "string" } },
        { name: "dsar.received", description: "Data subject access request received", payload: { dsar_id: "string", type: "string" } },
        { name: "certificate.issued", description: "Compliance certificate issued", payload: { cert_id: "string", org_id: "number" } },
      ],
    });
  });

  // Plugin catalog
  app.get("/api/marketplace/plugins", async (_req: Request, res: Response) => {
    try {
      const db = (await getDb())!;
      const result = await db.execute(sql`
        SELECT id, name, description, author, version, sector, category, install_count, status
        FROM marketplace_plugins WHERE status = 'published' ORDER BY install_count DESC
      `);
      res.json({ plugins: result.rows, total: result.rows.length });
    } catch {
      res.json({ plugins: [], total: 0 });
    }
  });

  logger.info("Developer portal mounted at /api/marketplace/*");
}
