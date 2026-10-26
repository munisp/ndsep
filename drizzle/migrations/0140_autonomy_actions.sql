-- Migration 0140: autonomy_actions — tier-2 auto-actions with undo window.
--
-- Round 12 Wave 9 (roadmap §7). Every action taken autonomously by a tier≥2
-- surface is first parked here as a 'pending_undo' proposal carrying a full
-- before-state snapshot in `payload`; it is only executed once the
-- `undo_deadline` (default 24h) has passed (executeDueAutonomyActions in
-- server/services/autonomyActions.ts). A human can undo within the window
-- (cancels the proposal) or after execution (restores the snapshot) via
-- autonomyGovernance.undoAction.
--
-- Wave-9 action types:
--   merge_proposal   (surface 'duplicate_merge'  — server/services/duplicateMerge.ts)
--   suppress_finding (surface 'scan_findings'    — server/services/falseFindingSuppressor.ts)
--
-- Status machine: pending_undo → executed | undone | expired
--   executed: undo_deadline passed and the action was applied.
--   undone:   a human cancelled/restored it (undone_by records who).
--   expired:  the deadline passed but the action could no longer be applied
--             (e.g. a human merged the complaint first) — fail-closed no-op.
--
-- action_type is intentionally NOT a CHECK-locked enum beyond non-empty so
-- future surfaces can register new types without a fix-forward migration;
-- the status machine IS locked. Idempotent: IF NOT EXISTS. PostgreSQL only.

CREATE TABLE IF NOT EXISTS autonomy_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surface       text NOT NULL,
  action_type   text NOT NULL CHECK (length(action_type) BETWEEN 3 AND 64),
  payload       jsonb NOT NULL,                 -- action params + before-state snapshot
  undo_deadline timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'pending_undo'
                CHECK (status IN ('pending_undo', 'executed', 'undone', 'expired')),
  executed_at   timestamptz,
  undone_by     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_autonomy_actions_pending_due
  ON autonomy_actions (undo_deadline)
  WHERE status = 'pending_undo';

CREATE INDEX IF NOT EXISTS idx_autonomy_actions_surface
  ON autonomy_actions (surface, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_autonomy_actions_status
  ON autonomy_actions (status, created_at DESC);
