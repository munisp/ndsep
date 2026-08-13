-- Phase-13 runtime contract reconciliation.
-- These tables and columns are used by live tRPC procedures and must exist on
-- a clean deployment. They are intentionally explicit rather than relying on
-- ad-hoc database setup or seed scripts.

CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id SERIAL PRIMARY KEY,
  metric_name TEXT NOT NULL,
  dimension TEXT,
  dimension_value TEXT,
  metric_value NUMERIC(20,4) NOT NULL DEFAULT 0,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(metric_name, dimension, dimension_value, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_metric_date ON analytics_snapshots(metric_name, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS article40_codes (
  id SERIAL PRIMARY KEY,
  code_name TEXT NOT NULL,
  sector TEXT NOT NULL,
  description TEXT,
  submitted_by TEXT,
  document_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'under_review', 'approved', 'rejected')),
  approved_by TEXT,
  approval_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_article40_codes_sector_status ON article40_codes(sector, status, created_at DESC);

CREATE TABLE IF NOT EXISTS compliance_calendar_events (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  event_type TEXT NOT NULL,
  due_date DATE NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  description TEXT,
  assigned_to TEXT,
  reminder_days INTEGER NOT NULL DEFAULT 14 CHECK (reminder_days >= 0),
  org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled', 'overdue')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_compliance_calendar_events_due_status ON compliance_calendar_events(due_date, status);
CREATE INDEX IF NOT EXISTS idx_compliance_calendar_events_org ON compliance_calendar_events(org_id, due_date);

CREATE TABLE IF NOT EXISTS consent_records_v2 (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  data_subject_id TEXT NOT NULL,
  data_subject_email TEXT,
  purpose TEXT NOT NULL,
  legal_basis TEXT NOT NULL DEFAULT 'consent',
  data_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  third_party_sharing BOOLEAN NOT NULL DEFAULT FALSE,
  third_parties JSONB NOT NULL DEFAULT '[]'::jsonb,
  consent_given BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn', 'expired', 'pending')),
  withdrawal_date TIMESTAMPTZ,
  expiry_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consent_records_v2_org_status ON consent_records_v2(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_records_v2_subject ON consent_records_v2(data_subject_id);

CREATE TABLE IF NOT EXISTS notification_inbox (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  action_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notification_inbox_user_unread ON notification_inbox(user_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS public_compliance_registry (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  org_name TEXT NOT NULL,
  registration_number TEXT,
  sector TEXT,
  compliance_status TEXT NOT NULL DEFAULT 'pending' CHECK (compliance_status IN ('compliant', 'partially_compliant', 'non_compliant', 'pending')),
  compliance_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (compliance_score BETWEEN 0 AND 100),
  last_assessment_date DATE,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_public_compliance_registry_published_score ON public_compliance_registry(is_published, compliance_score DESC);

CREATE TABLE IF NOT EXISTS api_rate_limit_stats (
  id BIGSERIAL PRIMARY KEY,
  endpoint TEXT NOT NULL,
  client_ip INET,
  window_start TIMESTAMPTZ NOT NULL,
  requests_count INTEGER NOT NULL DEFAULT 0 CHECK (requests_count >= 0),
  blocked_count INTEGER NOT NULL DEFAULT 0 CHECK (blocked_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(endpoint, client_ip, window_start)
);
CREATE INDEX IF NOT EXISTS idx_api_rate_limit_stats_window ON api_rate_limit_stats(window_start DESC, endpoint);

CREATE TABLE IF NOT EXISTS whistleblower_cases (
  id SERIAL PRIMARY KEY,
  case_reference TEXT NOT NULL UNIQUE,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  category TEXT,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'under_investigation', 'resolved', 'closed', 'escalated')),
  assigned_to TEXT,
  investigation_notes TEXT,
  resolution TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_whistleblower_cases_status_opened ON whistleblower_cases(status, opened_at DESC);

-- Bring the existing phase-29 table in line with the calculator procedure.
ALTER TABLE penalty_calculations ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE penalty_calculations ADD COLUMN IF NOT EXISTS org_name TEXT;
ALTER TABLE penalty_calculations ADD COLUMN IF NOT EXISTS violation_date DATE;
ALTER TABLE penalty_calculations ADD COLUMN IF NOT EXISTS annual_turnover NUMERIC(20,2);
ALTER TABLE penalty_calculations ADD COLUMN IF NOT EXISTS aggravating_multiplier NUMERIC(8,4) NOT NULL DEFAULT 1;
ALTER TABLE penalty_calculations ADD COLUMN IF NOT EXISTS mitigating_reduction NUMERIC(8,4) NOT NULL DEFAULT 0;
ALTER TABLE penalty_calculations ADD COLUMN IF NOT EXISTS penalty_cap NUMERIC(20,2);
ALTER TABLE penalty_calculations ADD COLUMN IF NOT EXISTS calculation_basis TEXT;
CREATE INDEX IF NOT EXISTS idx_penalty_calculations_org_name ON penalty_calculations(org_id, status, created_at DESC);
