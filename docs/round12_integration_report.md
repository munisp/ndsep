# Round 12 Integration Report

Date: 2026-10-26 · Workspace: `/mnt/agents/ndsep-r12` (base: `/mnt/agents/ndsep-r9`)

## Router mounts (14)

All 14 Round-12 routers are imported and mounted in `server/routers.ts`
(imports L295–L308, mounts L381–L394 under the
`// ── Round-12 waves (migrations 0127-0140) ──` block):

1. `decisionFeedback` → `./routers/decisionFeedback`
2. `bulkOps` → `./routers/bulkOps`
3. `savedViews` → `./routers/savedViews`
4. `orgIdentity` → `./routers/orgIdentity`
5. `kpiDashboard` → `./routers/kpiDashboard`
6. `searchExtended` → `./routers/search`
7. `casePrecedents` → `./routers/casePrecedents`
8. `autoTriage` → `./routers/autoTriage`
9. `copilotDraft` → `./routers/copilotDraft`
10. `formCopilot` → `./routers/formCopilot`
11. `nextBestAction` → `./routers/nextBestAction`
12. `settlementRecommender` → `./routers/settlementRecommender`
13. `penaltyCalibration` → `./routers/penaltyCalibration`
14. `autonomyGovernance` → `./routers/autonomyGovernance`

## Schema merges (7 tables)

Merged into `drizzle/schema.ts` (L3713–L3850), matching migrations
0127/0130/0131/0137/0138/0139/0140:

`decision_feedback`, `saved_views`, `kpi_snapshots`,
`learned_risk_weights`, `penalty_calibration_audit`, `autonomy_tiers`,
`autonomy_actions`.

## Temporal schedules (3 new + W4's 4)

`server/services/round12Schedules.ts` registers 7 durable schedules via
`registerRound12Schedules()`, wired into the worker at
`workers/temporal/worker.ts:116-117`; workflow definitions in
`workers/temporal/workflows/round12Jobs.ts`, activities in
`workers/temporal/activities/round12Jobs.ts`. Fail-closed when Temporal is
unconfigured (explicit warn per schedule; worker refuses to start in
production on registration failure). Manual tRPC mutations delegate to the
same service functions in `server/services/scheduledSweeps.ts`.

W4's 4 (manual run-button replacements):
- `round12-compliance-scan-sweep` — hourly :00
- `round12-settlement-default-detection` — daily 03:05
- `round12-fine-reconciliation-batch` — every 6h
- `round12-complaint-surge-sweep` — every 15min

3 new (W9 graduated autonomy):
- `round12-duplicate-merge-sweep` — every 6h
- `round12-false-finding-sweep` — every 6h
- `round12-autonomy-execute-due` — every 15min

## App routes

`client/src/App.tsx`:
- W3: `/dpco/onboarding` (DpcoOnboarding), `/dpia/workspace`
  (DpiaWorkspace), `/revenue-verification` (RevenueVerification)
- W9: `/autonomy-governance` (AutonomyGovernance)

Component integration into existing pages: ComplaintTriage
(SimilarPrecedentsPanel, OfficerPicker/CasePicker/
DuplicateComplaintPicker, CopilotDraftModal, NextBestActionCard, bulk
assign/status), ComplianceScanning (W2 bulk set-status/suppress with dual
control), CrossBorderDeclarationsReview and DataSovereigntyDashboard
(W1 NewDeclarationForm with OrgIdentityPrefill + FormCopilotInput).

## Cast removals

Post-schema-merge, trpc call sites for the 7 new tables no longer need
`as any` casts — query/mutation types now flow from `AppRouter`; stale
casts were removed during mounting. (4 `as any[]` casts in
`CrossBorderDeclarationsReview.tsx` predate Round-12 — identical code
exists in the r9 base — and were intentionally left; see tsc section.)

## Verification

### Migration chain (real PG16, previous integrator)

- Full chain: **82 applied / 0 failed**; re-runs idempotent
  (0 applied on 2nd/3rd pass); **327 tables** in final schema.
- New migrations 0127–0140 (10 files: 0127, 0130, 0131, 0133, 0134, 0135,
  0137, 0138, 0139, 0140) all pass.
