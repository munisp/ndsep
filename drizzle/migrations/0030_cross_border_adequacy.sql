-- Migration: Cross-border transfer adequacy (NDPA 2023 ss.41-43)
-- Adequacy-decision lifecycle, binding corporate rules (BCR) registry,
-- derogation tracking, and enforcement-action linkage for unlawful transfers.

CREATE TABLE IF NOT EXISTS adequacy_decisions (
  id SERIAL PRIMARY KEY,
  country VARCHAR(128) NOT NULL,
  region VARCHAR(128),
  decision_status VARCHAR(32) NOT NULL DEFAULT 'proposed'
    CHECK (decision_status IN ('proposed', 'in_force', 'suspended', 'revoked')),
  criteria JSONB,
  issued_by VARCHAR(256),
  issued_at TIMESTAMPTZ,
  review_due_date DATE,
  suspended_at TIMESTAMPTZ,
  suspension_reason TEXT,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adequacy_decisions_country
  ON adequacy_decisions (country);
CREATE INDEX IF NOT EXISTS idx_adequacy_decisions_status
  ON adequacy_decisions (decision_status);

CREATE TABLE IF NOT EXISTS binding_corporate_rules (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER,
  group_name VARCHAR(256) NOT NULL,
  bcr_document_url TEXT,
  bcr_document_key TEXT,
  scope JSONB,
  status VARCHAR(32) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'withdrawn')),
  submitted_at TIMESTAMPTZ,
  reviewed_by VARCHAR(256),
  reviewed_at TIMESTAMPTZ,
  approval_reference VARCHAR(128),
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bcr_org
  ON binding_corporate_rules (organization_id);
CREATE INDEX IF NOT EXISTS idx_bcr_status
  ON binding_corporate_rules (status);

CREATE TABLE IF NOT EXISTS cross_border_derogations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  transfer_reference VARCHAR(128),
  destination_country VARCHAR(128) NOT NULL,
  adequacy_decision_id INTEGER REFERENCES adequacy_decisions(id),
  derogation_type VARCHAR(64) NOT NULL
    CHECK (derogation_type IN (
      'explicit_consent', 'contract_performance', 'public_interest',
      'legal_claims', 'vital_interests', 'legitimate_interests'
    )),
  data_subject_count INTEGER,
  justification TEXT NOT NULL,
  transfer_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR(256),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_derogations_org
  ON cross_border_derogations (organization_id);
CREATE INDEX IF NOT EXISTS idx_derogations_country
  ON cross_border_derogations (destination_country);

-- Linkage between unlawful cross-border transfers and enforcement actions
CREATE TABLE IF NOT EXISTS cross_border_enforcement_links (
  id SERIAL PRIMARY KEY,
  derogation_id INTEGER REFERENCES cross_border_derogations(id),
  adequacy_decision_id INTEGER REFERENCES adequacy_decisions(id),
  enforcement_action_id INTEGER NOT NULL REFERENCES enforcement_actions(id),
  link_reason TEXT NOT NULL,
  created_by VARCHAR(256),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cb_enforcement_links_action
  ON cross_border_enforcement_links (enforcement_action_id);
