# Round-16 W3 — Operator Consoles: antiwipe, productionReadiness, workflows

**Date:** 2026 (round 16, wave 3)
**Scope:** client-only consoles for three previously-orphaned tRPC routers. No server edits, no new tables.

## Deliverables

| Page | Router (mount) | Procedures wired | Route |
|------|----------------|------------------|-------|
| `client/src/pages/AntiwipeConsole.tsx` | `antiwipe` (`server/antiwipe/router.ts`) | **15/15** | `/antiwipe-console` |
| `client/src/pages/ProductionReadiness.tsx` | `productionReadiness` (`server/routers/productionReadiness.ts`) | **16/16** | `/production-readiness` |
| `client/src/pages/WorkflowsConsole.tsx` | `workflows` (`server/routers/workflows.ts`) | **8/8** | `/workflows` |

Routes live in the `{/* Round-16 W3 */}` block in `client/src/App.tsx` (lazy imports + routes), inside the
`DashboardLayout` wrapper (staff-only shell). No nav registry edit: the sidebar registry
(`menuSections` in `client/src/components/DashboardLayout.tsx`) is outside this wave's file ownership, so nav
entries were deliberately not added there.

### AntiwipeConsole — `antiwipe.*` (15/15)

- **Ledger:** `status` (chain height, head hash/seq, genesis, anchor count/date, tail-window verification),
  `publicIntegrityStatus` (public head/tail cross-check), `verify` (run-on-demand `verifyChain` with optional
  `fromSeq`/`limit` window; result panel shows valid/broken, first broken seq + reason, head hash),
  `anchor` (admin; optional `YYYY-MM-DD`; shows merkle root, seq range, idempotency flag, external-mirror
  result incl. mirror errors), `append` (admin; action + JSON/text payload; actor always `user:<id>` server-side).
- **Vault:** `vaultList` (entries table w/ seal state), `vaultVerify` (64-hex hash, on demand),
  `vaultVerifyRecent` (N-sweep with failure list), `vaultPut` (file → base64, ≤32 MiB, case ref/content type),
  `vaultSeal` (admin; one-way legal seal).
- **Backups:** `backupList`, `backupRegister` (admin form), `backupVerify` (admin; re-hash artifact vs manifest).
- **Canaries/guards:** `canaryCheck` (polled; failures render as a **tamper-alert list** with
  acknowledge-and-re-arm via `canaryWrite` scoped to the tripped directory), `canaryWrite` (admin; re-write all).
  TRUNCATE/DROP/UPDATE/DELETE guard status is rendered as enforced-by-DB-trigger (migration 0061) — the router
  exposes no guard-introspection procedure, so this is an informational panel, not a live probe.
- Admin mutations are disabled client-side when `useAuth().user?.role !== "admin"` (server still enforces
  `adminProcedure`).

### ProductionReadiness — `productionReadiness.*` (16/16)

`readinessScore` (score, level, **gate list** with pass/fail; click a gate → evidence drawer), `middlewareHealth`
(14-service mesh table) + `middlewareStatus` (cached per-service detail on row select), `errorSummary` +
`errorMetrics`, `authConfig` (Keycloak mode/JWKS freshness), `workerBuildStatus`, `seedDataSummary`,
`eventBusMetrics`, `workflowDefinitions` + `workflowHealth` (Temporal), `serviceStatus` + `serviceDefinitions`,
`mlModels` + `mlPipelineStatus`, `k8sReadiness` (fail-closed static manifest review, limitations surfaced).
"Run assessment" refetches all queries. **Score trend** is session-local (router exposes no history; scores
accumulate client-side on each refresh). **No sign-off workflow exists** in the router — nothing to wire.

### WorkflowsConsole — `workflows.*` (8/8)

**Domain correction:** this router is *not* a Temporal-ops API — it fronts the in-process compliance lifecycle
engine (`server/workflows/complianceLifecycle.ts`: organization/violation/breach/dpia/dsar state machines) and
the NDPA business-rules library (`businessRules.ts`). The console therefore surfaces:

- `getAvailableActions` + `executeTransition` — lifecycle transition console (entity type/id/state picker,
  role-filtered action buttons, optional JSON metadata, success/rejection panel with concurrency errors).
- `calculatePenalty` (NDPA Art. 47, NGN formula display), `calculateComplianceScore` (8-control checklist +
  breakdown table + grade), `calculateRiskScore` (factor table), `checkSla` (elapsed/deadline + urgency badge),
  `checkRenewalEligibility`, `checkCrossBorderAdequacy` (safeguards list).
- **Schedule registry:** round-12/13 Temporal schedules (`round12-*`, `round13-*` sweeps, task queue
  `ndsep-main`, per `workers/temporal/workflows/round12Jobs.ts`/`round13Jobs.ts`) rendered as a reference table;
  the `workflows` router exposes no schedule CRUD or run/failure introspection — Temporal definitions/health are
  surfaced via `productionReadiness.workflowDefinitions/workflowHealth` (linked from the page header) and live
  runs via the existing `/temporal` page.

## Files changed

- `client/src/pages/AntiwipeConsole.tsx` (new)
- `client/src/pages/ProductionReadiness.tsx` (new)
- `client/src/pages/WorkflowsConsole.tsx` (new)
- `client/src/App.tsx` (Round-16 W3 import + route block; also repaired the file tail after a concurrent-edit
  truncation — restored the standard `</Switch></Suspense>/App` boilerplate, verified against pre-edit layout)

## Validation

- `node --max-old-space-size=3072 node_modules/typescript/bin/tsc --noEmit` → **35 errors, all pre-existing
  baseline** in other files (CrossBorderDeclarationsReview, finePayments, supervisionRisk, stripe, etc.);
  **zero errors** in the three new pages or App.tsx.

## Notes / residual risk

- All server data access is defensive (optional chaining, `?? []`/`?? "—"` fallbacks).
- Canary "acknowledge" = re-write tripwire (`canaryWrite`), the only server-supported remediation; the alert
  itself persists in `audit_logs` + ledger (server-side).
- Runtime smoke-testing against a live server was not possible from this environment; correctness rests on the
  router/server source contracts cited above.
- Concurrent agents (W1/W2) are editing `client/src/App.tsx`; the W3 block is additive and marked. Re-run tsc
  after the wave settles if the file is touched again.
