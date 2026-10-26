# Round 16 — Workstream 5: Mobile Endpoint Rebinding + Coverage Extension

**Scope:** `mobile/flutter` (primary), `mobile/react-native` (secondary). `mobile/app` (IDLR-PTS) untouched.
**Source of truth:** `server/routers.ts` appRouter mount map + router files.

## 1. Endpoint binding fixes (old → new)

Audit claims that turned out to be **false positives** (verified in `server/routers.ts`): `audit.list`/`security.alerts`/`enforcement.cases` were already corrected in a prior pass (`auditLogs.list`, `siem.alerts`, `enforcementCases.list`), and `orchestration.issuePenalty`/`orchestration.disputePenalty` **do exist** (routers.ts L1575+) — kept as-is.

### Flutter (`mobile/flutter/lib/services/api_service.dart`)

| Old (broken) | New (real) | Notes |
|---|---|---|
| `organizations.get` | `organizations.byId` | mount key renamed |
| `citizenRights.create` | `citizenRights.submit` | procedure renamed |
| `citizenRights.list {limit}` | `citizenRights.list {status?, requestType?}` | server input has no `limit` |
| `siem.resolveAlert {id}` | `siem.resolveAlert {alertId}` | wrong input key |
| `assets.list {organizationId}` | `assets.list {orgId}` | wrong input key |
| `notifications.markRead {id?, all}` | `notifications.markRead {id}` / `notifications.markAllRead {}` | `all` flag not a server input; routed internally |
| `banking.kyc.submit` | `banking.kyc.create` | procedure renamed |
| `banking.payments.list` | `banking.payments.listNip` | no `list` proc on payments router |
| `remediation.list {limit}` | `remediation.list {status?}` | server input `{orgId?, status?}` |
| `remediation.create {organizationId,title,dueDate}` | `remediation.create {orgId,actionType,priority,description,notes}` | wrong input keys |
| `remediation.complete` | `remediation.update {id,status:'completed'}` | procedure does not exist |
| `tia.create {transferDestination,dataCategories:string}` | `tia.create {destinationCountry, legalBasis (required), dataCategories:string[], riskLevel}` | wrong keys; legalBasis required |
| `tia.list {limit}` | `tia.list {}` | server input `{orgId?}` only |
| `financial.penalties {limit,organizationId}` | `financial.penalties {limit}` | orgId not a server input |
| `compliance.violations {…,organizationId}` | `compliance.violations {limit,severity}` | orgId not a server input |

Screens fixed directly (phantom `ApiService.instance.get/post` — a client API that never existed):
- `compliance/breach_incidents_screen.dart` — raw REST `breachIncidents.list/create` with wrong payload/parsing → real tRPC calls; `{data,total}` envelope + snake_case rows.
- `compliance/consent_management_screen.dart` — same; create now sends required `organizationId/dataSubjectName/dataSubjectEmail/purpose/lawfulBasis`.
- `compliance/dpia_screen.dart` — `dpiaAssessments.list` → `dpia.list`; snake_case fields (`dpia_risk_level`, `dpia_status`).
- `compliance/dpo_registry_screen.dart` — `dpoAppointments.list` with `{page,limit}` input, `{data}` envelope, snake_case fields.
- `financial/financial_enforcement_screen.dart` — `createPenalty` called with non-existent named args (`reason`, string `amount`) → real signature.
- `enforcement/penalty_detail_screen.dart` — `disputePenalty` positional args → named args against `orchestration.disputePenalty`; receipt fields fixed (`amount/currency/paymentStatus/orgName/createdAt`); dispute disabled with a graceful "not available" state when org context isn't passed (receipt has no org id).
- `enforcement/remediation_workflows_screen.dart` — create fields (actionType/notes), statuses `pending/in_progress/completed/overdue/cancelled`.
- `tia/tia_assessments_screen.dart` — destination/legal-basis-required create.
- `banking/banking_dashboard_screen.dart`, `dpco/dpco_portal_screen.dart` — fixed invalid method tear-offs (`Future Function()` closures).
- `enforcement/enforcement_screen.dart` — snake_case case fields (`case_reference`, `escalation_reason`, `org_name`), real statuses, penalty fields (`paymentStatus/amount/currency/description`), navigation to case/penalty detail.
- Tests updated: `test/unit/api_service_unit_test.dart`, `test/integration/api_integration_test.dart` (removed `financial.issuePenalty`, `banking.kyc.submit`, `complianceLeaderboard.list` phantom paths; `siem.resolveAlert` now sends `alertId`).

