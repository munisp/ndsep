import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const stakeholderType = pgEnum("stakeholder_type", ["individual", "business"]);
export const trustStatus = pgEnum("stakeholder_trust_status", ["draft", "in_review", "verified", "needs_attention", "rejected"]);
export const documentStatus = pgEnum("stakeholder_document_status", ["pending", "requires_review", "verified", "rejected", "unavailable"]);
export const reviewDecision = pgEnum("stakeholder_review_decision", ["request_review", "approve", "reject", "return_for_information"]);

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
  onboardingStatus: trustStatus("onboarding_status").default("draft").notNull(),
  readiness: integer("readiness").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("stakeholders_owner_subject_uq").on(table.ownerSubject),
  index("stakeholders_cac_idx").on(table.cacNumber),
  check("stakeholders_readiness_check", sql`${table.readiness} between 0 and 100`),
]);

export const stakeholderDocuments = pgTable("stakeholder_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  stakeholderId: uuid("stakeholder_id").notNull().references(() => stakeholders.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 80 }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  objectKey: text("object_key").notNull(),
  status: documentStatus("status").default("pending").notNull(),
  screening: jsonb("screening").$type<{ engine: string; confidence: number; provenance: string; reason?: string | null }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("stakeholder_documents_stakeholder_idx").on(table.stakeholderId)]);

export const documentReviewDecisions = pgTable("stakeholder_document_review_decisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").notNull().references(() => stakeholderDocuments.id, { onDelete: "restrict" }),
  reviewerSubject: varchar("reviewer_subject", { length: 255 }).notNull(),
  reviewerRole: varchar("reviewer_role", { length: 80 }).notNull(),
  decision: reviewDecision("decision").notNull(),
  reason: text("reason").notNull(),
  evidenceRefs: jsonb("evidence_refs").$type<string[]>().default([]).notNull(),
  priorStatus: documentStatus("prior_status").notNull(),
  newStatus: documentStatus("new_status").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("document_review_decisions_document_idx").on(table.documentId)]);

export const stakeholderAuditEvents = pgTable("stakeholder_audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  stakeholderId: uuid("stakeholder_id").notNull().references(() => stakeholders.id, { onDelete: "restrict" }),
  actorSubject: varchar("actor_subject", { length: 255 }).notNull(),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("stakeholder_audit_events_stakeholder_idx").on(table.stakeholderId, table.occurredAt)]);
