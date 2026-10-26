# Round 12 — Wave 9: Tier-2 Graduated Autonomy (roadmap §7)

**Status: implemented.** Two safe surfaces now support tier-2 guarded
autonomy — duplicate-complaint merges and false-finding suppression — behind
an acceptance-gated tier engine, a 24-hour undo-window action queue, and a
promotion dashboard whose manual overrides go through the existing
maker-checker dual-control queue. Everything is fail-closed: any evaluation
or execution error leaves the surface at tier 1 (suggest-only) or expires the
proposal without touching state.

## What was delivered

| Artifact | Path |
|---|---|
| Autonomy tier engine (gates, regression demotion, fail-closed evaluate) | `server/services/autonomyTiers.ts` |
| Shared undo-window action queue (handler registry, execute-after-deadline, undo/restore) | `server/services/autonomyActions.ts` |
| Duplicate-merge sweep + merge/undo handlers | `server/services/duplicateMerge.ts` |
| False-finding suppression sweep + handlers | `server/services/falseFindingSuppressor.ts` |
| Governance router (`autonomyGovernanceRouter`) | `server/routers/autonomyGovernance.ts` |
| Tier registry migration (sqlglot-validated, postgres) | `drizzle/migrations/0139_autonomy_tiers.sql` |
| Undo-window action queue migration (sqlglot-validated) | `drizzle/migrations/0140_autonomy_actions.sql` |
| Drizzle schema extension (integrator merges into main schema) | `drizzle/schema_ext/autonomyTiers.ts` |
| Promotion dashboard page + route `/autonomy-governance` | `client/src/pages/AutonomyGovernance.tsx`, `client/src/App.tsx` |
| Tests (vitest) — **34 tests, all passing** | `server/routers/__tests__/autonomyGovernance.test.ts` |

## Design notes

### 1. Tier engine (`autonomyTiers.ts`)

Per-surface registry row in `autonomy_tiers` (migration 0139). Stats come
from the Wave-1 `decision_feedback` table: latest action per prediction_id
(DISTINCT ON, same semantics as `decisionFeedback.acceptanceRate`), 90-day
window, acceptance = `accept / (accept+edit+reject)` over decided outcomes.

Gates (pure function `decideTransition`, unit-tested at the boundaries):
- **promote 1→2**: acceptance ≥ 85% over ≥ 500 decided suggestions.
- **promote 2→3**: acceptance ≥ 95% over ≥ 2000 decided AND ≥ 30 days stable
  in tier 2 (`promoted_at` age).
- **demote**: decided acceptance over the *trailing 200* decisions < 70%
  (full window required, so early noise cannot demote) → step down exactly
  one tier. Regression is evaluated **before** promotion — it always wins.
- **fail-closed**: any DB/evaluation error in `evaluate()` returns tier 1 and
  best-effort rewrites the stored row to tier 1; `getTier()` returns 1 on any
  error.

Every transition (auto promote/demote, manual override, request queued) is
appended to the anti-wipe `audit_ledger` (`autonomy.tier_promoted`,
`autonomy.tier_demoted`, `autonomy.tier_override`, …) via `appendLedger`.

### 2. Undo-window action queue (`autonomyActions.ts`, migration 0140)

`autonomy_actions` rows carry the full before-state snapshot in `payload` and
an `undo_deadline` (default 24h, `AUTONOMY_UNDO_WINDOW_HOURS`). Status
machine: `pending_undo → executed | undone | expired`. Surface services
register `{execute, undo}` handlers per `action_type`;
`executeDueAutonomyActions()` applies due proposals (race-safe status flip),
and marks proposals that can no longer be applied (e.g. a human merged the
complaint first) as `expired` — never retried blindly. `undoAutonomyAction()`
cancels a pending proposal or restores an executed one from the snapshot.

### 3. Surface a — duplicate merges (`duplicateMerge.ts`)

`runDuplicateMergeSweep()` (Temporal-friendly export; no schedules registered
— see wiring below) finds near-duplicate **open** complaints: same normalized
controller name (lowercase, punctuation stripped, legal suffixes
ltd/plc/ng/… dropped), same category, received within 14 days, subject
similarity ≥ 0.4. Similarity is pg_trgm `similarity()` when the extension is
installed (guarded by a `pg_extension` probe; probe failure → fallback),
otherwise an ILIKE-equivalent normalized-substring/long-token shortlist; both
paths verify with an in-process trigram Jaccard (the pg_trgm metric) so
behaviour is deterministic and testable.

- **tier 1**: the pair is minted as a `decision_feedback` suggestion
  (surface `duplicate_merge`) only — a human merges via
  `publicComplaints.mergeDuplicates` / `DuplicateComplaintPicker`.
- **tier ≥ 2**: a `merge_proposal` autonomy action is parked with the
  duplicate's pre-merge state snapshot; after the deadline the executor
  performs the merge with the same race-safe guard as the manual router
  (`UPDATE … WHERE merged_into_id IS NULL`), moves attachments, and writes
  `complaint_events`. Undo restores status/`merged_into_id`/`closed_at` from
  the snapshot and moves attachments back.

### 4. Surface b — false-finding suppression (`falseFindingSuppressor.ts`)

