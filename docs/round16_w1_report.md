# Round-16 W1 — Web UIs for orphaned routers: policyMonitor, regIntel, regulatorReconciliation

## Pages delivered

| Page | Route | Router wired | Procedures |
|---|---|---|---|
| `client/src/pages/PolicyMonitor.tsx` | `/policy-monitor` | `policyMonitor` | 17/17 |
| `client/src/pages/RegIntel.tsx` | `/reg-intel` | `regIntel` | 10/10 |
| `client/src/pages/RegulatorReconciliation.tsx` | `/regulator-reconciliation` | `regulatorReconciliation` | 10/10 |

Routes registered in `client/src/App.tsx` inside a clearly marked
`{/* Round-16 W1 — ... */}` block (lazy imports + Routes), following the
existing Round-12/16-W3 pattern. Placed immediately before the catch-all route.

## Procedure wiring detail

### policyMonitor (17/17)
- **Registry**: `listPolicies` (enabled + organizationId filters), `getPolicy`
  (detail dialog), `registerPolicy` (admin form), `updatePolicy` (enable/disable
  toggle + edit dialog for interval/notes), `checkNow` (admin, force check).
- **Versions & diffs**: `listVersions` (per-policy feed with classification
  filter), `getVersionDiff` (dialog: summary, diff_detail, previous-version
  excerpt), `listDiffQueue` (UNCONFIGURED/failed/pending retry queue),
  `requeueDiff` (admin).
- **Review queue**: `listReviews` (status/priority filters), `getReview`
  (workflow dialog), `assignReview` (admin), `decideReview` (staff),
  `escalateReview` (admin; surfaces investigation_violation_id),
  `closeReview` (admin), `notifyController` (admin; in_app/email/letter with
  external_reference enforcement), `monitorOverview` (7-stat rollup header).

### regIntel (10/10)
- **Corpus**: `createInstrument` (admin form), `addVersion` (admin; renders
  ingestStatus mode — worker vs `degraded_local_chunk` — embed/qdrant status
  and returned legalChangeAlerts), `listInstruments` (type filter + client-side
  search), `getInstrument` (detail drawer: metadata + supersession chain),
  `listSections` (per-version section browser with excerpt search and
  embedded/not-embedded badges).
- **askLegal**: `askLegal` (question + topK; mode badge distinguishes `kgqa`
  from `degraded_keyword_fallback`; citations table), `listQueries`
  (provenance trail with mode filter).
- **Rule refs / alerts**: `registerRuleReference` (admin),
  `removeRuleReference` (admin, from alert rows), `legalChangeAlerts`
  (instrument-filtered superseded-section alerts).

### regulatorReconciliation (10/10)
- **Conflicts**: `raiseConflict` (staff; multi-regulator chip picker, min 2),
  `listConflicts` (status + matterRef filters), `resolveConflict` (admin
  dialog: outcome, lead regulator, precedence decision — required when
  resolving, mirroring server validation).
- **Referrals**: `sendReferral` (from/to must differ; casePayload JSON
  validated client-side before submit), `acknowledgeReferral`,
  `respondReferral` (accept/decline dialog), `resolveReferral` (dialog),
  `listReferrals` (regulator + status filters; status-aware action buttons).
- **Dashboards**: `regulatorDashboard` (per-regulator snapshot: conflict
  counts, referral pipeline, recent activity), `regulatorAggregateStats`
  (cross-regulator workload tables).

## Guardrails & gating

- `useAuth()` role checks gate mutations: admin-only controls
  (`registerPolicy`, `updatePolicy`, `checkNow`, `requeueDiff`, `assignReview`,
  `escalateReview`, `closeReview`, `notifyController`, `createInstrument`,
  `addVersion`, `registerRuleReference`, `removeRuleReference`,
  `resolveConflict`) render only for `role === "admin"`; staff/regulator
  controls (`raiseConflict`, referral send/ack/respond/resolve) render for
  `admin | government_staff | regulator`. Server procedures remain the
  authoritative gate (adminProcedure / staffProcedure / Permify checks).
- `regulatorDashboard` / `regulatorAggregateStats` render server FORBIDDEN
  errors inline (Permify regulator-read denial) instead of crashing —
  `retry: false` + inline error card.
- House style copied from `EnforcementAnalytics.tsx` / `SupervisionRisk.tsx`:
  `Breadcrumbs`, `Card`/`Table`/`Tabs`/`Dialog`/`Sheet` primitives, sonner
  toasts (`toast.success` / `toast.error(err.message)`), `SkeletonTable`
  loading states, `EmptyState` for empty lists, `trpc.useUtils().invalidate()`
  for refresh.

## Nav registry

`client/src/components/DashboardLayout.tsx` holds a manually-curated
`menuSections` nav registry (lines ~60–280). It was **not modified**: it is
outside this workstream's file ownership (concurrent agents edit it), and the
Round-12 precedent pages (`/supervision-risk`, `/enforcement-analytics`,
`/autonomy-governance`, …) are likewise absent from the registry — these pages
are reachable by direct URL through `DashboardLayout`. If nav entries are
wanted, the owning workstream can append e.g.
`{ icon: MonitorCheck, label: "Policy Monitor", path: "/policy-monitor" }`,
`{ icon: Library, label: "Reg Intel", path: "/reg-intel" }`,
`{ icon: Scale, label: "Regulator Reconciliation", path: "/regulator-reconciliation" }`
to an appropriate section.

## Defensive-coding notes (response shapes)

Routers return raw SQL rows (`any[]`), so all row access uses optional
chaining / `?? "—"` fallbacks. Specific assumptions:
- `monitored_policies` rows: assumed columns `consecutive_failures`,
  `next_check_at`, `notes`, `enabled`, `check_interval_hours` (from router SQL
  `SELECT p.*` + overview query references).
- `policy_reviews` rows: assumed `controller_notified`, `notification_channel`,
  `decision`, `decision_notes`, `escalation_reason`, `escalated_to_investigation`,
  `assigned_to` (from mutation UPDATE ... RETURNING * columns).
- `regulatorDashboard` shape `{ conflicts, referrals, recentConflicts,
  recentReferrals }` taken directly from the router return; snake_case count
  fields rendered defensively (`v == null ? "—"`).
- `case_referrals.regulators` on conflicts is a jsonb array but may arrive
  stringified — `parseRegulators()` handles both.
- Client duplicates `REGULATOR_CODES` locally (server exports it from the
  router file, but importing server files into the client bundle is avoided).

## Validation

- `node --max-old-space-size=3072 node_modules/typescript/bin/tsc --noEmit`
  → **35 errors, all pre-existing baseline** (CrossBorderDeclarationsReview,
  InternationalCooperation, MinorsConsent, PenaltyCalculator, UssdIntakeQueue,
  server files incl. pre-existing `server/routers/regulatorReconciliation.ts`).
  **Zero errors in `PolicyMonitor.tsx`, `RegIntel.tsx`,
  `RegulatorReconciliation.tsx`, `App.tsx`.**
- No new DB tables, no server edits.
