-- Migration 0139: autonomy_tiers — per-surface graduated-autonomy tier registry.
--
-- Round 12 Wave 9 (roadmap §7, tier-2 graduated autonomy). Tracks, per AI /
-- rule-based surface, the current autonomy tier (1 = suggest-only, 2 =
-- auto-action with undo window, 3 = trusted auto-action), the latest measured
-- acceptance stats from decision_feedback (migration 0127), and the
-- promotion/demotion timestamps used by the tier-3 stability gate.
--
-- Tier transitions are computed by server/services/autonomyTiers.ts
-- (evaluate): tier1→2 at ≥85% decided acceptance over ≥500 suggestions
-- (90-day window), tier2→3 at ≥95% over ≥2000 suggestions AND 30 days stable
-- in tier 2, automatic demotion on regression (<70% decided acceptance over
-- the trailing 200 decisions). Every transition is appended to the anti-wipe
-- audit_ledger (migration 0061). The engine is fail-closed: any evaluation
-- error leaves/returns the surface at tier 1.
--
-- Also extends dual_control_requests.action_type (migration 0080, extended by
-- 0117) with 'autonomy_tier_change' so manual tier overrides queue through
-- the maker-checker queue (two DISTINCT admin approvers, requester may not
-- approve) — tier changes are governance-sensitive.
--
-- Idempotent: IF NOT EXISTS / DROP CONSTRAINT IF EXISTS throughout.
-- PostgreSQL only.

CREATE TABLE IF NOT EXISTS autonomy_tiers (
  surface          text PRIMARY KEY,            -- e.g. 'duplicate_merge', 'scan_findings'
  tier             int NOT NULL DEFAULT 1
                   CHECK (tier BETWEEN 1 AND 3),
  acceptance_rate  numeric,                     -- latest decided acceptance (90-day window)
  suggestion_count int,                         -- latest suggestion count (90-day window)
  promoted_at      timestamptz,                 -- when the current tier was entered
  demoted_at       timestamptz,                 -- most recent regression demotion
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ─── dual_control_requests: 'autonomy_tier_change' action type ──────────────
ALTER TABLE dual_control_requests
  DROP CONSTRAINT IF EXISTS dual_control_requests_action_type_check;
ALTER TABLE dual_control_requests
  ADD CONSTRAINT dual_control_requests_action_type_check
  CHECK (action_type IN
    ('fine_settlement', 'dpco_approval', 'role_grant',
     'vault_sealing_override', 'sanction_publication',
     'autonomy_tier_change'));
