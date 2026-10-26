# Round 12 — Wave 2 Report: Queue Bulk Actions, Triage Pickers, Saved Views

Roadmap §5 quick wins. Kills one-at-a-time clicking in the three worst queues
and raw numeric-ID entry in complaint triage; adds per-user saved views.

## Files created

| File | Purpose |
|---|---|
| `server/routers/bulkOps.ts` | `bulkOpsRouter` — 6 bulk mutation procedures + 2 picker search queries |
| `server/routers/savedViews.ts` | `savedViewsRouter` — user-scoped CRUD for saved filter sets; exports `userUuid()` |
| `drizzle/migrations/0130_saved_views.sql` | `saved_views` table (uuid PK, user_id uuid, surface, name, filters jsonb, created_at/updated_at) + unique (user_id, surface, name) |
| `drizzle/schema_ext/savedViews.ts` | Drizzle table def `savedViews` (+ `SavedView`/`InsertSavedView` types) |
| `client/src/components/pickers/PickerCombobox.tsx` | Shared popover+search combobox shell (`PickerCombobox`, `PickerOption`) |
| `client/src/components/pickers/OfficerPicker.tsx` | Officer autocomplete → `bulkOps.searchOfficers` |
| `client/src/components/pickers/CasePicker.tsx` | Enforcement-case autocomplete → `bulkOps.searchCases` |
| `client/src/components/pickers/DuplicateComplaintPicker.tsx` | Duplicate-complaint autocomplete → existing `publicComplaints.list` |
| `client/src/components/pickers/index.ts` | Barrel exports |
| `server/routers/bulkOps.test.ts` | Vitest: 16 tests over bulk types, guards, auth gating, dual control |
| `server/routers/savedViews.test.ts` | Vitest: 12 tests over scoping, CONFLICT/NOT_FOUND mapping, validation |

## Files edited

- `server/bulkOperations.ts` — extended `BulkOperationType` with
  `complaint_assign_officer`, `complaint_set_status`, `scan_finding_set_status`,
  `scan_finding_suppress_request`, `adverse_media_confirm`, `adverse_media_reject`.
  Existing helpers (`startBulkOperation`/`updateProgress`/`completeBulkOperation`)
  are now actually consumed by `bulkOps.ts`; every bulk run writes a
  `bulk_operations` tracking row (non-fatal on failure).
- `client/src/pages/ComplaintTriage.tsx` — raw ID inputs replaced by
  OfficerPicker/CasePicker/DuplicateComplaintPicker; row checkboxes + select-all
  + bulk action bar (assign officer, set status); saved-view save/apply/delete
  for surface `complaint_triage` (filters `{status, search}`).
- `client/src/pages/AdverseMediaReview.tsx` — per-card checkboxes + select-all +
  bulk bar (confirm / reject with shared note) on the pending queue.
- `client/src/pages/ComplianceScanning.tsx` — findings tab: checkbox column +
  select-all + bulk bar (set status acknowledged/resolved/dismissed; request
  suppression with reason ≥ 20 chars).
- `client/src/pages/GlobalSearch.tsx` — saved views for surface `global_search`
  (filters `{query}`): dropdown apply, name + save, delete.

## Integrator: exports to mount in `server/routers.ts`

```ts
import { bulkOpsRouter } from "./routers/bulkOps";
import { savedViewsRouter } from "./routers/savedViews";
// appRouter:
//   bulkOps: bulkOpsRouter,          ← client paths trpc.bulkOps.*
//   savedViews: savedViewsRouter,    ← client paths trpc.savedViews.*
```

Also add `"./drizzle/schema_ext/savedViews.ts"` to the `schema` array in
`drizzle.config.ts` (file not owned by this workstream).

Client note: all `trpc.bulkOps.*` / `trpc.savedViews.*` call sites use
`(trpc as any)` so the tree compiles before the mount lands; after mounting,
these can be tightened to typed access.

## Router surface (bulkOps)