- sqlglot parse check: **10/10** new migration files valid.
- Not re-run this session (numbers as reported by the prior integrator;
  migration files confirmed present: 82 SQL files in `drizzle/migrations/`).

### pytest

- New Round-12 python test files: **58 passed / 0 failed**
  - `ml/tests/test_round12_w8_trainers.py` — 17
  - `workers/python/test_case_embedder_worker.py` — 15
  - `workers/python/test_regintel_ingest_worker.py` — 10
  - `ml/tests/test_case_outcome_labels.py` — 8
  - `ml/tests/test_ab_outcomes_producer.py` — 4
  - `ml/tests/test_verdict_ingest.py` — 4
- Full python suite (`ml/tests`, `workers/python`, `tests`,
  `orchestration/tests`, incl. `test_cocoindex_watermark.py` after
  installing `psycopg2-binary`): **211 passed, 8 failed, 6 errors**.
  All 14 non-passing tests are in `ml/tests/test_neo4j_graph.py` and
  `ml/tests/test_ab.py` and **reproduce identically on the r9 baseline**
  (neo4j-driver mocking / environment issue; test and source files are
  byte-identical between r9 and r12) — pre-existing, not Round-12.

### vitest (Round-12 suites)

Command:
`ESBUILD_BINARY_PATH=/tmp/esbuild-bins/esbuild-0.27.7 node node_modules/vitest/vitest.mjs run <files>`

**13 test files passed, 185/185 tests passed, 0 failed:**

| File | Tests |
|---|---|
| server/routers/__tests__/autonomyGovernance.test.ts | 34 |
| server/routers/__tests__/nextBestAction.test.ts | 28 |
| server/routers/bulkOps.test.ts | 19 |
| server/routers/__tests__/autoTriage.test.ts | 14 |
| server/routers/__tests__/casePrecedents.test.ts | 12 |
| server/routers/savedViews.test.ts | 12 |
| server/analytics/productivityKpis.test.ts | 12 |
| server/services/__tests__/settlementRecommender.test.ts | 11 |
| server/services/__tests__/penaltyCalibration.test.ts | 10 |
| server/services/__tests__/riskWeights.test.ts | 10 |
| server/routers/__tests__/decisionFeedback.test.ts | 9 |
| server/routers/__tests__/formCopilot.test.ts | 9 |
| server/routers/__tests__/copilotDraft.test.ts | 5 |

(WARN lines about LLM-gateway ECONNREFUSED/500/503 are the autoTriage /
formCopilot tests deliberately exercising the gateway-failure fallback —
complaints stay in the manual queue; tests pass.)

### tsc

Command: `node --max-old-space-size=3072 node_modules/typescript/bin/tsc --noEmit`
(TypeScript 5.9.3, project `tsconfig.json`).

- **Round-12 scope: 0 errors.** All errors in Round-12 files were fixed
  (see Fixes applied).
- Remaining: **35 errors, all pre-existing** — every one is either in a
  file byte-identical to the r9 base or on a line unchanged from r9
  (verified by diff):
  - 16 × TS2802 (`for…of`/`Set` spread with tsconfig's default ES5
    target): supervisionRisk.ts (10), adverseMediaLogic.ts (2),
    annualReportLogic.ts (2), workerManager.ts (1), stripe-adjacent.
  - 3 × stripe API-version drift: code pins `2025-03-31.basil` /
    `2024-12-18.acacia`; lock-pinned stripe@22.6.2 types expect
    `2026-08-26.dahlia` (stripe.ts, phase12Features.ts ×2 — lines
    unchanged from r9).
  - 4 × `as any[]` narrowing in CrossBorderDeclarationsReview.tsx
    (casts identical in r9).
  - Remainder: pre-existing strictness issues in files byte-identical to
    r9 (finePayments null-guards, MinorsConsent, UssdIntakeQueue,
    PenaltyCalculator, InternationalCooperation, backupGuard,
    transferAnomaly, regulatorReconciliation, dataSovereignty).
- Note on baseline: the recorded Round-10 baseline reported "only vendored
  @temporalio/proto d.ts noise". This run shows no @temporalio noise
  (`skipLibCheck` is on), but the 35 errors above would reproduce on r9
  with the same tsconfig and lock-pinned deps, so they are classified as
  pre-existing noise relative to Round-12, not regressions.