`runFalseFindingSuppressionSweep()` loads **approved**, unexpired
`scan_suppressions` patterns and computes each pattern's historical
confirm-rate: `decision_feedback` surface `scan_findings` (accept = confirmed)
when present, else `scan_findings` status history
(acknowledged/referred/resolved vs dismissed/suppressed). Patterns with
confirm-rate < 5% get their matching **open** findings auto-suppressed at
tier ≥ 2 via the same undo-window mechanism (restore = set status back to the
snapshot); at execution time the pattern is re-validated as still approved
and unexpired.

**Dual control is not bypassed**: this service never creates or approves
suppression patterns — new pattern types still require the two-human
`complianceScanning.requestSuppression → approveSuppression` flow. Only
patterns already approved by two humans qualify. No decided history → not
eligible (fail-safe).

### 5. Governance router + dashboard

`autonomyGovernanceRouter`:
- `tierStatus` (protected): per-surface tier, live acceptance stats
  (read-only `evaluate(commit=false)` preview), and structured gate progress.
- `promote` / `demote` (admin): manual overrides are governance-sensitive and
  follow the `sanctionsRegister.publishNotice` maker-checker pattern —
  without `dualControlRequestId` the call **queues** an
  `autonomy_tier_change` request in `dual_control_requests` (action_type
  added by migration 0139; approvals via the existing generic
  `insiderThreat.approveDualControl`: two DISTINCT admins, requester may not
  approve); with one, it verifies approved/unexpired/unconsumed + payload
  match, consumes the request atomically, then applies the change.
- `listAutonomyActions` (protected): the action queue by status.
- `undoAction` (admin): human undo (cancel pending / restore executed).
- `transitionHistory` (protected): `autonomy.%` entries from `audit_ledger`.

`client/src/pages/AutonomyGovernance.tsx` (route `/autonomy-governance`,
registered next to the Round-8/9 staff surfaces in `App.tsx`): tier cards
with progress bars toward the next gate (acceptance / decided-count /
stability), a pending-undo queue with live countdowns + Undo buttons,
executed/undone/expired history tabs, and the ledger transition trail.
Follows the established `(trpc as any).autonomyGovernance` pattern used by
ComplaintTriage for not-yet-registered round-12 routers.

## Temporal / integrator wiring (not done here — workers/temporal is owned by
another workstream)

Schedule these idempotent, concurrency-safe exports on a periodic cadence
(e.g. every 15–60 min):
- `runDuplicateMergeSweep()` — `server/services/duplicateMerge.ts`
- `runFalseFindingSuppressionSweep()` — `server/services/falseFindingSuppressor.ts`
- `executeDueAutonomyActions()` — `server/services/autonomyActions.ts`
  (also re-exported as `executeDueMerges` / `executeDueSuppressions`)
- optionally `evaluateAllSurfaces()` — `server/services/autonomyTiers.ts` —
  to advance/demote tiers without waiting for dashboard reads.

Router registration (integrator, `server/routers.ts`): add
`autonomyGovernance: autonomyGovernanceRouter`. Schema merge (integrator):
`drizzle/schema_ext/autonomyTiers.ts` → `drizzle/schema.ts`.

## Migrations

Both validated with sqlglot (postgres dialect): 0139 = 3 statements
(autonomy_tiers + dual_control_requests action_type CHECK extension), 0140 =
4 statements (autonomy_actions + 3 indexes). Both fully idempotent
(IF NOT EXISTS / DROP CONSTRAINT IF EXISTS), matching the round-12 fix-forward
style.

## Tests

`server/routers/__tests__/autonomyGovernance.test.ts` — 34 tests, all passing
(run with the workspace vitest against a mocked pool/kafka/ledger/Permify/OPA;
the repo's partial node_modules lacks pino so `../../logger` is also mocked):
- gate math: exact boundaries (85%/500, 95%/2000/30d, 70%/trailing-200),
  partial-window no-demotion, regression-beats-promotion, tier clamping;
- fail-closed evaluate (DB error → tier 1 + tier-1 rewrite attempt);
- duplicate detection: normalization, 14-day window, similarity threshold,
  canonical = earliest, one pair per complaint per sweep;
- confirm-rate math + <5% eligibility gate;
- undo-window lifecycle: park → execute after deadline (merge applied,
  ledgered), expire on human-raced state, undo pending (no state writes),
  undo executed (snapshot restored), terminal-state undo refused;
- dual control: queue-without-write, pending request rejected, approved
  request consumed + applied + ledgered, cross-surface/tier request rejected,
  demote at tier 1 rejected, non-admin rejected.

## Residual risk / notes

- `npm`/`tsc` were not run (broken partial node_modules per constraints);
  server files were syntax-checked with esbuild and exercised via vitest.
- The client page compiles (esbuild) but could not be type-checked against
  `AppRouter` until the integrator registers the router in `server/routers.ts`
  (hence the `(trpc as any)` convention, matching Wave-7).
- Migration 0139 rewrites the `dual_control_requests` action_type CHECK to
  the known union + `autonomy_tier_change`; if another concurrent wave adds a
  new action type, the later-applied migration must carry the full union
  (0117 precedent).