| Procedure | Auth | Semantics |
|---|---|---|
| `searchOfficers` | staffProcedure | ILIKE name/email over active staff-ish roles |
| `searchCases` | staffProcedure | case_reference / org name / exact id |
| `bulkAssignComplaints` | adminProcedure | officer existence checked; per-item events + batch audit |
| `bulkSetComplaintStatus` | adminProcedure | enforces `canTransition` status machine + `linked_to_case` precondition + merged-duplicate guard **per item**; invalid items reported, never forced |
| `bulkSetFindingStatus` | adminProcedure | same guarded UPDATE as `complianceScanning.setFindingStatus` (open/acknowledged → any; referred → resolved only) |
| `bulkSuppressFindings` | protectedProcedure | **creates PENDING `scan_suppressions` requests only** — dual control preserved |
| `bulkConfirmAdverseMedia` | staffProcedure | pending-only transition; promotes confirmed matches into `supervision_risk_signals` (ON CONFLICT idempotent) |
| `bulkRejectAdverseMedia` | staffProcedure | pending-only; note min 3 chars |

All bulk mutations return `{ operationId, total, succeeded, failed: [{id, reason}] }`;
one bad item never fails the batch. Max 200 ids per call.

## Dual-control statement

No new procedure touches fines, settlements, or publications, so
`dual_control_requests` is never in play. Scan-finding suppression's existing
dual control is preserved structurally: the bulk path inserts **pending**
`scan_suppressions` (scope='finding') and findings only flip to `suppressed`
when a *different* officer approves via `complianceScanning.approveSuppression`.
A per-item test asserts no `UPDATE scan_findings` is issued by the bulk
suppress path.

## Migration validation

`0130_saved_views.sql` is Postgres-native, idempotent (`IF NOT EXISTS`
throughout), no dependencies on other migrations (no ORDER_OVERRIDES needed;
runner globs files). **sqlglot validation could not run — the sandbox has no
network (pip install failed) and sqlglot is not preinstalled.** Fallback: a
structural sanity check (3 statements, balanced parens, all
`CREATE … IF NOT EXISTS`) passed; manual review against the 0127
`decision_feedback` conventions (uuid PK `gen_random_uuid()`, timestamptz
defaults).

`user_id uuid` vs `users.id serial`: the router maps user ids through
`userUuid()` — sha256 of a namespaced key rendered version-5 style, the same
pseudonymous-actor convention as `decisionFeedback.actorUuid` (wave 1). No FK
to users; documented in the migration header.

## Tests

- `server/routers/bulkOps.test.ts` — follows banking.test.ts/sectors.test.ts
  pattern (mock `pg` pool, `middlewareIntegration`, `security/opa`;
  `getDb()` initializes the mocked pool; direct `bulkOpsRouter.createCaller`).
  Covers: officer/case search scoping + staff gating, bulk assign happy path /
  missing officer / per-item failure isolation / admin gating, status-machine
  enforcement per item (invalid transition, linked_to_case precondition,
  merged duplicate), finding closed-state guard, suppression dual-control
  (pending-only, existing-request skip, non-open skip), adverse-media
  confirm/reject pending-only + signal promotion + note validation.
- `server/routers/savedViews.test.ts` — userUuid determinism/format, list
  scoping (caller uuid + surface in params), cross-user isolation, create
  (param serialization, 23505 → CONFLICT, surface regex, 16 KiB filters cap),
  update (nothing-to-update, NOT_FOUND), remove (NOT_FOUND), unauthenticated
  rejection.

**Tests were NOT executed** — `node_modules` is still copying (no `.bin`, no
typescript package) and running npm/tsc/vitest was prohibited. Code was
written against existing patterns and reviewed manually.

## Known issues / follow-ups

1. `trpc.bulkOps` / `trpc.savedViews` client call sites are `(trpc as any)`
   until the integrator mounts the routers; pages will throw at render if
   visited before the mount. Tighten types after merge.
2. `bulkSetComplaintStatus` intentionally does NOT send per-complainant
   notifications (unlike single `publicComplaints.updateStatus`) to avoid
   notification storms; complaint_events still record each transition.
   If parity is required, add a notify toggle.
3. sqlglot validation of 0130 outstanding (offline sandbox) — run
   `sqlglot.parse(sql, dialect="postgres")` when network is available.
4. Saved-view unique conflict returns CONFLICT; the UI surfaces it as a toast
   telling the user to pick another name (no overwrite flow).
5. `searchOfficers` exposes staff name/email/role to any staff-role user —
   acceptable for an internal directory picker; tighten to adminProcedure if
   policy requires.
