-- NDSEP Liveness Detection — Database Schema
-- Creates the liveness_checks table for storing biometric verification results

CREATE TABLE IF NOT EXISTS liveness_checks (
  id SERIAL PRIMARY KEY,
  reference_id VARCHAR(50) NOT NULL UNIQUE,
  kyc_record_id INTEGER REFERENCES kyc_records(id) ON DELETE SET NULL,
  check_type VARCHAR(20) NOT NULL CHECK (check_type IN ('passive', 'active', 'face_match', 'anti_spoof', 'deepfake')),
  
  -- Core results
  is_live BOOLEAN NOT NULL DEFAULT false,
  liveness_score NUMERIC(5,2) DEFAULT 0,
  face_detected BOOLEAN DEFAULT true,
  face_count INTEGER DEFAULT 0,
  face_quality NUMERIC(5,2) DEFAULT 0,
  
  -- Anti-spoofing
  spoof_type VARCHAR(30) DEFAULT 'unknown',
  spoof_probability NUMERIC(5,4) DEFAULT 0,
  anti_spoof_score NUMERIC(5,2) DEFAULT 0,
  
  -- Deepfake
  deepfake_probability NUMERIC(5,4) DEFAULT 0,
  
  -- Confidence
  confidence NUMERIC(5,2) DEFAULT 0,
  
  -- Full JSON result for audit trail
  result_json JSONB,
  
  -- Metadata
  performed_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_liveness_checks_kyc ON liveness_checks(kyc_record_id);
CREATE INDEX IF NOT EXISTS idx_liveness_checks_type ON liveness_checks(check_type);
CREATE INDEX IF NOT EXISTS idx_liveness_checks_created ON liveness_checks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_liveness_checks_ref ON liveness_checks(reference_id);

-- Add face_embedding column to kyc_records for stored embeddings
ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS face_embedding JSONB;
ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS liveness_check_id INTEGER REFERENCES liveness_checks(id);
