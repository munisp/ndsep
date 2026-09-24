-- Migration: Consent Propagation (Gap 17)
-- Purpose-by-purpose withdrawal propagation: consent purpose registry,
-- withdrawal events, downstream processors, token-acknowledged propagation
-- records and overdue-ack escalation.
-- Idempotent: safe to re-run.

-- ─── Consent purposes registry (per org) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS consent_purposes (
  id                SERIAL PRIMARY KEY,
  organization_id   INTEGER NOT NULL REFERENCES organizations(id),
  purpose_key       VARCHAR(64) NOT NULL,                -- e.g. 'marketing_email'
  name              VARCHAR(256) NOT NULL,
  description       TEXT,
  lawful_basis      VARCHAR(32) NOT NULL DEFAULT 'consent',
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, purpose_key)
);

CREATE INDEX IF NOT EXISTS idx_consent_purposes_org
  ON consent_purposes (organization_id);

-- ─── Downstream processors per purpose ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS downstream_processors (
  id                SERIAL PRIMARY KEY,
  purpose_id        INTEGER NOT NULL REFERENCES consent_purposes(id),
  processor_name    VARCHAR(256) NOT NULL,
  contact_email     VARCHAR(256) NOT NULL,
  ack_endpoint_url  TEXT,                                 -- processor's own ack webhook (optional)
  sla_hours         INTEGER NOT NULL DEFAULT 72,          -- ack deadline after notification
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_downstream_processors_purpose
  ON downstream_processors (purpose_id);

-- ─── Withdrawal events (data subject withdraws one purpose) ─────────────────
CREATE TABLE IF NOT EXISTS withdrawal_events (
  id                SERIAL PRIMARY KEY,
  purpose_id        INTEGER NOT NULL REFERENCES consent_purposes(id),
  organization_id   INTEGER NOT NULL REFERENCES organizations(id),
  subject_ref       VARCHAR(256) NOT NULL,               -- data subject identifier (email/pseudonymous id)
  consent_record_id INTEGER,                              -- optional link to consent_records.id
  withdrawn_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason            TEXT,
  initiated_by      VARCHAR(16) NOT NULL DEFAULT 'subject', -- subject|org|regulator
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_events_purpose
  ON withdrawal_events (purpose_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_events_subject
  ON withdrawal_events (subject_ref);

-- ─── Propagation records (per processor per withdrawal) ─────────────────────
CREATE TABLE IF NOT EXISTS propagation_records (
  id                  SERIAL PRIMARY KEY,
  withdrawal_event_id INTEGER NOT NULL REFERENCES withdrawal_events(id),
  processor_id        INTEGER NOT NULL REFERENCES downstream_processors(id),
  ack_token           VARCHAR(128) UNIQUE NOT NULL,       -- token for the public ack endpoint
  notified_at         TIMESTAMPTZ,
  notification_channel VARCHAR(32),                        -- email|webhook|manual
  acked_at            TIMESTAMPTZ,
  proof_ref           TEXT,                                -- processor-supplied deletion proof reference
  status              VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending|notified|acknowledged|overdue|failed
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (withdrawal_event_id, processor_id)
);

CREATE INDEX IF NOT EXISTS idx_propagation_records_event
  ON propagation_records (withdrawal_event_id);
CREATE INDEX IF NOT EXISTS idx_propagation_records_overdue
  ON propagation_records (status, notified_at)
  WHERE status IN ('pending', 'notified');
