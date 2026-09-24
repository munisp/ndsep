-- Migration 0094: Data sovereignty — hosting declarations & attestations.
--
-- Regulatory driver: CBN Circular PSS/DIR/PUB/CIR/001/004 (2026-06-15) —
-- all payment system participants must ensure payment transaction data
-- generated in Nigeria is "stored and managed in Nigeria" by 2027-01-01
-- (primary processing, databases, backups, admin access, encryption-key
-- custody all local). NDPA 2023 ss.41-43 cross-border transfer rules apply
-- on top for any residual foreign processing.
--
-- Tables backing server/routers/dataSovereignty.ts:
--
--   hosting_declarations    self-declared hosting posture per regulated
--                           entity (PSP / fintech / bank / switch): primary
--                           data centre, cloud provider + regions, backup /
--                           DR locations, admin-access locations, encryption-
--                           key custody, subprocessors. Review workflow:
--                           submitted -> under_review -> approved | rejected.
--   residency_attestations  periodic officer sign-off on a declaration:
--                           named officer + attestation statement + SHA-256
--                           document hash + expiry. An EXPIRED attestation
--                           is itself a compliance flag (expired rows are
--                           surfaced by the router; status is flipped by the
--                           scoring sweep, not silently).
--
-- Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS hosting_declarations (
  id                        BIGSERIAL PRIMARY KEY,
  entity_ref                TEXT NOT NULL,              -- PSP/fintech licence or registry ref (e.g. CBN licence no.)
  entity_name               TEXT NOT NULL,
  entity_type               TEXT NOT NULL DEFAULT 'fintech'
                            CHECK (entity_type IN
                              ('psp', 'fintech', 'bank', 'switch', 'mmo',
                               'pssp', 'ptsp', 'super_agent', 'other')),
  in_scope                  BOOLEAN NOT NULL DEFAULT TRUE, -- CBN circular scope: payment system participant
  primary_dc_name           TEXT,
  primary_dc_city           TEXT,
  primary_dc_country        TEXT,                        -- ISO-3166 alpha-2; 'NG' required for compliance
  cloud_provider            TEXT,                        -- e.g. 'aws', 'azure', 'gcp', 'on_prem', 'hybrid'
  cloud_regions             JSONB NOT NULL DEFAULT '[]', -- ['lagos-1', 'eu-west-1', ...]
  backup_locations          JSONB NOT NULL DEFAULT '[]', -- [{name, city, country}]
  dr_locations              JSONB NOT NULL DEFAULT '[]', -- [{name, city, country}]
  admin_access_locations    JSONB NOT NULL DEFAULT '[]', -- [{country, city, team}] — where privileged admin access originates
  encryption_key_custody    JSONB NOT NULL DEFAULT '{}', -- {country, hsm_provider, custody_model: 'own_hsm'|'cloud_kms'|'byok'|'hyok'}
  subprocessors             JSONB NOT NULL DEFAULT '[]', -- [{name, service, country, contract_ref}]
  declaration_status        TEXT NOT NULL DEFAULT 'submitted'
                            CHECK (declaration_status IN
                              ('submitted', 'under_review', 'approved', 'rejected')),
  submitted_by              TEXT NOT NULL,               -- officer/user ref submitting on behalf of entity
  submitted_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by               TEXT,
  reviewed_at               TIMESTAMPTZ,
  review_notes              TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hosting_declarations_entity
  ON hosting_declarations (entity_ref, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_hosting_declarations_status
  ON hosting_declarations (declaration_status);
CREATE INDEX IF NOT EXISTS idx_hosting_declarations_type
  ON hosting_declarations (entity_type, in_scope);

CREATE TABLE IF NOT EXISTS residency_attestations (
  id                       BIGSERIAL PRIMARY KEY,
  declaration_id           BIGINT NOT NULL REFERENCES hosting_declarations(id) ON DELETE CASCADE,
  entity_ref               TEXT NOT NULL,          -- denormalised for fast flag queries
  attesting_officer_name   TEXT NOT NULL,          -- PII: named accountable officer
  attesting_officer_title  TEXT NOT NULL,
  attestation_statement    TEXT NOT NULL,          -- the exact statement attested to
  document_hash            TEXT NOT NULL           -- SHA-256 of the signed attestation artefact
                           CHECK (document_hash ~ '^[0-9a-f]{64}$'),
  attested_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at               TIMESTAMPTZ NOT NULL,   -- expired attestation = compliance flag
  status                   TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'expired', 'revoked', 'superseded')),
  revoked_by               TEXT,
  revoked_at               TIMESTAMPTZ,
  revocation_reason        TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attestation_expiry_after_attested CHECK (expires_at > attested_at)
);

CREATE INDEX IF NOT EXISTS idx_residency_attestations_entity
  ON residency_attestations (entity_ref, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_residency_attestations_status
  ON residency_attestations (status, expires_at);
-- Fast "currently expired but not yet flipped" scan for the scoring sweep:
CREATE INDEX IF NOT EXISTS idx_residency_attestations_expiry_scan
  ON residency_attestations (expires_at) WHERE status = 'active';
