# Round-10 Permify Wiring Guide — Resource-Scoped ReBAC for Round-8/9 Entities

Status: schema + sync helpers + check wrappers **implemented** (this round).
Router call-site wiring is **documented here, not yet applied** (role gates are
owned by another lane; do not edit routers without coordinating).

## What round 10 added

### 1. Schema (`server/permify.ts`)

`NDSEP_SCHEMA` (now an exported module-level const consumed by
`permifyBootstrapSchema()` and by `tests/round10/permifySchema.test.ts`) gained
16 resource-scoped entities for the round-8/9 surfaces, following the existing
`enforcement_case` / `dsar_request` pattern (direct user relations + an
`@organization` parent so org admins / compliance officers inherit visibility):

| Entity | Relations | Actions |
|---|---|---|
| `public_complaint` | assignee, controller(@org) | view, manage |
| `settlement` | initiator, approver, organization | view, approve, manage |
| `publication_document` | editor, approver, organization | view, publish, manage |
| `tribunal_bundle` | assembler, verifier, organization | view, verify, export, manage |
| `hosting_declaration` | declarant, reviewer, organization | view, review, manage |
| `transfer_declaration` | declarant, reviewer, organization | view, review, manage |
| `scan_target` | owner, organization | view, manage |
| `scan_finding` | assignee, organization | view, triage |
| `supervision_plan` | owner, assignee, organization | view, approve, manage |
| `verified_revenue` | filer, verifier, organization | view, verify, manage |
| `identity_verification` | subject, reviewer | view, manage |
| `ussd_intake` | assignee, organization | view, manage |
| `adverse_media_item` | reviewer, organization | view, triage |
| `ai_system` | owner, assessor, organization | view, assess, manage |
| `mutual_assistance_request` | requester, handler | view, manage |
| `legal_instrument` | custodian, publisher | view, publish, manage |

`ROUND10_RESOURCE_TYPES` in `server/permify.ts` enumerates these entity names;
the vitest asserts the schema defines every one (drift = test failure).

### 2. Check wrappers (`server/permify.ts`)

- `checkResourcePermission(subjectId, { type, id }, action): Promise<boolean>`
  — fail-closed boolean check (denies on Permify outage, like `permifyCheck`).
- `requireResourcePermission(subjectId, { type, id }, action): Promise<void>`
  — throwing variant (`FORBIDDEN`), for use inside mutations.
- `permifyDeleteRelationship(resourceType, resourceId, relation?, subjectId?)`
  — tuple deletion; omitting relation/subject deletes **all** tuples for the
  entity (lifecycle cleanup).

### 3. Tuple-sync helpers (`server/permifySync.ts`)

All helpers are idempotent, PERMIFY_ENABLED-gated, and enqueue into the
existing bounded retry queue on failure (CRITICAL log after 5 attempts).
Organization parents are written with `subjectType: "organization"` via the
direct Permify API (the middleware-bridge writer hardcodes user subjects —
that legacy quirk is **not** propagated to these helpers).