## Fixes applied (this integration pass)

node_modules repair (the blocking issue):
1. Regenerated the nested-breakage list (183 entries; 2 excluded as
   intentional: the `resolve` package's `test/shadowed_core` fixture and a
   stray `node_modules/node_modules/@antfu/install-pkg` container that is
   intact) and batch-repaired all **181 nested packages** from the npm
   mirror (`https://npm.mirrors.msh.team`), resolving versions from
   package-lock.json exact keys where present, else the nearest ancestor
   package.json range, else the same-name lock entry. **0 failures.**
2. Full-tree integrity sweep of all 1,732 lock packages against their
   tarballs: **241 packages were incompletely extracted** (previous repair
   had dropped files, e.g. `@trpc/server` was missing `dist/index.mjs`,
   which broke vitest module resolution) — all re-extracted.
3. Size-level sweep: **14 packages had truncated/size-mismatched files**
   (e.g. `resend/dist/index.d.mts` was 0 bytes, causing "not a module"
   tsc errors) — all re-extracted; `@dnd-kit/core` repaired manually.
4. esbuild platform binaries: `/mnt/agents` is a FUSE mount that silently
   ignores `chmod +x`, so binaries were staged executable on `/tmp` and
   vitest is run with `ESBUILD_BINARY_PATH=/tmp/esbuild-bins/esbuild-0.27.7`
   (matches vite's nested esbuild 0.27.7; top-level esbuild 0.25.12 and
   tsx's nested 0.28.2 versions verified consistent with their own
   `@esbuild/linux-x64` packages).

Round-12 tsc fixes (6 error sites):
5. `client/src/pages/ComplaintTriage.tsx` — typed `bulkStatus` state as
   `(typeof STATUSES)[number]` (was `string`); fixed
   `editOfficer?.name` → `editOfficer?.label` (PickerOption has `label`).
6. `client/src/pages/ComplianceScanning.tsx` — typed `bulkStatus` as
   `"acknowledged" | "resolved" | "dismissed"` (matches bulkOps router
   enum).
7. `client/src/pages/AutonomyGovernance.tsx` — typed
   `overrideForm.surface` as `"scan_findings" | "duplicate_merge"`
   (matches `AUTONOMY_SURFACES`).
8. `client/src/pages/DataSovereigntyDashboard.tsx` — fixed the two
   W1 parse helpers: return objects now omit absent optional keys so the
   type predicates are valid (TS2677/TS2322 ×4).
9. `server/services/scheduledSweeps.ts` — `[...new Set(...)]` →
   `Array.from(new Set(...))` (TS2802 under default ES5 target).
10. `server/services/duplicateMerge.ts` — Set `for…of` → `forEach`
    (TS2802).

## Residual risks

- **FUSE mount ignores exec bits**: any tool that `execve`s a node_modules
  binary directly will fail. Vitest needs `ESBUILD_BINARY_PATH`; tsc must
  be invoked as `node node_modules/typescript/bin/tsc`. A clean
  `npm ci`/`pnpm install` on a normal filesystem remains the proper fix.
- **node_modules provenance**: packages were repaired piecemeal from the
  mirror at lock-pinned versions, not from a single clean install; the
  integrity sweeps (existence + size vs. tarballs, 1,732 packages) now
  pass, but a future clean reinstall is recommended.
- **35 pre-existing tsc errors** remain (ES5-target TS2802, stripe
  API-version pin drift, misc. strictness) — out of Round-12 scope;
  consider adding `"target": "ES2022"` (or `downlevelIteration`) and
  aligning stripe apiVersion pins in a follow-up.
- **pytest environment failures** in `test_neo4j_graph.py`/`test_ab.py`
  (14 tests) pre-date Round-12 (reproduce on r9); appear to be
  neo4j-driver mocking incompatibilities with the sandbox package set.
- **Migration-chain / sqlglot numbers** (82/0, 327 tables, 10/10) are
  carried from the previous integrator's validated run on real PG16 and
  were not re-executed in this session.
- tsc requires `--max-old-space-size=3072` on this 4 GB node (default heap
  OOMs).
