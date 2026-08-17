# Field-Level Stakeholder Validation Patch and Review Persistence

## Current persistence boundary

The current relational Drizzle schema contains users, permitting agencies, permit cases, permit obligations, middleware components, and service topology. It **does not** define stakeholder, business-profile, identity-document, business-document, or reviewer-decision tables.

Those onboarding objects are presently held by `server/mobilePlatformRepository.ts` in a locally persisted `MobilePlatformBundle` plus a small `syncQueue`. A document review request mutates the relevant document in that local bundle, adds an `onboarding_document` queue entry, recalculates readiness, and writes the local store. This is suitable as a local/offline workflow adapter, but is not a database-backed, multi-user review ledger.

| Current object | Current storage | Review-state update |
|---|---|---|
| Stakeholder profile | `MobilePlatformBundle.onboarding.businessProfile` | `submitBusinessProfile` replaces profile values and writes the local store. |
| Identity/KYB documents | Bundle document arrays | Screening appends a document record with status, engine, confidence, provenance, reason, and upload timestamp. |
| Manual review request | Document record plus `syncQueue` | Status becomes `requires_review`; provenance becomes `manual_review`; an explicit non-verification reason is stored. |
| Readiness | Derived bundle state | `refreshReadiness` counts checklist statuses; it is workflow progress, not an authoritative trust ledger. |

## Server-side validation patch

Replace the existing permissive string fields in `server/routers.ts` with the following schemas. These validate **format and completeness**, not whether CAC/TIN/NIN claims are true; that remains an approved authority-provider action.

```ts
import { z } from "zod";

const nullableTrimmed = (max: number) =>
  z.string().trim().max(max).transform((value) => value || null).nullable();

const nigeriaPhone = z
  .string()
  .trim()
  .regex(/^(?:\+234|234|0)(?:70|71|80|81|90|91)[0-9]{8}$/, "Enter a valid Nigerian mobile number.")
  .transform((value) => value.replace(/[\s-]/g, ""));

const cacNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^(?:RC|BN|IT)[- ]?[0-9]{4,10}$/, "Enter a valid CAC/RC number, for example RC-449921.");

const tinNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^(?:TIN[- ]?)?[0-9]{8,14}$/, "Enter a valid TIN containing 8–14 digits.");

export const businessProfileSchema = z
  .object({
    stakeholderType: z.enum(["individual", "business"]),
    companyName: nullableTrimmed(160),
    cacNumber: nullableTrimmed(24),
    tinNumber: nullableTrimmed(24),
    businessEmail: z.string().trim().email("Enter a valid business email.").max(320).nullable(),
    businessPhone: z.string().trim().nullable(),
    businessAddress: nullableTrimmed(500),
    contactPerson: nullableTrimmed(160),
    onboardingStatus: z.enum(["draft", "in_review", "verified", "needs_attention"]),
    cacStatus: z.enum(["verified", "pending", "failed"]),
    tinStatus: z.enum(["verified", "pending", "failed"]),
    submittedAt: z.string().datetime().nullable(),
    verifiedAt: z.string().datetime().nullable(),
    documents: z.array(documentSchema),
  })
  .superRefine((profile, ctx) => {
    if (profile.stakeholderType !== "business") return;
    const required: Array<[keyof typeof profile, string]> = [
      ["companyName", "Company name is required for a business stakeholder."],
      ["cacNumber", "CAC/RC number is required for a business stakeholder."],
      ["tinNumber", "TIN is required for a business stakeholder."],
      ["businessEmail", "Business email is required for a business stakeholder."],
      ["businessPhone", "Business phone is required for a business stakeholder."],
      ["businessAddress", "Business address is required for a business stakeholder."],
      ["contactPerson", "Contact person is required for a business stakeholder."],
    ];
    for (const [field, message] of required) if (!profile[field]) ctx.addIssue({ code: "custom", path: [field], message });
    if (profile.cacNumber && !cacNumber.safeParse(profile.cacNumber).success)
      ctx.addIssue({ code: "custom", path: ["cacNumber"], message: "Enter a valid CAC/RC number." });
    if (profile.tinNumber && !tinNumber.safeParse(profile.tinNumber).success)
      ctx.addIssue({ code: "custom", path: ["tinNumber"], message: "Enter a valid TIN." });
    if (profile.businessPhone && !nigeriaPhone.safeParse(profile.businessPhone).success)
      ctx.addIssue({ code: "custom", path: ["businessPhone"], message: "Enter a valid Nigerian mobile number." });
  });
```

## Client-side field error patch

The mobile form should run this lightweight companion validator before mutation, retain errors by field, and still rely on the server schema as the authority.

```tsx
type ProfileErrors = Partial<Record<"companyName" | "cacNumber" | "tinNumber" | "businessEmail" | "businessPhone" | "businessAddress" | "contactPerson", string>>;

function validateBusinessProfile(form: FormState): ProfileErrors {
  const errors: ProfileErrors = {};
  if (form.stakeholderType !== "business") return errors;
  if (!form.companyName.trim()) errors.companyName = "Company name is required.";
  if (!/^(?:RC|BN|IT)[- ]?\d{4,10}$/i.test(form.cacNumber.trim())) errors.cacNumber = "Use a CAC/RC format such as RC-449921.";
  if (!/^(?:TIN[- ]?)?\d{8,14}$/i.test(form.tinNumber.trim())) errors.tinNumber = "TIN must contain 8–14 digits.";
  if (!/^\S+@\S+\.\S+$/.test(form.businessEmail.trim())) errors.businessEmail = "Enter a valid email address.";
  if (!/^(?:\+234|234|0)(?:70|71|80|81|90|91)\d{8}$/.test(form.businessPhone.replace(/[\s-]/g, ""))) errors.businessPhone = "Enter a valid Nigerian mobile number.";
  if (!form.businessAddress.trim()) errors.businessAddress = "Business address is required.";
  if (!form.contactPerson.trim()) errors.contactPerson = "Contact person is required.";
  return errors;
}

async function submitBusiness() {
  const nextErrors = validateBusinessProfile(form);
  setErrors(nextErrors);
  if (Object.keys(nextErrors).length) return;
  try {
    await submitBusinessProfile(/* existing payload */);
    Alert.alert("Business profile saved", "Profile submitted for authorised KYB review.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Please try again.";
    Alert.alert("Profile save failed", message);
  }
}
```

Each input should render an inline `<Text className="text-xs text-error">{errors.companyName}</Text>` immediately below the relevant field and use an error border when a message exists.

## Production database migration path

For a multi-user review system, add relational tables such as `stakeholders`, `stakeholder_documents`, `document_screenings`, `review_decisions`, and `trust_evidence`. Store immutable reviewer identity, role, decision, reason, provider evidence reference, timestamps, and prior/new status. The reviewer-decision transaction should append an audit event and prevent an assessor from setting externally verified CAC/TIN/NIN/liveness status without the required provider evidence.

The current Drizzle MySQL schema does not yet contain these entities; therefore it cannot presently provide durable cross-user stakeholder review history without this migration.
