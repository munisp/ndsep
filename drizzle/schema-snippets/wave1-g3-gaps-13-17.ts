/**
 * SNIPPET — Wave 1 Group 3 (Gaps 13–17) drizzle table definitions.
 * APPEND these definitions to drizzle/schema.ts (do NOT edit that file in this
 * branch — this snippet is the hand-off artifact). Corresponding DDL lives in
 * drizzle/migrations/0050_* … 0054_*.sql.
 *
 * Import merge note: schema.ts already imports pgTable, serial, integer,
 * varchar, text, timestamp, boolean, jsonb, pgEnum, uniqueIndex, index.
 */
import {
  pgTable, serial, integer, varchar, text, timestamp, boolean, jsonb,
  pgEnum, uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { organizations, users, enforcementCases, financialPenalties, consentRecords } from "../schema";

// ═══════════════════════════════════════════════════════════════════════════
// Gap 13: Public Sanctions Register
// ═══════════════════════════════════════════════════════════════════════════
export const enforcementNoticeTypeEnum = pgEnum("enforcement_notice_type", [
  "final_order", "undertaking", "administrative_fine", "reprimand"
]);
export const enforcementNoticeStatusEnum = pgEnum("enforcement_notice_status", [
  "draft", "published", "remediated", "delisted", "expired"
]);
export const delistingRequestStatusEnum = pgEnum("delisting_request_status", [
  "pending", "under_review", "approved", "rejected"
]);

export const enforcementNotices = pgTable("enforcement_notices", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  orgName: varchar("org_name", { length: 256 }).notNull(),
  noticeType: varchar("notice_type", { length: 32 }).notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  summary: text("summary"),
  legalInstrumentRef: varchar("legal_instrument_ref", { length: 128 }),
  gazetteNumber: varchar("gazette_number", { length: 64 }),
  publishedAt: timestamp("published_at"),
  sanctionStart: timestamp("sanction_start"),
  sanctionEnd: timestamp("sanction_end"),
  status: varchar("status", { length: 32 }).default("draft").notNull(),
  pdfRef: text("pdf_ref"),
  publicNote: text("public_note"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type EnforcementNotice = typeof enforcementNotices.$inferSelect;

export const delistingRequests = pgTable("delisting_requests", {
  id: serial("id").primaryKey(),
  noticeId: integer("notice_id").references(() => enforcementNotices.id).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id),
  applicantName: varchar("applicant_name", { length: 256 }).notNull(),
  applicantEmail: varchar("applicant_email", { length: 256 }).notNull(),
  remediationSummary: text("remediation_summary").notNull(),
  evidenceRefs: jsonb("evidence_refs").$type<string[]>().default([]),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  reviewerId: integer("reviewer_id"),
  reviewerNotes: text("reviewer_notes"),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DelistingRequest = typeof delistingRequests.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// Gap 14: FOIA Module
// ═══════════════════════════════════════════════════════════════════════════
export const foiaExemptionCodeEnum = pgEnum("foia_exemption_code", [
  "national_security", "personal_privacy", "law_enforcement", "commercial_confidence"
]);
export const foiaRequestStatusEnum = pgEnum("foia_request_status", [
  "received", "processing", "partial_disclosure", "disclosed", "refused", "closed"
]);

export const foiaRequests = pgTable("foia_requests", {
  id: serial("id").primaryKey(),
  referenceNumber: varchar("reference_number", { length: 32 }).unique().notNull(),
  requesterName: varchar("requester_name", { length: 256 }).notNull(),
  requesterEmail: varchar("requester_email", { length: 256 }).notNull(),
  requesterPhone: varchar("requester_phone", { length: 64 }),
  subject: varchar("subject", { length: 512 }).notNull(),
  description: text("description").notNull(),
  preferredFormat: varchar("preferred_format", { length: 32 }).default("electronic").notNull(),
  status: varchar("status", { length: 32 }).default("received").notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  statutoryDeadline: timestamp("statutory_deadline").notNull(),
  assignedOfficerId: integer("assigned_officer_id").references(() => users.id),
  exemptionCode: foiaExemptionCodeEnum("exemption_code"),
  refusalReason: text("refusal_reason"),
  disclosureNotes: text("disclosure_notes"),
  disclosedAt: timestamp("disclosed_at"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type FoiaRequest = typeof foiaRequests.$inferSelect;

export const foiaTasks = pgTable("foia_tasks", {
  id: serial("id").primaryKey(),
  foiaRequestId: integer("foia_request_id").references(() => foiaRequests.id).notNull(),
  taskType: varchar("task_type", { length: 32 }).notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  notes: text("notes"),
  status: varchar("status", { length: 32 }).default("open").notNull(),
  assignedTo: integer("assigned_to").references(() => users.id),
  dueAt: timestamp("due_at"),
  completedAt: timestamp("completed_at"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type FoiaTask = typeof foiaTasks.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// Gap 15: Election-Period Oversight
// ═══════════════════════════════════════════════════════════════════════════
export const electionPeriodStatusEnum = pgEnum("election_period_status", [
  "proclaimed", "active", "concluded", "archived"
]);

export const electionPeriods = pgTable("election_periods", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  status: varchar("status", { length: 32 }).default("proclaimed").notNull(),
  heightenedScrutiny: boolean("heightened_scrutiny").default(false).notNull(),
  proclaimedBy: integer("proclaimed_by").references(() => users.id),
  proclaimedAt: timestamp("proclaimed_at").defaultNow().notNull(),
  concludedAt: timestamp("concluded_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type ElectionPeriod = typeof electionPeriods.$inferSelect;

export const politicalMicrotargetingReports = pgTable("political_microtargeting_reports", {
  id: serial("id").primaryKey(),
  electionPeriodId: integer("election_period_id").references(() => electionPeriods.id),
  referenceNumber: varchar("reference_number", { length: 32 }).unique().notNull(),
  reporterName: varchar("reporter_name", { length: 256 }),
  reporterEmail: varchar("reporter_email", { length: 256 }),
  isAnonymous: boolean("is_anonymous").default(false).notNull(),
  partyOrCampaign: varchar("party_or_campaign", { length: 256 }).notNull(),
  platform: varchar("platform", { length: 64 }).notNull(),
  description: text("description").notNull(),
  evidenceRefs: jsonb("evidence_refs").$type<string[]>().default([]),
  regionState: varchar("region_state", { length: 64 }),
  status: varchar("status", { length: 32 }).default("received").notNull(),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewNotes: text("review_notes"),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type PoliticalMicrotargetingReport = typeof politicalMicrotargetingReports.$inferSelect;

export const inecReferrals = pgTable("inec_referrals", {
  id: serial("id").primaryKey(),
  caseReference: varchar("case_reference", { length: 64 }).unique().notNull(),
  electionPeriodId: integer("election_period_id").references(() => electionPeriods.id),
  microtargetingReportId: integer("microtargeting_report_id").references(() => politicalMicrotargetingReports.id),
  complaintReference: varchar("complaint_reference", { length: 64 }),
  subject: varchar("subject", { length: 512 }).notNull(),
  summary: text("summary").notNull(),
  status: varchar("status", { length: 32 }).default("referred").notNull(),
  jointActionNotes: text("joint_action_notes"),
  referredBy: integer("referred_by").references(() => users.id),
  referredAt: timestamp("referred_at").defaultNow().notNull(),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedAt: timestamp("resolved_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type InecReferral = typeof inecReferrals.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// Gap 16: AI-Regulation Instruments
// ═══════════════════════════════════════════════════════════════════════════
export const aiRiskTierEnum = pgEnum("ai_risk_tier", [
  "minimal", "limited", "high", "unacceptable"
]);

export const aiRiskTierAssessments = pgTable("ai_risk_tier_assessments", {
  id: serial("id").primaryKey(),
  systemRef: varchar("system_ref", { length: 64 }).unique().notNull(),
  organizationId: integer("organization_id").references(() => organizations.id),
  systemName: varchar("system_name", { length: 256 }).notNull(),
  systemPurpose: text("system_purpose"),
  tier: aiRiskTierEnum("tier").notNull(),
  rationale: text("rationale").notNull(),
  assessorId: integer("assessor_id").references(() => users.id),
  assessorName: varchar("assessor_name", { length: 256 }),
  assessedAt: timestamp("assessed_at").defaultNow().notNull(),
  reviewDueAt: timestamp("review_due_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AiRiskTierAssessment = typeof aiRiskTierAssessments.$inferSelect;

export const aiPermits = pgTable("ai_permits", {
  id: serial("id").primaryKey(),
  assessmentId: integer("assessment_id").references(() => aiRiskTierAssessments.id).notNull(),
  permitRef: varchar("permit_ref", { length: 64 }).unique().notNull(),
  organizationId: integer("organization_id").references(() => organizations.id),
  instrumentType: varchar("instrument_type", { length: 32 }).default("permit").notNull(),
  status: varchar("status", { length: 32 }).default("applied").notNull(),
  conditions: jsonb("conditions").$type<string[]>().default([]),
  appliedAt: timestamp("applied_at").defaultNow().notNull(),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  decisionNotes: text("decision_notes"),
  grantedAt: timestamp("granted_at"),
  expiresAt: timestamp("expires_at"),
  suspendedAt: timestamp("suspended_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AiPermit = typeof aiPermits.$inferSelect;

export const aiConformityAssessments = pgTable("ai_conformity_assessments", {
  id: serial("id").primaryKey(),
  assessmentId: integer("assessment_id").references(() => aiRiskTierAssessments.id).notNull(),
  permitId: integer("permit_id").references(() => aiPermits.id),
  ref: varchar("ref", { length: 64 }).unique().notNull(),
  checklistResults: jsonb("checklist_results").$type<Record<string, "pass" | "fail" | "n/a">>().default({}),
  overallResult: varchar("overall_result", { length: 32 }),
  assessorId: integer("assessor_id").references(() => users.id),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  certificateRef: varchar("certificate_ref", { length: 64 }),
  certificateIssuedAt: timestamp("certificate_issued_at"),
  certificateExpiresAt: timestamp("certificate_expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AiConformityAssessment = typeof aiConformityAssessments.$inferSelect;

export const aiIncidents = pgTable("ai_incidents", {
  id: serial("id").primaryKey(),
  incidentRef: varchar("incident_ref", { length: 64 }).unique().notNull(),
  organizationId: integer("organization_id").references(() => organizations.id),
  reporterType: varchar("reporter_type", { length: 16 }).default("public").notNull(),
  reporterName: varchar("reporter_name", { length: 256 }),
  reporterEmail: varchar("reporter_email", { length: 256 }),
  systemName: varchar("system_name", { length: 256 }).notNull(),
  description: text("description").notNull(),
  severity: varchar("severity", { length: 16 }).default("medium").notNull(),
  harmCategories: jsonb("harm_categories").$type<string[]>().default([]),
  occurredAt: timestamp("occurred_at"),
  status: varchar("status", { length: 32 }).default("received").notNull(),
  triagedBy: integer("triaged_by").references(() => users.id),
  triageNotes: text("triage_notes"),
  reportedAt: timestamp("reported_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AiIncident = typeof aiIncidents.$inferSelect;

export const aiEnforcementLinks = pgTable("ai_enforcement_links", {
  id: serial("id").primaryKey(),
  sourceType: varchar("source_type", { length: 32 }).notNull(),
  sourceId: integer("source_id").notNull(),
  enforcementCaseId: integer("enforcement_case_id").references(() => enforcementCases.id),
  financialPenaltyId: integer("financial_penalty_id").references(() => financialPenalties.id),
  linkNotes: text("link_notes").notNull(),
  escalatedBy: integer("escalated_by").references(() => users.id),
  escalatedAt: timestamp("escalated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  sourceIdx: index("idx_ai_enforcement_links_source").on(t.sourceType, t.sourceId),
}));
export type AiEnforcementLink = typeof aiEnforcementLinks.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// Gap 17: Consent Propagation
// ═══════════════════════════════════════════════════════════════════════════
export const consentPurposes = pgTable("consent_purposes", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  purposeKey: varchar("purpose_key", { length: 64 }).notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  lawfulBasis: varchar("lawful_basis", { length: 32 }).default("consent").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  orgPurposeUniq: uniqueIndex("consent_purposes_org_key_uniq").on(t.organizationId, t.purposeKey),
}));
export type ConsentPurpose = typeof consentPurposes.$inferSelect;

export const downstreamProcessors = pgTable("downstream_processors", {
  id: serial("id").primaryKey(),
  purposeId: integer("purpose_id").references(() => consentPurposes.id).notNull(),
  processorName: varchar("processor_name", { length: 256 }).notNull(),
  contactEmail: varchar("contact_email", { length: 256 }).notNull(),
  ackEndpointUrl: text("ack_endpoint_url"),
  slaHours: integer("sla_hours").default(72).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DownstreamProcessor = typeof downstreamProcessors.$inferSelect;

export const withdrawalEvents = pgTable("withdrawal_events", {
  id: serial("id").primaryKey(),
  purposeId: integer("purpose_id").references(() => consentPurposes.id).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  subjectRef: varchar("subject_ref", { length: 256 }).notNull(),
  consentRecordId: integer("consent_record_id").references(() => consentRecords.id),
  withdrawnAt: timestamp("withdrawn_at").defaultNow().notNull(),
  reason: text("reason"),
  initiatedBy: varchar("initiated_by", { length: 16 }).default("subject").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type WithdrawalEvent = typeof withdrawalEvents.$inferSelect;

export const propagationRecords = pgTable("propagation_records", {
  id: serial("id").primaryKey(),
  withdrawalEventId: integer("withdrawal_event_id").references(() => withdrawalEvents.id).notNull(),
  processorId: integer("processor_id").references(() => downstreamProcessors.id).notNull(),
  ackToken: varchar("ack_token", { length: 128 }).unique().notNull(),
  notifiedAt: timestamp("notified_at"),
  notificationChannel: varchar("notification_channel", { length: 32 }),
  ackedAt: timestamp("acked_at"),
  proofRef: text("proof_ref"),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  eventProcessorUniq: uniqueIndex("propagation_records_event_processor_uniq").on(t.withdrawalEventId, t.processorId),
}));
export type PropagationRecord = typeof propagationRecords.$inferSelect;
