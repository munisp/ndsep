-- ============================================================
-- NDSEP Field-Level Encryption Migration
-- Enables pgcrypto extension and widens PII columns to accommodate
-- AES-256-GCM encrypted values (enc:v1:<iv>:<tag>:<ciphertext>).
--
-- Encrypted values are ~2.5x longer than plaintext:
--   "enc:v1:" (7) + iv (24) + ":" + tag (32) + ":" + ciphertext (~2x plaintext hex)
--   Example: 30-char email → ~130 char encrypted string
--
-- This migration:
-- 1. Enables the pgcrypto extension (for future DB-level operations)
-- 2. Widens all PII varchar columns to TEXT to accommodate encrypted values
-- 3. Adds a field_encryption_status table to track encryption state
-- ============================================================

-- 1. Enable pgcrypto extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Widen PII columns from varchar to text (encrypted values are longer)
-- Users
ALTER TABLE users ALTER COLUMN email TYPE text;
ALTER TABLE users ALTER COLUMN name TYPE text;

-- Organizations
ALTER TABLE organizations ALTER COLUMN contact_email TYPE text;

-- Portal Submissions
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='portal_submissions' AND column_name='contact_email') THEN
    ALTER TABLE portal_submissions ALTER COLUMN contact_name TYPE text;
    ALTER TABLE portal_submissions ALTER COLUMN contact_email TYPE text;
    ALTER TABLE portal_submissions ALTER COLUMN contact_phone TYPE text;
  END IF;
END $$;

-- Citizen Requests
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='citizen_requests' AND column_name='citizen_email') THEN
    ALTER TABLE citizen_requests ALTER COLUMN citizen_email TYPE text;
    ALTER TABLE citizen_requests ALTER COLUMN citizen_nin TYPE text;
  END IF;
END $$;

-- Breach Incidents
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='breach_incidents' AND column_name='data_subject_email') THEN
    ALTER TABLE breach_incidents ALTER COLUMN data_subject_email TYPE text;
    ALTER TABLE breach_incidents ALTER COLUMN data_subject_nin TYPE text;
  END IF;
END $$;

-- DPO Appointments
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dpo_appointments' AND column_name='dpo_email') THEN
    ALTER TABLE dpo_appointments ALTER COLUMN dpo_email TYPE text;
    ALTER TABLE dpo_appointments ALTER COLUMN dpo_phone TYPE text;
  END IF;
END $$;

-- Compliance Audit Returns
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='compliance_audit_returns' AND column_name='dpo_contact_info') THEN
    ALTER TABLE compliance_audit_returns ALTER COLUMN dpo_contact_info TYPE text;
  END IF;
END $$;

-- Automated Decision Records
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='automated_decision_records' AND column_name='data_subject_email') THEN
    ALTER TABLE automated_decision_records ALTER COLUMN data_subject_email TYPE text;
  END IF;
END $$;

-- Parental Consent Records
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='parental_consent_records' AND column_name='parent_email') THEN
    ALTER TABLE parental_consent_records ALTER COLUMN parent_email TYPE text;
  END IF;
END $$;

-- Data Export Jobs
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='data_export_jobs' AND column_name='data_subject_email') THEN
    ALTER TABLE data_export_jobs ALTER COLUMN data_subject_email TYPE text;
  END IF;
END $$;

-- DPCO Registrations
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dpco_registrations' AND column_name='email') THEN
    ALTER TABLE dpco_registrations ALTER COLUMN email TYPE text;
    ALTER TABLE dpco_registrations ALTER COLUMN phone TYPE text;
    ALTER TABLE dpco_registrations ALTER COLUMN dpo_email TYPE text;
    ALTER TABLE dpco_registrations ALTER COLUMN contact_name TYPE text;
    ALTER TABLE dpco_registrations ALTER COLUMN contact_email TYPE text;
    ALTER TABLE dpco_registrations ALTER COLUMN contact_phone TYPE text;
  END IF;
END $$;

-- DPCO Clients
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dpco_clients' AND column_name='contact_email') THEN
    ALTER TABLE dpco_clients ALTER COLUMN contact_name TYPE text;
    ALTER TABLE dpco_clients ALTER COLUMN contact_email TYPE text;
    ALTER TABLE dpco_clients ALTER COLUMN contact_phone TYPE text;
  END IF;
END $$;

-- DPCO Licensed Firms
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dpco_licensed_firms' AND column_name='email') THEN
    ALTER TABLE dpco_licensed_firms ALTER COLUMN email TYPE text;
    ALTER TABLE dpco_licensed_firms ALTER COLUMN phone TYPE text;
  END IF;
END $$;

-- 3. Create encryption status tracking table
CREATE TABLE IF NOT EXISTS field_encryption_status (
  id serial PRIMARY KEY,
  table_name varchar(128) NOT NULL,
  column_name varchar(128) NOT NULL,
  encrypted_count integer DEFAULT 0,
  total_count integer DEFAULT 0,
  last_encrypted_at timestamp,
  encryption_version varchar(16) DEFAULT 'v1',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  UNIQUE(table_name, column_name)
);

-- 4. Insert tracking rows for all PII fields
INSERT INTO field_encryption_status (table_name, column_name) VALUES
  ('users', 'email'),
  ('users', 'name'),
  ('organizations', 'contact_email'),
  ('portal_submissions', 'contact_name'),
  ('portal_submissions', 'contact_email'),
  ('portal_submissions', 'contact_phone'),
  ('citizen_requests', 'citizen_email'),
  ('citizen_requests', 'citizen_nin'),
  ('breach_incidents', 'data_subject_email'),
  ('breach_incidents', 'data_subject_nin'),
  ('dpo_appointments', 'dpo_email'),
  ('dpo_appointments', 'dpo_phone'),
  ('compliance_audit_returns', 'dpo_contact_info'),
  ('automated_decision_records', 'data_subject_email'),
  ('parental_consent_records', 'parent_email'),
  ('data_export_jobs', 'data_subject_email'),
  ('dpco_registrations', 'email'),
  ('dpco_registrations', 'phone'),
  ('dpco_registrations', 'dpo_email'),
  ('dpco_registrations', 'contact_name'),
  ('dpco_registrations', 'contact_email'),
  ('dpco_registrations', 'contact_phone'),
  ('dpco_clients', 'contact_name'),
  ('dpco_clients', 'contact_email'),
  ('dpco_clients', 'contact_phone'),
  ('dpco_licensed_firms', 'email'),
  ('dpco_licensed_firms', 'phone')
ON CONFLICT (table_name, column_name) DO NOTHING;
