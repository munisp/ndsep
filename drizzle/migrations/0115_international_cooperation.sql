-- Migration: International cooperation workflows (FEAT-E, round 9)
-- Mutual-assistance requests (outbound/inbound) against an admin-managed
-- counterpart DPA registry (African DPAs, GPA members), MOU/instrument
-- registry with effective dates, evidence-sharing packages linked to tribunal
-- bundles BY REFERENCE + HASH ONLY, and statutory-deadline tracking for
-- inbound requests. Idempotent: safe to re-run.

-- ─── Counterpart DPA registry (reference data, admin-managed) ───────────────
CREATE TABLE IF NOT EXISTS counterpart_dpa_registry (
  id            SERIAL PRIMARY KEY,
  authority_key VARCHAR(64) NOT NULL UNIQUE,   -- e.g. 'ng_ndpc', 'ke_odpc'
  name          VARCHAR(256) NOT NULL,
  country       VARCHAR(128) NOT NULL,
  region        VARCHAR(16) NOT NULL DEFAULT 'africa'
    CHECK (region IN ('africa', 'gpa', 'other')),
  networks      JSONB NOT NULL DEFAULT '[]'::jsonb,  -- e.g. ["GPA","NADPA-RAP"]
  contact_name  VARCHAR(256),                          -- PII (official contact)
  contact_email VARCHAR(256),                          -- PII (official contact)
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    VARCHAR(256),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: African DPAs (NADPA-RAP members) + GPA convenor network. Neutral
-- reference rows; admins maintain contact details via CRUD.
INSERT INTO counterpart_dpa_registry (authority_key, name, country, region, networks, created_by)
VALUES
  ('ng_ndpc', 'Nigeria Data Protection Commission', 'Nigeria', 'africa', '["NADPA-RAP","GPA"]'::jsonb, 'system-seed'),
  ('ke_odpc', 'Office of the Data Protection Commissioner', 'Kenya', 'africa', '["NADPA-RAP","GPA"]'::jsonb, 'system-seed'),
  ('gh_dpa', 'Data Protection Commission', 'Ghana', 'africa', '["NADPA-RAP"]'::jsonb, 'system-seed'),
  ('za_inforeg', 'Information Regulator', 'South Africa', 'africa', '["NADPA-RAP","GPA"]'::jsonb, 'system-seed'),
  ('rw_nida_dpo', 'Data Protection Office (NIDA)', 'Rwanda', 'africa', '["NADPA-RAP"]'::jsonb, 'system-seed'),
  ('sn_cdp', 'Commission de protection des Donnees personnelles', 'Senegal', 'africa', '["NADPA-RAP"]'::jsonb, 'system-seed'),
  ('mu_dpo', 'Data Protection Office', 'Mauritius', 'africa', '["NADPA-RAP","GPA"]'::jsonb, 'system-seed'),
  ('gpa_secretariat', 'Global Privacy Assembly Secretariat', 'International', 'gpa', '["GPA"]'::jsonb, 'system-seed')
ON CONFLICT (authority_key) DO NOTHING;

-- ─── MOU / cooperation instrument registry ──────────────────────────────────
CREATE TABLE IF NOT EXISTS mou_registry (
  id              SERIAL PRIMARY KEY,
  instrument_ref  VARCHAR(64) NOT NULL UNIQUE,  -- MOU-YYYY-###
  title           VARCHAR(512) NOT NULL,
  counterpart_dpa_id INTEGER REFERENCES counterpart_dpa_registry(id),
  instrument_type VARCHAR(24) NOT NULL DEFAULT 'mou'
    CHECK (instrument_type IN ('mou', 'treaty', 'arrangement', 'administrative_agreement')),
  signed_date     DATE,
  effective_date  DATE,
  expiry_date     DATE,
  status          VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_force', 'expired', 'terminated')),
  document_ref    TEXT,                          -- storage ref of signed instrument
  document_hash   VARCHAR(64),                   -- sha256 of signed instrument
  notes           TEXT,
  created_by      VARCHAR(256),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mou_registry_status
  ON mou_registry (status, effective_date);

-- ─── Mutual-assistance requests ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mutual_assistance_requests (
  id               SERIAL PRIMARY KEY,
  request_ref      VARCHAR(64) NOT NULL UNIQUE,  -- ICMA-YYYY-#####
  direction        VARCHAR(8) NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  counterpart_dpa_id INTEGER NOT NULL REFERENCES counterpart_dpa_registry(id),
  mou_id           INTEGER REFERENCES mou_registry(id),
  subject          VARCHAR(512) NOT NULL,
  legal_basis      TEXT,
  status           VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'acknowledged', 'fulfilled', 'declined', 'withdrawn')),
  sent_at          TIMESTAMPTZ,
  acknowledged_at  TIMESTAMPTZ,
  fulfilled_at     TIMESTAMPTZ,
  declined_at      TIMESTAMPTZ,
  decline_reason   TEXT,
  statutory_deadline DATE,                       -- inbound only
  created_by       VARCHAR(256),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS icma_ref_seq START 1;

CREATE INDEX IF NOT EXISTS idx_icma_status
  ON mutual_assistance_requests (status, direction);
CREATE INDEX IF NOT EXISTS idx_icma_deadline
  ON mutual_assistance_requests (statutory_deadline)
  WHERE direction = 'inbound'
    AND status IN ('sent', 'acknowledged');

-- ─── Request lifecycle events ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS icoop_request_events (
  id         BIGSERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES mutual_assistance_requests(id),
  event_type VARCHAR(32) NOT NULL,               -- created|sent|acknowledged|fulfilled|declined|withdrawn|note
  actor      VARCHAR(256),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_icoop_request_events_request
  ON icoop_request_events (request_id, created_at DESC);

-- ─── Evidence-sharing packages (tribunal bundle by REFERENCE + HASH only) ──
CREATE TABLE IF NOT EXISTS icoop_evidence_packages (
  id                 BIGSERIAL PRIMARY KEY,
  request_id         INTEGER NOT NULL REFERENCES mutual_assistance_requests(id),
  tribunal_bundle_id BIGINT NOT NULL REFERENCES tribunal_bundles(id),
  bundle_merkle_root TEXT NOT NULL,              -- integrity hash captured at share time
  package_ref        VARCHAR(64) NOT NULL UNIQUE,
  shared_at          TIMESTAMPTZ,
  shared_by          VARCHAR(256),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_icoop_evidence_packages_request
  ON icoop_evidence_packages (request_id);