### React Native (`mobile/react-native`) — typed client was functional; fixed bindings:

| Old (broken) | New (real) |
|---|---|
| `financial.issuePenalty` (×2) | `financial.createPenalty` (`{organizationId,amount,currency,description}`) |
| `financial.disputePenalty` | `orchestration.disputePenalty` (degraded gracefully w/o orgId route param) |
| `financial.penalties {paymentStatus}` | `{limit}` + client-side status filter |
| `dpiaAssessments.list` (raw fetch) | `dpia.list` + correct `{result.data.json}` envelope |
| `breachIncidents.list` / `consentRecords.list` / `dpoAppointments.list` (raw fetch, no auth/input) | same paths + `?input=` encoding, Bearer token, `{data}` envelope, snake_case fields |
| `bankingServices.institutionStats/listInstitutions` | `banking.institutions.institutionStats/listInstitutions` |
| `dpco.listEngagements` | `dpco.listAuditEngagements` |
| `organizations.get` | `organizations.byId` |
| `citizenRights.create` / `.list {limit}` | `citizenRights.submit` / `.list {}` |
| `remediation.complete` / `.create` / `.list {limit}` | `remediation.update {status:'completed'}` / `{orgId,actionType,…}` / `{status}` |
| `siem.resolveAlert {id}` | `siem.resolveAlert {alertId}` |
| `notifications.markRead {all:true}` | `notifications.markAllRead {}` |
| `tia.create {transferDestination,…}` | `{destinationCountry, legalBasis, dataCategories: string[], riskLevel}` |

## 2. New screens

### Flutter
- `lib/screens/complaints/complaints_screen.dart` — staff triage queue: stats row (`publicComplaints.stats`), filter chips (status/category/SLA-breached/unassigned), list (`publicComplaints.list`), detail sheet with status timeline + attachments (`publicComplaints.get`), public track-by-reference dialog (`publicComplaints.trackComplaint`).
- `lib/screens/sovereignty/data_sovereignty_screen.dart` — 3 tabs: Verdicts (`hostingVerification.listVerdicts` + `.stats`, per-declaration evidence via `.declarationVerdict`), Score Register (`dataSovereignty.scoreRegister`), Sector Heat Map (`dataSovereignty.sectorHeatMap`).
- `lib/screens/enforcement/enforcement_case_detail_screen.dart` — case row + timeline (`enforcementCases.list` + `enforcementCases.timeline`).
- `lib/screens/enforcement/settlements_screen.dart` — settlement list + detail with terms/approvals/instalments (`settlementWorkflow.listSettlements` / `.getSettlement`).
- Navigation: routes `/complaints`, `/data-sovereignty`, `/settlements`, `/enforcement/cases/:id`, `/penalties/:id` (+orgId/amount query); drawer entries in main.dart shell.

### React Native
- `src/screens/ComplaintsScreen.tsx`, `DataSovereigntyScreen.tsx`, `SettlementsScreen.tsx`, `EnforcementCaseDetailScreen.tsx` (same endpoints as Flutter).
- Wired into `AppNavigator.tsx` (drawer entries + stack detail screens); enforcement case/penalty cards navigate to detail.

## 3. Graceful degradation
- Penalty dispute: `orchestration.disputePenalty` requires `orgId`+`amountUsd` which the receipt payload lacks → dispute button disabled with a "not available here — open from Enforcement list" state unless org context is passed via route (both Flutter & RN).

## 4. Validation
- Flutter SDK downloaded to `/tmp` during the session for `dart analyze` (result appended below / noted in the final report).
- Manual review pass over every edited file for type/shape consistency against server router zod inputs and db row shapes (snake_case raw SQL vs drizzle camelCase).
- No new dependencies added (pubspec unchanged).
