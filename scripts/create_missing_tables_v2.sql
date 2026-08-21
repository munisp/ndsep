-- Create enums (safe)
DO $$ BEGIN CREATE TYPE lawful_basis AS ENUM ('consent','contract','legal_obligation','vital_interests','public_task','legitimate_interests'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE consent_status AS ENUM ('active','withdrawn','expired','pending'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE breach_severity AS ENUM ('low','medium','high','critical'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE breach_status AS ENUM ('detected','assessing','ndpc_notified','individuals_notified','contained','resolved','closed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE dpo_credential_status AS ENUM ('pending','verified','expired','suspended','revoked'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE dpia_status AS ENUM ('draft','in_progress','review','approved','rejected','archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE dpia_risk_level AS ENUM ('low','medium','high','critical'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- consent_records
CREATE TABLE IF NOT EXISTS consent_records (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  data_subject_name VARCHAR(256) NOT NULL,
  data_subject_email VARCHAR(320) NOT NULL,
  data_subject_nin VARCHAR(64),
  purpose TEXT NOT NULL,
  lawful_basis lawful_basis NOT NULL DEFAULT 'consent',
  consent_status consent_status NOT NULL DEFAULT 'active',
  consent_given_at TIMESTAMP NOT NULL DEFAULT NOW(),
  consent_withdrawn_at TIMESTAMP,
  expires_at TIMESTAMP,
  evidence_ref TEXT,
  data_categories JSONB DEFAULT '[]',
  processing_activities JSONB DEFAULT '[]',
  third_party_sharing BOOLEAN DEFAULT FALSE,
  cross_border_transfer BOOLEAN DEFAULT FALSE,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- breach_incidents
CREATE TABLE IF NOT EXISTS breach_incidents (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  breach_incident_severity breach_severity NOT NULL DEFAULT 'medium',
  breach_incident_status breach_status NOT NULL DEFAULT 'detected',
  detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ndpc_notification_deadline TIMESTAMP NOT NULL DEFAULT NOW() + INTERVAL '72 hours',
  ndpc_notified_at TIMESTAMP,
  individuals_notified_at TIMESTAMP,
  contained_at TIMESTAMP,
  resolved_at TIMESTAMP,
  affected_individuals_count INTEGER DEFAULT 0,
  data_types_affected JSONB DEFAULT '[]',
  breach_cause TEXT,
  remediation_actions TEXT,
  reported_by INTEGER,
  assigned_to INTEGER,
  ndpc_reference_number VARCHAR(128),
  security_alert_id INTEGER,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- dpo_appointments
CREATE TABLE IF NOT EXISTS dpo_appointments (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  dpo_name VARCHAR(256) NOT NULL,
  dpo_email VARCHAR(320) NOT NULL,
  dpo_phone VARCHAR(32),
  appointed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  credential_status dpo_credential_status NOT NULL DEFAULT 'pending',
  dpco_id VARCHAR(128),
  dpco_name VARCHAR(256),
  certification_expires_at TIMESTAMP,
  last_report_submitted_at TIMESTAMP,
  independence_verified BOOLEAN DEFAULT FALSE,
  training_hours_completed INTEGER DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ropa_records
CREATE TABLE IF NOT EXISTS ropa_records (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  processing_activity_name VARCHAR(256) NOT NULL,
  controller_name VARCHAR(256) NOT NULL,
  dpo_contact VARCHAR(320),
  purpose_of_processing TEXT NOT NULL,
  lawful_basis lawful_basis NOT NULL DEFAULT 'consent',
  data_categories JSONB DEFAULT '[]',
  data_subjects JSONB DEFAULT '[]',
  recipients JSONB DEFAULT '[]',
  third_country_transfers BOOLEAN DEFAULT FALSE,
  transfer_safeguards TEXT,
  retention_period VARCHAR(128),
  security_measures TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  last_reviewed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- retention_policies
CREATE TABLE IF NOT EXISTS retention_policies (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  policy_name VARCHAR(256) NOT NULL,
  data_category VARCHAR(128) NOT NULL,
  retention_period_days INTEGER NOT NULL,
  legal_basis TEXT,
  deletion_method VARCHAR(128) DEFAULT 'secure_delete',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  review_date TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- dpo_reports
CREATE TABLE IF NOT EXISTS dpo_reports (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  dpo_appointment_id INTEGER,
  report_period_start TIMESTAMP NOT NULL,
  report_period_end TIMESTAMP NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  activities_summary TEXT,
  violations_identified INTEGER DEFAULT 0,
  dsars_handled INTEGER DEFAULT 0,
  training_conducted INTEGER DEFAULT 0,
  privacy_notices_review TEXT,
  recommendations TEXT,
  submitted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- adequacy_determinations
CREATE TABLE IF NOT EXISTS adequacy_determinations (
  id SERIAL PRIMARY KEY,
  country_code VARCHAR(8) NOT NULL,
  country_name VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  determination_date TIMESTAMP,
  review_date TIMESTAMP,
  ndpc_decision TEXT,
  conditions TEXT,
  applicable_sectors JSONB DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- data_processing_agreements
CREATE TABLE IF NOT EXISTS data_processing_agreements (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  processor_name VARCHAR(256) NOT NULL,
  processor_country VARCHAR(128) NOT NULL,
  agreement_reference VARCHAR(128),
  processing_purposes JSONB DEFAULT '[]',
  data_categories JSONB DEFAULT '[]',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  signed_at TIMESTAMP,
  expires_at TIMESTAMP,
  sub_processors JSONB DEFAULT '[]',
  security_measures TEXT,
  audit_rights BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- privacy_notices
CREATE TABLE IF NOT EXISTS privacy_notices (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  notice_title VARCHAR(256) NOT NULL,
  version VARCHAR(32) NOT NULL DEFAULT '1.0',
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  language VARCHAR(16) NOT NULL DEFAULT 'en',
  content TEXT NOT NULL,
  effective_date TIMESTAMP,
  review_date TIMESTAMP,
  approved_by INTEGER,
  published_url TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- cookie_consent_records
CREATE TABLE IF NOT EXISTS cookie_consent_records (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  session_id VARCHAR(256) NOT NULL,
  user_agent TEXT,
  ip_address VARCHAR(64),
  consent_given BOOLEAN NOT NULL DEFAULT FALSE,
  analytics_cookies BOOLEAN DEFAULT FALSE,
  marketing_cookies BOOLEAN DEFAULT FALSE,
  functional_cookies BOOLEAN DEFAULT TRUE,
  consent_version VARCHAR(32),
  consented_at TIMESTAMP,
  withdrawn_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- automated_decision_records
CREATE TABLE IF NOT EXISTS automated_decision_records (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  system_name VARCHAR(256) NOT NULL,
  decision_type VARCHAR(128) NOT NULL,
  data_subject_ref VARCHAR(256),
  decision_outcome TEXT NOT NULL,
  logic_explanation TEXT,
  human_review_available BOOLEAN DEFAULT TRUE,
  human_review_requested BOOLEAN DEFAULT FALSE,
  human_review_completed_at TIMESTAMP,
  objection_raised BOOLEAN DEFAULT FALSE,
  objection_outcome TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- parental_consent_records
CREATE TABLE IF NOT EXISTS parental_consent_records (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  child_ref VARCHAR(256) NOT NULL,
  child_age INTEGER NOT NULL,
  parent_guardian_name VARCHAR(256) NOT NULL,
  parent_guardian_email VARCHAR(320) NOT NULL,
  parent_guardian_nin VARCHAR(64),
  consent_purpose TEXT NOT NULL,
  consent_status consent_status NOT NULL DEFAULT 'active',
  consent_given_at TIMESTAMP NOT NULL DEFAULT NOW(),
  consent_withdrawn_at TIMESTAMP,
  verification_method VARCHAR(128),
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- staff_training_records
CREATE TABLE IF NOT EXISTS staff_training_records (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  staff_name VARCHAR(256) NOT NULL,
  staff_email VARCHAR(320),
  training_title VARCHAR(256) NOT NULL,
  training_type VARCHAR(128) NOT NULL DEFAULT 'data_protection',
  provider VARCHAR(256),
  completed_at TIMESTAMP,
  expires_at TIMESTAMP,
  score INTEGER,
  passed BOOLEAN DEFAULT FALSE,
  certificate_url TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- transfer_instruments
CREATE TABLE IF NOT EXISTS transfer_instruments (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  instrument_type VARCHAR(128) NOT NULL,
  instrument_reference VARCHAR(256),
  destination_country VARCHAR(128) NOT NULL,
  data_categories JSONB DEFAULT '[]',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  approved_by INTEGER,
  approved_at TIMESTAMP,
  expires_at TIMESTAMP,
  conditions TEXT,
  ndpc_reference VARCHAR(128),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- data_export_jobs
CREATE TABLE IF NOT EXISTS data_export_jobs (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  requested_by INTEGER,
  export_type VARCHAR(128) NOT NULL DEFAULT 'full_export',
  data_categories JSONB DEFAULT '[]',
  format VARCHAR(32) NOT NULL DEFAULT 'csv',
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  file_url TEXT,
  file_size_bytes BIGINT,
  records_exported INTEGER,
  error_message TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- dcpmi_thresholds
CREATE TABLE IF NOT EXISTS dcpmi_thresholds (
  id SERIAL PRIMARY KEY,
  metric_name VARCHAR(256) NOT NULL,
  sector VARCHAR(128) NOT NULL DEFAULT 'all',
  threshold_value NUMERIC(10,4) NOT NULL,
  unit VARCHAR(64),
  alert_level VARCHAR(32) NOT NULL DEFAULT 'warning',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT,
  regulatory_basis TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ndpa_compliance_snapshots
CREATE TABLE IF NOT EXISTS ndpa_compliance_snapshots (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER,
  snapshot_date TIMESTAMP NOT NULL DEFAULT NOW(),
  overall_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  consent_score NUMERIC(5,2) DEFAULT 0,
  breach_score NUMERIC(5,2) DEFAULT 0,
  dpia_score NUMERIC(5,2) DEFAULT 0,
  ropa_score NUMERIC(5,2) DEFAULT 0,
  dpo_score NUMERIC(5,2) DEFAULT 0,
  transfer_score NUMERIC(5,2) DEFAULT 0,
  open_violations INTEGER DEFAULT 0,
  critical_violations INTEGER DEFAULT 0,
  pending_dsars INTEGER DEFAULT 0,
  active_breaches INTEGER DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

