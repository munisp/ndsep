-- Migration 0134: case_embedding_watermarks — incremental case-similarity indexing.
--
-- Round 12 Wave 6 (roadmap §4.3: case-similarity retrieval). The Python
-- worker workers/python/case_embedder_worker.py embeds the Commission's own
-- CLOSED/decided cases (resolved/closed public_complaints, settled/closed
-- enforcement_cases, fulfilled/defaulted settlements, decided
-- tribunal_escalations) into the Qdrant collection `ndsep_cases`, after
-- building a redacted text card per case (no raw data-subject or respondent
-- PII — names, emails, MSISDN, NIN/BVN are stripped/HMAC-masked).
--
-- Incrementality is watermark-based: one row per source table recording the
-- highest source row id embedded so far. The worker processes rows with
-- id > last_id in ascending order and advances the watermark only after a
-- successful Qdrant upsert, so crashes are safe to retry (upserts are
-- idempotent on the deterministic point id).
--
--   source_table  one of: public_complaints, enforcement_cases,
--                 settlements, tribunal_escalations
--   last_id       highest source row id embedded (text — sources mix
--                 BIGSERIAL and SERIAL ids; compared via ::bigint casts)
--   last_run_at   last time the worker completed a pass over the source
--
-- Idempotent: IF NOT EXISTS throughout. PostgreSQL only.

CREATE TABLE IF NOT EXISTS case_embedding_watermarks (
  source_table text PRIMARY KEY,
  last_id      text NOT NULL DEFAULT '0',
  last_run_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed one row per known source so operators can see all sources at a glance.
INSERT INTO case_embedding_watermarks (source_table) VALUES
  ('public_complaints'),
  ('enforcement_cases'),
  ('settlements'),
  ('tribunal_escalations')
ON CONFLICT (source_table) DO NOTHING;
