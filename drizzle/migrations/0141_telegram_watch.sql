-- Migration 0141: telegram_watch — OSIRIS Telegram breach early-warning feed.
--
-- Round 13 P0.1. Wires OSIRIS's Telegram OSINT layer (public-channel posts
-- scraped from t.me/s/<channel> previews, geoparsed) into the adverse-media
-- pipeline as a breach early-warning source.
--
-- Tables:
--   telegram_watch_items      one row per matched OSIRIS Telegram post; the
--                             raw text is stored ONLY after PII redaction
--                             (emails/MSISDN/NIN masked with keyed HMAC, same
--                             convention as case_embedder_worker.redact_pii).
--                             Each matched post is ALSO ingested into
--                             adverse_media_items under the seeded
--                             source_key='osiris_telegram' source; this table
--                             carries the watch-specific review state and a
--                             stable prediction_id used by decision_feedback
--                             (surface='telegram_watch') when staff confirm /
--                             reject a signal.
--   breach_lag_signals        breach_notification_overdue signals: a matched
--                             post names a registered entity but no breach
--                             self-report (breach_incidents row) exists within
--                             72h of the post timestamp.
--   telegram_watch_watermarks per-channel poll watermarks so the worker
--                             resumes without re-scanning history.
--
-- The seeded adverse_media_sources row stays enabled=FALSE forever: the
-- telegram watch worker polls OSIRIS itself and maintains last_status /
-- last_polled_at on this row for observability; the round-9 adverse-media
-- worker must never treat it as an RSS source.
--
-- Idempotent: IF NOT EXISTS / ON CONFLICT DO NOTHING. PostgreSQL only.

CREATE TABLE IF NOT EXISTS telegram_watch_items (
  id                   BIGSERIAL PRIMARY KEY,
  post_id              TEXT NOT NULL,                    -- OSIRIS post id
  channel              TEXT NOT NULL,                    -- telegram channel handle
  post_ts              TIMESTAMPTZ,                      -- post timestamp (NULL if unparseable)
  post_url             TEXT,                             -- t.me provenance URL
  text_redacted        TEXT NOT NULL,                    -- PII-redacted post text
  geo                  JSONB,                            -- {lat,lng,place} | NULL
  classifier           JSONB NOT NULL DEFAULT '{}'::jsonb, -- {keywords, method, confidence}
  severity             VARCHAR(16) NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  adverse_media_item_id BIGINT REFERENCES adverse_media_items(id) ON DELETE SET NULL,
  status               VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'rejected')),
  reviewed_by          VARCHAR(256),
  reviewed_at          TIMESTAMPTZ,
  review_note          TEXT,
  prediction_id        uuid NOT NULL DEFAULT gen_random_uuid(), -- decision_feedback key
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel, post_id)                              -- dedupe by post id
);

CREATE INDEX IF NOT EXISTS idx_telegram_watch_items_status
  ON telegram_watch_items (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_watch_items_post_ts
  ON telegram_watch_items (post_ts DESC);

CREATE TABLE IF NOT EXISTS breach_lag_signals (
  id                     BIGSERIAL PRIMARY KEY,
  signal_type            VARCHAR(48) NOT NULL DEFAULT 'breach_notification_overdue'
    CHECK (signal_type IN ('breach_notification_overdue')),
  organization_id        INTEGER NOT NULL REFERENCES organizations(id),
  telegram_watch_item_id BIGINT NOT NULL REFERENCES telegram_watch_items(id) ON DELETE CASCADE,
  post_ts                TIMESTAMPTZ NOT NULL,
  notification_deadline  TIMESTAMPTZ NOT NULL,           -- post_ts + 72h (NDPA 72-hour rule)
  status                 VARCHAR(16) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved')),
  acknowledged_by        VARCHAR(256),
  acknowledged_at        TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, telegram_watch_item_id)       -- idempotent detection
);

CREATE INDEX IF NOT EXISTS idx_breach_lag_signals_open
  ON breach_lag_signals (status, notification_deadline)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_breach_lag_signals_org
  ON breach_lag_signals (organization_id, status);

CREATE TABLE IF NOT EXISTS telegram_watch_watermarks (
  channel      TEXT PRIMARY KEY,
  last_post_id TEXT,
  last_post_ts TIMESTAMPTZ,
  last_run_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stats        JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Seeded adverse-media source row for the existing ingestion path. Disabled:
-- ingestion is performed by workers/python/telegram_breach_watch_worker.py,
-- which patches last_status / last_polled_at on this row directly.
INSERT INTO adverse_media_sources (source_key, name, source_type, enabled, created_by, config)
VALUES (
  'osiris_telegram',
  'OSIRIS Telegram breach early-warning feed',
  'breach_disclosure',
  FALSE,
  'system-seed',
  '{"managed_by": "telegram_breach_watch_worker", "feed": "osiris:/api/telegram-feed"}'::jsonb
)
ON CONFLICT (source_key) DO NOTHING;
