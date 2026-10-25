-- ============================================================================
-- 0100: DPCO router ↔ canonical schema reconciliation (round 9, FIX-A)
--
-- server/routers/dpco.ts + the dpcoAuditLogs/dpcoPerformanceMetrics routers in
-- server/routers/enhancements.ts write columns and tables that were absent
-- from the canonical DDL (drizzle/create_dpco_tables.sql,
-- drizzle/0024_canonical_schema_reconciliation.sql). This migration adds the
-- missing columns/tables with canonical PostgreSQL types, all idempotent.
-- ============================================================================

-- ─── 1. dpco_org_status: router/dashboards use 'expired' ─────────────────────
ALTER TYPE dpco_org_status ADD VALUE IF NOT EXISTS 'expired';

-- ─── 2. dpco_organisations: columns the registry router writes ───────────────
ALTER TABLE dpco_organisations
  ADD COLUMN IF NOT EXISTS organisation_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS licence_date DATE,
  ADD COLUMN IF NOT EXISTS state VARCHAR(128),
  ADD COLUMN IF NOT EXISTS staff_count INTEGER,
  ADD COLUMN IF NOT EXISTS ndpc_reference VARCHAR(128),
  ADD COLUMN IF NOT EXISTS tax_clearance_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ng_domain_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Sequence-backed DPCO licence numbers (approveRegistration uses nextval).
CREATE SEQUENCE IF NOT EXISTS dpco_licence_seq;

-- ─── 3. dpco_clients: link to platform organisations ─────────────────────────
ALTER TABLE dpco_clients
  ADD COLUMN IF NOT EXISTS organisation_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_dpco_clients_organisation_id
  ON dpco_clients (organisation_id);

-- ─── 4. dpco_verification_statements: router filing columns ──────────────────
ALTER TABLE dpco_verification_statements
  ADD COLUMN IF NOT EXISTS dpco_id INTEGER,
  ADD COLUMN IF NOT EXISTS filing_type VARCHAR(64) NOT NULL DEFAULT 'compliance_audit_return',
  ADD COLUMN IF NOT EXISTS filing_reference_id INTEGER,
  ADD COLUMN IF NOT EXISTS organisation_id INTEGER,
  ADD COLUMN IF NOT EXISTS statement_date DATE,
  ADD COLUMN IF NOT EXISTS audit_scope TEXT,
  ADD COLUMN IF NOT EXISTS findings_summary TEXT,
  ADD COLUMN IF NOT EXISTS compliance_score NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS non_conformities JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS corrective_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dpco_licence_number VARCHAR(128),
  ADD COLUMN IF NOT EXISTS dpco_signatory_name VARCHAR(256),
  ADD COLUMN IF NOT EXISTS dpco_signatory_role VARCHAR(128),
  ADD COLUMN IF NOT EXISTS signature_hash VARCHAR(128);

-- The router's insert does not populate the legacy NOT NULL columns; relax.
ALTER TABLE dpco_verification_statements
  ALTER COLUMN client_name DROP NOT NULL,
  ALTER COLUMN filing_period DROP NOT NULL,
  ALTER COLUMN statement_type DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dpco_verification_statements_org
  ON dpco_verification_statements (organisation_id);

-- ─── 5. dpco_audit_control_ratings: denormalised control metadata + upsert key
ALTER TABLE dpco_audit_control_ratings
  ADD COLUMN IF NOT EXISTS dpco_org_id INTEGER,
  ADD COLUMN IF NOT EXISTS control_ref VARCHAR(64),
  ADD COLUMN IF NOT EXISTS control_title VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS dpco_audit_control_ratings_eng_control_uniq
  ON dpco_audit_control_ratings (engagement_id, control_id);

