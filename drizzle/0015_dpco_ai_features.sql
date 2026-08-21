-- AI Gap Analysis results
CREATE TABLE IF NOT EXISTS dpco_ai_gap_analyses (
  id SERIAL PRIMARY KEY,
  engagement_id INTEGER NOT NULL UNIQUE,
  overall_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  executive_summary TEXT,
  ratings_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- CAR Narrative drafts
CREATE TABLE IF NOT EXISTS dpco_car_narratives (
  id SERIAL PRIMARY KEY,
  engagement_id INTEGER NOT NULL UNIQUE,
  executive_summary TEXT,
  scope_and_methodology TEXT,
  key_findings TEXT,
  recommendations TEXT,
  auditor_declaration TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Risk Predictions per organisation
CREATE TABLE IF NOT EXISTS dpco_risk_predictions (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL,
  risk_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  risk_level VARCHAR(20) NOT NULL DEFAULT 'medium',
  primary_risk_factors TEXT NOT NULL DEFAULT '[]',
  audit_priority VARCHAR(20) NOT NULL DEFAULT 'routine',
  recommended_audit_frequency TEXT,
  mitigation_actions TEXT NOT NULL DEFAULT '[]',
  dcpmi_exposure_estimate TEXT,
  predicted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dpco_risk_predictions_org ON dpco_risk_predictions(organisation_id);
