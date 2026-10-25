-- 0106: Standard Contractual Clauses (SCC) registrations + unified NDPA s.43
-- derogation vocabulary across cross_border_derogations (0030) and
-- transfer_declarations (0089), plus case-insensitive uniqueness for the
-- destination risk register. Idempotent. PostgreSQL only.

-- ─── scc_registrations ───────────────────────────────────────────────────────
-- SCC safeguards registered by controllers/processors and reviewed by NDPC.
-- Status lifecycle: pending -> approved -> suspended/expired.
CREATE TABLE IF NOT EXISTS scc_registrations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  controller_party VARCHAR(256) NOT NULL,
  processor_party VARCHAR(256) NOT NULL,
  clauses_version VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','suspended','expired')),
  effective_from TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  document_hash VARCHAR(64) NOT NULL,   -- sha256 hex of the executed SCC document
  notes TEXT,
  submitted_by VARCHAR(256),
  reviewed_by VARCHAR(256),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scc_registrations_org_status
  ON scc_registrations (organization_id, status);

CREATE OR REPLACE FUNCTION update_scc_registrations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_scc_registrations_updated_at ON scc_registrations;
CREATE TRIGGER trg_scc_registrations_updated_at
  BEFORE UPDATE ON scc_registrations
  FOR EACH ROW EXECUTE FUNCTION update_scc_registrations_updated_at();

-- ─── Unified NDPA s.43 derogation vocabulary ─────────────────────────────────
-- Canonical vocabulary (NDPA 2023 s.43(1)(a)-(g), incl. public-register ground):
--   explicit_consent        (a) -- requires informed-of-risks attestation
--   contract_performance    (b)
--   data_subject_benefit    (c)
--   public_interest         (d)
--   legal_claims            (e)
--   vital_interests         (f)
--   public_register         (g)
-- Map legacy rows BEFORE tightening the CHECK.
UPDATE cross_border_derogations
SET derogation_type = 'data_subject_benefit',
    justification = COALESCE(justification, '')
      || ' [migration 0106: legacy derogation_type ''legitimate_interests'' remapped to the NDPA s.43 vocabulary; an officer must re-assess and document the correct s.43 ground.]'
WHERE derogation_type = 'legitimate_interests';

ALTER TABLE cross_border_derogations
  DROP CONSTRAINT IF EXISTS cross_border_derogations_derogation_type_check;
ALTER TABLE cross_border_derogations
  ADD CONSTRAINT cross_border_derogations_derogation_type_check
  CHECK (derogation_type IN (
    'explicit_consent','contract_performance','data_subject_benefit',
    'public_interest','legal_claims','vital_interests','public_register'
  ));

-- Informed-of-risks attestation for consent-based derogations (s.43(1)(a)).
ALTER TABLE cross_border_derogations
  ADD COLUMN IF NOT EXISTS informed_of_risks_confirmed BOOLEAN;
ALTER TABLE cross_border_derogations
  ADD COLUMN IF NOT EXISTS legal_section_ref VARCHAR(8);
UPDATE cross_border_derogations
SET legal_section_ref = CASE derogation_type
  WHEN 'explicit_consent' THEN 's.43(a)'
  WHEN 'contract_performance' THEN 's.43(b)'
  WHEN 'data_subject_benefit' THEN 's.43(c)'
  WHEN 'public_interest' THEN 's.43(d)'
  WHEN 'legal_claims' THEN 's.43(e)'
  WHEN 'vital_interests' THEN 's.43(f)'
  WHEN 'public_register' THEN 's.43(g)'
END
WHERE legal_section_ref IS NULL;

-- ─── transfer_declarations legal_basis unification (0089) ────────────────────
-- Align singular 'vital_interest' with the unified plural 'vital_interests'.
UPDATE transfer_declarations
SET legal_basis = 'vital_interests'
WHERE legal_basis = 'vital_interest';

ALTER TABLE transfer_declarations
  DROP CONSTRAINT IF EXISTS transfer_declarations_legal_basis_check;
ALTER TABLE transfer_declarations
  ADD CONSTRAINT transfer_declarations_legal_basis_check
  CHECK (legal_basis IN (
    'adequacy_decision','bcr','scc','derogation','explicit_consent',
    'contract_performance','vital_interests','none_claimed'
  ));

-- ─── destination_risk_register: case-insensitive uniqueness ─────────────────
-- Remove case-variant duplicates (keep most recently updated) before indexing.
DELETE FROM destination_risk_register a
USING destination_risk_register b
WHERE lower(a.country) = lower(b.country)
  AND a.id <> b.id
  AND (a.updated_at < b.updated_at
       OR (a.updated_at = b.updated_at AND a.id > b.id));

CREATE UNIQUE INDEX IF NOT EXISTS idx_destination_risk_country_lower
  ON destination_risk_register (lower(country));
