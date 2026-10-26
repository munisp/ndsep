# Round-16 W4 Report — ML Ops Console, Automation Rules, Duplicate-Router Unmount List

## Deliverables

| Item | Path | Notes |
| --- | --- | --- |
| ML/AI operations console | `client/src/pages/MlOpsConsole.tsx` | 4 tabs (Models / GNN / Lakehouse / Drift & Retrain); wires **all 34 procedures** of the `mlProduction` (11), `gnn` (10) and `lakehouseAnalytics` (13) namespaces from `server/routers/aimlRouter.ts`. Admin-gated. |
| Automation rules console | `client/src/pages/AutomationRules.tsx` | 6 tabs wiring **all procedures** of `transferApprovalRules` (list/create/update/delete), `transferAutoApproval` (getRules/upsertRule/applyRules), `dsarAutomation` (getDeadlineAlerts/autoAssign/bulkExtend/getWorkflowStats), `breachLifecycle` (getTimeline/submitNotification/getComplianceStats), `retentionScheduler` (getStatus/getExpiredRecords), `onboardingAutomation` (getOrgProgress). Enable/disable toggles, run-now where exposed, threshold editors, last-run status. Admin-gated. |
| OSIRIS feed status card | `client/src/components/OsirisFeedStatusCard.tsx` | `osirisIntelFeed.feedStatus` (watermarks, per-source counts, last poll) + admin `triggerPoll` with source picker. Mounted as an additive status strip at the top of `client/src/pages/AdverseMediaReview.tsx` (existing tabs / bulk bar / source chips untouched). |
| Routes | `client/src/App.tsx` | `/ml-ops`, `/automation-rules` under the `{/* Round-16 W4 */}` block; lazy imports. Nav entries added to `client/src/components/DashboardLayout.tsx` ("AI & Intelligence" → ML Ops Console; "Admin & Settings" → Automation Rules). |

No server files were edited; no new tables.

## Duplicate-router unmount list (for the integrator — do NOT delete routers, just unmount)

The following 14 mounts in `server/routers.ts` (lines ~335–348 and ~424) re-expose generic
CRUD routers from `server/routers/enhancements.ts` that duplicate an existing canonical
namespace. None of the 14 are referenced anywhere in `client/src` (verified via grep),
so unmounting is client-safe.

| # | Namespace (mount) | enhancements.ts router | Canonical namespace it duplicates | Evidence |
| --- | --- | --- | --- | --- |
| 1 | `auditLogs` | `auditLogsRouter` | `siem.auditLogs` (routers.ts ~L835, `getAuditLogs`) | `AuditLogViewer.tsx` uses `trpc.siem` |
| 2 | `compliancePolicies` | `compliancePoliciesRouter` | `compliance.policies` / `compliance.deletePolicy` (routers.ts ~L663) | canonical `compliance` router serves policies CRUD |
| 3 | `dataCatalog` | `dataCatalogRouter` | `catalog` (routers.ts ~L754) | `DataCatalog.tsx` uses `trpc.catalog` |
| 4 | `enforcementActions` | `enforcementActionsRouter` | `compliance.enforcementActions` / `compliance.createAction` (routers.ts ~L674); case view in `enforcementCases` | `EnforcementCases.tsx` uses `trpc.enforcementCases` |
| 5 | `penaltyAppeals` | `penaltyAppealsRouter` | `financial.appeals` / `financial.reviewAppeal` (routers.ts ~L1017) + `appealsDueProcess` | `AppealsDueProcess.tsx` uses `trpc.appealsDueProcess` |
| 6 | `threatIntelligence` | `threatIntelligenceRouter` | `siem.threatIntel` (routers.ts ~L831, `getThreatIntelligence`) + `osirisIntel` | `ThreatIntelligenceDashboard.tsx` uses `trpc.osirisIntel` |
| 7 | `streamingEvents` | `streamingEventsDbRouter` | `streaming` (routers.ts ~L1145, events/topicStats/kafkaStatus) | `StreamingEvents.tsx` uses `trpc.streaming` |
| 8 | `configSnapshots` | `configSnapshotsRouter` | `gitopsConfig` (routers.ts ~L2181; same `config_snapshots` table, see L2202) | `GitopsConfig.tsx` uses `trpc.gitopsConfig` |
| 9 | `mlRiskPredictions` | `mlRiskPredictionsRouter` | `aiRiskScoring` (routers.ts ~L3556) | `AiRiskEngine.tsx` uses `trpc.aiRiskScoring` |
| 10 | `dpcoAuditLogs` | `dpcoAuditLogsRouter` | `dpco` (`server/routers/dpco.ts` — audit engagements/logs surface) | dpco router owns DPCO audit trail |
| 11 | `dpcoPerformanceMetrics` | `dpcoPerformanceMetricsRouter` | `dpco` (`server/routers/dpco.ts` ~L1637 reads `dpco_performance_metrics`) | canonical metrics reader in dpco router |
| 12 | `i18n` | `i18nRouter` | client-side i18next bundles (`client/src/lib/i18n.ts`, `i18nCitizen.ts`, `useT` hook) | no server caller of `getTranslations`/`upsertTranslation`/`aiTranslate` anywhere |
| 13 | `aiSystems` | `aiSystemsRouter` | `aiGovernance` — the **same** `aiSystemsRouter` object is mounted twice (routers.ts L328 and L335) | identical router, double mount |
| 14 | `transferImpact` | `transferImpactRouter` | `tia` (routers.ts ~L2102) + `tiaAssessments` (routers.ts L423) | `TiaAssessments.tsx` uses `trpc.tia` |

Note: `tiaAssessments` (also from enhancements.ts) is **not** on the unmount list but is
likewise a candidate duplicate of `tia`; flagged for a future pass.

## Validation

- `node --max-old-space-size=3072 node_modules/typescript/bin/tsc --noEmit`: 35 errors before and after (baseline 35, zero new errors).
- No edits to `server/routers.ts` or any other server file.
