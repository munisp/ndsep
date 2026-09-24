-- Migration: AI-Regulation Instruments (Gap 16)
-- Risk-tier assessments, high-risk permits, unacceptable-tier prohibition
-- orders, conformity assessments, AI incident reporting and the
-- AI-finding -> enforcement-action linkage table.
-- Idempotent: safe to re-run.

-- ─── Risk tier enum ─────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE ai_risk_tier AS ENUM ('minimal', 'limited', 'high', 'unacceptable');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Risk-tier assessments ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_risk_tier_assessments (
  id                SERIAL PRIMARY KEY,
  system_ref        VARCHAR(64) UNIQUE NOT NULL,         -- AIRT-YYYY-#####
  organization_id   INTEGER REFERENCES organizations(id),
  system_name       VARCHAR(256) NOT NULL,
  system_purpose    TEXT,
  tier              ai_risk_tier NOT NULL,
  rationale         TEXT NOT NULL,                       -- assessment rationale
  assessor_id       INTEGER,                             -- assessing officer (user id)
  assessor_name     VARCHAR(256),
  assessed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  review_due_at     TIMESTAMPTZ,                         -- periodic re-assessment
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS airt_ref_seq START 1;

CREATE INDEX IF NOT EXISTS idx_airt_tier
  ON ai_risk_tier_assessments (tier);
CREATE INDEX IF NOT EXISTS idx_airt_org
  ON ai_risk_tier_assessments (organization_id);

-- ─── AI permits (high-risk systems) & prohibition orders (unacceptable) ─────
CREATE TABLE IF NOT EXISTS ai_permits (
  id                SERIAL PRIMARY KEY,
  assessment_id     INTEGER NOT NULL REFERENCES ai_risk_tier_assessments(id),
  permit_ref        VARCHAR(64) UNIQUE NOT NULL,         -- AIP-YYYY-#####
  organization_id   INTEGER REFERENCES organizations(id),
  instrument_type   VARCHAR(32) NOT NULL DEFAULT 'permit', -- permit|prohibition_order
  status            VARCHAR(32) NOT NULL DEFAULT 'applied',
    -- permit: applied -> under_review -> granted -> suspended|revoked
    -- prohibition_order: issued -> in_force -> lifted
  conditions        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- permit conditions
  applied_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by       INTEGER,
  reviewed_at       TIMESTAMPTZ,
  decision_notes    TEXT,
  granted_at        TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  suspended_at      TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS ai_permit_ref_seq START 1;

CREATE INDEX IF NOT EXISTS idx_ai_permits_status
  ON ai_permits (status)
  WHERE status IN ('applied', 'under_review', 'granted', 'in_force');
CREATE INDEX IF NOT EXISTS idx_ai_permits_assessment
  ON ai_permits (assessment_id);

-- ─── Conformity assessments & certificates ──────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_conformity_assessments (
  id                SERIAL PRIMARY KEY,
  assessment_id     INTEGER NOT NULL REFERENCES ai_risk_tier_assessments(id),
  permit_id         INTEGER REFERENCES ai_permits(id),
  ref               VARCHAR(64) UNIQUE NOT NULL,         -- AICA-YYYY-#####
  checklist_results JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {item: pass|fail|n/a, ...}
  overall_result    VARCHAR(32),                          -- pass|conditional|fail
  assessor_id       INTEGER,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  certificate_ref   VARCHAR(64),                          -- issued certificate number
  certificate_issued_at TIMESTAMPTZ,
  certificate_expires_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS aica_ref_seq START 1;

CREATE INDEX IF NOT EXISTS idx_aica_assessment
  ON ai_conformity_assessments (assessment_id);

-- ─── AI incident reporting channel (public + org submit) ────────────────────
CREATE TABLE IF NOT EXISTS ai_incidents (
  id                SERIAL PRIMARY KEY,
  incident_ref      VARCHAR(64) UNIQUE NOT NULL,         -- AIINC-YYYY-#####
  organization_id   INTEGER REFERENCES organizations(id),
  reporter_type     VARCHAR(16) NOT NULL DEFAULT 'public', -- public|org
  reporter_name     VARCHAR(256),
  reporter_email    VARCHAR(256),
  system_name       VARCHAR(256) NOT NULL,
  description       TEXT NOT NULL,
  severity          VARCHAR(16) NOT NULL DEFAULT 'medium', -- low|medium|high|critical
  harm_categories   JSONB NOT NULL DEFAULT '[]'::jsonb,  -- e.g. ["discrimination","privacy_harm","physical_harm"]
  occurred_at       TIMESTAMPTZ,
  status            VARCHAR(32) NOT NULL DEFAULT 'received', -- received|triaged|investigating|resolved|closed
  triaged_by        INTEGER,
  triage_notes      TEXT,
  reported_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS ai_incident_ref_seq START 1;

CREATE INDEX IF NOT EXISTS idx_ai_incidents_status
  ON ai_incidents (status)
  WHERE status IN ('received', 'triaged', 'investigating');
CREATE INDEX IF NOT EXISTS idx_ai_incidents_severity
  ON ai_incidents (severity);

-- ─── AI finding -> enforcement action linkage ───────────────────────────────
-- Links AI-regulation records to existing enforcement cases / penalties
-- WITHOUT modifying the existing enforcement tables.
CREATE TABLE IF NOT EXISTS ai_enforcement_links (
  id                SERIAL PRIMARY KEY,
  source_type       VARCHAR(32) NOT NULL,                -- risk_assessment|permit|conformity|incident
  source_id         INTEGER NOT NULL,
  enforcement_case_id INTEGER REFERENCES enforcement_cases(id),
  financial_penalty_id INTEGER REFERENCES financial_penalties(id),
  link_notes        TEXT NOT NULL,
  escalated_by      INTEGER,
  escalated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_enforcement_links_source
  ON ai_enforcement_links (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_ai_enforcement_links_case
  ON ai_enforcement_links (enforcement_case_id);
