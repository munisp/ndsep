-- Migration 0087: Revenue verification (FIRS/CAC) + s.48 penalty computations.
--
-- Tables backing server/routers/revenueVerification.ts and
-- server/services/penaltyEngine.ts:
--
--   verified_revenues            revenue figures per registered controller,
--                                sourced from FIRS (TIN-verified filed revenue),
--                                CAC (RC-number corporate record), or a manual
--                                filing with dual attestation (CFO + external
--                                auditor). Status machine:
--                                unverified -> pending -> verified -> disputed
--                                -> superseded. Evidence hash links the record
--                                to source evidence (never the raw documents).
--   penalty_computations         full NDPA 2023 s.48 computation breakdown per
--                                enforcement fine, persisted for appeal
--                                defence: statutory floor, revenue component,
--                                statutory cap, s.48(6) factor contributions,
--                                severity, multiplier, final amount, revenue
--                                provenance, and prior vs new amount on
--                                recomputation.
--   integration_credentials_audit every external adapter invocation (FIRS/CAC)
--                                audited with a key FINGERPRINT (sha256 prefix
--                                of the API key) — secrets are never stored.
--
-- Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS verified_revenues (
  id               BIGSERIAL PRIMARY KEY,
  org_id           INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source           TEXT NOT NULL
                   CHECK (source IN ('firs', 'cac', 'manual_filing')),
  amount           NUMERIC(20, 2) NOT NULL CHECK (amount >= 0),
  currency         CHAR(3) NOT NULL DEFAULT 'NGN',
  fiscal_year      INTEGER NOT NULL CHECK (fiscal_year BETWEEN 1990 AND 2100),
  evidence_hash    TEXT NOT NULL,            -- sha256 of the source evidence payload
  external_ref     TEXT,                     -- TIN (firs) / RC number (cac); NULL for manual
  status           TEXT NOT NULL DEFAULT 'unverified'
                   CHECK (status IN
                     ('unverified', 'pending', 'verified', 'disputed', 'superseded')),
  -- Manual-filing dual attestation: CFO declaration + external auditor
  -- countersignature. NULL for firs/cac-sourced records.
  attestation      JSONB,                    -- {cfo_name, cfo_title, cfo_attested_at,
                                             --  auditor_name, auditor_firm, auditor_attested_at}
  document_hash    TEXT,                     -- sha256 of the filed financial statement (manual path)
  verifier         TEXT,                     -- NDPC officer / adapter principal that verified
  verified_at      TIMESTAMPTZ,
  superseded_by    BIGINT REFERENCES verified_revenues(id) ON DELETE SET NULL,
  dispute_reason   TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verified_revenues_org
  ON verified_revenues (org_id, fiscal_year DESC);
CREATE INDEX IF NOT EXISTS idx_verified_revenues_status
  ON verified_revenues (status) WHERE status = 'verified';
CREATE INDEX IF NOT EXISTS idx_verified_revenues_source
  ON verified_revenues (source, status);
CREATE INDEX IF NOT EXISTS idx_verified_revenues_external_ref
  ON verified_revenues (external_ref) WHERE external_ref IS NOT NULL;

-- Penalty computation ledger (NDPA 2023 s.48). One row per computation event;
-- rows are NEVER updated in place — a recomputation appends a new row with
-- prior_amount pointing at what the fine was, so the appeal record is intact.
CREATE TABLE IF NOT EXISTS penalty_computations (
  id                   BIGSERIAL PRIMARY KEY,
  fine_id              INTEGER REFERENCES enforcement_fines(id) ON DELETE SET NULL,
  org_id               INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  is_dcpmi             BOOLEAN NOT NULL,
  -- Revenue provenance (best-available verified revenue at computation time)
  verified_revenue_id  BIGINT REFERENCES verified_revenues(id) ON DELETE SET NULL,
  revenue_amount       NUMERIC(20, 2),
  revenue_currency     CHAR(3),
  revenue_fiscal_year  INTEGER,
  revenue_source       TEXT                  -- 'firs'|'cac'|'manual_filing'|'none'
                       CHECK (revenue_source IN ('firs', 'cac', 'manual_filing', 'none')),
  -- s.48 formula components
  statutory_floor      NUMERIC(20, 2) NOT NULL,  -- N10,000,000 (DCPMI) / N2,000,000
  revenue_component    NUMERIC(20, 2) NOT NULL,  -- 2% of annual gross revenue (0 when none)
  statutory_cap        NUMERIC(20, 2) NOT NULL,  -- max(floor, revenue_component)
  -- s.48(6) aggravating/mitigating factors and resulting multiplier
  factors              JSONB NOT NULL,           -- structured factor inputs
  factor_contributions JSONB NOT NULL,           -- [{factor, value, weight, points, detail}]
  severity_score       DOUBLE PRECISION NOT NULL
                       CHECK (severity_score >= 0 AND severity_score <= 1),
  multiplier           DOUBLE PRECISION NOT NULL
                       CHECK (multiplier >= 0 AND multiplier <= 1),
  final_amount         NUMERIC(20, 2) NOT NULL CHECK (final_amount >= 0),
  currency             CHAR(3) NOT NULL DEFAULT 'NGN',
  prior_amount         NUMERIC(20, 2),           -- fine amount before recomputation
  breakdown            JSONB NOT NULL,           -- full human-readable breakdown for appeal defence
  computed_by          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_penalty_computations_fine
  ON penalty_computations (fine_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_penalty_computations_org
  ON penalty_computations (org_id, created_at DESC);

-- Audit of every external-integration credential use. credential_fingerprint
-- is the first 12 hex chars of sha256(api_key) so operators can correlate
-- "which configured credential was used" without ever persisting the secret.
CREATE TABLE IF NOT EXISTS integration_credentials_audit (
  id                     BIGSERIAL PRIMARY KEY,
  service                TEXT NOT NULL CHECK (service IN ('firs', 'cac')),
  operation              TEXT NOT NULL,      -- verify_tin | lookup_filed_revenue | lookup_rc_number
  endpoint               TEXT,               -- configured base URL (no query strings / secrets)
  credential_fingerprint TEXT,               -- sha256(api_key)[:12]; NULL when unconfigured
  outcome                TEXT NOT NULL
                         CHECK (outcome IN ('success', 'unconfigured', 'unavailable', 'error')),
  detail                 JSONB NOT NULL DEFAULT '{}',
  actor                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_credentials_audit_service
  ON integration_credentials_audit (service, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_credentials_audit_outcome
  ON integration_credentials_audit (outcome) WHERE outcome <> 'success';
