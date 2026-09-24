-- Migration 0085: Tribunal evidence bundles
--
-- Court-facing export of everything the NDPC holds on an enforcement case:
-- evidence-vault artifact hashes, hash-chain proof segments from the
-- anti-wipe audit ledger (0061), due-process log (notices / response
-- windows / hearings from 0035 + penalty_appeals), filings and
-- determinations. Each bundle carries a manifest JSON with per-artifact
-- SHA-256 digests and a Merkle root (server/services/merkle.ts) that is
-- anchored into the hash-chained audit ledger at seal time.
--
--   tribunal_bundles   one row per assembled bundle; status machine
--                      assembling -> sealed -> exported. Export requires
--                      dual control (two DISTINCT approvers, neither the
--                      requester — mirrors the 0080 dual_control_requests
--                      maker-checker pattern, enforced here by CHECK
--                      constraints + router logic because 0080's action_type
--                      enum is fixed).
--   bundle_artifacts   one row per artifact in the bundle manifest, in
--                      deterministic merkle_index order.
--   bundle_access_log  immutable record of every view / verify / export of
--                      a bundle (court-facing non-repudiation trail).
--                      UPDATE and DELETE are blocked by trigger.
--
-- Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS tribunal_bundles (
  id                    BIGSERIAL PRIMARY KEY,
  case_ref              TEXT NOT NULL,              -- enforcement case reference / id
  status                TEXT NOT NULL DEFAULT 'assembling'
                        CHECK (status IN ('assembling', 'sealed', 'exported')),
  merkle_root           TEXT,                       -- NULL until sealed
  artifact_count        INTEGER NOT NULL DEFAULT 0,
  manifest              JSONB NOT NULL DEFAULT '{}',-- full manifest incl. per-artifact hashes
  ledger_anchor_seq     BIGINT,                     -- audit_ledger.seq where the root was anchored
  ledger_anchor_hash    TEXT,                       -- audit_ledger.entry_hash at anchor
  chain_segment_from    BIGINT,                     -- audit_ledger seq range included as proof
  chain_segment_to      BIGINT,
  assembled_by          TEXT NOT NULL,
  assembled_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sealed_at             TIMESTAMPTZ,
  sealed_by             TEXT,
  -- dual-control export gate (pattern reused from dual_control_requests, 0080):
  export_requested_by   TEXT,
  export_requested_at   TIMESTAMPTZ,
  export_expires_at     TIMESTAMPTZ,
  export_first_approver TEXT,
  export_second_approver TEXT,
  exported_at           TIMESTAMPTZ,
  exported_to           TEXT,                       -- tribunal / court identifier
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- maker-checker invariants at the storage layer:
  CONSTRAINT bundle_export_no_self_first
    CHECK (export_first_approver IS NULL OR export_first_approver <> export_requested_by),
  CONSTRAINT bundle_export_no_self_second
    CHECK (export_second_approver IS NULL OR export_second_approver <> export_requested_by),
  CONSTRAINT bundle_export_distinct
    CHECK (export_second_approver IS NULL OR export_second_approver <> export_first_approver),
  -- export only after sealing; approvals only after an export request
  CONSTRAINT bundle_export_requires_seal
    CHECK (status <> 'exported' OR (merkle_root IS NOT NULL AND sealed_at IS NOT NULL)),
  CONSTRAINT bundle_export_requires_request
    CHECK (export_first_approver IS NULL OR export_requested_by IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_tribunal_bundles_case_ref
  ON tribunal_bundles (case_ref, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tribunal_bundles_status
  ON tribunal_bundles (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tribunal_bundles_merkle_root
  ON tribunal_bundles (merkle_root) WHERE merkle_root IS NOT NULL;

CREATE TABLE IF NOT EXISTS bundle_artifacts (
  id            BIGSERIAL PRIMARY KEY,
  bundle_id     BIGINT NOT NULL REFERENCES tribunal_bundles(id) ON DELETE CASCADE,
  merkle_index  INTEGER NOT NULL,               -- leaf position in the manifest tree
  artifact_type TEXT NOT NULL
                CHECK (artifact_type IN
                  ('evidence', 'ledger_segment', 'due_process',
                   'filing', 'determination', 'manifest')),
  ref           TEXT NOT NULL,                  -- vault hash / ledger seq range / table:id
  sha256        TEXT NOT NULL,                  -- content digest committed to the tree
  size_bytes    BIGINT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bundle_artifacts_sha256_hex
    CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_bundle_artifacts_bundle
  ON bundle_artifacts (bundle_id, merkle_index);
-- One artifact slot per merkle position per bundle.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bundle_artifacts_position
  ON bundle_artifacts (bundle_id, merkle_index);

CREATE TABLE IF NOT EXISTS bundle_access_log (
  id          BIGSERIAL PRIMARY KEY,
  bundle_id   BIGINT NOT NULL REFERENCES tribunal_bundles(id) ON DELETE CASCADE,
  accessor    TEXT NOT NULL,
  action      TEXT NOT NULL
              CHECK (action IN ('assemble', 'view', 'verify', 'export_request',
                                'export_approve', 'export', 'download')),
  verdict     TEXT,                              -- verify outcome: valid | invalid
  detail      JSONB NOT NULL DEFAULT '{}',
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bundle_access_log_bundle
  ON bundle_access_log (bundle_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_bundle_access_log_accessor
  ON bundle_access_log (accessor, accessed_at DESC);

-- Immutability: the access log is a court-facing non-repudiation trail.
-- No row may ever be rewritten or removed (same trigger style as 0060/0061).
CREATE OR REPLACE FUNCTION bundle_access_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'tribunal bundle access log is immutable: % not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bundle_access_log_no_update ON bundle_access_log;
CREATE TRIGGER trg_bundle_access_log_no_update
  BEFORE UPDATE ON bundle_access_log
  FOR EACH ROW EXECUTE FUNCTION bundle_access_log_immutable();

DROP TRIGGER IF EXISTS trg_bundle_access_log_no_delete ON bundle_access_log;
CREATE TRIGGER trg_bundle_access_log_no_delete
  BEFORE DELETE ON bundle_access_log
  FOR EACH ROW EXECUTE FUNCTION bundle_access_log_immutable();
