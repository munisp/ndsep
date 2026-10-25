-- Migration 0124: fix-forward — citizen_request_status 'resolved'/'closed'
-- ============================================================================
-- Round-10 real-Postgres validation found that
-- 0070_performance_indexes.sql builds the partial index
-- idx_citizen_requests_open_deadline with predicate
--   WHERE status NOT IN ('resolved', 'closed')
-- but the citizen_request_status enum (created in drizzle/0004, extended by
-- drizzle/0009, 0071 and 0103) never contained 'resolved' or 'closed', so
-- the statement failed on a fresh database with:
--   ERROR: invalid input value for enum citizen_request_status: "resolved"
--
-- Policy: migrations 0019-0096 are never rewritten, so this fix-forward adds
-- the two missing enum values. They are inert (no code path writes them;
-- terminal states remain 'completed'/'rejected' per server/routers/
-- enhancements.ts), they simply make the 0070 predicate valid. Ordering is
-- safe: the runner's ORDER_OVERRIDES force 0070 to apply after every other
-- file, so this value exists before 0070 runs.
--
-- Note: ALTER TYPE ... ADD VALUE cannot run inside a transaction that later
-- USES the new value, but 0070 runs as a separate file after this one
-- commits, so that restriction does not apply here.

ALTER TYPE citizen_request_status ADD VALUE IF NOT EXISTS 'resolved';
ALTER TYPE citizen_request_status ADD VALUE IF NOT EXISTS 'closed';
