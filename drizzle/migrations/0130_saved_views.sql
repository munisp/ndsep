-- Migration 0130: saved_views — per-user, per-surface saved filter sets.
--
-- Round 12 Wave 2 (roadmap §5 quick wins). Powers "save this filter set" on
-- the triage queue and Global Search so officers stop rebuilding the same
-- filter combinations every shift.
--
-- Semantics:
--   - Rows are strictly user-scoped: server/routers/savedViews.ts only ever
--     reads/writes rows whose user_id matches the caller.
--   - surface is a free-text surface key (e.g. 'global_search',
--     'complaint_triage'); the unique key (user_id, surface, name) makes
--     view names unique per user per surface.
--   - filters is an opaque jsonb blob owned by the surface UI; the server
--     validates only shape (object) and size, never semantics.
--
-- NOTE on user_id: this platform's users.id is a serial int, so the router
-- maps it to a deterministic pseudonymous uuid (sha256 of a namespaced key,
-- version-5 style — same convention as decision_feedback.actor_id). The
-- column is uuid (not int) so saved views can later be re-homed onto a
-- UUID-keyed identity provider without a migration.
--
-- Idempotent: IF NOT EXISTS throughout. PostgreSQL only.

CREATE TABLE IF NOT EXISTS saved_views (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  surface     text NOT NULL CHECK (length(surface) BETWEEN 1 AND 80),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  filters     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_views_user_surface_name
  ON saved_views (user_id, surface, name);

CREATE INDEX IF NOT EXISTS idx_saved_views_user_surface
  ON saved_views (user_id, surface);
