# Manual Review, Reviewer Decisions, and Stakeholder Profile Validation

## Manual-review routing

The current onboarding route uses `approveIdentityDocument` as an inbox-triggered action. Despite its historical name, the function does **not** approve a document or confer external trust. It changes the document to `requires_review`, records `manual_review` provenance, writes an explicit warning, queues a mutation, recalculates readiness, and persists the bundle.

```ts
export function approveIdentityDocument(input: { documentId: string }) {
  const store = readStore();
  const document = store.onboarding.identityDocuments.find((item) => item.id === input.documentId);
  if (!document) throw new Error("Identity document not found");

  document.status = "requires_review";
  document.analysisProvenance = "manual_review";
  document.analysisReason =
    "A manual review was requested from the inbox. This action does not verify identity, NIN, BVN, CAC, TIN, or document authenticity.";
  queueMutation(store, { type: "onboarding_document", recordId: document.id, queuedAt: new Date().toISOString() });
  refreshReadiness(store);
  store.syncMeta = buildSyncMeta(store, "live");
  writeStore(store);
  return { document };
}
```

| Action | Persisted state | What it means | What it does **not** mean |
|---|---|---|---|
| Document upload | `pending` or analysis-specific status | Evidence is available for screening or review | Authenticity or authority has been established |
| Manual-review request | `requires_review`, `manual_review` provenance | A reviewer queue action was created | A reviewer approved the document |
| Configured authority-provider verification | `verified`, with provider evidence | An authorised integration returned a valid result | General title, identity, or registration truth beyond that provider’s scoped response |

## Readiness and trust updates

`refreshReadiness` recomputes a seven-item checklist from persisted statuses. Each verified item contributes equally to the readiness percentage. It sets the aggregate onboarding workflow status to `verified` at 100%, `in_review` at 57% or above, otherwise `draft`.

```ts
const checklist = [
  { key: "nin", completed: store.onboarding.ninStatus === "verified" },
  { key: "bvn", completed: store.onboarding.bvnStatus === "verified" },
  { key: "liveness", completed: store.onboarding.livenessStatus === "verified" },
  { key: "kyc_documents", completed: store.onboarding.identityDocuments.filter((item) => item.status === "verified").length >= 2 },
  { key: "cac", completed: store.onboarding.businessProfile.cacStatus === "verified" },
  { key: "tin", completed: store.onboarding.businessProfile.tinStatus === "verified" },
  { key: "kyb_documents", completed: store.onboarding.businessProfile.documents.filter((item) => item.status === "verified").length >= 1 },
];
```

> **Important:** this is a workflow-readiness calculation. It is not by itself a trustworthy external verification decision. The implementation must only permit `verified` source statuses from an authorised reviewer or configured authority-provider boundary.

The liveness path contains a separate hard guard: an input cannot be recorded as verified unless `verificationMethod === "challenge_video"`. A single-image capture therefore remains a review-routing artefact, not a verified liveness result.

## Profile input validation and error states

The mobile form maintains its fields locally and submits via `submitBusinessProfile`. It maps blank fields to `null`, wraps submission in `try/catch`, and shows native alerts for success or failure.

```tsx
async function submitBusiness() {
  try {
    await submitBusinessProfile({
      stakeholderType: form.stakeholderType,
      companyName: form.companyName || null,
      cacNumber: form.cacNumber || null,
      tinNumber: form.tinNumber || null,
      businessEmail: form.businessEmail || null,
      businessPhone: form.businessPhone || null,
      businessAddress: form.businessAddress || null,
      contactPerson: form.contactPerson || null,
      // Existing workflow and evidence fields are retained.
    });
    Alert.alert("Business profile saved", "The KYB profile has been synchronized to the live mobile API.");
  } catch (error) {
    Alert.alert("Profile save failed", error instanceof Error ? error.message : "Please try again.");
  }
}
```

The API schema currently provides **structural** validation: it constrains stakeholder type, status enums, document evidence fields, and expected nullable string fields. It does **not** currently enforce content-level rules such as required company fields for a business applicant, CAC-number syntax, TIN syntax, email format, phone format, or field-level inline messages.

| Current control | Behaviour | Gap to close for production intake |
|---|---|---|
| Local form state | Inputs update React state immediately | Add touched/error state and input-level feedback |
| Submit error handling | Catches mutation failures and shows an alert | Keep field-specific server validation errors and focus the first invalid field |
| Server schema | Enforces enums and data shape | Add conditional business requirements, `z.string().email()`, normalized phone/CAC/TIN rules, and length limits |
| Provider health | Warns when CAC/Docling services are unavailable | Prevent users from interpreting profile save as verification |

## Recommended reviewer-decision hardening

The current named reviewer action only creates manual review. A production decision flow should add an authorised reviewer identity, decision (`approved` or `rejected`), reason, timestamp, immutable audit event, and explicit provider-evidence references. That decision must not silently set NIN, CAC, TIN, or liveness verification unless the reviewer has authority for that exact trust claim and the required evidence is present.

## Source files

- `app/onboarding.tsx` — form inputs, picker and liveness UI, client errors.
- `server/routers.ts` — Zod input shape for the profile and document routes.
- `server/mobilePlatformRepository.ts` — readiness calculation, liveness restriction, and manual-review routing.
- `lib/mobile-sync.ts` — mutations and post-mutation bundle invalidation.
