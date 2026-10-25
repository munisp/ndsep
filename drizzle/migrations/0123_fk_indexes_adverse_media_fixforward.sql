-- Migration 0123: fix-forward FK index for adverse_media_entity_matches
-- ============================================================================
-- Round-10 real-Postgres validation found that 0097_fk_indexes.sql created
-- idx_adverse_media_entity_matches_item_id, but the table
-- adverse_media_entity_matches is only created later by
-- 0112_adverse_media.sql — a forward-reference that broke fresh-database
-- applies. 0097 (round-9, never deployed) was minimally patched in place to
-- drop that statement; the index is applied here, after the table exists.
--
-- Idempotent: IF NOT EXISTS. Plain (non-concurrent) index so the file can
-- run inside the migration runner's transaction.

CREATE INDEX IF NOT EXISTS idx_adverse_media_entity_matches_item_id
  ON adverse_media_entity_matches (item_id);