-- ─── 6. dpco_training_sessions: delivery/scheduling columns ──────────────────
ALTER TABLE dpco_training_sessions
  ADD COLUMN IF NOT EXISTS dpco_id INTEGER,
  ADD COLUMN IF NOT EXISTS client_organisation_id INTEGER,
  ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(50) NOT NULL DEFAULT 'virtual',
  ADD COLUMN IF NOT EXISTS duration_hours NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS max_participants INTEGER,
  ADD COLUMN IF NOT EXISTS meeting_link VARCHAR(500),
  ADD COLUMN IF NOT EXISTS trainer_name VARCHAR(256),
  ADD COLUMN IF NOT EXISTS ndpc_accredited BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cpe_credits NUMERIC(6, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS enrolled_count INTEGER NOT NULL DEFAULT 0;

-- ─── 7. dpco_training_participants (new) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS dpco_training_participants (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES dpco_training_sessions(id) ON DELETE CASCADE,
  participant_name VARCHAR(255) NOT NULL,
  participant_email TEXT NOT NULL,
  organisation_id INTEGER,
  role_title VARCHAR(128),
  certificate_issued BOOLEAN NOT NULL DEFAULT FALSE,
  certificate_number VARCHAR(128),
  certificate_issued_at TIMESTAMPTZ,
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dpco_training_participants_session
  ON dpco_training_participants (session_id);

CREATE UNIQUE INDEX IF NOT EXISTS dpco_training_participants_session_email_uniq
  ON dpco_training_participants (session_id, participant_email);

-- ─── 8. dpco_policy_drafts: lifecycle columns ────────────────────────────────
ALTER TABLE dpco_policy_drafts
  ADD COLUMN IF NOT EXISTS dpco_id INTEGER,
  ADD COLUMN IF NOT EXISTS client_organisation_id INTEGER,
  ADD COLUMN IF NOT EXISTS effective_date DATE,
  ADD COLUMN IF NOT EXISTS review_date DATE,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS ndpc_filed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ndpc_reference VARCHAR(128);

-- ─── 9. dpco_client_policies: upsert key for assignClientPolicy ──────────────
CREATE UNIQUE INDEX IF NOT EXISTS dpco_client_policies_org_client_template_uniq
  ON dpco_client_policies (dpco_org_id, client_id, template_id);

-- ─── 10. dpco_evidence_items: vault metadata columns ─────────────────────────
ALTER TABLE dpco_evidence_items
  ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS finding_ref VARCHAR(128),
  ADD COLUMN IF NOT EXISTS is_tampered BOOLEAN,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by VARCHAR(255),
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;

-- The router mints UUID text ids for evidence rows; canonical was SERIAL.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dpco_evidence_items' AND column_name = 'id'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE dpco_evidence_items ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE dpco_evidence_items ALTER COLUMN id TYPE TEXT USING id::TEXT;
  END IF;
END $$;

-- Router stores engagement/dpco references as externally supplied strings.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dpco_evidence_items' AND column_name = 'engagement_id'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE dpco_evidence_items ALTER COLUMN engagement_id TYPE TEXT USING engagement_id::TEXT;
  END IF;
END $$;

ALTER TABLE dpco_evidence_items ALTER COLUMN dpco_org_id DROP NOT NULL;

-- ─── 11. dpco_audit_logs (new) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dpco_audit_logs (
  id SERIAL PRIMARY KEY,
  dpco_org_id INTEGER NOT NULL,
  actor_id INTEGER,
  action VARCHAR(255) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dpco_audit_logs_org
  ON dpco_audit_logs (dpco_org_id, created_at DESC);

-- ─── 12. dpco_performance_metrics (new) ──────────────────────────────────────
-- Supports both the per-metric series shape (metric_name/metric_value used by
-- dpco.getPerformanceMetrics) and the aggregate upsert shape used by
-- enhancements.dpcoPerformanceMetricsRouter.
CREATE TABLE IF NOT EXISTS dpco_performance_metrics (
  id SERIAL PRIMARY KEY,
  dpco_org_id INTEGER NOT NULL,
  period_start DATE NOT NULL DEFAULT CURRENT_DATE,
  period_end DATE,
  metric_name VARCHAR(128),
  metric_value NUMERIC(20, 4),
  cases_handled INTEGER NOT NULL DEFAULT 0,
  avg_resolution_days NUMERIC(10, 2) NOT NULL DEFAULT 0,
  client_satisfaction_score NUMERIC(5, 2) NOT NULL DEFAULT 0,
  compliance_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  revenue_ngn NUMERIC(20, 2) NOT NULL DEFAULT 0,
  active_clients INTEGER NOT NULL DEFAULT 0,
  recorded_by VARCHAR(255),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS dpco_performance_metrics_org_period_uniq
  ON dpco_performance_metrics (dpco_org_id, period_start);

CREATE INDEX IF NOT EXISTS idx_dpco_performance_metrics_org_metric
  ON dpco_performance_metrics (dpco_org_id, metric_name, period_end DESC);
