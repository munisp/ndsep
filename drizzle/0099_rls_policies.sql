-- ============================================================
-- NDSEP Row-Level Security (RLS) Policies — Priority 3
-- Enables true multi-tenancy: each DPCO org can only see its own data.
-- Admin users bypass all policies via the ndsep_admin role.
-- ============================================================

-- ── Create application roles ──────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ndsep_app') THEN
    CREATE ROLE ndsep_app;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ndsep_admin') THEN
    CREATE ROLE ndsep_admin;
  END IF;
END $$;

-- Grant ndsep_admin to ndsep_user so admin can bypass RLS
GRANT ndsep_admin TO ndsep_user;

-- ── Helper function: get current org ID from session variable ─────────────────
-- Set via: SET LOCAL ndsep.current_org_id = '42';
-- Set via: SET LOCAL ndsep.current_role = 'admin';
CREATE OR REPLACE FUNCTION ndsep_current_org_id() RETURNS INTEGER AS $$
BEGIN
  RETURN NULLIF(current_setting('ndsep.current_org_id', true), '')::INTEGER;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ndsep_is_admin() RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE(current_setting('ndsep.current_role', true), '') = 'admin';
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ── Enable RLS on DPCO tables ─────────────────────────────────────────────────

ALTER TABLE dpco_organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dpco_accreditation_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE dpco_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dpco_evidence_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE dpco_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE dpco_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE dpco_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dpco_performance_metrics ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies: dpco_organisations ─────────────────────────────────────────

-- Admins see all orgs
CREATE POLICY dpco_organisations_admin_all ON dpco_organisations
  FOR ALL
  USING (ndsep_is_admin());

-- DPCOs see only their own org
CREATE POLICY dpco_organisations_own ON dpco_organisations
  FOR SELECT
  USING (org_id = ndsep_current_org_id());

-- ── RLS Policies: dpco_accreditation_applications ────────────────────────────

CREATE POLICY dpco_accreditation_admin_all ON dpco_accreditation_applications
  FOR ALL
  USING (ndsep_is_admin());

CREATE POLICY dpco_accreditation_own ON dpco_accreditation_applications
  FOR SELECT
  USING (dpco_org_id = ndsep_current_org_id());

-- ── RLS Policies: dpco_audit_logs ────────────────────────────────────────────

CREATE POLICY dpco_audit_logs_admin_all ON dpco_audit_logs
  FOR ALL
  USING (ndsep_is_admin());

CREATE POLICY dpco_audit_logs_own ON dpco_audit_logs
  FOR SELECT
  USING (dpco_org_id = ndsep_current_org_id());

-- ── RLS Policies: dpco_evidence_items ────────────────────────────────────────

CREATE POLICY dpco_evidence_admin_all ON dpco_evidence_items
  FOR ALL
  USING (ndsep_is_admin());

CREATE POLICY dpco_evidence_own ON dpco_evidence_items
  FOR ALL
  USING (dpco_org_id = ndsep_current_org_id());

-- ── RLS Policies: dpco_invoices ───────────────────────────────────────────────

CREATE POLICY dpco_invoices_admin_all ON dpco_invoices
  FOR ALL
  USING (ndsep_is_admin());

CREATE POLICY dpco_invoices_own ON dpco_invoices
  FOR SELECT
  USING (dpco_org_id = ndsep_current_org_id());

-- ── RLS Policies: dpco_payments ──────────────────────────────────────────────

CREATE POLICY dpco_payments_admin_all ON dpco_payments
  FOR ALL
  USING (ndsep_is_admin());

CREATE POLICY dpco_payments_own ON dpco_payments
  FOR SELECT
  USING (dpco_org_id = ndsep_current_org_id());

-- ── RLS Policies: dpco_subscriptions ─────────────────────────────────────────

CREATE POLICY dpco_subscriptions_admin_all ON dpco_subscriptions
  FOR ALL
  USING (ndsep_is_admin());

CREATE POLICY dpco_subscriptions_own ON dpco_subscriptions
  FOR ALL
  USING (dpco_org_id = ndsep_current_org_id());

-- ── RLS Policies: dpco_performance_metrics ───────────────────────────────────

CREATE POLICY dpco_perf_admin_all ON dpco_performance_metrics
  FOR ALL
  USING (ndsep_is_admin());

CREATE POLICY dpco_perf_own ON dpco_performance_metrics
  FOR SELECT
  USING (dpco_org_id = ndsep_current_org_id());

-- ── Apply RLS policies to the database ───────────────────────────────────────
-- Run: psql $NDSEP_PG_URL -f drizzle/0099_rls_policies.sql
