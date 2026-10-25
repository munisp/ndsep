-- Migration: AI-system runtime oversight (FEAT-E, round 9)
-- Extends the aiRegulation instruments (0053_ai_regulation_instruments.sql)
-- with a runtime register of deployed AI systems, mandatory incident
-- reporting with severity classes and a 72h response clock for serious
-- incidents (mirroring the breach workflow), periodic algorithmic audit
-- submissions with due-date tracking, material-change re-audit triggers that
-- open sandbox review tasks, and incident -> enforcement referral.
-- Idempotent: safe to re-run.

-- ─── Runtime AI system register ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_system_registry (
  id              SERIAL PRIMARY KEY,
  system_ref      VARCHAR(64) NOT NULL UNIQUE,             -- AIRS-YYYY-#####
  organization_id INTEGER REFERENCES organizations(id),
  system_name     VARCHAR(256) NOT NULL,
  purpose         TEXT,
  risk_tier       VARCHAR(16) NOT NULL DEFAULT 'limited'
    CHECK (risk_tier IN ('minimal', 'limited', 'high', 'unacceptable')),
  model_version   VARCHAR(128),
  model_hash      VARCHAR(64),                             -- sha256 of deployed model artefact
  status          VARCHAR(16) NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'approved', 'suspended', 'retired')),
  approved_at     TIMESTAMPTZ,
  created_by      VARCHAR(256),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS airs_ref_seq START 1;

CREATE INDEX IF NOT EXISTS idx_ai_system_registry_org
  ON ai_system_registry (organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_system_registry_transparency
  ON ai_system_registry (risk_tier, status)
  WHERE status = 'approved' AND risk_tier = 'high';

-- ─── Runtime AI incidents (72h clock for serious incidents) ────────────────
CREATE TABLE IF NOT EXISTS ai_runtime_incidents (
  id                SERIAL PRIMARY KEY,
  incident_ref      VARCHAR(64) NOT NULL UNIQUE,           -- AIRT-RT-YYYY-#####
  system_id         INTEGER REFERENCES ai_system_registry(id),
  organization_id   INTEGER REFERENCES organizations(id),
  reporter_type     VARCHAR(16) NOT NULL DEFAULT 'org'
    CHECK (reporter_type IN ('org', 'public', 'regulator')),
  reporter_name     VARCHAR(256),                          -- PII when reporter_type='public'
  reporter_email    VARCHAR(256),                          -- PII when reporter_type='public'
  severity_class    VARCHAR(24) NOT NULL
    CHECK (severity_class IN ('class_1_serious', 'class_2_significant', 'class_3_minor')),
  description       TEXT NOT NULL,
  occurred_at       TIMESTAMPTZ,
  reported_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 72h substantive-response clock for class_1_serious incidents (mirrors
  -- the NDPA breach-notification workflow); NULL for lower classes.
  response_due_at   TIMESTAMPTZ,
  responded_at      TIMESTAMPTZ,
  status            VARCHAR(24) NOT NULL DEFAULT 'reported'
    CHECK (status IN ('reported', 'acknowledged', 'investigating',
                      'contained', 'closed', 'referred_enforcement')),
  enforcement_case_id INTEGER REFERENCES enforcement_cases(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS airt_rt_ref_seq START 1;

CREATE INDEX IF NOT EXISTS idx_ai_runtime_incidents_status
  ON ai_runtime_incidents (status, severity_class);
CREATE INDEX IF NOT EXISTS idx_ai_runtime_incidents_sla
  ON ai_runtime_incidents (response_due_at)
  WHERE status IN ('reported', 'acknowledged', 'investigating')
    AND response_due_at IS NOT NULL;

-- ─── Periodic algorithmic audit submissions ─────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_algorithmic_audits (
  id               SERIAL PRIMARY KEY,
  system_id        INTEGER NOT NULL REFERENCES ai_system_registry(id),
  audit_period     VARCHAR(16) NOT NULL,                   -- e.g. '2026-H1'
  due_date         DATE NOT NULL,
  submitted_at     TIMESTAMPTZ,
  status           VARCHAR(16) NOT NULL DEFAULT 'due'
    CHECK (status IN ('due', 'submitted', 'accepted', 'rejected')),
  auditor_name     VARCHAR(256),
  findings_summary TEXT,
  report_ref       TEXT,                                   -- storage ref of the audit report
  review_notes     TEXT,
  reviewed_by      VARCHAR(256),
  reviewed_at      TIMESTAMPTZ,
  created_by       VARCHAR(256),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (system_id, audit_period)
);

CREATE INDEX IF NOT EXISTS idx_ai_algorithmic_audits_due
  ON ai_algorithmic_audits (due_date)
  WHERE status = 'due';

-- ─── Material-change re-audit triggers (model version/hash change) ──────────
CREATE TABLE IF NOT EXISTS ai_reaudit_triggers (
  id             SERIAL PRIMARY KEY,
  system_id      INTEGER NOT NULL REFERENCES ai_system_registry(id),
  trigger_type   VARCHAR(32) NOT NULL
    CHECK (trigger_type IN ('model_version_change', 'model_hash_change', 'manual')),
  old_version    VARCHAR(128),
  new_version    VARCHAR(128),
  old_hash       VARCHAR(64),
  new_hash       VARCHAR(64),
  status         VARCHAR(16) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'sandbox_review', 'cleared')),
  sandbox_task_ref VARCHAR(128),                           -- sandbox review task reference
  reason         TEXT,
  created_by     VARCHAR(256),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_by    VARCHAR(256),
  resolved_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_reaudit_triggers_open
  ON ai_reaudit_triggers (system_id, status)
  WHERE status IN ('open', 'sandbox_review');
