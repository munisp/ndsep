-- 0108: Scan-finding dedupe support + attestation artifact registry.
--   1. scan_findings gains evidence_hash / last_seen / occurrence_count so the
--      crawler worker can dedupe repeat findings across runs (same target +
--      type + tracker + evidence hash => bump last_seen, no new row).
--   2. attestation_artifacts: registry of uploaded signed-attestation
--      artifacts (sha256) that residency attestations must reference, so the
--      document_hash on an attestation is verified against a real upload.
--   3. residency_attestations.document_ref binds an attestation to its
--      uploaded artifact.
-- Idempotent: safe to re-run. PostgreSQL only.

-- ─── 1. scan_findings dedupe columns ─────────────────────────────────────────
ALTER TABLE scan_findings
  ADD COLUMN IF NOT EXISTS evidence_hash TEXT;
ALTER TABLE scan_findings
  ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE scan_findings
  ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_scan_findings_dedupe
  ON scan_findings (target_id, finding_type, tracker_name, evidence_hash);

-- ─── 2. attestation artifact registry ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attestation_artifacts (
  id BIGSERIAL PRIMARY KEY,
  artifact_ref TEXT NOT NULL UNIQUE,   -- opaque upload reference (object key / vault id)
  entity_ref TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attestation_artifacts_entity
  ON attestation_artifacts (entity_ref, created_at DESC);

-- ─── 3. residency_attestations: artifact binding ────────────────────────────
ALTER TABLE residency_attestations
  ADD COLUMN IF NOT EXISTS document_ref TEXT;
