-- Migration 0146: osiris_intel_feeds — OSIRIS GDELT + live-news adverse-media
-- candidate feeds.
--
-- Round 13 P1.5. Wires OSIRIS's GDELT events layer (GET /api/gdelt — geocoded
-- events) and its 23-broadcaster live-news layer (GET /api/news — broadcast
-- headlines) into the adverse-media pipeline as adverse-media candidate
-- sources via workers/python/gdelt_adverse_media_worker.py.
--
-- Tables:
--   osiris_intel_watermarks   per-source poll watermarks (high-water marks on
--                             source-native ids) so the worker resumes without
--                             re-scanning history, plus last_run_at and the
--                             last-cycle stats blob for the osirisIntelFeed
--                             router's feedStatus view.
--
-- Items themselves are ingested via the EXISTING adverse-media path
-- (adverse_media_items / adverse_media_entity_matches, migration 0112) under
-- the seeded source_key='osiris_gdelt' / 'osiris_news' source rows below.
-- Dedup by source-native id is enforced through adverse_media_items.url_hash
-- (worker derives url_hash = sha256('<source_key>://<native_id>')).
--
-- Index needs: adverse_media_items has NO source_key column — source slicing
-- joins through adverse_media_sources (whose source_key is already UNIQUE)
-- on adverse_media_items.source_id, already covered by
-- idx_adverse_media_items_source (source_id, fetched_at DESC) from migration
-- 0112. No additional index is required; none is added.
--
-- The seeded adverse_media_sources rows stay enabled=FALSE forever: the
-- worker polls OSIRIS itself and maintains last_status / last_polled_at on
-- these rows for observability; the round-9 adverse-media worker must never
-- treat them as RSS/API sources.
--
-- Idempotent: IF NOT EXISTS / ON CONFLICT DO NOTHING. PostgreSQL only.

CREATE TABLE IF NOT EXISTS osiris_intel_watermarks (
  source       TEXT PRIMARY KEY,                -- 'osiris_gdelt' | 'osiris_news'
  last_seen_id TEXT,                            -- high-water mark: latest source-native id
  last_run_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stats        JSONB NOT NULL DEFAULT '{}'::jsonb -- last-cycle per-source stats
);

-- Seeded adverse-media source rows for the existing ingestion path. Disabled:
-- ingestion is performed by workers/python/gdelt_adverse_media_worker.py,
-- which patches last_status / last_polled_at on these rows directly.
INSERT INTO adverse_media_sources (source_key, name, source_type, enabled, created_by, config)
VALUES (
  'osiris_gdelt',
  'OSIRIS GDELT geocoded events feed',
  'news_api',
  FALSE,
  'system-seed',
  '{"managed_by": "gdelt_adverse_media_worker", "feed": "osiris:/api/gdelt"}'::jsonb
)
ON CONFLICT (source_key) DO NOTHING;

INSERT INTO adverse_media_sources (source_key, name, source_type, enabled, created_by, config)
VALUES (
  'osiris_news',
  'OSIRIS 23-broadcaster live-news feed',
  'news_api',
  FALSE,
  'system-seed',
  '{"managed_by": "gdelt_adverse_media_worker", "feed": "osiris:/api/news"}'::jsonb
)
ON CONFLICT (source_key) DO NOTHING;
