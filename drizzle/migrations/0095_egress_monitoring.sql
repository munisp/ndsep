-- Migration 0095: Data sovereignty — egress monitoring & residency violations.
--
-- Tables backing workers/python/egress_monitor_worker.py (writer) and
-- server/routers/dataSovereignty.ts (read surface + manual workflow):
--
--   egress_flow_rollups        5-minute per-entity egress aggregates derived
--                              from Kafka topic `netflow.egress` by the egress
--                              monitor worker: total vs foreign vs domestic
--                              bytes/flows and the foreign-egress ratio.
--   residency_violations       auto (worker: threshold breach / Poisson
--                              change-point shift) and manual (analyst)
--                              localisation violations with a status machine:
--                              detected -> acknowledged -> under_remediation
--                              -> resolved | dismissed.
--   egress_thresholds          configurable per-entity (or global, entity_ref
--                              IS NULL) enforcement thresholds. Admin-editable;
--                              the worker reloads them each cycle.
--   cross_regulator_referrals  CBN <-> NDPC case handoff records for
--                              violations that implicate both mandates
--                              (data localisation is CBN; personal-data
--                              transfer is NDPC).
--
-- Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS egress_flow_rollups (
  id                       BIGSERIAL PRIMARY KEY,
  entity_ref               TEXT NOT NULL,
  window_start             TIMESTAMPTZ NOT NULL,   -- 5-minute aligned
  window_end               TIMESTAMPTZ NOT NULL,
  total_flows              BIGINT NOT NULL DEFAULT 0,
  total_bytes              BIGINT NOT NULL DEFAULT 0,
  domestic_flows           BIGINT NOT NULL DEFAULT 0,
  domestic_bytes           BIGINT NOT NULL DEFAULT 0,
  foreign_flows            BIGINT NOT NULL DEFAULT 0,
  foreign_bytes            BIGINT NOT NULL DEFAULT 0,
  unknown_flows            BIGINT NOT NULL DEFAULT 0,  -- unclassifiable destinations (counted neither way)
  unknown_bytes            BIGINT NOT NULL DEFAULT 0,
  foreign_ratio            DOUBLE PRECISION NOT NULL DEFAULT 0
                           CHECK (foreign_ratio >= 0 AND foreign_ratio <= 1),
  top_foreign_destinations JSONB NOT NULL DEFAULT '[]', -- [{dst, bytes, flows, classification}] top 10
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT egress_rollup_window_order CHECK (window_end > window_start),
  CONSTRAINT egress_rollup_entity_window_uq UNIQUE (entity_ref, window_start)
);

CREATE INDEX IF NOT EXISTS idx_egress_rollups_entity_window
  ON egress_flow_rollups (entity_ref, window_start DESC);
CREATE INDEX IF NOT EXISTS idx_egress_rollups_window
  ON egress_flow_rollups (window_start DESC);

CREATE TABLE IF NOT EXISTS residency_violations (
  id                BIGSERIAL PRIMARY KEY,
  entity_ref        TEXT NOT NULL,
  violation_type    TEXT NOT NULL
                    CHECK (violation_type IN
                      ('foreign_egress_threshold',   -- ratio/bytes breach of egress_thresholds
                       'egress_changepoint_shift',   -- Poisson change-point: step up in foreign egress
                       'undeclared_hosting',         -- observed destination not in approved declaration
                       'key_custody_foreign',
                       'backup_foreign',
                       'admin_access_foreign',
                       'attestation_expired',
                       'manual')),
  source            TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  severity          TEXT NOT NULL DEFAULT 'medium'
                    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status            TEXT NOT NULL DEFAULT 'detected'
                    CHECK (status IN
                      ('detected', 'acknowledged', 'under_remediation',
                       'resolved', 'dismissed')),
  details           JSONB NOT NULL DEFAULT '{}',   -- evidence: window, ratio, threshold, changepoint stats
  detected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_by   TEXT,
  acknowledged_at   TIMESTAMPTZ,
  resolved_by       TEXT,
  resolved_at       TIMESTAMPTZ,
  resolution_notes  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_residency_violations_entity
  ON residency_violations (entity_ref, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_residency_violations_status
  ON residency_violations (status, severity, detected_at DESC);
-- One open auto-violation per (entity, type): the worker checks this before
-- inserting so a sustained breach does not flood the register.
CREATE INDEX IF NOT EXISTS idx_residency_violations_open
  ON residency_violations (entity_ref, violation_type)
  WHERE status IN ('detected', 'acknowledged', 'under_remediation');

CREATE TABLE IF NOT EXISTS egress_thresholds (
  id                              BIGSERIAL PRIMARY KEY,
  entity_ref                      TEXT,                -- NULL = global default row
  max_foreign_ratio               DOUBLE PRECISION NOT NULL DEFAULT 0.05
                                  CHECK (max_foreign_ratio >= 0 AND max_foreign_ratio <= 1),
  max_foreign_bytes_per_window    BIGINT NOT NULL DEFAULT 104857600, -- 100 MiB / 5-min window
  changepoint_probability_min     DOUBLE PRECISION NOT NULL DEFAULT 0.95
                                  CHECK (changepoint_probability_min > 0.5 AND changepoint_probability_min <= 1),
  changepoint_min_rate_ratio      DOUBLE PRECISION NOT NULL DEFAULT 3.0, -- lam2/lam1 must exceed this
  window_minutes                  INTEGER NOT NULL DEFAULT 5 CHECK (window_minutes BETWEEN 1 AND 60),
  in_scope_only                   BOOLEAN NOT NULL DEFAULT TRUE, -- enforce only on CBN-scope entities
  enabled                         BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by                      TEXT,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly one global default row and at most one row per entity.
CREATE UNIQUE INDEX IF NOT EXISTS egress_thresholds_global_uq
  ON egress_thresholds ((1)) WHERE entity_ref IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS egress_thresholds_entity_uq
  ON egress_thresholds (entity_ref) WHERE entity_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS cross_regulator_referrals (
  id                  BIGSERIAL PRIMARY KEY,
  entity_ref          TEXT NOT NULL,
  violation_id        BIGINT REFERENCES residency_violations(id) ON DELETE SET NULL,
  referring_authority TEXT NOT NULL CHECK (referring_authority IN ('NDPC', 'CBN')),
  receiving_authority TEXT NOT NULL CHECK (receiving_authority IN ('NDPC', 'CBN')),
  case_summary        TEXT NOT NULL,
  legal_basis         TEXT,                        -- e.g. 'CBN Circular PSS/DIR/PUB/CIR/001/004', 'NDPA 2023 s.41'
  evidence_refs       JSONB NOT NULL DEFAULT '[]', -- [{type, ref, hash}]
  status              TEXT NOT NULL DEFAULT 'referred'
                      CHECK (status IN
                        ('referred', 'received', 'under_joint_review',
                         'actioned', 'closed', 'returned')),
  referred_by         TEXT NOT NULL,               -- officer ref at referring authority
  referred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_by         TEXT,
  received_at         TIMESTAMPTZ,
  outcome_notes       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT referral_distinct_authorities CHECK (referring_authority <> receiving_authority)
);

CREATE INDEX IF NOT EXISTS idx_referrals_entity
  ON cross_regulator_referrals (entity_ref, referred_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_status
  ON cross_regulator_referrals (status, receiving_authority);

-- Seed the global default threshold row (idempotent).
INSERT INTO egress_thresholds (entity_ref, updated_by)
SELECT NULL, 'migration-0095'
WHERE NOT EXISTS (SELECT 1 FROM egress_thresholds WHERE entity_ref IS NULL);