| Helper | Writes |
|---|---|
| `syncComplaintAssignment(complaintId, assigneeId, orgId?)` | public_complaint#id assignee, controller |
| `syncSettlementParties(settlementId, {initiatorId?, approverId?, orgId?})` | settlement relations |
| `syncPublicationDocument(documentId, {editorId?, approverId?, orgId?})` | publication_document relations |
| `syncTribunalBundle(bundleId, {assemblerId?, verifierId?, orgId?})` | tribunal_bundle relations |
| `syncHostingDeclaration(declarationId, {declarantId?, reviewerId?, orgId?})` | hosting_declaration relations |
| `syncTransferDeclaration(declarationId, {declarantId?, reviewerId?, orgId?})` | transfer_declaration relations |
| `syncScanTarget(targetId, ownerId, orgId?)` | scan_target owner, organization |
| `syncScanFindingAssignment(findingId, assigneeId, orgId?)` | scan_finding assignee, organization |
| `syncSupervisionPlan(planId, {ownerId?, assigneeId?, orgId?})` | supervision_plan relations |
| `syncVerifiedRevenue(revenueId, {filerId?, verifierId?, orgId?})` | verified_revenue relations |
| `syncIdentityVerification(verificationId, {subjectId?, reviewerId?})` | identity_verification relations |
| `syncUssdIntakeAssignment(intakeId, assigneeId, orgId?)` | ussd_intake assignee, organization |
| `syncAdverseMediaItem(itemId, reviewerId, orgId?)` | adverse_media_item reviewer, organization |
| `syncAiSystem(systemId, {ownerId?, assessorId?, orgId?})` | ai_system relations |
| `syncMutualAssistanceRequest(requestId, {requesterId?, handlerId?})` | mutual_assistance_request relations |
| `syncLegalInstrument(instrumentId, {custodianId?, publisherId?})` | legal_instrument relations |
| `deleteResourceTuples(entityType, entityId)` | removes all tuples for an entity on deletion |

## Router call sites (wiring to apply — do NOT gate twice; keep existing role gates as the coarse layer, add these as the resource-scoped layer)

### publicComplaints (`server/routers/publicComplaints.ts`)
- `assign` (~L477): after the assignment UPDATE →
  `await syncComplaintAssignment(input.complaintId, input.officerId, complaint.controller_id)`.
- `submitComplaint` (~L221): when `controllerId` is resolved →
  `await syncComplaintAssignment(complaint.id, null, controllerId)` — a null
  assignee writes only the controller link (no assignee exists at intake).
- Checks: `get` / `list` detail reads may add
  `await checkResourcePermission(ctx.user.id, { type: "public_complaint", id }, "view")`
  as defence-in-depth under the existing staffProcedure gate.

### settlementWorkflow (`server/routers/settlementWorkflow.ts`)
- `proposeSettlement` (~L247) → `syncSettlementParties(settlementId, { initiatorId: ctx.user.id, orgId })`.
- `submitForApproval` / `approveSettlement` (~L366/L385) →
  `syncSettlementParties(settlementId, { approverId })`; gate approval with
  `requireResourcePermission(ctx.user.id, { type: "settlement", id }, "approve")`
  (in addition to the existing staff/admin gate and dual-control rules).

### publicationWorkbench (`server/routers/publicationWorkbench.ts`)
- Document creation (router body near L226) →
  `syncPublicationDocument(docId, { editorId: ctx.user.id, orgId })`.
- `approve` (~L461) → `syncPublicationDocument(docId, { approverId: ctx.user.id })`.
- `publish` (~L553) → optional resource check
  `requireResourcePermission(ctx.user.id, { type: "publication_document", id }, "publish")`.
- `withdraw` (~L712) → `deleteResourceTuples("publication_document", id)`.

### tribunalBundle (`server/routers/tribunalBundle.ts`)
- `assembleBundle` (~L285) → `syncTribunalBundle(bundleId, { assemblerId: ctx.user.id, orgId })`.
- `approveExport` (~L575, dual control) →
  `requireResourcePermission(ctx.user.id, { type: "tribunal_bundle", id }, "export")`
  under the existing adminProcedure gate; designate verifiers with
  `syncTribunalBundle(bundleId, { verifierId })`.

### dataSovereignty (`server/routers/dataSovereignty.ts`)
- `submitDeclaration` (~L231) →
  `syncHostingDeclaration(declarationId, { declarantId: ctx.user.id, orgId })`.
- `reviewDeclaration` (~L259) →
  `syncHostingDeclaration(declarationId, { reviewerId: ctx.user.id })` and gate
  with `requireResourcePermission(…, "hosting_declaration", "review")`.

### crossBorderDeclarations (`server/routers/crossBorderDeclarations.ts`)
- `submit` (~L198) →
  `syncTransferDeclaration(declarationId, { declarantId: ctx.user.id, orgId })`.
