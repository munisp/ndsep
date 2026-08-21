/* Generated from the verified phase-13 PostgreSQL catalog. */
import { bigint, bigserial, boolean, date, inet, integer, jsonb, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const analyticsEvents = pgTable("analytics_events", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(),
  page: text("page").notNull(),
  feature: text("feature"),
  userHash: text("user_hash"),
  orgId: integer("org_id"),
  role: text("role"),
  metadata: jsonb("metadata"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }),
});

export const breachTimers = pgTable("breach_timers", {
  breachId: integer("breach_id").primaryKey(),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull(),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  escalationsSent: integer("escalations_sent"),
  status: text("status"),
  createdAt: timestamp("created_at", { withTimezone: true }),
});

export const bulkDsarJobs = pgTable("bulk_dsar_jobs", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id"),
  jobName: text("job_name").notNull(),
  jobType: text("job_type").notNull(),
  totalSubjects: integer("total_subjects").notNull(),
  processedCount: integer("processed_count").notNull(),
  errorCount: integer("error_count").notNull(),
  inputFileUrl: text("input_file_url"),
  outputFileUrl: text("output_file_url"),
  createdBy: integer("created_by"),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const bulkOperations = pgTable("bulk_operations", {
  id: text("id").primaryKey(),
  operationType: text("operation_type").notNull(),
  totalItems: integer("total_items").notNull(),
  processedItems: integer("processed_items"),
  successCount: integer("success_count"),
  failureCount: integer("failure_count"),
  status: text("status"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  undoAvailable: boolean("undo_available"),
  undoExpiresAt: timestamp("undo_expires_at", { withTimezone: true }),
  undoData: jsonb("undo_data"),
  createdBy: text("created_by").notNull(),
});

export const changelogs = pgTable("changelogs", {
  id: serial("id").primaryKey(),
  version: text("version").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  category: text("category"),
  isPublished: boolean("is_published"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const complianceScoreHistory = pgTable("compliance_score_history", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id"),
  sector: text("sector"),
  score: numeric("score").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const consentAuditChain = pgTable("consent_audit_chain", {
  id: serial("id").primaryKey(),
  subjectId: text("subject_id").notNull(),
  consentType: text("consent_type").notNull(),
  action: text("action").notNull(),
  previousState: text("previous_state"),
  newState: text("new_state").notNull(),
  legalBasis: text("legal_basis"),
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent"),
  hash: text("hash").notNull(),
  previousHash: text("previous_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }),
});

export const crossBorderTransfers = pgTable("cross_border_transfers", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id"),
  organizationId: integer("organization_id"),
  orgName: text("org_name"),
  transferRef: text("transfer_ref").unique(),
  destinationCountry: text("destination_country").notNull(),
  dataCategory: text("data_category"),
  dataCategories: jsonb("data_categories").notNull(),
  transferMechanism: text("transfer_mechanism"),
  volumeRecords: bigint("volume_records", { mode: "number" }),
  legalBasis: text("legal_basis"),
  adequacyDecision: boolean("adequacy_decision").notNull(),
  safeguards: text("safeguards"),
  riskLevel: text("risk_level").notNull(),
  status: text("status").notNull(),
  nitdaNotified: boolean("nitda_notified").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const dataResidencyLocations = pgTable("data_residency_locations", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id"),
  dataCategory: text("data_category"),
  storageCountry: text("storage_country"),
  storageRegion: text("storage_region"),
  providerName: text("provider_name"),
  providerType: text("provider_type"),
  latitude: numeric("latitude"),
  longitude: numeric("longitude"),
  transferMechanism: text("transfer_mechanism"),
  volumeGb: numeric("volume_gb"),
  adequacyDecision: boolean("adequacy_decision").notNull(),
  status: text("status").notNull(),
  countryCode: text("country_code"),
  countryName: text("country_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const dpcoAiGapAnalyses = pgTable("dpco_ai_gap_analyses", {
  id: serial("id").primaryKey(),
  engagementId: integer("engagement_id").notNull().unique(),
  overallScore: numeric("overall_score").notNull(),
  executiveSummary: text("executive_summary"),
  ratingsJson: text("ratings_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export const dpcoCarNarratives = pgTable("dpco_car_narratives", {
  id: serial("id").primaryKey(),
  engagementId: integer("engagement_id").notNull().unique(),
  executiveSummary: text("executive_summary"),
  scopeAndMethodology: text("scope_and_methodology"),
  keyFindings: text("key_findings"),
  recommendations: text("recommendations"),
  auditorDeclaration: text("auditor_declaration"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
});

export const dpcoRiskPredictions = pgTable("dpco_risk_predictions", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull(),
  riskScore: numeric("risk_score").notNull(),
  riskLevel: text("risk_level").notNull(),
  primaryRiskFactors: text("primary_risk_factors").notNull(),
  auditPriority: text("audit_priority").notNull(),
  recommendedAuditFrequency: text("recommended_audit_frequency"),
  mitigationActions: text("mitigation_actions").notNull(),
  dcpmiExposureEstimate: text("dcpmi_exposure_estimate"),
  predictedAt: timestamp("predicted_at", { withTimezone: true }).notNull(),
});

export const encryptionKeyAudit = pgTable("encryption_key_audit", {
  id: serial("id").primaryKey(),
  operation: text("operation").notNull(),
  keyVersion: integer("key_version").notNull(),
  performedBy: text("performed_by"),
  performedAt: timestamp("performed_at", { withTimezone: true }).notNull(),
  details: jsonb("details"),
});

export const encryptionKeyMetadata = pgTable("encryption_key_metadata", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  keyId: text("key_id").notNull(),
  encryptedDek: text("encrypted_dek").notNull(),
  version: integer("version").notNull().unique(),
  isActive: boolean("is_active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
});

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull(),
  rolloutPercentage: integer("rollout_percentage").notNull(),
  targetOrgs: integer("target_orgs").array(),
  targetRoles: text("target_roles").array(),
  environment: text("environment").array(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export const fieldEncryptionStatus = pgTable("field_encryption_status", {
  id: serial("id").primaryKey(),
  tableName: text("table_name").notNull(),
  columnName: text("column_name").notNull(),
  encryptedCount: integer("encrypted_count"),
  totalCount: integer("total_count"),
  lastEncryptedAt: timestamp("last_encrypted_at"),
  encryptionVersion: text("encryption_version"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export const formDrafts = pgTable("form_drafts", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  formType: text("form_type").notNull(),
  formData: jsonb("form_data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export const generatedReports = pgTable("generated_reports", {
  id: serial("id").primaryKey(),
  reportType: text("report_type").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  filePath: text("file_path"),
  fileHash: text("file_hash"),
  metrics: jsonb("metrics"),
  deliveredTo: text("delivered_to").array(),
  deliveryStatus: text("delivery_status"),
});

export const inAppNotifications = pgTable("in_app_notifications", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  severity: text("severity").notNull(),
  category: text("category").notNull(),
  organizationId: integer("organization_id"),
  userId: integer("user_id"),
  isRead: boolean("is_read").notNull(),
  actionUrl: text("action_url"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull(),
});

export const notificationSettings = pgTable("notification_settings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().unique(),
  penaltyIssued: boolean("penalty_issued").notNull(),
  penaltyPaid: boolean("penalty_paid").notNull(),
  penaltyAppealFiled: boolean("penalty_appeal_filed").notNull(),
  penaltyAppealDecision: boolean("penalty_appeal_decision").notNull(),
  enforcementCaseOpened: boolean("enforcement_case_opened").notNull(),
  certificateGranted: boolean("certificate_granted").notNull(),
  portalPhaseUpdate: boolean("portal_phase_update").notNull(),
  citizenRequestUpdate: boolean("citizen_request_update").notNull(),
  slaBreachWarning: boolean("sla_breach_warning").notNull(),
  complianceScoreChange: boolean("compliance_score_change").notNull(),
  dpoEmail: text("dpo_email"),
  technicalEmail: text("technical_email"),
  legalEmail: text("legal_email"),
  digestFrequency: text("digest_frequency").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const pushNotificationLog = pgTable("push_notification_log", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  notificationType: text("notification_type").notNull(),
  title: text("title").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  status: text("status"),
  error: text("error"),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export const regulatoryReports = pgTable("regulatory_reports", {
  id: serial("id").primaryKey(),
  reportName: text("report_name"),
  reportType: text("report_type").notNull(),
  reportingPeriodStart: date("reporting_period_start"),
  reportingPeriodEnd: date("reporting_period_end"),
  reportPeriod: text("report_period"),
  orgId: integer("org_id"),
  organizationId: integer("organization_id"),
  status: text("status").notNull(),
  generatedBy: text("generated_by"),
  submittedTo: text("submitted_to"),
  submissionDate: date("submission_date"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  dataSnapshot: jsonb("data_snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const reportSchedules = pgTable("report_schedules", {
  reportType: text("report_type").primaryKey(),
  frequency: text("frequency").notNull(),
  lastRun: timestamp("last_run", { withTimezone: true }),
  nextRun: timestamp("next_run", { withTimezone: true }),
  recipients: text("recipients").array(),
  format: text("format"),
  enabled: boolean("enabled"),
  createdAt: timestamp("created_at", { withTimezone: true }),
});

export const retentionPurgeLog = pgTable("retention_purge_log", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  tableName: text("table_name").notNull(),
  recordsPurged: integer("records_purged").notNull(),
  recordsAnonymized: integer("records_anonymized"),
  purgedAt: timestamp("purged_at", { withTimezone: true }),
  policyDays: integer("policy_days").notNull(),
});

export const riskScorecardEntries = pgTable("risk_scorecard_entries", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id"),
  riskCategory: text("risk_category").notNull(),
  riskName: text("risk_name").notNull(),
  likelihood: integer("likelihood"),
  impact: integer("impact"),
  riskLevel: text("risk_level").notNull(),
  mitigationPlan: text("mitigation_plan"),
  owner: text("owner"),
  reviewDate: date("review_date"),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  riskScore: integer("risk_score"),
});

export const mobilePushDevices = pgTable("mobile_push_devices", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  token: text("token").notNull().unique(),
  platform: text("platform").notNull(),
  deviceId: text("device_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
