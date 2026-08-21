/**
 * NDSEP Multi-Tenancy Isolation for DPCO Organizations
 * =====================================================
 * Ensures that DPCO organizations can only access their own data.
 * Implements row-level filtering via middleware that appends
 * organization_id / dpco_org_id filters to queries.
 *
 * Three isolation strategies:
 *   1. Middleware: tRPC context injects orgId, all queries filter by it
 *   2. RLS Policies: PostgreSQL row-level security (for defense-in-depth)
 *   3. View-based: org-scoped views that pre-filter data
 */

import { Pool } from "pg";
import { getDatabaseUrl } from "./config";
import { getPgSslConfig } from "./dbSslConfig";
import { logger } from "./logger";

export interface TenantContext {
  userId: string;
  role: string;
  dpcoOrgId: number | null;
  isAdmin: boolean;
}

/**
 * Tables that contain organization-scoped data.
 * Each entry maps table name → org ID column name.
 */
export const ORG_SCOPED_TABLES: Record<string, string> = {
  dpco_clients: "dpco_org_id",
  dpco_audit_engagements: "dpco_org_id",
  dpco_training_sessions: "dpco_org_id",
  dpco_policy_drafts: "dpco_org_id",
  dpco_subscriptions: "dpco_org_id",
  dpco_invoices: "dpco_org_id",
  dpco_payments: "dpco_org_id",
  platform_revenue_splits: "dpco_org_id",
  dpco_organisations: "id",
};

/**
 * SQL to enable PostgreSQL Row-Level Security on org-scoped tables.
 * Run once during migration to enable defense-in-depth.
 */
export async function enableRowLevelSecurity(): Promise<void> {
  const pool = new Pool({
    connectionString: getDatabaseUrl(),
    ssl: getPgSslConfig(),
    max: 2,
  });

  try {
    for (const [table, orgCol] of Object.entries(ORG_SCOPED_TABLES)) {
      // Check if table exists
      const exists = await pool.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)`,
        [table]
      );
      if (!exists.rows[0].exists) continue;

      // Enable RLS
      await pool.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);

      // Create policy for org isolation
      const policyName = `${table}_org_isolation`;
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies WHERE tablename = '${table}' AND policyname = '${policyName}'
          ) THEN
            EXECUTE format(
              'CREATE POLICY %I ON %I FOR ALL USING (%I = current_setting(''app.current_org_id'', true)::int OR current_setting(''app.is_admin'', true) = ''true'')',
              '${policyName}', '${table}', '${orgCol}'
            );
          END IF;
        END
        $$;
      `);

      logger.info({ table, orgCol }, "[MultiTenancy] RLS enabled on %s", table);
    }
  } catch (err) {
    logger.warn({ err }, "[MultiTenancy] RLS setup failed — application-level filtering still active");
  } finally {
    await pool.end();
  }
}

/**
 * Set the current tenant context on a database connection.
 * This activates PostgreSQL RLS policies for the duration of the connection.
 */
export async function setTenantContext(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  tenant: TenantContext
): Promise<void> {
  if (tenant.dpcoOrgId) {
    await client.query(`SET LOCAL app.current_org_id = '${tenant.dpcoOrgId}'`);
  }
  await client.query(`SET LOCAL app.is_admin = '${tenant.isAdmin}'`);
}

/**
 * Validate that a user has access to a specific organization's data.
 * Returns true if the user is an admin or belongs to the organization.
 */
export function canAccessOrg(tenant: TenantContext, targetOrgId: number): boolean {
  if (tenant.isAdmin) return true;
  if (tenant.role === "gov_staff") return true;
  return tenant.dpcoOrgId === targetOrgId;
}

/**
 * Build a SQL WHERE clause fragment for org isolation.
 * Admins and gov_staff see all rows; org users see only their org's rows.
 */
export function orgFilterClause(
  tenant: TenantContext,
  orgColumn: string = "dpco_org_id"
): { clause: string; params: unknown[] } {
  if (tenant.isAdmin || tenant.role === "gov_staff") {
    return { clause: "1=1", params: [] };
  }
  if (!tenant.dpcoOrgId) {
    return { clause: "1=0", params: [] }; // No org — see nothing
  }
  return { clause: `${orgColumn} = $1`, params: [tenant.dpcoOrgId] };
}
