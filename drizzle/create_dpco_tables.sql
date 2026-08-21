-- Create DPCO enums (if not exists)
DO $$ BEGIN
  CREATE TYPE dpco_org_status AS ENUM ('pending', 'active', 'suspended', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dpco_org_tier AS ENUM ('starter', 'professional', 'enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dpco_client_status AS ENUM ('active', 'inactive', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dpco_client_risk AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dpco_audit_stage AS ENUM ('initiated', 'data_mapping', 'gap_assessment', 'fieldwork', 'findings_review', 'management_response', 'report_issued', 'car_filed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE control_rating AS ENUM ('compliant', 'partial', 'non_compliant', 'not_applicable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dpco_evidence_status AS ENUM ('active', 'expired', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dpco_training_status AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dpco_client_policy_status AS ENUM ('draft', 'reviewed', 'signed', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- dpco_organisations
CREATE TABLE IF NOT EXISTS dpco_organisations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  licence_number VARCHAR(100) UNIQUE,
  status dpco_org_status NOT NULL DEFAULT 'pending',
  tier dpco_org_tier NOT NULL DEFAULT 'starter',
  email VARCHAR(255),
  phone VARCHAR(50),
  address TEXT,
  cac_number VARCHAR(100),
  tax_id VARCHAR(100),
  rc_number VARCHAR(100),
  dpo_name VARCHAR(255),
  dpo_email VARCHAR(255),
  services TEXT[],
  sectors TEXT[],
  website VARCHAR(255),
  logo_url VARCHAR(500),
  licence_expires_at TIMESTAMP,
  approved_at TIMESTAMP,
  approved_by VARCHAR(255),
  rejection_reason TEXT,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- dpco_clients
CREATE TABLE IF NOT EXISTS dpco_clients (
  id SERIAL PRIMARY KEY,
  dpco_org_id INTEGER NOT NULL,
  org_name VARCHAR(255) NOT NULL,
  org_sector VARCHAR(100),
  org_location VARCHAR(255),
  contact_name VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  status dpco_client_status NOT NULL DEFAULT 'active',
  risk_level dpco_client_risk NOT NULL DEFAULT 'medium',
  compliance_score INTEGER DEFAULT 0,
  onboarded_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- dpco_audit_engagements
CREATE TABLE IF NOT EXISTS dpco_audit_engagements (
  id SERIAL PRIMARY KEY,
  dpco_org_id INTEGER NOT NULL,
  client_id INTEGER,
  title VARCHAR(255) NOT NULL,
  current_stage dpco_audit_stage NOT NULL DEFAULT 'initiated',
  compliance_score INTEGER,
  lead_auditor VARCHAR(255),
  planned_start TIMESTAMP,
  planned_end TIMESTAMP,
  actual_start TIMESTAMP,
  actual_end TIMESTAMP,
  critical_findings INTEGER DEFAULT 0,
  high_findings INTEGER DEFAULT 0,
  medium_findings INTEGER DEFAULT 0,
  low_findings INTEGER DEFAULT 0,
  management_response TEXT,
  notes TEXT,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- dpco_audit_control_ratings
CREATE TABLE IF NOT EXISTS dpco_audit_control_ratings (
  id SERIAL PRIMARY KEY,
  engagement_id INTEGER NOT NULL,
  control_id VARCHAR(20) NOT NULL,
  rating control_rating NOT NULL,
  notes TEXT,
  rated_by VARCHAR(255),
  rated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- dpco_evidence_items
CREATE TABLE IF NOT EXISTS dpco_evidence_items (
  id SERIAL PRIMARY KEY,
  dpco_org_id INTEGER NOT NULL,
  engagement_id INTEGER,
  client_id INTEGER,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  file_url VARCHAR(500),
  file_key VARCHAR(500),
  file_name VARCHAR(255),
  mime_type VARCHAR(100),
  file_size INTEGER,
  sha256_hash VARCHAR(64),
  control_ids TEXT[],
  status dpco_evidence_status NOT NULL DEFAULT 'active',
  expires_at TIMESTAMP,
  uploaded_by VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- dpco_training_sessions
CREATE TABLE IF NOT EXISTS dpco_training_sessions (
  id SERIAL PRIMARY KEY,
  dpco_org_id INTEGER NOT NULL,
  client_id INTEGER,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  training_type VARCHAR(100),
  status dpco_training_status NOT NULL DEFAULT 'scheduled',
  scheduled_date TIMESTAMP,
  completed_date TIMESTAMP,
  participant_count INTEGER DEFAULT 0,
  certificates_issued INTEGER DEFAULT 0,
  ndpa_section VARCHAR(50),
  facilitator VARCHAR(255),
  venue VARCHAR(255),
  materials TEXT[],
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- dpco_client_policies
CREATE TABLE IF NOT EXISTS dpco_client_policies (
  id SERIAL PRIMARY KEY,
  dpco_org_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  template_id VARCHAR(100) NOT NULL,
  template_name VARCHAR(255) NOT NULL,
  status dpco_client_policy_status NOT NULL DEFAULT 'draft',
  customised_content TEXT,
  file_url VARCHAR(500),
  assigned_by VARCHAR(255),
  signed_at TIMESTAMP,
  expires_at TIMESTAMP,
  notes TEXT,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add dpco_org_id to users table if not exists
ALTER TABLE users ADD COLUMN IF NOT EXISTS dpco_org_id INTEGER;
