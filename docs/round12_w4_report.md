# Round-12 W4 — Durable Schedules, Search Expansion, KPI Baselines

Scope: roadmap §5 (manual run-buttons → durable Temporal schedules with
exception-only queues) + §8 (global search expansion, productivity KPI
instrumentation).

## 1. Temporal schedules (fail-closed, shared logic)

New module **`server/services/scheduledSweeps.ts`** holds the canonical
business logic for the four former manual buttons. Both the tRPC mutations
(operator overrides, signatures preserved) and the Temporal activities call
these functions, so the scheduled and manual paths cannot drift:

| Job | Schedule id / workflowType | Cadence | Exceptions land in |
|---|---|---|---|
| `runComplianceScanSweep` | `round12-compliance-scan-sweep` / `compliance_scan_sweep` | hourly (`0 * * * *`) | `scan_runs` (failed) / `scan_findings` queue |
| `detectSettlementDefaults` | `round12-settlement-default-detection` / `settlement_default_detection` | daily (`5 3 * * *`) | hash-chained `audit_ledger` (`settlement.defaulted`), fine flips back to `outstanding` |
| `runFineReconciliationBatch` | `round12-fine-reconciliation-batch` / `fine_reconciliation_batch` | every 6 h (`0 */6 * * *`) | `payment_reconciliations` `unmatched`/`partial` (reconciliationQueue) |
| `runComplaintSurgeSweep` | `round12-complaint-surge-sweep` / `complaint_surge_sweep` | every 15 min (`*/15 * * * *`) | `surge_alerts` queue (deduped, migration 0104) |

- The scan sweep SQL mirrors `workers/python/scan_crawler_worker.py`
  `schedule_due_targets()` exactly (enabled targets, interval elapsed, no
  open run; `trigger_type='cron'`).
- Scheduled runs record actor `system:temporal-schedule` in
  `audit_logs` / the audit ledger so operator overrides stay distinguishable.

Registration follows the Round-9 pattern exactly:

- **`server/services/round12Schedules.ts`** — `ROUND12_SCHEDULES`,
  `registerRound12Schedules()` (explicit SKIP per schedule when Temporal is
  unconfigured; per-schedule failures collected), plus `ROUND12_JOB_RUNNERS`
  / `runRound12Job()` cron fallback for non-Temporal deployments.
- **`workers/temporal/workflows/round12Jobs.ts`** + exported from
  `workflows/index.ts`; workflow names match the registered workflowTypes.
- **`workers/temporal/activities/round12Jobs.ts`** — thin wrappers over the
  shared service functions; failures propagate to Temporal retry (max 3,
  15-min start-to-close).
- **`workers/temporal/worker.ts`** — registers the four schedules at startup
  via `ensureSchedule` (idempotent; existing schedules left in place) and
  **fails closed in production**: any registration failure throws before the
  worker starts polling, so the platform health endpoint reports the worker
  as down (visible degradation) instead of fake-running jobs. Non-production
  logs a warning and continues.

Router refactors (surgical; procedure signatures unchanged):

- `server/routers/complianceScanning.ts` — `scheduleScan` delegates to
  `scheduledSweeps.scheduleScanRun` (NOT_FOUND/CONFLICT codes preserved).
- `server/routers/settlementWorkflow.ts` — `detectDefaults` delegates to
  `detectSettlementDefaults` (optimistic-concurrency CONFLICT preserved).
- `server/routers/finePayments.ts` — `runReconciliationBatch` delegates to
  `runFineReconciliationBatch`.
- `server/routers/complaintAnalytics.ts` — `runSurgeDetection` delegates to
  `runComplaintSurgeSweep`; now-unused direct imports from
  `services/complaintSurge` removed.

## 2. Global search expansion

**`server/routers/search.ts`** — new `searchExtendedRouter.global` (the
legacy router lives in `server/routers/enhancements.ts`, owned by another
workstream, so it was not edited). Adds five entity types with Postgres FTS
ranking, merged by rank; **limit raised to 50** (default 50, max 50):

- `complaints` (public_complaints — no complainant PII columns selected)
- `settlements`
- `hosting_declarations`
- `transfer_declarations`
- `fines` (enforcement_fines)

Authorization mirrors the owning routers: complaints/settlements/hosting
declarations are staff-only (admin/government_staff/auditor/regulator) and
are silently dropped from non-staff requests; transfer declarations and
fines are org-scoped for non-staff callers using the finePayments
`listReceipts` org-membership pattern.

## 3. KPI instrumentation

