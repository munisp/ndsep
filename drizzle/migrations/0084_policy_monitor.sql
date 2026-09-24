-- Migration 0084: Privacy-policy change monitor (NDPA 2023 ss. 34-35 —
-- transparency / privacy-notice obligations; material adverse changes to a
-- controller's privacy notice are a supervision trigger).
--
-- Tables backing workers/python/policy_monitor_worker.py and
-- server/routers/policyMonitor.ts:
--
--   monitored_policies  registry of controller privacy-policy URLs polled
--                       on a schedule.
--   policy_versions     one row per distinct content hash observed: raw
--                       normalized text (for diffing), heuristic + LLM
--                       semantic-diff classification, and an explicit
--                       retry queue for when the LLM worker is
--                       UNCONFIGURED/unreachable (never silently dropped).
--   policy_reviews      officer review-task queue for material changes:
--                       assign → decide → escalate to investigation, with
--                       controller-notification tracking.
--
-- Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS monitored_policies (
  id                   BIGSERIAL PRIMARY KEY,
  organization_id      INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  controller_name      TEXT NOT NULL,
  policy_url           TEXT NOT NULL UNIQUE,
  enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  check_interval_hours INTEGER NOT NULL DEFAULT 24 CHECK (check_interval_hours BETWEEN 1 AND 8760),
  last_checked_at      TIMESTAMPTZ,
  next_check_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_content_hash    CHAR(64),
  last_http_status     INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,
  notes                TEXT,
  created_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monitored_policies_due
  ON monitored_policies (next_check_at) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_monitored_policies_org
  ON monitored_policies (organization_id);

CREATE TABLE IF NOT EXISTS policy_versions (
  id                   BIGSERIAL PRIMARY KEY,
  policy_id            BIGINT NOT NULL REFERENCES monitored_policies(id) ON DELETE CASCADE,
  content_hash         CHAR(64) NOT NULL,          -- sha256 of normalized text
  fetched_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  http_status          INTEGER,
  content_length       INTEGER,
  content_text         TEXT,                       -- normalized visible text (diff input)
  -- classification of the change vs the previous version:
  change_classification TEXT NOT NULL DEFAULT 'pending'
                       CHECK (change_classification IN
                         ('pending', 'none', 'minor',
                          'material_neutral', 'material_beneficial', 'material_adverse')),
  diff_status          TEXT NOT NULL DEFAULT 'pending'
                       CHECK (diff_status IN
                         ('pending', 'completed', 'UNCONFIGURED', 'failed')),
  diff_summary         TEXT,
  diff_detail          JSONB NOT NULL DEFAULT '{}', -- heuristic stats + LLM rationale
  retry_count          INTEGER NOT NULL DEFAULT 0,
  next_retry_at        TIMESTAMPTZ,                 -- LLM retry queue (never dropped)
  classifier           TEXT,                        -- 'ollama:<model>' | 'heuristic' | NULL
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (policy_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_policy_versions_policy
  ON policy_versions (policy_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_policy_versions_retry
  ON policy_versions (next_retry_at)
  WHERE diff_status IN ('UNCONFIGURED', 'failed', 'pending');

CREATE TABLE IF NOT EXISTS policy_reviews (
  id               BIGSERIAL PRIMARY KEY,
  policy_id        BIGINT NOT NULL REFERENCES monitored_policies(id) ON DELETE CASCADE,
  version_id       BIGINT NOT NULL REFERENCES policy_versions(id) ON DELETE CASCADE,
  priority         TEXT NOT NULL DEFAULT 'medium'
                   CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  status           TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN
                     ('open', 'assigned', 'in_progress', 'decided',
                      'escalated', 'closed')),
  assigned_to      TEXT,
  assigned_by      TEXT,
  assigned_at      TIMESTAMPTZ,
  decision         TEXT CHECK (decision IN ('upheld', 'dismissed', 'referred')),
  decision_notes   TEXT,
  decided_by       TEXT,
  decided_at       TIMESTAMPTZ,
  escalated_to_investigation BOOLEAN NOT NULL DEFAULT FALSE,
  escalation_reason TEXT,
  escalated_by     TEXT,
  escalated_at     TIMESTAMPTZ,
  controller_notified BOOLEAN NOT NULL DEFAULT FALSE,
  controller_notified_at TIMESTAMPTZ,
  controller_notified_by TEXT,
  notification_channel TEXT,                     -- 'in_app' | 'email' | 'letter'
  notification_reference TEXT,
  created_by       TEXT,                          -- 'policy-monitor-worker' for auto-created tasks
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_policy_reviews_queue
  ON policy_reviews (status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_policy_reviews_policy
  ON policy_reviews (policy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_policy_reviews_assignee
  ON policy_reviews (assigned_to) WHERE status IN ('assigned', 'in_progress');
