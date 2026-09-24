-- Migration 0088: Risk-based supervision scheduler.
--
-- Tables backing server/routers/supervisionRisk.ts:
--
--   risk_weights            configurable per-factor weights for the composite
--                           supervision risk score (seeded with defaults).
--   risk_score_inputs       raw normalized input snapshot per controller per
--                           sweep (complaint volume/surge, scan findings,
--                           sanctions, filing delinquency, data-volume class),
--                           plus which source tables were actually present.
--   risk_scores             composite weighted score 0..1 with an explanation
--                           payload (top contributing factors), mirroring the
--                           ml/insider fusion explanation shape.
--   supervision_plans       annual supervision plan with a hard capacity
--                           constraint (available inspector-days).
--   supervision_plan_items  risk-ranked plan line items linking entity +
--                           scope + assigned team + due window; can be
--                           referred to field inspection (inspection_cases).
--
-- Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS risk_weights (
  key         TEXT PRIMARY KEY,
  weight      DOUBLE PRECISION NOT NULL CHECK (weight >= 0),
  description TEXT,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default factor weights (sum = 1.0). INSERT is idempotent: existing tuned
-- weights are preserved on re-run.
INSERT INTO risk_weights (key, weight, description) VALUES
  ('complaint_volume',    0.20, 'Complaints received in trailing 12 months, normalised'),
  ('complaint_surge',     0.10, 'Complaint surge alert flag (surge_alerts)'),
  ('scan_findings',       0.25, 'Severity-weighted open scan findings (scan_findings)'),
  ('prior_sanctions',     0.20, 'Published sanctions register entries (enforcement_notices)'),
  ('filing_delinquency',  0.10, 'Overdue CAR/registration filings'),
  ('data_volume_class',   0.15, 'Declared data-volume class of the controller')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS risk_score_inputs (
  id            BIGSERIAL PRIMARY KEY,
  org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inputs        JSONB NOT NULL,      -- {complaint_volume, complaint_surge, scan_findings,
                                     --  prior_sanctions, filing_delinquency, data_volume_class}
                                     -- raw values BEFORE normalisation
  normalized    JSONB NOT NULL,      -- same keys, normalised to 0..1
  source_tables JSONB NOT NULL,      -- {scan_findings: true, surge_alerts: false, ...}
  collected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_score_inputs_org
  ON risk_score_inputs (org_id, collected_at DESC);

CREATE TABLE IF NOT EXISTS risk_scores (
  id           BIGSERIAL PRIMARY KEY,
  org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inputs_id    BIGINT REFERENCES risk_score_inputs(id) ON DELETE SET NULL,
  score        DOUBLE PRECISION NOT NULL CHECK (score >= 0 AND score <= 1),
  band         TEXT NOT NULL CHECK (band IN ('low', 'medium', 'high', 'critical')),
  weights      JSONB NOT NULL,       -- weight snapshot used for this score
  explanation  JSONB NOT NULL,       -- [{signal, contribution, detail}] ranked, top 5
  computed_by  TEXT,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_scores_org
  ON risk_scores (org_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_scores_score
  ON risk_scores (score DESC);
CREATE INDEX IF NOT EXISTS idx_risk_scores_band
  ON risk_scores (band, computed_at DESC);

CREATE TABLE IF NOT EXISTS supervision_plans (
  id                       BIGSERIAL PRIMARY KEY,
  year                     INTEGER NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  name                     TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'approved', 'active', 'closed')),
  capacity_inspector_days  INTEGER NOT NULL CHECK (capacity_inspector_days >= 0),
  allocated_inspector_days INTEGER NOT NULL DEFAULT 0 CHECK (allocated_inspector_days >= 0),
  generated_by             TEXT,
  generated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by              TEXT,
  approved_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (year, name)
);

CREATE TABLE IF NOT EXISTS supervision_plan_items (
  id                      BIGSERIAL PRIMARY KEY,
  plan_id                 BIGINT NOT NULL REFERENCES supervision_plans(id) ON DELETE CASCADE,
  org_id                  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  risk_score_id           BIGINT REFERENCES risk_scores(id) ON DELETE SET NULL,
  rank                    INTEGER NOT NULL,
  scope                   TEXT NOT NULL,           -- inspection scope statement
  assigned_team           TEXT,                    -- supervision team / lead inspector ref
  estimated_inspector_days INTEGER NOT NULL CHECK (estimated_inspector_days > 0),
  due_start               DATE NOT NULL,
  due_end                 DATE NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'scheduled'
                          CHECK (status IN
                            ('scheduled', 'referred', 'in_progress', 'completed', 'deferred')),
  referral_ref            TEXT,                    -- inspection_cases.case_uuid after referral
  referred_at             TIMESTAMPTZ,
  referred_by             TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT supervision_plan_items_window CHECK (due_end >= due_start),
  CONSTRAINT supervision_plan_items_unique_org UNIQUE (plan_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_supervision_plan_items_plan
  ON supervision_plan_items (plan_id, rank);
CREATE INDEX IF NOT EXISTS idx_supervision_plan_items_status
  ON supervision_plan_items (status) WHERE status IN ('scheduled', 'referred');
CREATE INDEX IF NOT EXISTS idx_supervision_plan_items_due
  ON supervision_plan_items (due_start, due_end);

-- Reference allocation for plan names / referral audit, backed by a SEQUENCE
-- (matches the 0075/0077 pattern for race-free reference numbers).
CREATE SEQUENCE IF NOT EXISTS ndsep_supervision_plan_seq;