- **`server/analytics/productivityKpis.ts`** — five baseline metrics computed
  from existing tables only, zero-safe (`value: 0`, `sampleSize: 0` on empty
  data, never fabricated):
  - `clicks_per_workflow` — (staff `complaint_events` + complaint-related
    `audit_ledger` actions) / distinct complaints;
  - `time_to_triage_hours` — complaint_events: submitted → first
    status_change out of `received`;
  - `time_to_resolution_hours` — submitted → first `resolved`/`closed`;
  - `queue_auto_clear_rate` — scan_findings/adverse_media_items resolved
    without a manual actor / all resolved (honest 0 baseline);
  - `form_fields_edited` — analytics_events form_* events, sum of
    `metadata.fieldsEdited`, with start/complete/abandon breakdown.
- **`server/routers/kpiDashboard.ts`** — `baseline({ persist })` and
  `history({ metric, limit })` (adminProcedure).
- **`drizzle/migrations/0131_kpi_snapshots.sql`** — `kpi_snapshots (id uuid
  PK default gen_random_uuid(), metric text, value numeric, dimensions
  jsonb, captured_at timestamptz default now())` + two indexes. Validated by
  parsing all 3 statements with **sqlglot 30.24.0, postgres dialect** (pip
  installed from a local wheel; the KPI queries were parsed the same way).
- **`drizzle/schema_ext/kpiSnapshots.ts`** — Drizzle table, matching the
  sibling `decisionFeedback.ts` extension style.
- Snapshot persistence degrades gracefully when the migration is not yet
  applied (42P01 → warn + skip); other SQL errors are rethrown.

## 4. KPI dashboard page

- **`client/src/pages/ProductivityKpis.tsx`** — metric cards + snapshot trend
  table, refresh + "Capture snapshot" actions. Uses an explicitly untyped
  tRPC handle because `kpiDashboard` is not yet mounted in the typed
  AppRouter (see Mount work below).
- **`client/src/App.tsx`** — lazy import + `<Route path="/productivity-kpis">`
  registered next to the other Round-8–10 staff surfaces (minimal two-line
  edit; shared file, concurrent-edit risk noted).

## 5. Tests

**`server/analytics/productivityKpis.test.ts`** — vitest, db mocked via
`vi.mock("../db")` with a canned-row router keyed on the issued SQL (the
`ngnLedgerWiring.test.ts` pattern). Covers: clicks-per-workflow math and
zero-sample behaviour, triage/resolution pass-through and NULL→0,
auto-clear rate combination across both queues and the 0 baseline,
form-fields aggregation, the full five-metric baseline, snapshot insert
shape (one row per metric, unit/sampleSize folded into dimensions), the
42P01 graceful-skip path, non-42P01 rethrow, and history filtering.

Not run locally (per round rules: no npm/tsc/vitest execution in this
workspace).

## Mount work for the router-assembly workstream (server/routers.ts — not edited here)

```ts
import { searchExtendedRouter } from "./routers/search";
import { kpiDashboardRouter } from "./routers/kpiDashboard";
// ...
searchExtended: searchExtendedRouter,
kpiDashboard: kpiDashboardRouter,
```

Drizzle schema merge (drizzle/schema.ts — not edited here):

```ts
export { kpiSnapshots } from "./schema_ext/kpiSnapshots";
```

## Files touched

New: `server/services/scheduledSweeps.ts`, `server/services/round12Schedules.ts`,
`server/routers/search.ts`, `server/routers/kpiDashboard.ts`,
`server/analytics/productivityKpis.ts`, `server/analytics/productivityKpis.test.ts`,
`workers/temporal/workflows/round12Jobs.ts`, `workers/temporal/activities/round12Jobs.ts`,
`drizzle/migrations/0131_kpi_snapshots.sql`, `drizzle/schema_ext/kpiSnapshots.ts`,
`client/src/pages/ProductivityKpis.tsx`, `docs/round12_w4_report.md`.

Edited: `workers/temporal/worker.ts` (round-12 registration + activities on
the main task queue), `workers/temporal/workflows/index.ts` (exports),
`server/routers/complianceScanning.ts`, `server/routers/settlementWorkflow.ts`,
`server/routers/finePayments.ts`, `server/routers/complaintAnalytics.ts`
(delegation only), `client/src/App.tsx` (lazy import + route).

## Residual risks / notes

- `trpc.kpiDashboard` is untyped in the client until routers.ts is mounted;
  the page isolates this behind a documented `as any` handle.
- The 15-min surge sweep is idempotent (upserts) and overlaps safely with
  the Round-9 daily surge job (`overlap: SKIP` schedule policy).
- Not run: tsc/vitest (forbidden in this workspace) — types reviewed
  manually; the KPI tests follow an existing, known-good mock pattern.
