# Router Validation, Persistence Errors, and PostgreSQL Review Ledger

## Current router behavior

The current `onboarding` router uses a tRPC `.input(...)` schema before invoking persistence functions. For example, `submitBusinessProfile` calls `publicProcedure.input(businessProfileSchema).mutation(({ input }) => submitBusinessProfile(input))`. Invalid input rejected by Zod does not reach `submitBusinessProfile`; tRPC returns a validation error to the client.

The document routes validate minimum request shape—document type, filename, MIME type, and Base64 length—then run `analyzeDocumentImage`, append a document record, and return the analysis plus refreshed onboarding bundle.

```ts
analyzeBusinessDocument: publicProcedure
  .input(z.object({
    type: z.string(),
    fileName: z.string(),
    mimeType: z.string(),
    base64Data: z.string().min(32),
  }))
  .mutation(async ({ input }) => {
    const analysis = await analyzeDocumentImage({ ...input, documentType: input.type });
    const document = appendBusinessDocument({
      id: Date.now(),
      type: input.type,
      fileName: input.fileName,
      documentUrl: null,
      status: analysis.status,
      engine: analysis.engine,
      confidence: analysis.confidence,
      extractedSummary: analysis.summary,
      analysisProvenance: analysis.provenance,
      analysisReason: analysis.reason,
      uploadedAt: new Date().toISOString(),
    });
    return { analysis, document, onboarding: getMobilePlatformBundle().onboarding };
  });
```

### Current error propagation

The router does not wrap these mutations in a custom `try/catch`. A thrown provider, file-analysis, local-store, or persistence error propagates through tRPC. On the mobile screen, calls are wrapped in `try/catch` and displayed using `Alert.alert("… failed", message)`. This provides a user-visible error, but it does not yet map database failures to stable application error codes or field-specific messages.

> Current limitation: `publicProcedure` exposes onboarding mutation boundaries without an authenticated stakeholder or reviewer identity requirement. A PostgreSQL migration should introduce authenticated subject ownership and role-bound review procedures.

## PostgreSQL-first review-ledger migration

The existing `drizzle/schema.ts` is MySQL-oriented and does not contain stakeholder or reviewer-ledger entities. For the stakeholder trust domain, use a dedicated PostgreSQL Drizzle schema and a transactional repository. Do not reuse the mobile JSON bundle as the authoritative ledger.

### 1. PostgreSQL Drizzle schema

```ts
import {
  pgTable, uuid, varchar, text, timestamp, jsonb, integer,
  pgEnum, uniqueIndex, index,
} from "drizzle-orm/pg-core";

export const stakeholderType = pgEnum("stakeholder_type", ["individual", "business"]);
export const trustStatus = pgEnum("trust_status", ["draft", "in_review", "verified", "needs_attention", "rejected"]);
export const documentStatus = pgEnum("document_status", ["pending", "requires_review", "verified", "rejected", "unavailable"]);
export const decisionType = pgEnum("review_decision_type", ["request_review", "approve", "reject", "return_for_information"]);

export const stakeholders = pgTable("stakeholders", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerSubject: varchar("owner_subject", { length: 255 }).notNull(),
  type: stakeholderType("type").notNull(),
  companyName: varchar("company_name", { length: 160 }),
  cacNumber: varchar("cac_number", { length: 24 }),
  tinNumber: varchar("tin_number", { length: 24 }),
  businessEmail: varchar("business_email", { length: 320 }),
  businessPhone: varchar("business_phone", { length: 24 }),
  businessAddress: text("business_address"),
  contactPerson: varchar("contact_person", { length: 160 }),
  onboardingStatus: trustStatus("onboarding_status").notNull().default("draft"),
  readiness: integer("readiness").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("stakeholders_owner_subject_uq").on(table.ownerSubject),
  index("stakeholders_cac_idx").on(table.cacNumber),
]);

export const stakeholderDocuments = pgTable("stakeholder_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  stakeholderId: uuid("stakeholder_id").notNull().references(() => stakeholders.id),
  kind: varchar("kind", { length: 80 }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  objectKey: text("object_key").notNull(),
  status: documentStatus("status").notNull().default("pending"),
  screening: jsonb("screening").$type<{ engine: string; confidence: number; provenance: string; reason?: string | null }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const documentReviewDecisions = pgTable("document_review_decisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").notNull().references(() => stakeholderDocuments.id),
  reviewerSubject: varchar("reviewer_subject", { length: 255 }).notNull(),
  reviewerRole: varchar("reviewer_role", { length: 80 }).notNull(),
  decision: decisionType("decision").notNull(),
  reason: text("reason").notNull(),
  evidenceRefs: jsonb("evidence_refs").$type<string[]>().notNull().default([]),
  priorStatus: documentStatus("prior_status").notNull(),
  newStatus: documentStatus("new_status").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
});
```

### 2. Transactional decision procedure

Use a serializable transaction that locks the document, confirms reviewer role and evidence, appends an immutable decision, updates the document’s current status, recalculates readiness, and appends an audit event. Reject the transaction on an unexpected prior state or missing authorised provider evidence.

```ts
await db.transaction(async (tx) => {
  await tx.execute(sql`set transaction isolation level serializable`);
  const document = await tx.query.stakeholderDocuments.findFirst({
    where: eq(stakeholderDocuments.id, input.documentId),
    // In raw SQL, use SELECT ... FOR UPDATE.
  });
  if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
  assertEnterpriseRole(ctx.enterprise, ["planning_supervisor"]);
  if (input.decision === "approve" && !input.evidenceRefs.length)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Authorised evidence is required for approval" });

  await tx.insert(documentReviewDecisions).values({
    documentId: document.id,
    reviewerSubject: ctx.enterprise.subject,
    reviewerRole: ctx.enterprise.role,
    decision: input.decision,
    reason: input.reason,
    evidenceRefs: input.evidenceRefs,
    priorStatus: document.status,
    newStatus: nextStatus,
  });
  await tx.update(stakeholderDocuments).set({ status: nextStatus, updatedAt: new Date() }).where(eq(stakeholderDocuments.id, document.id));
  // Recalculate stakeholder readiness and append an audit event here.
});
```

### 3. Migration and deployment sequence

| Step | Action | Safety control |
|---|---|---|
| 1 | Provision managed PostgreSQL and a least-privilege application role | TLS, backups, PITR, separate migration role |
| 2 | Add PostgreSQL Drizzle connection and migration configuration | Keep MySQL and local bundle read-only during cutover |
| 3 | Create stakeholder, document, decision, and audit tables | Foreign keys, indexed lookup paths, UTC timestamps |
| 4 | Backfill local bundle records as `legacy_import` evidence | Do not translate locally seeded `verified` statuses into authority verification |
| 5 | Deploy dual-read comparison and write only to PostgreSQL for new reviews | Reconciliation metrics and rollback feature flag |
| 6 | Require authenticated stakeholder/reviewer context on procedures | Ownership check, agency role check, reviewer audit identity |
| 7 | Retire local onboarding write path after evidence reconciliation | Immutable audit export and retention policy |

## Error contract recommendation

Map failures to stable tRPC errors: `BAD_REQUEST` for validation, `UNAUTHORIZED` and `FORBIDDEN` for identity/role, `NOT_FOUND` for missing records, `CONFLICT` for concurrent state changes, `PRECONDITION_FAILED` for missing authoritative evidence, and `INTERNAL_SERVER_ERROR` only after server-side error logging with a correlation ID. The client should render field errors for `BAD_REQUEST` validation payloads and generic retry-safe feedback for unavailable providers or persistence faults.
