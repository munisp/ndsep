-- Migration: Cross-border transfer declarations + anomaly detection (NDPA 2023 ss.41-43)
-- Periodic (annual + on-change) machine-readable transfer declarations by controllers,
-- destination risk register (admin-editable reference data), automatic non-compliance
-- findings, and immutable amendment history. Idempotent: safe to re-run.
-- Complements 0030_cross_border_adequacy.sql (adequacy decisions / BCR / derogations).

-- ─── Transfer declarations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfer_declarations (
  id                   SERIAL PRIMARY KEY,
  organization_id      INTEGER NOT NULL REFERENCES organizations(id),
  declaration_type     VARCHAR(16) NOT NULL DEFAULT 'annual'
    CHECK (declaration_type IN ('annual', 'on_change')),
  period_start         DATE NOT NULL,
  period_end           DATE NOT NULL,
  destination_country  VARCHAR(128) NOT NULL,
  legal_basis          VARCHAR(32) NOT NULL
    CHECK (legal_basis IN (
      'adequacy_decision', 'bcr', 'scc', 'derogation',
      'explicit_consent', 'contract_performance', 'vital_interest', 'none_claimed'
    )),
  data_categories      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- e.g. ["contact","financial","health"]
  subject_count_band   VARCHAR(16) NOT NULL
    CHECK (subject_count_band IN ('band_0_100','band_101_1000','band_1001_10000','band_10001_100000','band_100000_plus')),
  volume_band          VARCHAR(16) NOT NULL
    CHECK (volume_band IN ('vol_small','vol_medium','vol_large','vol_very_large')),
  volume_estimate_gb   NUMERIC(14,2),                        -- optional numeric volume for trend analysis
  processors           JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{name, country, role: processor|sub_processor}]
  declares_no_transfers BOOLEAN NOT NULL DEFAULT FALSE,      -- controller attests zero cross-border transfers
  adequacy_decision_id INTEGER REFERENCES adequacy_decisions(id),  -- resolved at validation time
  compliance_status    VARCHAR(24) NOT NULL DEFAULT 'pending_review'
    CHECK (compliance_status IN ('compliant', 'non_compliant', 'pending_review')),
  status               VARCHAR(24) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'under_review', 'accepted', 'superseded', 'withdrawn')),
  submitted_by         VARCHAR(256),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_declarations_org
  ON transfer_declarations (organization_id);
CREATE INDEX IF NOT EXISTS idx_transfer_declarations_country
  ON transfer_declarations (destination_country);
CREATE INDEX IF NOT EXISTS idx_transfer_declarations_basis
  ON transfer_declarations (legal_basis);
CREATE INDEX IF NOT EXISTS idx_transfer_declarations_adequacy
  ON transfer_declarations (adequacy_decision_id)
  WHERE adequacy_decision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transfer_declarations_active
  ON transfer_declarations (status)
  WHERE status IN ('submitted', 'under_review', 'accepted');

