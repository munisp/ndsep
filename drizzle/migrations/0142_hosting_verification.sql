-- Migration 0142: Hosting-declaration verification (Round-13 P0.2).
--
-- Evidence-based verification of hosting declarations: OSIRIS RECON
-- (DNS resolution, IP geolocation/ASN, SSL/TLS inspection) is used to
-- independently verify that declared in-Nigeria infrastructure actually
-- resolves to the 422 verified Nigerian IPv4 prefixes / verified NG ASNs
-- seeded by migration 0120 (asn_geo_reference, provenance-stamped,
-- RIPEstat AFRINIC data).
--
-- Regulatory driver: CBN Circular PSS/DIR/PUB/CIR/001/004 — payment data
-- must be hosted in Nigeria by 2027-01-01. Self-declared hosting posture
-- (hosting_declarations, migration 0094) is not evidence; these tables
-- persist the independent verification trail.
--
-- Tables backing server/services/hostingVerification.ts and
-- server/routers/hostingVerification.ts:
--
--   hosting_verification_runs    one row per verification run of a
--                                declaration. Aggregate verdict:
--                                  compliant   — every extracted host in_nigeria
--                                  violation   — any host outside_nigeria
--                                  unverified  — any unverified (and none
--                                                outside) or nothing to check.
--                                FAIL-CLOSED: missing recon evidence can
--                                never produce 'compliant'.
--                                prediction_id links a violation flag to its
--                                decision_feedback baseline (surface
--                                'hosting_verification') for human
--                                confirm/reject outcomes.
--   hosting_verification_hosts   per-host verdicts + evidence jsonb
--                                (resolved IPs, matched NG prefix, ASN,
--                                cert summary, checked_at).
--
-- Idempotent: IF NOT EXISTS guards throughout. PostgreSQL only.

CREATE TABLE IF NOT EXISTS hosting_verification_runs (
  id                     BIGSERIAL PRIMARY KEY,
  declaration_id         BIGINT NOT NULL REFERENCES hosting_declarations(id) ON DELETE CASCADE,
  entity_ref             TEXT NOT NULL,               -- denormalised for queue queries
  verdict                TEXT NOT NULL
                         CHECK (verdict IN ('compliant', 'violation', 'unverified')),
  trigger                TEXT NOT NULL DEFAULT 'manual'
                         CHECK (trigger IN ('manual', 'scheduled')),
  host_count             INTEGER NOT NULL DEFAULT 0,
  in_nigeria_count       INTEGER NOT NULL DEFAULT 0,
  outside_nigeria_count  INTEGER NOT NULL DEFAULT 0,
  unverified_count       INTEGER NOT NULL DEFAULT 0,
  evidence               JSONB NOT NULL DEFAULT '{}', -- run-level summary (host verdict rollup, notes)
  prediction_id          UUID,                        -- decision_feedback baseline for violation flags
  checked_by             TEXT NOT NULL DEFAULT 'system',
  checked_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hv_runs_declaration
  ON hosting_verification_runs (declaration_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_hv_runs_verdict
  ON hosting_verification_runs (verdict, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_hv_runs_entity
  ON hosting_verification_runs (entity_ref, checked_at DESC);

CREATE TABLE IF NOT EXISTS hosting_verification_hosts (
  id              BIGSERIAL PRIMARY KEY,
  run_id          BIGINT NOT NULL REFERENCES hosting_verification_runs(id) ON DELETE CASCADE,
  declaration_id  BIGINT NOT NULL REFERENCES hosting_declarations(id) ON DELETE CASCADE,
  host            TEXT NOT NULL,                -- declared domain/hostname or IP literal
  host_kind       TEXT NOT NULL CHECK (host_kind IN ('domain', 'ip')),
  resolved_ips    JSONB NOT NULL DEFAULT '[]',  -- ['41.58.0.1', ...]
  verdict         TEXT NOT NULL
                  CHECK (verdict IN ('in_nigeria', 'outside_nigeria', 'unverified')),
  evidence        JSONB NOT NULL DEFAULT '{}',  -- {ips:[{ip,prefix,asn,country,org}], dns_source, cert:{...}, notes}
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hv_hosts_run
  ON hosting_verification_hosts (run_id);
CREATE INDEX IF NOT EXISTS idx_hv_hosts_verdict
  ON hosting_verification_hosts (verdict, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_hv_hosts_declaration
  ON hosting_verification_hosts (declaration_id, checked_at DESC);
