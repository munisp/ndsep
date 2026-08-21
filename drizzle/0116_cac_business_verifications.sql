CREATE TABLE IF NOT EXISTS cac_business_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_reference varchar(255) NOT NULL,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  registration_number varchar(128) NOT NULL,
  verification_purpose varchar(512) NOT NULL,
  verified boolean NOT NULL,
  provider_status varchar(64) NOT NULL,
  legal_name varchar(512),
  registration_type varchar(64),
  provenance varchar(32) NOT NULL CHECK (provenance IN ('cac_bridge', 'test_emulator')),
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count >= 1),
  success_count integer NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  last_verified_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT cac_business_verifications_provider_reference_unique UNIQUE (provider_reference),
  CONSTRAINT cac_business_verifications_registration_scope_unique UNIQUE (organization_id, registration_number)
);

CREATE INDEX IF NOT EXISTS cac_business_verifications_org_verified_idx
  ON cac_business_verifications (organization_id, last_verified_at DESC);

CREATE INDEX IF NOT EXISTS cac_business_verifications_registration_idx
  ON cac_business_verifications (registration_number);

COMMENT ON TABLE cac_business_verifications IS
  'Authoritative CAC bridge business-registration verification outcomes. Test-emulator provenance is prohibited in production.';