-- ─── Immutable amendment history ────────────────────────────────────────────
-- One row per amendment; prior-state snapshot is captured BEFORE the change.
-- Rows are append-only: UPDATE/DELETE are blocked by trigger.
CREATE TABLE IF NOT EXISTS declaration_amendments (
  id              SERIAL PRIMARY KEY,
  declaration_id  INTEGER NOT NULL REFERENCES transfer_declarations(id),
  prior_state     JSONB NOT NULL,                 -- full snapshot of the declaration row before amendment
  changed_fields  JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason          TEXT NOT NULL,
  amended_by      VARCHAR(256),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_declaration_amendments_decl
  ON declaration_amendments (declaration_id);

CREATE OR REPLACE FUNCTION declaration_amendments_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'declaration_amendments is append-only: % not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_declaration_amendments_no_update ON declaration_amendments;
CREATE TRIGGER trg_declaration_amendments_no_update
  BEFORE UPDATE OR DELETE ON declaration_amendments
  FOR EACH ROW EXECUTE FUNCTION declaration_amendments_immutable();

-- ─── Destination risk register (admin-editable reference data) ──────────────
CREATE TABLE IF NOT EXISTS destination_risk_register (
  id               SERIAL PRIMARY KEY,
  country          VARCHAR(128) NOT NULL UNIQUE,
  iso_code         VARCHAR(3),
  adequacy_status  VARCHAR(16) NOT NULL DEFAULT 'under_review'
    CHECK (adequacy_status IN ('adequate', 'partial', 'none', 'under_review')),
  risk_score       NUMERIC(5,2) NOT NULL DEFAULT 50.00
    CHECK (risk_score >= 0 AND risk_score <= 100),
  notes            TEXT,
  is_admin_reference BOOLEAN NOT NULL DEFAULT TRUE,   -- marks starter/reference data, admin-editable
  updated_by       VARCHAR(256),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Starter reference set — ADMINISTRATIVE REFERENCE DATA, editable by NDPC admins.
-- Risk scores are indicative starting points (0 = lowest risk, 100 = highest),
-- not regulatory determinations. Idempotent seed via ON CONFLICT DO NOTHING.
INSERT INTO destination_risk_register (country, iso_code, adequacy_status, risk_score, notes, updated_by)
VALUES
  ('Nigeria',      'NG',  'adequate',     10.00, 'Domestic jurisdiction — NDPA 2023 applies directly.', 'system:seed'),
  ('European Union / EEA', 'EU', 'adequate', 15.00, 'GDPR regime; review against NDPC adequacy criteria (NDPA s.41).', 'system:seed'),
  ('United Kingdom', 'GB', 'adequate',    20.00, 'UK GDPR; adequacy standing to be confirmed by NDPC decision.', 'system:seed'),
  ('United States', 'US', 'partial',      55.00, 'Sectoral/state-level coverage only; no comprehensive federal law.', 'system:seed'),
  ('Kenya',        'KE',  'partial',      40.00, 'Kenya DPA 2019 in force; enforcement maturity under review.', 'system:seed'),
  ('Ghana',        'GH',  'partial',      40.00, 'Ghana DPA 2012; supervisory capacity under review.', 'system:seed'),
  ('South Africa', 'ZA',  'partial',      35.00, 'POPIA in force; Information Regulator operational.', 'system:seed'),
  ('United Arab Emirates', 'AE', 'under_review', 60.00, 'UAE PDPL recent; adequacy assessment not yet completed.', 'system:seed')
ON CONFLICT (country) DO NOTHING;

-- ─── Transfer findings (automatic non-compliance + anomaly findings) ────────
CREATE TABLE IF NOT EXISTS transfer_findings (
  id                    SERIAL PRIMARY KEY,
  declaration_id        INTEGER REFERENCES transfer_declarations(id),
  organization_id       INTEGER NOT NULL REFERENCES organizations(id),
  finding_type          VARCHAR(48) NOT NULL
    CHECK (finding_type IN (
      'none_claimed', 'no_valid_safeguard', 'adequacy_suspended_cascade',
      'volume_anomaly', 'contradiction_tracker_evidence', 'manual'
    )),
  severity              VARCHAR(16) NOT NULL DEFAULT 'high'
    CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  description           TEXT NOT NULL,
  evidence              JSONB NOT NULL DEFAULT '{}'::jsonb,
  enforcement_referral  BOOLEAN NOT NULL DEFAULT FALSE,   -- TRUE => enforcement referral event emitted
  status                VARCHAR(24) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'referred', 'under_investigation', 'resolved', 'dismissed')),
  resolved_by           VARCHAR(256),
  resolved_at           TIMESTAMPTZ,
  resolution_notes      TEXT,
  created_by            VARCHAR(256) NOT NULL DEFAULT 'system',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_findings_decl
  ON transfer_findings (declaration_id);
CREATE INDEX IF NOT EXISTS idx_transfer_findings_org
  ON transfer_findings (organization_id);
CREATE INDEX IF NOT EXISTS idx_transfer_findings_open
  ON transfer_findings (status)
  WHERE status IN ('open', 'referred', 'under_investigation');
