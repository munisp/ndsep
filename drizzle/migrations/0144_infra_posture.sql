-- Migration 0144: infrastructure posture scanning (round 13, W3 / P0.3).
--
-- OSIRIS RECON port/CVE/SSL scans of compliance-scanning targets (registered
-- controllers' web infrastructure) feed the EXISTING compliance-scanning
-- findings pipeline and supervision risk:
--
--   1. scan_findings.finding_type CHECK gains 'infra_posture' so posture
--      findings share the same lifecycle statuses, dashboards and the
--      dual-control suppression workflow (migration 0083) as crawler
--      findings. The constraint is dropped and re-added (NOT VALID first is
--      not needed: existing rows all satisfy the widened set).
--   2. infra_posture_runs: scan-run bookkeeping — one row per posture sweep
--      of a target: scanner availability (fail-closed record when OSIRIS
--      RECON is unreachable / OSIRIS_SCANNER_KEY unset), findings count and
--      duration. scan_run_id links to the scan_runs row the findings hang
--      off (scan_findings.run_id is NOT NULL).
--
-- Consumed by server/services/infraPostureScan.ts.
-- Idempotent: safe to re-run. PostgreSQL only.

-- ─── 1. Widen scan_findings.finding_type CHECK ──────────────────────────────
ALTER TABLE scan_findings
  DROP CONSTRAINT IF EXISTS scan_findings_finding_type_check;

ALTER TABLE scan_findings
  ADD CONSTRAINT scan_findings_finding_type_check
  CHECK (finding_type IN
    ('pre_consent_tracker', 'missing_consent_banner',
     'cookie_before_consent',
     'dark_pattern_preticked', 'dark_pattern_asymmetric_choice',
     'dark_pattern_forced_account',
     'tracker_detected', 'fetch_error',
     'infra_posture'));

-- ─── 2. Posture scan-run bookkeeping ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS infra_posture_runs (
  id                  BIGSERIAL PRIMARY KEY,
  target_id           BIGINT NOT NULL REFERENCES scan_targets(id) ON DELETE CASCADE,
  scan_run_id         BIGINT REFERENCES scan_runs(id) ON DELETE SET NULL,
  host                TEXT NOT NULL,
  scanner_available   BOOLEAN NOT NULL,        -- FALSE = fail-closed, no findings written
  scanner_key_present BOOLEAN NOT NULL,        -- OSIRIS_SCANNER_KEY configured at scan time
  findings_count      INTEGER NOT NULL DEFAULT 0,
  duration_ms         INTEGER,
  error               TEXT,                    -- unavailability / failure reason
  result              JSONB NOT NULL DEFAULT '{}', -- severity + evidence summary (ok runs)
  created_by          TEXT,                    -- officer ref; NULL for scheduled sweeps
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_infra_posture_runs_target
  ON infra_posture_runs (target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_infra_posture_runs_availability
  ON infra_posture_runs (scanner_available, created_at DESC);
