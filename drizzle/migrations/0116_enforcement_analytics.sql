-- Migration: Enforcement analytics & annual-report generator (FEAT-E, round 9)
-- Analytics are computed live from canonical tables (enforcement_cases,
-- enforcement_fines, settlements, settlement_instalments, public_complaints);
-- this migration only persists generated annual-report snapshots and the
-- scheduled-generation run log (Temporal hook documented in
-- server/services/annualReport.ts). Idempotent: safe to re-run.

-- ─── Annual report snapshots (deterministic from DB; no LLM) ────────────────
CREATE TABLE IF NOT EXISTS annual_report_snapshots (
  id           SERIAL PRIMARY KEY,
  report_year  INTEGER NOT NULL UNIQUE CHECK (report_year >= 2020 AND report_year <= 2100),
  payload      JSONB NOT NULL,                 -- structured KPI payload
  markdown     TEXT NOT NULL,                  -- rendered markdown snapshot
  source_hash  VARCHAR(64) NOT NULL,           -- sha256 of canonical payload JSON
  trigger      VARCHAR(16) NOT NULL DEFAULT 'manual'
    CHECK (trigger IN ('manual', 'scheduled')),
  generated_by VARCHAR(256),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_annual_report_snapshots_year
  ON annual_report_snapshots (report_year DESC);

-- ─── Scheduled-generation run log (graceful-skip auditability) ──────────────
CREATE TABLE IF NOT EXISTS annual_report_runs (
  id          BIGSERIAL PRIMARY KEY,
  report_year INTEGER NOT NULL,
  trigger     VARCHAR(16) NOT NULL
    CHECK (trigger IN ('manual', 'scheduled')),
  status      VARCHAR(16) NOT NULL
    CHECK (status IN ('completed', 'skipped', 'failed')),
  reason      TEXT,                            -- skip/failure reason (explicit, never silent)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_annual_report_runs_year
  ON annual_report_runs (report_year, created_at DESC);