- `withdraw` (~L313) → `deleteResourceTuples("transfer_declaration", id)`.
- Staff review surfaces → `syncTransferDeclaration(id, { reviewerId })`.

### complianceScanning (`server/routers/complianceScanning.ts`)
- `addTarget` (~L186) → `syncScanTarget(targetId, ctx.user.id, orgId)`.
- `setFindingStatus` / `referFindingToEnforcement` (~L460/L491) →
  `syncScanFindingAssignment(findingId, ctx.user.id, orgId)` and gate triage
  with `checkResourcePermission(…, "scan_finding", "triage")`.

### supervisionRisk (`server/routers/supervisionRisk.ts`)
- `generateAnnualPlan` (~L534) → `syncSupervisionPlan(planId, { ownerId: ctx.user.id })`.
- `assignPlanItem` (~L657) → `syncSupervisionPlan(planId, { assigneeId })`.
- `approvePlan` (~L642) → `requireResourcePermission(…, "supervision_plan", "approve")`.

### revenueVerification (`server/routers/revenueVerification.ts`)
- `submitManualFiling` (~L411) → `syncVerifiedRevenue(filingId, { filerId: ctx.user.id, orgId })`.
- `verifyManualFiling` (~L501) → `syncVerifiedRevenue(filingId, { verifierId: ctx.user.id })`
  + `requireResourcePermission(…, "verified_revenue", "verify")`.

### ninIdentity (`server/routers/ninIdentity.ts`)
- `verifyBasic` / `verifyNin` (~L231/L283) →
  `syncIdentityVerification(verificationId, { subjectId: ctx.user?.id ?? null })`.
- `revoke` (~L423) → `deleteResourceTuples("identity_verification", id)`.

### ussdChannel (`server/routers/ussdChannel.ts`)
- `syncPendingIntake` (~L543) / officer claim in `listIntakeQueue` flow →
  `syncUssdIntakeAssignment(queueId, officerId)`.

### adverseMedia (`server/routers/adverseMedia.ts`)
- `ingestManualItem` (~L292) → `syncAdverseMediaItem(itemId, ctx.user.id, orgId)`.
- `confirmItem` / `rejectItem` (~L166/L198) → gate with
  `checkResourcePermission(…, "adverse_media_item", "triage")`.

### aiRegulation (`server/routers/aiRegulation.ts`)
- `createAssessment` (~L76) / `applyForPermit` (~L110) →
  `syncAiSystem(systemId, { ownerId: ctx.user.id, orgId })`.
- `startConformityAssessment` (~L209) → `syncAiSystem(systemId, { assessorId: ctx.user.id })`
  + gate with `requireResourcePermission(…, "ai_system", "assess")`.

### internationalCooperation (`server/routers/internationalCooperation.ts`)
- `createRequest` (~L179) →
  `syncMutualAssistanceRequest(requestId, { requesterId: ctx.user.id })`.
- `transitionRequest` (~L211) →
  `syncMutualAssistanceRequest(requestId, { handlerId: ctx.user.id })`.

### regIntel (`server/routers/regIntel.ts`)
- `createInstrument` (~L214) →
  `syncLegalInstrument(instrumentId, { custodianId: ctx.user.id })`.
- `addVersion` (~L244, publishing a new version) →
  `syncLegalInstrument(instrumentId, { publisherId: ctx.user.id })` and gate
  with `requireResourcePermission(…, "legal_instrument", "publish")`.

## Operational notes

- Schema bootstrap runs at API startup (`server/_core/index.ts` →
  `permifyBootstrapSchema()`); it is idempotent and ships these entities.
- Every check fails closed: Permify unreachable ⇒ deny.
- Tuple writes never block the request path on Permify: failures enter the
  retry queue and CRITICAL-log after exhaustion for operator reconciliation.
- `deleteResourceTuples` MUST be called on hard delete / merge /
  withdraw flows so a recycled primary key can never inherit stale grants.
