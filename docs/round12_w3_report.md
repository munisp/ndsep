# Round-12 Workstream 3 — De-duplication & Orphaned-Router UI Report

Scope: eliminate duplicated data entry (DPCO onboarding, DPIA, org identity),
build UIs for orphaned routers (`revenueVerification`, `finePayments`).

## Files created

| File | Purpose |
|---|---|
| `server/routers/orgIdentity.ts` | NEW read-only router. `lookupByRegistrationRef` (publicProcedure) resolves a CAC RC/BN number / NDPC reference / DPCO licence number against `organizations`, `public_compliance_registry`, `dpco_organisations`. Defensive per-source failure handling; no writes, no new tables. Exports `orgIdentityRouter` and type `OrgIdentityMatch`. |
| `client/src/components/OrgIdentityPrefill.tsx` | NEW shared lookup component (input + "Look up" + match card) calling `orgIdentity.lookupByRegistrationRef`; `onResolved(identity)` callback pre-fills the host form. |
| `client/src/pages/DpcoOnboarding.tsx` | NEW unified DPCO wizard: organisation details (with OrgIdentityPrefill) → services & contact → accreditation (lead auditors + sectors) → evidence & declaration → confirmation. Submission sequence: `dpco.registerOrganisation` (CONFLICT tolerated → continues) then `accreditation.submitApplication` linked via `existingDpcoOrgId`. |
| `client/src/pages/DpiaWorkspace.tsx` | NEW unified DPIA page. Tab "Assessments register" = `dpia.list/create/update/delete`; tab "Guided wizard" = `dpiaWizard.list/create/aiAnalyse`. |
| `client/src/pages/RevenueVerification.tsx` | NEW console wiring EVERY revenueVerification procedure: `verifyTin`, `lookupFiledRevenue` (with persist), `lookupCorporateRecord`, `submitManualFiling`, `attestManualFiling`, `verifyManualFiling`, `transitionRevenueStatus`, `listVerifiedRevenues`, `getRevenueHistory`, `computePenaltyPreview`, `recomputeFine`, `listPenaltyComputations`, `integrationStatus`, `listIntegrationAudit`. |

## Files converted to thin wrappers (routes keep working, no deletions)

- `client/src/pages/DpcoRegister.tsx` → re-exports `DpcoOnboarding` (`/register`)
- `client/src/pages/DpcoApply.tsx` → re-exports `DpcoOnboarding` (`/dpco/apply`)
- `client/src/pages/DpcoOnboard.tsx` → re-exports `DpcoOnboarding` (`/dpco/onboard`)
- `client/src/pages/DpiaWizard.tsx` → re-exports `DpiaWorkspace` (`/dpia-wizard`)
- `client/src/pages/DpiaAssessments.tsx` → re-exports `DpiaWorkspace` (`/dpia`)
- `client/src/pages/PrivacyImpactAssessment.tsx` → RETIRED, re-exports `DpiaWorkspace` (`/pia`); its `phase12.pia.*` procedures now have no client consumer.

## Files edited (in place)

- `client/src/pages/PublicComplaintPortal.tsx` — `OrgIdentityPrefill` wired into the controller-identity block (fills controller name, registration ref, state).
- `client/src/pages/DataSovereigntyDashboard.tsx` — new "Submit declaration" tab: full hosting-declaration form (`dataSovereignty.submitDeclaration`, ~16 fields) with `OrgIdentityPrefill` filling entity_ref/entity_name.
- `client/src/pages/CrossBorderDeclarationsReview.tsx` — new "New declaration" tab: `crossBorderDeclarations.submit` form with `OrgIdentityPrefill` resolving the declaring organisation (orgId).
- `client/src/pages/FinePayments.tsx` — unified onto the canonical `finePayments` router: `generateRrr` (RRR dialog + dev `simulateRrrSettlement`), `runReconciliationBatch` + `reconciliationQueue` + `reconciliationHistory`, `requestRefund`/`listRefunds`/`decideRefund` (approve/reject/confirm-payout), `listReceipts`/`resendReceipt`. The parallel `phase12.fines.initiatePayment` (Stripe) path is no longer called. `phase12.fines.listFines/getStats/issueFine/waiveFine` are retained ONLY because `finePayments` intentionally has no fine-register procedures.
- `server/routers/phase12Features.ts` — deprecation comment above `finesRouter` (payment procedures deprecated in favour of `finePayments`; procedures NOT deleted).
- `client/src/App.tsx` — lazy imports + routes for the three new pages (see below).

## Integrator actions required

1. **Mount the new server router** in `server/routers.ts`:
   ```ts
   import { orgIdentityRouter } from "./routers/orgIdentity";
   // inside appRouter:
   orgIdentity: orgIdentityRouter,
   ```
   Until mounted, `OrgIdentityPrefill` reaches the procedure through a typed
   `(trpc as any)` alias (`trpcAny` in OrgIdentityPrefill.tsx) — remove that
   alias once the AppRouter type includes `orgIdentity`.
2. **New client routes** (already registered in App.tsx):
   - `/dpco/onboarding` → `DpcoOnboarding` (canonical; old routes redirect via wrappers)
   - `/dpia/workspace` → `DpiaWorkspace` (canonical)
   - `/revenue-verification` → `RevenueVerification`

## Known issues / residual risk

- No `npm/tsc/vitest` was run (per constraints). Syntax validated by manual review + bracket-balance check only; a full typecheck should be run after the orgIdentity mount.
- `revenueVerification` admin/staff procedures (`lookupFiledRevenue`, `verifyManualFiling`, `transitionRevenueStatus`, `computePenaltyPreview`, `recomputeFine`, `integrationStatus`, `listIntegrationAudit`, `submitManualFiling`, `attestManualFiling`) will return 403 for non-staff users — the console surfaces the error via toast; consider gating the route to staff roles in the layout.
- `listPenaltyComputations` FORBIDDEN for org users without an organisation context unless an orgId filter is entered.
- `phase12.pia.*` procedures are now fully orphaned server-side (kept for compatibility; deprecation note added to phase12 fines only, per mission scope).
- `dpco.upsertOrganisation` no longer has a client caller (the unified flow uses `registerOrganisation` + `accreditation.submitApplication`); it remains available for authenticated org-profile editing.
- CrossBorderDeclarationsReview's new submission tab uses `crossBorderDeclarations.submit` (protectedProcedure) from a staff-facing page; org self-service submission would need a separate surface.
