-- Migration: v2 Recommendations (52 items)
-- Feature flags, breach timers, consent audit chain, push notifications,
-- analytics events, report schedules, and more.

-- E1: Feature flags system
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

-- M15: Breach notification 72-hour timers
CREATE TABLE IF NOT EXISTS breach_timers (
  breach_id INTEGER PRIMARY KEY,
  discovered_at TIMESTAMPTZ NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL,
  notified_at TIMESTAMPTZ,
  escalations_sent INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'notified', 'overdue', 'escalated')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_breach_timers_status ON breach_timers(status);
CREATE INDEX IF NOT EXISTS idx_breach_timers_deadline ON breach_timers(deadline_at);

-- M12: Consent audit chain (hash-linked immutable trail)
CREATE TABLE IF NOT EXISTS consent_audit_chain (
  id SERIAL PRIMARY KEY,
  subject_id TEXT NOT NULL,
  consent_type TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('grant', 'modify', 'withdraw', 'expire', 'renew')),
  previous_state TEXT,
  new_state TEXT NOT NULL,
  legal_basis TEXT DEFAULT 'consent',
  ip_address TEXT NOT NULL,
  user_agent TEXT DEFAULT '',
  hash TEXT NOT NULL,
  previous_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consent_audit_subject ON consent_audit_chain(subject_id);
CREATE INDEX IF NOT EXISTS idx_consent_audit_type ON consent_audit_chain(consent_type);
CREATE INDEX IF NOT EXISTS idx_consent_audit_created ON consent_audit_chain(created_at);

-- E12: Push notification subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS push_notification_log (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'sent',
  error TEXT
);

-- E2: Product analytics (privacy-respecting)
CREATE TABLE IF NOT EXISTS analytics_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  page TEXT NOT NULL,
  feature TEXT,
  user_hash TEXT,
  org_id INTEGER,
  role TEXT,
  metadata JSONB DEFAULT '{}',
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_page ON analytics_events(page);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);
-- Partition-ready: consider RANGE partitioning on created_at for large datasets

-- E4: Automated report scheduling
CREATE TABLE IF NOT EXISTS report_schedules (
  report_type TEXT PRIMARY KEY,
  frequency TEXT NOT NULL DEFAULT 'weekly',
  last_run TIMESTAMPTZ,
  next_run TIMESTAMPTZ,
  recipients TEXT[] DEFAULT '{}',
  format TEXT DEFAULT 'pdf',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generated_reports (
  id SERIAL PRIMARY KEY,
  report_type TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  file_path TEXT,
  file_hash TEXT,
  metrics JSONB,
  delivered_to TEXT[] DEFAULT '{}',
  delivery_status TEXT DEFAULT 'pending'
);

-- M9: Form auto-save (server-side backup of draft data)
CREATE TABLE IF NOT EXISTS form_drafts (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  form_type TEXT NOT NULL,
  form_data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, form_type)
);
CREATE INDEX IF NOT EXISTS idx_form_drafts_user ON form_drafts(user_id);

-- H12: API key bcrypt hashes (upgrade from SHA-256)
-- Add bcrypt_hash column alongside existing key_hash for migration
DO $$ BEGIN
  ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS bcrypt_hash TEXT;
  ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS hash_version INTEGER DEFAULT 1;
EXCEPTION WHEN undefined_table THEN
  -- api_keys table doesn't exist yet, will be created by apiKeyRotation.ts
  NULL;
END $$;

-- E8: Bulk operations with progress tracking and undo
CREATE TABLE IF NOT EXISTS bulk_operations (
  id TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL,
  total_items INTEGER NOT NULL,
  processed_items INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  undo_available BOOLEAN DEFAULT true,
  undo_expires_at TIMESTAMPTZ,
  undo_data JSONB,
  created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bulk_ops_status ON bulk_operations(status);

-- M11: Data retention purge audit log
CREATE TABLE IF NOT EXISTS retention_purge_log (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  table_name TEXT NOT NULL,
  records_purged INTEGER NOT NULL,
  records_anonymized INTEGER DEFAULT 0,
  purged_at TIMESTAMPTZ DEFAULT NOW(),
  policy_days INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_retention_log_category ON retention_purge_log(category);
CREATE INDEX IF NOT EXISTS idx_retention_log_purged_at ON retention_purge_log(purged_at);

-- M3: Cursor-based pagination support indexes
CREATE INDEX IF NOT EXISTS idx_organizations_id_cursor ON organizations(id);
CREATE INDEX IF NOT EXISTS idx_enforcement_cases_id_cursor ON enforcement_cases(id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_id_cursor ON audit_logs(id);
CREATE INDEX IF NOT EXISTS idx_citizen_requests_id_cursor ON citizen_requests(id);
