-- Migration: Adverse-media / OSINT intelligence feed (FEAT-E, round 9)
-- Configurable news/RSS/breach-disclosure sources ingested by
-- workers/python/adverse_media_worker.py. Items are deduped by URL hash,
-- triaged (ollama when configured; keyword classifier otherwise, explicitly
-- labelled), matched against the organizations registry, and once confirmed
-- by an analyst are promoted into supervision_risk_signals, the shared
-- signals table other routers (supervision, analytics) read.
-- Idempotent: safe to re-run.

-- ─── Feed sources (admin-managed; seeded with neutral, disabled slots) ─────
CREATE TABLE IF NOT EXISTS adverse_media_sources (
  id                 SERIAL PRIMARY KEY,
  source_key         VARCHAR(64) NOT NULL UNIQUE,
  name               VARCHAR(256) NOT NULL,
  source_type        VARCHAR(32) NOT NULL
    CHECK (source_type IN ('rss', 'news_api', 'breach_disclosure')),
  feed_url           TEXT,                                -- NULL until configured
  enabled            BOOLEAN NOT NULL DEFAULT FALSE,
  poll_interval_minutes INTEGER NOT NULL DEFAULT 60 CHECK (poll_interval_minutes >= 5),
  retention_days     INTEGER NOT NULL DEFAULT 365 CHECK (retention_days >= 30),
  last_polled_at     TIMESTAMPTZ,
  last_status        VARCHAR(32) NOT NULL DEFAULT 'UNCONFIGURED'
    CHECK (last_status IN ('UNCONFIGURED', 'ok', 'fetch_error', 'parse_error', 'disabled')),
  last_error         TEXT,
  config             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by         VARCHAR(256),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Neutral seeded source SLOTS: disabled, no feed_url, UNCONFIGURED status.
-- The worker fails closed on any source without a feed_url; admins attach
-- real feeds via the source CRUD endpoints.
INSERT INTO adverse_media_sources (source_key, name, source_type, created_by)
VALUES
  ('slot_news_rss_1', 'News RSS source slot 1', 'rss', 'system-seed'),
  ('slot_news_rss_2', 'News RSS source slot 2', 'rss', 'system-seed'),
  ('slot_news_api_1', 'News API source slot 1', 'news_api', 'system-seed'),
  ('slot_breach_disclosure_1', 'Breach disclosure source slot 1', 'breach_disclosure', 'system-seed'),
  ('slot_breach_disclosure_2', 'Breach disclosure source slot 2', 'breach_disclosure', 'system-seed')
ON CONFLICT (source_key) DO NOTHING;

-- ─── Feed items (dedupe by URL hash) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS adverse_media_items (
  id                 BIGSERIAL PRIMARY KEY,
  source_id          INTEGER NOT NULL REFERENCES adverse_media_sources(id),
  url                TEXT,
  url_hash           VARCHAR(64) NOT NULL UNIQUE,          -- sha256(normalised url or title+published_at)
  title              VARCHAR(512) NOT NULL,
  summary            TEXT,
  published_at       TIMESTAMPTZ,
  fetched_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  severity           VARCHAR(16) NOT NULL DEFAULT 'info'
    CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  -- triage_method is an honesty label: 'ollama' when the LLM worker triaged
  -- the item, 'keyword' for the deterministic fallback classifier, 'manual'
  -- when an analyst set severity by hand.
  triage_method      VARCHAR(16) NOT NULL DEFAULT 'keyword'
    CHECK (triage_method IN ('ollama', 'keyword', 'manual')),
  triage_label       VARCHAR(64),                          -- e.g. data_breach|sanction|insolvency|lawsuit|other
  review_status      VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'confirmed', 'rejected')),
  reviewed_by        VARCHAR(256),
  reviewed_at        TIMESTAMPTZ,
  review_note        TEXT,
  retention_expires_at TIMESTAMPTZ,                        -- fetched_at + source.retention_days
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adverse_media_items_review
  ON adverse_media_items (review_status, severity, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_adverse_media_items_source
  ON adverse_media_items (source_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_adverse_media_items_retention
  ON adverse_media_items (retention_expires_at)
  WHERE review_status <> 'confirmed';

-- ─── Entity matches against the organizations registry ──────────────────────
CREATE TABLE IF NOT EXISTS adverse_media_entity_matches (
  id              BIGSERIAL PRIMARY KEY,
  item_id         BIGINT NOT NULL REFERENCES adverse_media_items(id) ON DELETE CASCADE,
  organization_id INTEGER REFERENCES organizations(id),
  matched_name    VARCHAR(256) NOT NULL,                   -- surface form found in text
  match_method    VARCHAR(16) NOT NULL
    CHECK (match_method IN ('exact', 'alias', 'fuzzy')),
  confidence      NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status          VARCHAR(16) NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested', 'confirmed', 'rejected')),
  confirmed_by    VARCHAR(256),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_adverse_media_matches_org
  ON adverse_media_entity_matches (organization_id, status);

-- ─── Supervision risk signals (shared, read by other routers) ───────────────
-- Written by adverseMedia (and future intelligence features); supervision /
-- analytics routers consume rows with status='open'.
CREATE TABLE IF NOT EXISTS supervision_risk_signals (
  id              BIGSERIAL PRIMARY KEY,
  signal_type     VARCHAR(48) NOT NULL,                    -- adverse_media|...
  organization_id INTEGER REFERENCES organizations(id),
  source_table    VARCHAR(64) NOT NULL,                    -- provenance pointer
  source_id       BIGINT NOT NULL,
  severity        VARCHAR(16) NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  title           VARCHAR(512) NOT NULL,
  summary         TEXT,
  status          VARCHAR(16) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'closed')),
  acknowledged_by VARCHAR(256),
  acknowledged_at TIMESTAMPTZ,
  created_by      VARCHAR(256),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_table, source_id, signal_type)            -- idempotent promotion
);

CREATE INDEX IF NOT EXISTS idx_supervision_risk_signals_org
  ON supervision_risk_signals (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_supervision_risk_signals_open
  ON supervision_risk_signals (status, severity)
  WHERE status = 'open';
