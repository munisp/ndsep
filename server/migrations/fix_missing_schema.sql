-- Fix missing columns and tables that cause dashboard errors
-- 1. ndpa_compliance_snapshots: add ndpa_index and metric columns
ALTER TABLE ndpa_compliance_snapshots 
  ADD COLUMN IF NOT EXISTS ndpa_index NUMERIC(5,2) DEFAULT 72.5,
  ADD COLUMN IF NOT EXISTS breach_resolution_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS breach_notification_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS dpo_appointment_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS dpia_completion_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS consent_compliance_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS training_completion_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS audit_return_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS privacy_notice_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS breaches_total INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dpo_verified INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dpia_approved INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consent_active INTEGER DEFAULT 0;

-- 2. staff_training_records: add training_status
ALTER TABLE staff_training_records 
  ADD COLUMN IF NOT EXISTS training_status VARCHAR(32) DEFAULT 'pending';

-- 3. onboarding_checklists
CREATE TABLE IF NOT EXISTS onboarding_checklists (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  step_id VARCHAR(128) NOT NULL,
  completed_at BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, step_id)
);

-- 4. changelogs
CREATE TABLE IF NOT EXISTS changelogs (
  id SERIAL PRIMARY KEY,
  version VARCHAR(32) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT,
  category VARCHAR(64) DEFAULT 'feature',
  published_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. compliance_audit_returns
CREATE TABLE IF NOT EXISTS compliance_audit_returns (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  audit_period_start DATE,
  audit_period_end DATE,
  dpco_id INTEGER,
  dpco_name VARCHAR(255),
  compliance_score NUMERIC(5,2),
  findings_summary TEXT,
  non_conformities TEXT,
  corrective_actions TEXT,
  data_protection_policies_review TEXT,
  security_measures_assessment TEXT,
  staff_training_assessment TEXT,
  incident_response_assessment TEXT,
  cross_border_assessment TEXT,
  car_status VARCHAR(32) DEFAULT 'draft',
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. privacy_notices: add privacy_notice_status
ALTER TABLE privacy_notices
  ADD COLUMN IF NOT EXISTS privacy_notice_status VARCHAR(32) DEFAULT 'draft';

-- 7. data_processing_agreements: add dpa_status
ALTER TABLE data_processing_agreements
  ADD COLUMN IF NOT EXISTS dpa_status VARCHAR(32) DEFAULT 'draft';

-- 8. dpo_reports: add dpo_report_status
ALTER TABLE dpo_reports
  ADD COLUMN IF NOT EXISTS dpo_report_status VARCHAR(32) DEFAULT 'draft';

-- 9. adequacy_determinations: add adequacy_status
ALTER TABLE adequacy_determinations
  ADD COLUMN IF NOT EXISTS adequacy_status VARCHAR(32) DEFAULT 'pending';

-- 10. automated_decision_records: add significant_effect
ALTER TABLE automated_decision_records
  ADD COLUMN IF NOT EXISTS significant_effect BOOLEAN DEFAULT false;

-- 11. parental_consent_records: add parental_consent_status
ALTER TABLE parental_consent_records
  ADD COLUMN IF NOT EXISTS parental_consent_status VARCHAR(32) DEFAULT 'pending';

-- 12. transfer_instruments: add transfer_instrument_status
ALTER TABLE transfer_instruments
  ADD COLUMN IF NOT EXISTS transfer_instrument_status VARCHAR(32) DEFAULT 'draft';

-- 13. data_export_jobs: add export_job_status
ALTER TABLE data_export_jobs
  ADD COLUMN IF NOT EXISTS export_job_status VARCHAR(32) DEFAULT 'pending';
