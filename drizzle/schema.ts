import {
  bigint,
  boolean,
  date,
  integer,
  inet,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", ["user", "admin", "auditor", "org_admin", "dpco"]);
export const assetTypeEnum = pgEnum("asset_type", ["hardware", "software", "cloud", "network", "database", "saas"]);
export const assetStatusEnum = pgEnum("asset_status", ["active", "inactive", "quarantined", "decommissioned"]);
export const complianceStatusEnum = pgEnum("compliance_status", ["compliant", "non_compliant", "under_review", "remediation"]);
export const severityEnum = pgEnum("severity", ["critical", "high", "medium", "low", "info"]);
export const enforcementStatusEnum = pgEnum("enforcement_status", ["pending", "notice_sent", "audit_scheduled", "penalty_imposed", "settled", "escalated"]);
export const dataClassificationEnum = pgEnum("data_classification", ["tier1_pii", "tier2_financial", "tier3_health", "tier4_government", "tier5_public"]);
export const networkEventTypeEnum = pgEnum("network_event_type", ["cross_border_transfer", "exfiltration_attempt", "anomaly", "policy_violation", "normal"]);
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "processing", "completed", "failed", "overdue"]);

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("open_id", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("login_method", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),
  organizationId: integer("organization_id"),
  dpcoOrgId: integer("dpco_org_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastSignedIn: timestamp("last_signed_in").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Organizations ────────────────────────────────────────────────────────────

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  registrationNumber: varchar("registration_number", { length: 64 }).unique(),
  sector: varchar("sector", { length: 128 }),
  country: varchar("country", { length: 64 }),
  city: varchar("city", { length: 128 }),
  latitude: real("latitude"),
  longitude: real("longitude"),
  complianceScore: real("compliance_score").default(0),
  complianceStatus: complianceStatusEnum("compliance_status").default("under_review"),
  agentInstalled: boolean("agent_installed").default(false),
  agentVersion: varchar("agent_version", { length: 32 }),
  lastAgentHeartbeat: timestamp("last_agent_heartbeat"),
  declaredAssetCount: integer("declared_asset_count").default(0),
  discoveredAssetCount: integer("discovered_asset_count").default(0),
  riskScore: real("risk_score").default(50),
  contactEmail: varchar("contact_email", { length: 320 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = typeof organizations.$inferInsert;

// ─── Assets ───────────────────────────────────────────────────────────────────

export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  name: text("name").notNull(),
  assetType: assetTypeEnum("asset_type").notNull(),
  status: assetStatusEnum("status").default("active"),
  ipAddress: varchar("ip_address", { length: 64 }),
  macAddress: varchar("mac_address", { length: 64 }),
  hostname: varchar("hostname", { length: 256 }),
  operatingSystem: varchar("operating_system", { length: 128 }),
  osVersion: varchar("os_version", { length: 64 }),
  location: varchar("location", { length: 256 }),
  latitude: real("latitude"),
  longitude: real("longitude"),
  cloudProvider: varchar("cloud_provider", { length: 64 }),
  cloudRegion: varchar("cloud_region", { length: 64 }),
  dataClassification: dataClassificationEnum("data_classification"),
  isWithinBorders: boolean("is_within_borders").default(true),
  vulnerabilityCount: integer("vulnerability_count").default(0),
  metadata: jsonb("metadata"),
  discoveredAt: timestamp("discovered_at").defaultNow().notNull(),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Asset = typeof assets.$inferSelect;
export type InsertAsset = typeof assets.$inferInsert;

// ─── Compliance Policies ──────────────────────────────────────────────────────

export const compliancePolicies = pgTable("compliance_policies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  category: varchar("category", { length: 128 }),
  opaRule: text("opa_rule"),
  severity: severityEnum("severity").default("medium"),
  isActive: boolean("is_active").default(true),
  weight: real("weight").default(1.0),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type CompliancePolicy = typeof compliancePolicies.$inferSelect;

// ─── Compliance Violations ────────────────────────────────────────────────────

export const complianceViolations = pgTable("compliance_violations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  policyId: integer("policy_id"),
  assetId: integer("asset_id"),
  title: text("title").notNull(),
  description: text("description"),
  severity: severityEnum("severity").default("medium"),
  status: complianceStatusEnum("status").default("non_compliant"),
  enforcementStatus: enforcementStatusEnum("enforcement_status").default("pending"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  penaltyAmount: real("penalty_amount"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ComplianceViolation = typeof complianceViolations.$inferSelect;

// ─── Enforcement Actions ──────────────────────────────────────────────────────

export const enforcementActions = pgTable("enforcement_actions", {
  id: serial("id").primaryKey(),
  violationId: integer("violation_id").notNull(),
  organizationId: integer("organization_id").notNull(),
  workflowId: varchar("workflow_id", { length: 128 }),
  actionType: varchar("action_type", { length: 64 }),
  status: enforcementStatusEnum("status").default("pending"),
  noticeIssuedAt: timestamp("notice_issued_at"),
  auditScheduledAt: timestamp("audit_scheduled_at"),
  penaltyImposedAt: timestamp("penalty_imposed_at"),
  penaltyAmount: real("penalty_amount"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type EnforcementAction = typeof enforcementActions.$inferSelect;

// ─── Financial Penalties ──────────────────────────────────────────────────────

export const financialPenalties = pgTable("financial_penalties", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  violationId: integer("violation_id"),
  enforcementActionId: integer("enforcement_action_id"),
  amount: real("amount").notNull(),
  currency: varchar("currency", { length: 8 }).default("USD"),
  paymentStatus: paymentStatusEnum("payment_status").default("pending"),
  tigerBeetleTransferId: varchar("tiger_beetle_transfer_id", { length: 128 }),
  mojaloopTransferId: varchar("mojaloop_transfer_id", { length: 128 }),
  dueDate: timestamp("due_date"),
  paidAt: timestamp("paid_at"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type FinancialPenalty = typeof financialPenalties.$inferSelect;

// ─── Penalty Appeals ─────────────────────────────────────────────────────────

export const appealStatusEnum = pgEnum("appeal_status", ["submitted", "under_review", "upheld", "dismissed", "withdrawn"]);

export const penaltyAppeals = pgTable("penalty_appeals", {
  id: serial("id").primaryKey(),
  penaltyId: integer("penalty_id").notNull(),
  organizationId: integer("organization_id").notNull(),
  submittedBy: varchar("submitted_by", { length: 256 }).notNull(),
  contactEmail: varchar("contact_email", { length: 256 }).notNull(),
  groundsForAppeal: text("grounds_for_appeal").notNull(),
  evidenceSummary: text("evidence_summary"),
  evidenceUrls: jsonb("evidence_urls").$type<string[]>().default([]),
  requestedOutcome: varchar("requested_outcome", { length: 64 }).default("reduction"),
  status: appealStatusEnum("status").default("submitted"),
  reviewedBy: integer("reviewed_by"),
  reviewNotes: text("review_notes"),
  reviewedAt: timestamp("reviewed_at"),
  temporalWorkflowId: varchar("temporal_workflow_id", { length: 256 }),
  escrowTransferId: varchar("escrow_transfer_id", { length: 128 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PenaltyAppeal = typeof penaltyAppeals.$inferSelect;

// ─── Security Alerts (SIEM) ───────────────────────────────────────────────────

export const securityAlerts = pgTable("security_alerts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  assetId: integer("asset_id"),
  source: varchar("source", { length: 64 }),
  alertType: varchar("alert_type", { length: 128 }),
  title: text("title").notNull(),
  description: text("description"),
  severity: severityEnum("severity").default("medium"),
  isResolved: boolean("is_resolved").default(false),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: integer("resolved_by"),
  threatActorId: varchar("threat_actor_id", { length: 128 }),
  mitreTechnique: varchar("mitre_technique", { length: 64 }),
  rawLog: text("raw_log"),
  metadata: jsonb("metadata"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SecurityAlert = typeof securityAlerts.$inferSelect;

// ─── Network Events ───────────────────────────────────────────────────────────

export const networkEvents = pgTable("network_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  sourceIp: varchar("source_ip", { length: 64 }),
  destinationIp: varchar("destination_ip", { length: 64 }),
  sourceCountry: varchar("source_country", { length: 64 }),
  destinationCountry: varchar("destination_country", { length: 64 }),
  sourceLatitude: real("source_latitude"),
  sourceLongitude: real("source_longitude"),
  destLatitude: real("dest_latitude"),
  destLongitude: real("dest_longitude"),
  protocol: varchar("protocol", { length: 32 }),
  port: integer("port"),
  bytesTransferred: integer("bytes_transferred"),
  eventType: networkEventTypeEnum("event_type").default("normal"),
  isCrossBorder: boolean("is_cross_border").default(false),
  ixpSite: varchar("ixp_site", { length: 128 }),
  suricataRuleId: varchar("suricata_rule_id", { length: 64 }),
  isBlocked: boolean("is_blocked").default(false),
  metadata: jsonb("metadata"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type NetworkEvent = typeof networkEvents.$inferSelect;

// ─── Threat Intelligence ──────────────────────────────────────────────────────

export const threatIntelligence = pgTable("threat_intelligence", {
  id: serial("id").primaryKey(),
  source: varchar("source", { length: 64 }),
  indicatorType: varchar("indicator_type", { length: 64 }),
  indicatorValue: text("indicator_value").notNull(),
  threatActor: varchar("threat_actor", { length: 256 }),
  campaign: varchar("campaign", { length: 256 }),
  mitreTactic: varchar("mitre_tactic", { length: 128 }),
  mitreTechnique: varchar("mitre_technique", { length: 64 }),
  severity: severityEnum("severity").default("medium"),
  confidence: real("confidence").default(0.5),
  isActive: boolean("is_active").default(true),
  expiresAt: timestamp("expires_at"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ThreatIntelligence = typeof threatIntelligence.$inferSelect;

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  organizationId: integer("organization_id"),
  action: varchar("action", { length: 128 }).notNull(),
  resourceType: varchar("resource_type", { length: 64 }),
  resourceId: integer("resource_id"),
  details: text("details"),
  ipAddress: varchar("ip_address", { length: 64 }),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;

// ─── Streaming Events ─────────────────────────────────────────────────────────

export const streamingEvents = pgTable("streaming_events", {
  id: serial("id").primaryKey(),
  topic: varchar("topic", { length: 128 }).notNull(),
  source: varchar("source", { length: 64 }),
  eventType: varchar("event_type", { length: 128 }),
  payload: jsonb("payload"),
  partition: integer("partition"),
  offset: integer("offset"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type StreamingEvent = typeof streamingEvents.$inferSelect;

// ─── Data Catalog Entries ─────────────────────────────────────────────────────

export const dataCatalogEntries = pgTable("data_catalog_entries", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  assetId: integer("asset_id"),
  name: text("name").notNull(),
  description: text("description"),
  dataType: varchar("data_type", { length: 128 }),
  classification: dataClassificationEnum("classification"),
  schema: jsonb("schema"),
  lineage: jsonb("lineage"),
  qualityScore: real("quality_score"),
  rowCount: integer("row_count"),
  sizeBytes: integer("size_bytes"),
  storageLocation: text("storage_location"),
  isWithinBorders: boolean("is_within_borders").default(true),
  latitude: real("latitude"),
  longitude: real("longitude"),
  tags: jsonb("tags"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DataCatalogEntry = typeof dataCatalogEntries.$inferSelect;

// ─── ML Risk Predictions ──────────────────────────────────────────────────────

export const mlRiskPredictions = pgTable("ml_risk_predictions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  modelName: varchar("model_name", { length: 128 }),
  currentRiskScore: real("current_risk_score"),
  predictedRiskScore: real("predicted_risk_score"),
  confidenceInterval: real("confidence_interval"),
  predictionHorizonDays: integer("prediction_horizon_days"),
  features: jsonb("features"),
  recommendation: text("recommendation"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type MlRiskPrediction = typeof mlRiskPredictions.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// BGP Route Validation (Rust Worker — L1)
// ─────────────────────────────────────────────────────────────────────────────

export const bgpRouteStatusEnum = pgEnum("bgp_route_status", ["valid", "invalid", "unknown", "hijacked", "leaked"]);

export const bgpRoutes = pgTable("bgp_routes", {
  id: serial("id").primaryKey(),
  prefix: varchar("prefix", { length: 64 }).notNull(),
  originAsn: integer("origin_asn").notNull(),
  peerAsn: integer("peer_asn"),
  asPath: text("as_path"),
  nextHop: varchar("next_hop", { length: 64 }),
  rpkiStatus: bgpRouteStatusEnum("rpki_status").default("unknown"),
  isHijacked: boolean("is_hijacked").default(false),
  isLeaked: boolean("is_leaked").default(false),
  isCrossBorder: boolean("is_cross_border").default(false),
  organizationId: integer("organization_id"),
  ixpSite: varchar("ixp_site", { length: 64 }),
  communityTags: text("community_tags").array(),
  metadata: jsonb("metadata"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type BgpRoute = typeof bgpRoutes.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Data Residency Checks (Rust Worker — L2)
// ─────────────────────────────────────────────────────────────────────────────

export const residencyStatusEnum = pgEnum("residency_status", ["compliant", "violation", "warning", "unknown"]);

export const residencyChecks = pgTable("residency_checks", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  dataAssetId: integer("data_asset_id"),
  dataAssetName: varchar("data_asset_name", { length: 256 }),
  dataClassification: dataClassificationEnum("data_classification"),
  storageLocation: varchar("storage_location", { length: 128 }),
  storageCountry: varchar("storage_country", { length: 8 }),
  storageLatitude: real("storage_latitude"),
  storageLongitude: real("storage_longitude"),
  isWithinBorders: boolean("is_within_borders").notNull(),
  residencyStatus: residencyStatusEnum("residency_status").default("unknown"),
  policyId: integer("policy_id"),
  violationReason: text("violation_reason"),
  remediationAction: varchar("remediation_action", { length: 256 }),
  checkedAt: timestamp("checked_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ResidencyCheck = typeof residencyChecks.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Financial Ledger Transactions (Rust Worker — TigerBeetle/Mojaloop)
// ─────────────────────────────────────────────────────────────────────────────

export const ledgerTxTypeEnum = pgEnum("ledger_tx_type", ["penalty", "fine", "settlement", "refund", "escrow", "transfer"]);
export const ledgerTxStatusEnum = pgEnum("ledger_tx_status", ["pending", "processing", "settled", "failed", "reversed"]);

export const financialLedger = pgTable("financial_ledger", {
  id: serial("id").primaryKey(),
  transactionId: varchar("transaction_id", { length: 128 }).unique().notNull(),
  organizationId: integer("organization_id").notNull(),
  penaltyId: integer("penalty_id"),
  violationId: integer("violation_id"),
  txType: ledgerTxTypeEnum("tx_type").notNull(),
  status: ledgerTxStatusEnum("status").default("pending"),
  amount: real("amount").notNull(),
  currency: varchar("currency", { length: 8 }).default("NGN"),
  debitAccount: varchar("debit_account", { length: 128 }),
  creditAccount: varchar("credit_account", { length: 128 }),
  tigerBeetleId: varchar("tiger_beetle_id", { length: 128 }),
  mojaloopId: varchar("mojaloop_id", { length: 128 }),
  description: text("description"),
  metadata: jsonb("metadata"),
  settledAt: timestamp("settled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type FinancialLedgerTx = typeof financialLedger.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Organization Self-Service Portal
// ─────────────────────────────────────────────────────────────────────────────

export const onboardingPhaseEnum = pgEnum("onboarding_phase", [
  "registration",
  "asset_inventory",
  "data_catalog",
  "self_assessment",
  "initial_audit",
  "remediation",
  "certified",
]);

export const portalSubmissions = pgTable("portal_submissions", {
  id: serial("id").primaryKey(),
  submissionToken: varchar("submission_token", { length: 128 }).unique().notNull(),
  organizationId: integer("organization_id"),
  orgName: text("org_name").notNull(),
  orgSector: varchar("org_sector", { length: 64 }).notNull(), // bank, telecom, healthcare, government, fintech, energy
  orgCountry: varchar("org_country", { length: 64 }).notNull(),
  regulatoryId: varchar("regulatory_id", { length: 128 }),
  contactName: text("contact_name").notNull(),
  contactEmail: varchar("contact_email", { length: 320 }).notNull(),
  contactPhone: varchar("contact_phone", { length: 32 }),
  currentPhase: onboardingPhaseEnum("current_phase").default("registration").notNull(),
  assetCount: integer("asset_count").default(0),
  datasetCount: integer("dataset_count").default(0),
  selfAssessmentScore: real("self_assessment_score"),
  complianceScore: real("compliance_score"),
  assignedAuditorId: integer("assigned_auditor_id"),
  notes: text("notes"),
  metadata: jsonb("metadata"),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  certifiedAt: timestamp("certified_at"),
});

export type PortalSubmission = typeof portalSubmissions.$inferSelect;
export type InsertPortalSubmission = typeof portalSubmissions.$inferInsert;

export const onboardingPhases = pgTable("onboarding_phases", {
  id: serial("id").primaryKey(),
  submissionId: integer("submission_id").notNull(),
  phase: onboardingPhaseEnum("phase").notNull(),
  status: varchar("status", { length: 32 }).default("pending").notNull(), // pending, in_progress, completed, failed
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  workerResults: jsonb("worker_results"), // results from workers that processed this phase
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OnboardingPhase = typeof onboardingPhases.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Cross-Border Transfer Approvals
// ─────────────────────────────────────────────────────────────────────────────

export const transferApprovalStatusEnum = pgEnum("transfer_approval_status", [
  "pending",
  "under_review",
  "approved",
  "denied",
  "expired",
]);

export const transferApprovals = pgTable("transfer_approvals", {
  id: serial("id").primaryKey(),
  referenceId: varchar("reference_id", { length: 128 }).unique().notNull(),
  organizationId: integer("organization_id").notNull(),
  submissionId: integer("submission_id"),
  datasetName: text("dataset_name").notNull(),
  datasetId: integer("dataset_id"),
  sourceCountry: varchar("source_country", { length: 64 }).notNull(),
  destinationCountry: varchar("destination_country", { length: 64 }).notNull(),
  destinationEntity: text("destination_entity").notNull(),
  volumeGb: real("volume_gb").notNull(),
  dataClassification: dataClassificationEnum("data_classification").notNull(),
  businessJustification: text("business_justification").notNull(),
  transferMethod: varchar("transfer_method", { length: 64 }), // SFTP, API, VPN, physical
  encryptionMethod: varchar("encryption_method", { length: 64 }),
  status: transferApprovalStatusEnum("status").default("pending").notNull(),
  approverId: integer("approver_id"),
  approverNotes: text("approver_notes"),
  riskScore: real("risk_score"),
  expiresAt: timestamp("expires_at"),
  approvedAt: timestamp("approved_at"),
  deniedAt: timestamp("denied_at"),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TransferApproval = typeof transferApprovals.$inferSelect;
export type InsertTransferApproval = typeof transferApprovals.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Continuous Monitoring Snapshots
// ─────────────────────────────────────────────────────────────────────────────

export const monitoringSnapshots = pgTable("monitoring_snapshots", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  snapshotType: varchar("snapshot_type", { length: 64 }).notNull(), // compliance_score, sla_check, drift_check, bgp_check
  score: real("score"),
  previousScore: real("previous_score"),
  delta: real("delta"),
  status: varchar("status", { length: 32 }).notNull(), // ok, warning, breach, critical
  workerSource: varchar("worker_source", { length: 64 }), // which worker produced this snapshot
  details: jsonb("details"),
  alertTriggered: boolean("alert_triggered").default(false),
  resolvedAt: timestamp("resolved_at"),
  capturedAt: timestamp("captured_at").defaultNow().notNull(),
});

export type MonitoringSnapshot = typeof monitoringSnapshots.$inferSelect;

export const slaBreaches = pgTable("sla_breaches", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  slaType: varchar("sla_type", { length: 64 }).notNull(), // response_time, uptime, reporting_deadline, audit_frequency
  threshold: real("threshold").notNull(),
  actual: real("actual").notNull(),
  severity: severityEnum("severity").default("medium"),
  status: varchar("status", { length: 32 }).default("open").notNull(), // open, acknowledged, resolved
  escalatedTo: varchar("escalated_to", { length: 128 }),
  notes: text("notes"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export type SlaBreach = typeof slaBreaches.$inferSelect;

export const driftAlerts = pgTable("drift_alerts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  driftType: varchar("drift_type", { length: 64 }).notNull(), // schema_drift, config_drift, policy_drift, data_drift
  resourceName: text("resource_name"),
  previousState: jsonb("previous_state"),
  currentState: jsonb("current_state"),
  severity: severityEnum("severity").default("medium"),
  status: varchar("status", { length: 32 }).default("open").notNull(),
  detectedBy: varchar("detected_by", { length: 64 }), // which worker
  resolvedAt: timestamp("resolved_at"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
});

export type DriftAlert = typeof driftAlerts.$inferSelect;

// ─── Phase 2: BigID + Azure Arc inspired features ───────────────────────────

// Policy Templates Library
export const policyTemplateFrameworkEnum = pgEnum("policy_template_framework", [
  "NDPR", "GDPR", "PIPL", "DPDP", "HIPAA", "SOC2", "ISO27001", "DOJ_EO_14117", "CUSTOM"
]);
export const policyTemplateStatusEnum = pgEnum("policy_template_status", [
  "draft", "active", "deprecated"
]);

export const policyTemplates = pgTable("policy_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  framework: policyTemplateFrameworkEnum("framework").notNull(),
  version: varchar("version", { length: 32 }).default("1.0").notNull(),
  description: text("description"),
  policyDefinition: jsonb("policy_definition").notNull(),
  status: policyTemplateStatusEnum("status").default("draft").notNull(),
  createdBy: integer("created_by"),
  instantiatedCount: integer("instantiated_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type PolicyTemplate = typeof policyTemplates.$inferSelect;

// AI Governance Registry
export const aiRiskLevelEnum = pgEnum("ai_risk_level", [
  "minimal", "limited", "high", "unacceptable"
]);
export const aiSystemStatusEnum = pgEnum("ai_system_status", [
  "registered", "under_review", "approved", "suspended", "decommissioned"
]);

export const aiSystems = pgTable("ai_systems", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  organizationId: integer("organization_id").notNull(),
  vendor: varchar("vendor", { length: 256 }),
  version: varchar("version", { length: 64 }),
  purpose: text("purpose"),
  riskLevel: aiRiskLevelEnum("risk_level").default("limited").notNull(),
  status: aiSystemStatusEnum("status").default("registered").notNull(),
  trainingDataDescription: text("training_data_description"),
  personalDataProcessed: boolean("personal_data_processed").default(false).notNull(),
  crossBorderTransfer: boolean("cross_border_transfer").default(false).notNull(),
  lastAuditAt: timestamp("last_audit_at"),
  nextAuditDue: timestamp("next_audit_due"),
  auditNotes: text("audit_notes"),
  registeredAt: timestamp("registered_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AiSystem = typeof aiSystems.$inferSelect;

// Audit-Ready Evidence Packages
export const evidencePackageStatusEnum = pgEnum("evidence_package_status", [
  "generating", "ready", "verified", "expired"
]);

export const evidencePackages = pgTable("evidence_packages", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  packageType: varchar("package_type", { length: 64 }).notNull(),
  referenceId: integer("reference_id"),
  referenceType: varchar("reference_type", { length: 64 }),
  status: evidencePackageStatusEnum("status").default("generating").notNull(),
  fileUrl: text("file_url"),
  hmacSignature: varchar("hmac_signature", { length: 128 }),
  contentHash: varchar("content_hash", { length: 128 }),
  generatedBy: integer("generated_by"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type EvidencePackage = typeof evidencePackages.$inferSelect;

// Multi-Tenant Sector Hierarchy
export const sectors = pgTable("sectors", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  parentId: integer("parent_id"),
  description: text("description"),
  regulatoryFramework: varchar("regulatory_framework", { length: 128 }),
  orgCount: integer("org_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type Sector = typeof sectors.$inferSelect;

// Citizen Data Rights Requests
export const citizenRequestTypeEnum = pgEnum("citizen_request_type", [
  "access", "erasure", "portability", "rectification", "restriction", "objection"
]);
export const citizenRequestStatusEnum = pgEnum("citizen_request_status", [
  "submitted", "acknowledged", "in_progress", "completed", "rejected", "escalated"
]);

export const citizenRequests = pgTable("citizen_requests", {
  id: serial("id").primaryKey(),
  citizenName: varchar("citizen_name", { length: 256 }).notNull(),
  citizenEmail: varchar("citizen_email", { length: 256 }).notNull(),
  citizenNin: varchar("citizen_nin", { length: 64 }),
  requestType: citizenRequestTypeEnum("request_type").notNull(),
  status: citizenRequestStatusEnum("status").default("submitted").notNull(),
  organizationId: integer("organization_id"),
  description: text("description"),
  referenceNumber: varchar("reference_number", { length: 32 }).unique(),
  responseDeadline: timestamp("response_deadline"),
  responseNotes: text("response_notes"),
  supportingDocUrl: text("supporting_doc_url"),
  supportingDocKey: text("supporting_doc_key"),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type CitizenRequest = typeof citizenRequests.$inferSelect;

// GitOps Config Snapshots
export const configSnapshotStatusEnum = pgEnum("config_snapshot_status", [
  "synced", "drifted", "pending", "failed"
]);

export const configSnapshots = pgTable("config_snapshots", {
  id: serial("id").primaryKey(),
  snapshotName: varchar("snapshot_name", { length: 256 }).notNull(),
  source: varchar("source", { length: 64 }).default("manual").notNull(),
  configData: jsonb("config_data").notNull(),
  status: configSnapshotStatusEnum("status").default("synced").notNull(),
  driftSummary: jsonb("drift_summary"),
  commitHash: varchar("commit_hash", { length: 64 }),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type ConfigSnapshot = typeof configSnapshots.$inferSelect;

// Transfer Impact Assessments
export const tiaRiskLevelEnum = pgEnum("tia_risk_level", [
  "low", "medium", "high", "critical"
]);
export const tiaStatusEnum = pgEnum("tia_status", [
  "draft", "submitted", "approved", "rejected"
]);

export const tiaAssessments = pgTable("tia_assessments", {
  id: serial("id").primaryKey(),
  transferApprovalId: integer("transfer_approval_id"),
  organizationId: integer("organization_id").notNull(),
  dataCategories: jsonb("data_categories"),
  destinationCountry: varchar("destination_country", { length: 128 }),
  legalBasis: varchar("legal_basis", { length: 256 }),
  riskLevel: tiaRiskLevelEnum("risk_level").default("medium").notNull(),
  status: tiaStatusEnum("status").default("draft").notNull(),
  tiaDocument: text("tia_document"),
  safeguards: text("safeguards"),
  reviewedBy: integer("reviewed_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type TiaAssessment = typeof tiaAssessments.$inferSelect;

// ─── Remediation Workflows ───────────────────────────────────────────────────
export const remediationWorkflowStatusEnum = pgEnum("remediation_workflow_status", [
  "pending", "in_progress", "completed", "overdue", "cancelled"
]);
export const remediationWorkflows = pgTable("remediation_workflows", {
  id: serial("id").primaryKey(),
  violationId: integer("violation_id").references(() => complianceViolations.id),
  orgId: integer("org_id").references(() => organizations.id),
  actionType: text("action_type").notNull(),
  priority: text("priority").notNull().default("medium"),
  description: text("description"),
  status: remediationWorkflowStatusEnum("status").notNull().default("pending"),
  assignedTo: integer("assigned_to").references(() => users.id),
  deadline: timestamp("deadline"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type RemediationWorkflow = typeof remediationWorkflows.$inferSelect;

// ─── Enforcement Cases (Penalty Escalation) ──────────────────────────────────
export const enforcementCaseStatusEnum = pgEnum("enforcement_case_status", [
  "open", "under_investigation", "notice_issued", "escalated_to_nitda", "settled", "closed"
]);

export const enforcementCases = pgTable("enforcement_cases", {
  id: serial("id").primaryKey(),
  penaltyId: integer("penalty_id").references(() => financialPenalties.id).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  status: enforcementCaseStatusEnum("status").default("open").notNull(),
  caseReference: varchar("case_reference", { length: 64 }).unique().notNull(),
  assignedOfficerId: integer("assigned_officer_id").references(() => users.id),
  overduedays: integer("overdue_days").default(0),
  escalationReason: text("escalation_reason"),
  nitdaReferenceNumber: varchar("nitda_reference_number", { length: 128 }),
  resolutionNotes: text("resolution_notes"),
  openedAt: timestamp("opened_at").defaultNow().notNull(),
  escalatedAt: timestamp("escalated_at"),
  closedAt: timestamp("closed_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type EnforcementCase = typeof enforcementCases.$inferSelect;
export type InsertEnforcementCase = typeof enforcementCases.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Enforcement Case Timeline (audit trail for status changes)
// ─────────────────────────────────────────────────────────────────────────────

export const caseTimeline = pgTable("case_timeline", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => enforcementCases.id).notNull(),
  changedByUserId: integer("changed_by_user_id").references(() => users.id),
  changedByName: varchar("changed_by_name", { length: 256 }),
  fromStatus: varchar("from_status", { length: 64 }),
  toStatus: varchar("to_status", { length: 64 }).notNull(),
  note: text("note"),
  nitdaRef: varchar("nitda_ref", { length: 128 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CaseTimeline = typeof caseTimeline.$inferSelect;
export type InsertCaseTimeline = typeof caseTimeline.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// GAP CLOSURE: 18 new tables for full NDPA 2023 / GAID 2025 compliance
// ═══════════════════════════════════════════════════════════════════════════

// ─── Gap 1: Consent Management ─────────────────────────────────────────────
export const consentStatusEnum = pgEnum("consent_status", [
  "active", "withdrawn", "expired", "pending"
]);
export const lawfulBasisEnum = pgEnum("lawful_basis", [
  "consent", "contract", "legal_obligation", "vital_interest", "public_interest", "legitimate_interest"
]);

export const consentRecords = pgTable("consent_records", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  dataSubjectName: varchar("data_subject_name", { length: 256 }).notNull(),
  dataSubjectEmail: varchar("data_subject_email", { length: 320 }).notNull(),
  dataSubjectNin: varchar("data_subject_nin", { length: 64 }),
  purpose: text("purpose").notNull(),
  lawfulBasis: lawfulBasisEnum("lawful_basis").notNull(),
  consentStatus: consentStatusEnum("consent_status").default("active").notNull(),
  consentGivenAt: timestamp("consent_given_at").defaultNow().notNull(),
  consentWithdrawnAt: timestamp("consent_withdrawn_at"),
  expiresAt: timestamp("expires_at"),
  evidenceRef: text("evidence_ref"),
  dataCategories: jsonb("data_categories").$type<string[]>().default([]),
  processingActivities: jsonb("processing_activities").$type<string[]>().default([]),
  thirdPartySharing: boolean("third_party_sharing").default(false),
  crossBorderTransfer: boolean("cross_border_transfer").default(false),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type ConsentRecord = typeof consentRecords.$inferSelect;

// ─── Gap 2: Data Breach Notification ────────────────────────────────────────
export const breachSeverityEnum = pgEnum("breach_severity", [
  "low", "medium", "high", "critical"
]);
export const breachStatusEnum = pgEnum("breach_status", [
  "detected", "assessing", "ndpc_notified", "individuals_notified", "contained", "resolved", "closed"
]);

export const breachIncidents = pgTable("breach_incidents", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  severity: breachSeverityEnum("breach_incident_severity").default("medium").notNull(),
  status: breachStatusEnum("breach_incident_status").default("detected").notNull(),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  ndpcNotificationDeadline: timestamp("ndpc_notification_deadline").notNull(),
  ndpcNotifiedAt: timestamp("ndpc_notified_at"),
  individualsNotifiedAt: timestamp("individuals_notified_at"),
  containedAt: timestamp("contained_at"),
  resolvedAt: timestamp("resolved_at"),
  affectedIndividualsCount: integer("affected_individuals_count").default(0),
  dataTypesAffected: jsonb("data_types_affected").$type<string[]>().default([]),
  breachCause: text("breach_cause"),
  remediationActions: text("remediation_actions"),
  reportedBy: integer("reported_by"),
  assignedTo: integer("assigned_to"),
  ndpcReferenceNumber: varchar("ndpc_reference_number", { length: 128 }),
  securityAlertId: integer("security_alert_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type BreachIncident = typeof breachIncidents.$inferSelect;

// ─── Gap 3: DPO Registry ────────────────────────────────────────────────────
export const dpoCredentialStatusEnum = pgEnum("dpo_credential_status", [
  "pending", "verified", "expired", "suspended", "revoked"
]);

export const dpoAppointments = pgTable("dpo_appointments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  dpoName: varchar("dpo_name", { length: 256 }).notNull(),
  dpoEmail: varchar("dpo_email", { length: 320 }).notNull(),
  dpoPhone: varchar("dpo_phone", { length: 32 }),
  appointedAt: timestamp("appointed_at").defaultNow().notNull(),
  credentialStatus: dpoCredentialStatusEnum("credential_status").default("pending").notNull(),
  dpcoId: varchar("dpco_id", { length: 128 }),
  dpcoName: varchar("dpco_name", { length: 256 }),
  certificationExpiresAt: timestamp("certification_expires_at"),
  lastReportSubmittedAt: timestamp("last_report_submitted_at"),
  independenceVerified: boolean("independence_verified").default(false),
  trainingHoursCompleted: integer("training_hours_completed").default(0),
  notes: text("notes"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DpoAppointment = typeof dpoAppointments.$inferSelect;

// ─── Gap 4: DPIA (Data Privacy Impact Assessment) ───────────────────────────
export const dpiaStatusEnum = pgEnum("dpia_status", [
  "draft", "in_progress", "review", "approved", "rejected", "archived"
]);
export const dpiaRiskLevelEnum = pgEnum("dpia_risk_level", [
  "low", "medium", "high", "critical"
]);

export const dpiaAssessments = pgTable("dpia_assessments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  title: text("title").notNull(),
  processingDescription: text("processing_description").notNull(),
  triggerCategory: varchar("trigger_category", { length: 128 }).notNull(),
  status: dpiaStatusEnum("dpia_status").default("draft").notNull(),
  riskLevel: dpiaRiskLevelEnum("dpia_risk_level").default("medium").notNull(),
  dataCategories: jsonb("data_categories").$type<string[]>().default([]),
  purposeOfProcessing: text("purpose_of_processing"),
  necessityAssessment: text("necessity_assessment"),
  riskAssessment: text("risk_assessment"),
  mitigationMeasures: text("mitigation_measures"),
  residualRisk: text("residual_risk"),
  ndpcConsultationRequired: boolean("ndpc_consultation_required").default(false),
  ndpcConsultedAt: timestamp("ndpc_consulted_at"),
  reviewedBy: integer("reviewed_by"),
  approvedAt: timestamp("approved_at"),
  nextReviewDate: timestamp("next_review_date"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DpiaAssessment = typeof dpiaAssessments.$inferSelect;

// ─── Gap 5: Records of Processing Activities (ROPA) ────────────────────────
export const ropaRecords = pgTable("ropa_records", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  processingActivityName: text("processing_activity_name").notNull(),
  purpose: text("purpose").notNull(),
  lawfulBasis: lawfulBasisEnum("ropa_lawful_basis").notNull(),
  dataCategories: jsonb("data_categories").$type<string[]>().default([]),
  dataSubjectCategories: jsonb("data_subject_categories").$type<string[]>().default([]),
  recipients: jsonb("recipients").$type<string[]>().default([]),
  crossBorderTransfers: boolean("cross_border_transfers").default(false),
  transferDestinations: jsonb("transfer_destinations").$type<string[]>().default([]),
  retentionPeriodDays: integer("retention_period_days"),
  securityMeasures: text("security_measures"),
  dpiaRequired: boolean("dpia_required").default(false),
  dpiaId: integer("dpia_id"),
  dpoReviewed: boolean("dpo_reviewed").default(false),
  lastReviewedAt: timestamp("last_reviewed_at"),
  isActive: boolean("is_active").default(true).notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type RopaRecord = typeof ropaRecords.$inferSelect;

// ─── Gap 6: Retention Policies ──────────────────────────────────────────────
export const retentionPolicies = pgTable("retention_policies", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  name: varchar("name", { length: 256 }).notNull(),
  dataCategory: varchar("data_category", { length: 128 }).notNull(),
  retentionPeriodDays: integer("retention_period_days").notNull(),
  archivalAction: varchar("archival_action", { length: 64 }).default("delete").notNull(),
  legalBasis: text("legal_basis"),
  isGlobal: boolean("is_global").default(false),
  isActive: boolean("is_active").default(true).notNull(),
  lastExecutedAt: timestamp("last_executed_at"),
  nextExecutionAt: timestamp("next_execution_at"),
  recordsAffected: integer("records_affected").default(0),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type RetentionPolicy = typeof retentionPolicies.$inferSelect;

// ─── Gap 7: Semi-Annual DPO Reports ────────────────────────────────────────
export const dpoReportStatusEnum = pgEnum("dpo_report_status", [
  "draft", "submitted", "verified", "rejected"
]);

export const dpoReports = pgTable("dpo_reports", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  dpoAppointmentId: integer("dpo_appointment_id"),
  reportPeriodStart: timestamp("report_period_start").notNull(),
  reportPeriodEnd: timestamp("report_period_end").notNull(),
  status: dpoReportStatusEnum("dpo_report_status").default("draft").notNull(),
  privacyNoticesReview: text("privacy_notices_review"),
  dataProcessingCategories: text("data_processing_categories"),
  lawfulBasesReview: text("lawful_bases_review"),
  dpiaReview: text("dpia_review"),
  rightsExerciseReview: text("rights_exercise_review"),
  complaintHandling: text("complaint_handling"),
  securityMeasuresReview: text("security_measures_review"),
  crossBorderReview: text("cross_border_review"),
  breachNotifications: text("breach_notifications"),
  trainingActivities: text("training_activities"),
  recommendations: text("recommendations"),
  dpcoVerifiedAt: timestamp("dpco_verified_at"),
  dpcoVerifierId: varchar("dpco_verifier_id", { length: 128 }),
  submittedAt: timestamp("submitted_at"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DpoReport = typeof dpoReports.$inferSelect;

// ─── Gap 8: Compliance Audit Returns (CAR) ──────────────────────────────────
export const carStatusEnum = pgEnum("car_status", [
  "draft", "submitted", "under_review", "accepted", "rejected", "revision_requested"
]);

export const complianceAuditReturns = pgTable("compliance_audit_returns", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  auditPeriodStart: timestamp("audit_period_start").notNull(),
  auditPeriodEnd: timestamp("audit_period_end").notNull(),
  status: carStatusEnum("car_status").default("draft").notNull(),
  dpcoId: varchar("dpco_id", { length: 128 }),
  dpcoName: varchar("dpco_name", { length: 256 }),
  complianceScore: real("compliance_score"),
  findingsSummary: text("findings_summary"),
  nonConformities: jsonb("non_conformities").$type<string[]>().default([]),
  correctiveActions: jsonb("corrective_actions").$type<string[]>().default([]),
  dataProtectionPoliciesReview: text("data_protection_policies_review"),
  securityMeasuresAssessment: text("security_measures_assessment"),
  staffTrainingAssessment: text("staff_training_assessment"),
  incidentResponseAssessment: text("incident_response_assessment"),
  crossBorderAssessment: text("cross_border_assessment"),
  submittedAt: timestamp("submitted_at"),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type ComplianceAuditReturn = typeof complianceAuditReturns.$inferSelect;

// ─── Gap 9: Adequacy Determination Registry ─────────────────────────────────
export const adequacyStatusEnum = pgEnum("adequacy_status", [
  "adequate", "partially_adequate", "not_adequate", "under_review", "pending"
]);

export const adequacyDeterminations = pgTable("adequacy_determinations", {
  id: serial("id").primaryKey(),
  countryCode: varchar("country_code", { length: 8 }).notNull().unique(),
  countryName: varchar("country_name", { length: 128 }).notNull(),
  status: adequacyStatusEnum("adequacy_status").default("pending").notNull(),
  dataProtectionLaw: varchar("data_protection_law", { length: 256 }),
  supervisoryAuthority: varchar("supervisory_authority", { length: 256 }),
  assessmentDate: timestamp("assessment_date"),
  expiresAt: timestamp("expires_at"),
  notes: text("notes"),
  requiresAdditionalSafeguards: boolean("requires_additional_safeguards").default(false),
  approvedTransferInstruments: jsonb("approved_transfer_instruments").$type<string[]>().default([]),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AdequacyDetermination = typeof adequacyDeterminations.$inferSelect;

// ─── Gap 10: Data Processing Agreements (DPA) ───────────────────────────────
export const dpaStatusEnum = pgEnum("dpa_status", [
  "draft", "active", "expired", "terminated", "under_review"
]);

export const dataProcessingAgreements = pgTable("data_processing_agreements", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  processorName: varchar("processor_name", { length: 256 }).notNull(),
  processorCountry: varchar("processor_country", { length: 128 }),
  status: dpaStatusEnum("dpa_status").default("draft").notNull(),
  agreementDate: timestamp("agreement_date"),
  expiryDate: timestamp("expiry_date"),
  processingPurpose: text("processing_purpose"),
  dataCategories: jsonb("data_categories").$type<string[]>().default([]),
  subProcessors: jsonb("sub_processors").$type<string[]>().default([]),
  securityMeasures: text("security_measures"),
  breachNotificationClause: boolean("breach_notification_clause").default(true),
  crossBorderTransfer: boolean("cross_border_transfer").default(false),
  auditRights: boolean("audit_rights").default(true),
  terminationProvisions: text("termination_provisions"),
  documentUrl: text("document_url"),
  reviewedBy: integer("reviewed_by"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DataProcessingAgreement = typeof dataProcessingAgreements.$inferSelect;

// ─── Gap 11: Privacy Notices ────────────────────────────────────────────────
export const privacyNoticeStatusEnum = pgEnum("privacy_notice_status", [
  "draft", "active", "archived"
]);

export const privacyNotices = pgTable("privacy_notices", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  version: varchar("version", { length: 32 }).default("1.0").notNull(),
  status: privacyNoticeStatusEnum("privacy_notice_status").default("draft").notNull(),
  noticeType: varchar("notice_type", { length: 64 }).default("general").notNull(),
  content: text("content").notNull(),
  dataControllerInfo: text("data_controller_info"),
  dpoContactInfo: text("dpo_contact_info"),
  purposesOfProcessing: jsonb("purposes_of_processing").$type<string[]>().default([]),
  lawfulBases: jsonb("lawful_bases").$type<string[]>().default([]),
  dataRetentionInfo: text("data_retention_info"),
  rightsInfo: text("rights_info"),
  crossBorderInfo: text("cross_border_info"),
  cookieInfo: text("cookie_info"),
  publishedAt: timestamp("published_at"),
  effectiveDate: timestamp("effective_date"),
  previousVersionId: integer("previous_version_id"),
  approvedBy: integer("approved_by"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type PrivacyNotice = typeof privacyNotices.$inferSelect;

// ─── Gap 12: Cookie Consent Tracking ────────────────────────────────────────
export const cookieConsentRecords = pgTable("cookie_consent_records", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  domain: varchar("domain", { length: 256 }).notNull(),
  visitorId: varchar("visitor_id", { length: 256 }),
  consentGiven: boolean("consent_given").default(false).notNull(),
  necessaryCookies: boolean("necessary_cookies").default(true),
  analyticalCookies: boolean("analytical_cookies").default(false),
  marketingCookies: boolean("marketing_cookies").default(false),
  functionalCookies: boolean("functional_cookies").default(false),
  consentTimestamp: timestamp("consent_timestamp").defaultNow().notNull(),
  withdrawnAt: timestamp("withdrawn_at"),
  ipAddress: varchar("ip_address", { length: 64 }),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CookieConsentRecord = typeof cookieConsentRecords.$inferSelect;

// ─── Gap 13: Automated Decision Records ────────────────────────────────────
export const automatedDecisionRecords = pgTable("automated_decision_records", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  aiSystemId: integer("ai_system_id"),
  dataSubjectEmail: varchar("data_subject_email", { length: 320 }),
  decisionType: varchar("decision_type", { length: 128 }).notNull(),
  decisionOutcome: text("decision_outcome").notNull(),
  significantEffect: boolean("significant_effect").default(false),
  humanReviewRequested: boolean("human_review_requested").default(false),
  humanReviewCompletedAt: timestamp("human_review_completed_at"),
  humanReviewOutcome: text("human_review_outcome"),
  logicExplanation: text("logic_explanation"),
  inputDataSummary: text("input_data_summary"),
  optOutRequested: boolean("opt_out_requested").default(false),
  optOutGrantedAt: timestamp("opt_out_granted_at"),
  metadata: jsonb("metadata"),
  decidedAt: timestamp("decided_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type AutomatedDecisionRecord = typeof automatedDecisionRecords.$inferSelect;

// ─── Gap 14: Children's Data / Parental Consent ─────────────────────────────
export const parentalConsentStatusEnum = pgEnum("parental_consent_status", [
  "pending", "granted", "denied", "withdrawn", "expired"
]);

export const parentalConsentRecords = pgTable("parental_consent_records", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  childName: varchar("child_name", { length: 256 }),
  childAge: integer("child_age"),
  parentName: varchar("parent_name", { length: 256 }).notNull(),
  parentEmail: varchar("parent_email", { length: 320 }).notNull(),
  parentIdVerified: boolean("parent_id_verified").default(false),
  purpose: text("purpose").notNull(),
  consentStatus: parentalConsentStatusEnum("parental_consent_status").default("pending").notNull(),
  consentGivenAt: timestamp("consent_given_at"),
  consentWithdrawnAt: timestamp("consent_withdrawn_at"),
  verificationMethod: varchar("verification_method", { length: 128 }),
  ageVerificationMethod: varchar("age_verification_method", { length: 128 }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type ParentalConsentRecord = typeof parentalConsentRecords.$inferSelect;

// ─── Gap 15: Staff Training & Awareness ─────────────────────────────────────
export const trainingStatusEnum = pgEnum("training_status", [
  "scheduled", "in_progress", "completed", "overdue", "cancelled"
]);

export const staffTrainingRecords = pgTable("staff_training_records", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  trainingTitle: varchar("training_title", { length: 256 }).notNull(),
  trainingType: varchar("training_type", { length: 128 }).notNull(),
  description: text("description"),
  status: trainingStatusEnum("training_status").default("scheduled").notNull(),
  scheduledDate: timestamp("scheduled_date"),
  completedDate: timestamp("completed_date"),
  participantCount: integer("participant_count").default(0),
  targetAudience: varchar("target_audience", { length: 256 }),
  trainerName: varchar("trainer_name", { length: 256 }),
  durationHours: real("duration_hours"),
  passRate: real("pass_rate"),
  nextScheduledDate: timestamp("next_scheduled_date"),
  isRecurring: boolean("is_recurring").default(false),
  recurrenceMonths: integer("recurrence_months"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type StaffTrainingRecord = typeof staffTrainingRecords.$inferSelect;

// ─── Gap 16: BCR/SCC Templates ──────────────────────────────────────────────
export const transferInstrumentTypeEnum = pgEnum("transfer_instrument_type", [
  "bcr", "scc", "adequacy", "derogation", "authorization"
]);
export const transferInstrumentStatusEnum = pgEnum("transfer_instrument_status", [
  "draft", "active", "expired", "revoked"
]);

export const transferInstruments = pgTable("transfer_instruments", {
  id: serial("id").primaryKey(),
  instrumentType: transferInstrumentTypeEnum("instrument_type").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  status: transferInstrumentStatusEnum("transfer_instrument_status").default("draft").notNull(),
  description: text("description"),
  templateContent: text("template_content"),
  applicableCountries: jsonb("applicable_countries").$type<string[]>().default([]),
  effectiveDate: timestamp("effective_date"),
  expiryDate: timestamp("expiry_date"),
  approvedBy: integer("approved_by"),
  organizationId: integer("organization_id"),
  ndpcApprovalRef: varchar("ndpc_approval_ref", { length: 128 }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type TransferInstrument = typeof transferInstruments.$inferSelect;

// ─── Gap 17: Data Portability Export Jobs ───────────────────────────────────
export const exportJobStatusEnum = pgEnum("export_job_status", [
  "queued", "processing", "completed", "failed", "expired"
]);

export const dataExportJobs = pgTable("data_export_jobs", {
  id: serial("id").primaryKey(),
  citizenRequestId: integer("citizen_request_id"),
  organizationId: integer("organization_id").notNull(),
  dataSubjectEmail: varchar("data_subject_email", { length: 320 }).notNull(),
  exportFormat: varchar("export_format", { length: 32 }).default("json").notNull(),
  status: exportJobStatusEnum("export_job_status").default("queued").notNull(),
  dataCategories: jsonb("data_categories").$type<string[]>().default([]),
  fileSizeBytes: integer("file_size_bytes"),
  downloadUrl: text("download_url"),
  downloadExpiresAt: timestamp("download_expires_at"),
  processedAt: timestamp("processed_at"),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type DataExportJob = typeof dataExportJobs.$inferSelect;

// ─── Gap 18: DCPMI Threshold Configuration ──────────────────────────────────
export const dcpmiThresholds = pgTable("dcpmi_thresholds", {
  id: serial("id").primaryKey(),
  sectorCode: varchar("sector_code", { length: 64 }),
  criterionName: varchar("criterion_name", { length: 256 }).notNull(),
  criterionDescription: text("criterion_description"),
  thresholdValue: real("threshold_value").notNull(),
  thresholdUnit: varchar("threshold_unit", { length: 64 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  effectiveDate: timestamp("effective_date"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DcpmiThreshold = typeof dcpmiThresholds.$inferSelect;

// ─── NDPA Compliance Snapshots (daily trend) ─────────────────────────────────
export const ndpaComplianceSnapshots = pgTable("ndpa_compliance_snapshots", {
  id: serial("id").primaryKey(),
  snapshotDate: timestamp("snapshot_date").notNull(),
  ndpaIndex: real("ndpa_index").notNull(),
  breachResolutionRate: real("breach_resolution_rate").notNull(),
  breachNotificationRate: real("breach_notification_rate").notNull(),
  dpoAppointmentRate: real("dpo_appointment_rate").notNull(),
  dpiaCompletionRate: real("dpia_completion_rate").notNull(),
  consentComplianceRate: real("consent_compliance_rate").notNull(),
  trainingCompletionRate: real("training_completion_rate").notNull(),
  auditReturnRate: real("audit_return_rate").notNull(),
  privacyNoticeRate: real("privacy_notice_rate").notNull(),
  breachesTotal: integer("breaches_total").default(0),
  dpoVerified: integer("dpo_verified").default(0),
  dpiaApproved: integer("dpia_approved").default(0),
  consentActive: integer("consent_active").default(0),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type NdpaComplianceSnapshot = typeof ndpaComplianceSnapshots.$inferSelect;

// ─── DPCO Billing & Revenue Split ─────────────────────────────────────────────
export const dpcoInvoiceStatusEnum = pgEnum("dpco_invoice_status", [
  "draft", "sent", "paid", "overdue", "cancelled", "disputed",
]);
export const dpcoInvoices = pgTable("dpco_invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: varchar("invoice_number", { length: 64 }).notNull().unique(),
  dpcoOrgId: integer("dpco_org_id").notNull(),
  clientOrgId: integer("client_org_id"),
  clientName: varchar("client_name", { length: 256 }).notNull(),
  clientEmail: varchar("client_email", { length: 256 }),
  status: dpcoInvoiceStatusEnum("status").default("draft").notNull(),
  serviceType: varchar("service_type", { length: 128 }).notNull(),
  description: text("description"),
  subtotal: numeric("subtotal", { precision: 15, scale: 2 }).notNull(),
  vatAmount: numeric("vat_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull(),
  platformFeeRate: numeric("platform_fee_rate", { precision: 5, scale: 4 }).default("0.1000").notNull(),
  platformFeeAmount: numeric("platform_fee_amount", { precision: 15, scale: 2 }).notNull(),
  dpcoNetAmount: numeric("dpco_net_amount", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
  issueDate: timestamp("issue_date").defaultNow().notNull(),
  dueDate: timestamp("due_date").notNull(),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  lineItems: jsonb("line_items"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DpcoInvoice = typeof dpcoInvoices.$inferSelect;

export const dpcoPaymentMethodEnum = pgEnum("dpco_payment_method", [
  "bank_transfer", "card", "ussd", "paystack", "flutterwave", "manual",
]);
export const dpcoPayments = pgTable("dpco_payments", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  dpcoOrgId: integer("dpco_org_id").notNull(),
  paymentReference: varchar("payment_reference", { length: 128 }).notNull().unique(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  platformFeeAmount: numeric("platform_fee_amount", { precision: 15, scale: 2 }).notNull(),
  dpcoNetAmount: numeric("dpco_net_amount", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
  paymentMethod: dpcoPaymentMethodEnum("payment_method").default("bank_transfer").notNull(),
  paidAt: timestamp("paid_at").defaultNow().notNull(),
  gatewayReference: varchar("gateway_reference", { length: 256 }),
  notes: text("notes"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type DpcoPayment = typeof dpcoPayments.$inferSelect;

export const dpcoSubscriptionTierEnum = pgEnum("dpco_subscription_tier", [
  "starter", "professional", "enterprise", "unlimited",
]);
export const dpcoSubscriptionStatusEnum = pgEnum("dpco_subscription_status", [
  "active", "suspended", "cancelled", "trial", "expired",
]);
export const dpcoSubscriptions = pgTable("dpco_subscriptions", {
  id: serial("id").primaryKey(),
  dpcoOrgId: integer("dpco_org_id").notNull().unique(),
  tier: dpcoSubscriptionTierEnum("tier").default("starter").notNull(),
  status: dpcoSubscriptionStatusEnum("status").default("trial").notNull(),
  monthlyFee: numeric("monthly_fee", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
  maxClients: integer("max_clients").default(10).notNull(),
  maxAuditsPerMonth: integer("max_audits_per_month").default(5).notNull(),
  platformFeeRate: numeric("platform_fee_rate", { precision: 5, scale: 4 }).default("0.1000").notNull(),
  trialEndsAt: timestamp("trial_ends_at"),
  currentPeriodStart: timestamp("current_period_start").defaultNow().notNull(),
  currentPeriodEnd: timestamp("current_period_end").notNull(),
  cancelledAt: timestamp("cancelled_at"),
  features: jsonb("features"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DpcoSubscription = typeof dpcoSubscriptions.$inferSelect;

export const platformRevenueSplits = pgTable("platform_revenue_splits", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull(),
  invoiceId: integer("invoice_id").notNull(),
  dpcoOrgId: integer("dpco_org_id").notNull(),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull(),
  platformShare: numeric("platform_share", { precision: 15, scale: 2 }).notNull(),
  dpcoShare: numeric("dpco_share", { precision: 15, scale: 2 }).notNull(),
  platformFeeRate: numeric("platform_fee_rate", { precision: 5, scale: 4 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
  splitAt: timestamp("split_at").defaultNow().notNull(),
  platformPaidOut: boolean("platform_paid_out").default(false).notNull(),
  dpcoPaidOut: boolean("dpco_paid_out").default(false).notNull(),
  platformPaidOutAt: timestamp("platform_paid_out_at"),
  dpcoPaidOutAt: timestamp("dpco_paid_out_at"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type PlatformRevenueSplit = typeof platformRevenueSplits.$inferSelect;

// ── DPCO Organisations ────────────────────────────────────────────────────────
export const dpcoOrgStatusEnum = pgEnum("dpco_org_status", ["pending", "active", "suspended", "revoked"]);
export const dpcoOrgTierEnum = pgEnum("dpco_org_tier", ["starter", "professional", "enterprise"]);

export const dpcoOrganisations = pgTable("dpco_organisations", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  licenceNumber: varchar("licence_number", { length: 100 }).unique(),
  status: dpcoOrgStatusEnum("status").default("pending").notNull(),
  tier: dpcoOrgTierEnum("tier").default("starter").notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  cacNumber: varchar("cac_number", { length: 100 }),
  taxId: varchar("tax_id", { length: 100 }),
  rcNumber: varchar("rc_number", { length: 100 }),
  dpoName: varchar("dpo_name", { length: 255 }),
  dpoEmail: varchar("dpo_email", { length: 255 }),
  services: text("services").array(),
  sectors: text("sectors").array(),
  website: varchar("website", { length: 255 }),
  logoUrl: varchar("logo_url", { length: 500 }),
  licenceExpiresAt: timestamp("licence_expires_at"),
  approvedAt: timestamp("approved_at"),
  approvedBy: varchar("approved_by", { length: 255 }),
  rejectionReason: text("rejection_reason"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DpcoOrganisation = typeof dpcoOrganisations.$inferSelect;
export type InsertDpcoOrganisation = typeof dpcoOrganisations.$inferInsert;

// ── DPCO Clients ──────────────────────────────────────────────────────────────
export const dpcoClientStatusEnum = pgEnum("dpco_client_status", ["active", "inactive", "suspended"]);
export const dpcoClientRiskEnum = pgEnum("dpco_client_risk", ["low", "medium", "high", "critical"]);

export const dpcoClients = pgTable("dpco_clients", {
  id: serial("id").primaryKey(),
  dpcoOrgId: integer("dpco_org_id").notNull(),
  orgName: varchar("org_name", { length: 255 }).notNull(),
  orgSector: varchar("org_sector", { length: 100 }),
  orgLocation: varchar("org_location", { length: 255 }),
  contactName: varchar("contact_name", { length: 255 }),
  contactEmail: varchar("contact_email", { length: 255 }),
  contactPhone: varchar("contact_phone", { length: 50 }),
  status: dpcoClientStatusEnum("status").default("active").notNull(),
  riskLevel: dpcoClientRiskEnum("risk_level").default("medium").notNull(),
  complianceScore: integer("compliance_score").default(0),
  onboardedAt: timestamp("onboarded_at").defaultNow(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DpcoClient = typeof dpcoClients.$inferSelect;
export type InsertDpcoClient = typeof dpcoClients.$inferInsert;

// ── DPCO Audit Engagements ────────────────────────────────────────────────────
export const dpcoAuditStageEnum = pgEnum("dpco_audit_stage", [
  "initiated", "data_mapping", "gap_assessment", "fieldwork",
  "findings_review", "management_response", "report_issued", "car_filed"
]);

export const dpcoAuditEngagements = pgTable("dpco_audit_engagements", {
  id: serial("id").primaryKey(),
  dpcoOrgId: integer("dpco_org_id").notNull(),
  clientId: integer("client_id"),
  title: varchar("title", { length: 255 }).notNull(),
  currentStage: dpcoAuditStageEnum("current_stage").default("initiated").notNull(),
  complianceScore: integer("compliance_score"),
  leadAuditor: varchar("lead_auditor", { length: 255 }),
  plannedStart: timestamp("planned_start"),
  plannedEnd: timestamp("planned_end"),
  actualStart: timestamp("actual_start"),
  actualEnd: timestamp("actual_end"),
  criticalFindings: integer("critical_findings").default(0),
  highFindings: integer("high_findings").default(0),
  mediumFindings: integer("medium_findings").default(0),
  lowFindings: integer("low_findings").default(0),
  managementResponse: text("management_response"),
  notes: text("notes"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DpcoAuditEngagement = typeof dpcoAuditEngagements.$inferSelect;
export type InsertDpcoAuditEngagement = typeof dpcoAuditEngagements.$inferInsert;

// ── DPCO Audit Control Ratings ────────────────────────────────────────────────
export const controlRatingEnum = pgEnum("control_rating", ["compliant", "partial", "non_compliant", "not_applicable"]);

export const dpcoAuditControlRatings = pgTable("dpco_audit_control_ratings", {
  id: serial("id").primaryKey(),
  engagementId: integer("engagement_id").notNull(),
  dpcoOrgId: integer("dpco_org_id"),
  controlId: varchar("control_id", { length: 20 }).notNull(),
  controlRef: varchar("control_ref", { length: 255 }),
  controlTitle: varchar("control_title", { length: 255 }),
  rating: controlRatingEnum("rating").notNull(),
  notes: text("notes"),
  ratedBy: varchar("rated_by", { length: 255 }),
  ratedAt: timestamp("rated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DpcoAuditControlRating = typeof dpcoAuditControlRatings.$inferSelect;

// ── DPCO Evidence Items ───────────────────────────────────────────────────────
export const dpcoEvidenceStatusEnum = pgEnum("dpco_evidence_status", ["active", "expired", "superseded"]);

export const dpcoEvidenceItems = pgTable("dpco_evidence_items", {
  id: serial("id").primaryKey(),
  dpcoOrgId: integer("dpco_org_id").notNull(),
  engagementId: integer("engagement_id"),
  clientId: integer("client_id"),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  fileUrl: varchar("file_url", { length: 500 }),
  fileKey: varchar("file_key", { length: 500 }),
  fileName: varchar("file_name", { length: 255 }),
  mimeType: varchar("mime_type", { length: 100 }),
  fileSize: integer("file_size"),
  sha256Hash: varchar("sha256_hash", { length: 64 }),
  controlIds: text("control_ids").array(),
  status: dpcoEvidenceStatusEnum("status").default("active").notNull(),
  expiresAt: timestamp("expires_at"),
  uploadedBy: varchar("uploaded_by", { length: 255 }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DpcoEvidenceItem = typeof dpcoEvidenceItems.$inferSelect;

// ── DPCO Training Sessions ────────────────────────────────────────────────────
export const dpcoTrainingStatusEnum = pgEnum("dpco_training_status", ["scheduled", "in_progress", "completed", "cancelled"]);

export const dpcoTrainingSessions = pgTable("dpco_training_sessions", {
  id: serial("id").primaryKey(),
  dpcoOrgId: integer("dpco_org_id").notNull(),
  clientId: integer("client_id"),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  trainingType: varchar("training_type", { length: 100 }),
  status: dpcoTrainingStatusEnum("status").default("scheduled").notNull(),
  scheduledDate: timestamp("scheduled_date"),
  completedDate: timestamp("completed_date"),
  participantCount: integer("participant_count").default(0),
  certificatesIssued: integer("certificates_issued").default(0),
  ndpaSection: varchar("ndpa_section", { length: 50 }),
  facilitator: varchar("facilitator", { length: 255 }),
  venue: varchar("venue", { length: 255 }),
  materials: text("materials").array(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DpcoTrainingSession = typeof dpcoTrainingSessions.$inferSelect;

// ── DPCO Client Policies ──────────────────────────────────────────────────────
export const dpcoClientPolicyStatusEnum = pgEnum("dpco_client_policy_status", ["draft", "customised", "reviewed", "signed", "delivered", "expired"]);

export const dpcoClientPolicies = pgTable("dpco_client_policies", {
  id: serial("id").primaryKey(),
  dpcoOrgId: integer("dpco_org_id").notNull(),
  clientId: integer("client_id").notNull(),
  templateId: varchar("template_id", { length: 100 }).notNull(),
  templateName: varchar("template_name", { length: 255 }).notNull(),
  status: dpcoClientPolicyStatusEnum("status").default("draft").notNull(),
  customisedContent: text("customised_content"),
  fileUrl: varchar("file_url", { length: 500 }),
  assignedBy: varchar("assigned_by", { length: 255 }),
  signedAt: timestamp("signed_at"),
  expiresAt: timestamp("expires_at"),
  notes: text("notes"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DpcoClientPolicy = typeof dpcoClientPolicies.$inferSelect;

// ── DPCO Engagement Requests ──────────────────────────────────────────────────
// Submitted by regulated organisations via the Org Portal to request a DPCO audit
export const dpcoEngagementRequestStatusEnum = pgEnum("dpco_engagement_request_status", [
  "pending",      // submitted, awaiting DPCO response
  "accepted",     // DPCO accepted — will create a formal audit engagement
  "declined",     // DPCO declined (capacity, conflict of interest, etc.)
  "withdrawn",    // Org withdrew the request
  "converted",    // Accepted and converted into a dpcoAuditEngagement
]);

export const dpcoEngagementRequests = pgTable("dpco_engagement_requests", {
  id: serial("id").primaryKey(),
  // Requesting organisation
  orgName: varchar("org_name", { length: 255 }).notNull(),
  orgSector: varchar("org_sector", { length: 100 }),
  orgCountry: varchar("org_country", { length: 100 }),
  orgRegistrationNumber: varchar("org_registration_number", { length: 100 }),
  contactName: varchar("contact_name", { length: 255 }).notNull(),
  contactEmail: varchar("contact_email", { length: 320 }).notNull(),
  contactPhone: varchar("contact_phone", { length: 50 }),
  // Target DPCO
  dpcoOrgId: integer("dpco_org_id").notNull(),
  // Audit scope
  auditScope: text("audit_scope"),           // free-text description of what needs auditing
  preferredStartDate: timestamp("preferred_start_date"),
  estimatedDataSubjects: varchar("estimated_data_subjects", { length: 100 }),
  processingActivities: text("processing_activities").array(),
  // Status tracking
  status: dpcoEngagementRequestStatusEnum("status").default("pending").notNull(),
  dpcoResponseNote: text("dpco_response_note"),   // DPCO's acceptance/decline message
  respondedAt: timestamp("responded_at"),
  // If converted, link to the formal engagement
  engagementId: integer("engagement_id"),
  // Reference token shown to the org
  referenceToken: varchar("reference_token", { length: 64 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DpcoEngagementRequest = typeof dpcoEngagementRequests.$inferSelect;
export type InsertDpcoEngagementRequest = typeof dpcoEngagementRequests.$inferInsert;

// ── DPCO Accreditation Applications ──────────────────────────────────────────
export const accreditationAppStatusEnum = pgEnum("accreditation_app_status", [
  "draft", "submitted", "info_requested", "under_review", "competency_scheduled",
  "approved", "conditionally_approved", "rejected", "renewal_pending", "renewal_submitted",
  "suspended", "revoked"
]);

export const dpcoAccreditationApplications = pgTable("dpco_accreditation_applications", {
  id: serial("id").primaryKey(),
  orgName: varchar("org_name", { length: 255 }).notNull(),
  rcNumber: varchar("rc_number", { length: 100 }).notNull(),
  cacNumber: varchar("cac_number", { length: 100 }),
  taxId: varchar("tax_id", { length: 100 }),
  address: text("address").notNull(),
  website: varchar("website", { length: 255 }),
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  leadAuditors: jsonb("lead_auditors").notNull().$type<Array<{name: string; email: string; certifications: string[]}>>(),
  sectors: text("sectors").array().notNull(),
  incorporationDocUrl: varchar("incorporation_doc_url", { length: 500 }),
  financialStatementsUrl: varchar("financial_statements_url", { length: 500 }),
  indemnityInsuranceUrl: varchar("indemnity_insurance_url", { length: 500 }),
  auditMethodologyUrl: varchar("audit_methodology_url", { length: 500 }),
  conflictDeclaration: boolean("conflict_declaration").default(false).notNull(),
  declarationSignedAt: timestamp("declaration_signed_at"),
  applicationType: varchar("application_type", { length: 20 }).default("new").notNull(),
  existingDpcoOrgId: integer("existing_dpco_org_id").references(() => dpcoOrganisations.id),
  applicationFee: integer("application_fee").default(0),
  paymentIntentId: varchar("payment_intent_id", { length: 255 }),
  paymentStatus: varchar("payment_status", { length: 50 }).default("pending"),
  status: accreditationAppStatusEnum("status").default("draft").notNull(),
  referenceToken: varchar("reference_token", { length: 64 }).unique().notNull(),
  reviewedBy: varchar("reviewed_by", { length: 255 }),
  reviewStartedAt: timestamp("review_started_at"),
  reviewChecklist: jsonb("review_checklist").$type<Record<string, boolean>>(),
  infoRequestNote: text("info_request_note"),
  infoRequestedAt: timestamp("info_requested_at"),
  competencyScheduledAt: timestamp("competency_scheduled_at"),
  decision: varchar("decision", { length: 30 }),
  decisionAt: timestamp("decision_at"),
  decisionBy: varchar("decision_by", { length: 255 }),
  decisionReason: text("decision_reason"),
  conditions: text("conditions"),
  issuedLicenceNumber: varchar("issued_licence_number", { length: 100 }),
  licenceIssuedAt: timestamp("licence_issued_at"),
  licenceExpiresAt: timestamp("licence_expires_at"),
  licenceCertificateUrl: varchar("licence_certificate_url", { length: 500 }),
  suspendedAt: timestamp("suspended_at"),
  suspensionReason: text("suspension_reason"),
  revokedAt: timestamp("revoked_at"),
  revocationReason: text("revocation_reason"),
  submittedAt: timestamp("submitted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DpcoAccreditationApplication = typeof dpcoAccreditationApplications.$inferSelect;
export type InsertDpcoAccreditationApplication = typeof dpcoAccreditationApplications.$inferInsert;

// ─── DPCO Verification Statements ────────────────────────────────────────────
export const dpcoVerificationStatements = pgTable("dpco_verification_statements", {
  id: serial("id").primaryKey(),
  dpcoOrgId: integer("dpco_org_id").references(() => dpcoOrganisations.id).notNull(),
  clientOrgId: integer("client_org_id"),
  clientName: varchar("client_name", { length: 255 }).notNull(),
  filingPeriod: varchar("filing_period", { length: 50 }).notNull(),
  statementType: varchar("statement_type", { length: 100 }).notNull(),
  statementText: text("statement_text"),
  signedBy: varchar("signed_by", { length: 255 }),
  signedAt: timestamp("signed_at"),
  pdfUrl: varchar("pdf_url", { length: 500 }),
  pkcs7Signature: text("pkcs7_signature"),
  verificationCode: varchar("verification_code", { length: 64 }).unique(),
  status: varchar("status", { length: 50 }).default("draft").notNull(),
  submittedAt: timestamp("submitted_at"),
  reviewedBy: varchar("reviewed_by", { length: 255 }),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DpcoVerificationStatement = typeof dpcoVerificationStatements.$inferSelect;
export type InsertDpcoVerificationStatement = typeof dpcoVerificationStatements.$inferInsert;

// ─── DPCO Policy Drafts ───────────────────────────────────────────────────────
export const dpcoPolicyDrafts = pgTable("dpco_policy_drafts", {
  id: serial("id").primaryKey(),
  dpcoOrgId: integer("dpco_org_id").references(() => dpcoOrganisations.id).notNull(),
  clientOrgId: integer("client_org_id"),
  clientName: varchar("client_name", { length: 255 }),
  title: varchar("title", { length: 500 }).notNull(),
  documentType: varchar("document_type", { length: 100 }).notNull(),
  content: text("content"),
  version: varchar("version", { length: 20 }).default("1.0").notNull(),
  status: varchar("status", { length: 50 }).default("draft").notNull(),
  approvedBy: varchar("approved_by", { length: 255 }),
  approvedAt: timestamp("approved_at"),
  signedAt: timestamp("signed_at"),
  pdfUrl: varchar("pdf_url", { length: 500 }),
  tags: jsonb("tags").$type<string[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DpcoPolicyDraft = typeof dpcoPolicyDrafts.$inferSelect;
export type InsertDpcoPolicyDraft = typeof dpcoPolicyDrafts.$inferInsert;



export const bankLicenseTypeEnum = pgEnum("bank_license_type", [
  "commercial", "merchant", "microfinance", "development", "mortgage", "payment_service_bank", "non_interest"
]);
export const bankStatusEnum = pgEnum("bank_status", [
  "licensed", "provisional", "suspended", "revoked", "under_examination"
]);

export const bankingInstitutions = pgTable("banking_institutions", {
  id: serial("id").primaryKey(),
  cbnCode: varchar("cbn_code", { length: 10 }).unique().notNull(),
  sortCode: varchar("sort_code", { length: 10 }).unique().notNull(),
  bicCode: varchar("bic_code", { length: 11 }),
  name: varchar("name", { length: 255 }).notNull(),
  shortName: varchar("short_name", { length: 50 }).notNull(),
  licenseType: bankLicenseTypeEnum("license_type").notNull(),
  licenseNumber: varchar("license_number", { length: 50 }).notNull(),
  status: bankStatusEnum("status").default("licensed").notNull(),
  headOfficeAddress: text("head_office_address"),
  ceoName: varchar("ceo_name", { length: 255 }),
  totalAssets: bigint("total_assets", { mode: "number" }),
  capitalAdequacyRatio: numeric("capital_adequacy_ratio", { precision: 5, scale: 2 }),
  nonPerformingLoanRatio: numeric("non_performing_loan_ratio", { precision: 5, scale: 2 }),
  dataProtectionOfficer: varchar("data_protection_officer", { length: 255 }),
  dpcoOrgId: integer("dpco_org_id"),
  lastExaminationDate: timestamp("last_examination_date"),
  nextExaminationDate: timestamp("next_examination_date"),
  complianceScore: integer("compliance_score").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type BankingInstitution = typeof bankingInstitutions.$inferSelect;
export type InsertBankingInstitution = typeof bankingInstitutions.$inferInsert;

export const kycStatusEnum = pgEnum("kyc_status", [
  "pending", "in_review", "verified", "rejected", "expired", "suspended"
]);
export const kycTierEnum = pgEnum("kyc_tier", ["tier1", "tier2", "tier3"]);

export const kycRecords = pgTable("kyc_records", {
  id: serial("id").primaryKey(),
  referenceId: varchar("reference_id", { length: 50 }).unique().notNull(),
  organizationId: integer("organization_id").references(() => organizations.id),
  bankId: integer("bank_id").references(() => bankingInstitutions.id),
  subjectType: varchar("subject_type", { length: 30 }).default("individual").notNull(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  dateOfBirth: varchar("date_of_birth", { length: 20 }),
  nationality: varchar("nationality", { length: 100 }).default("Nigerian"),
  bvn: varchar("bvn", { length: 11 }),
  nin: varchar("nin", { length: 11 }),
  phoneNumber: varchar("phone_number", { length: 20 }),
  email: varchar("email", { length: 255 }),
  address: text("address"),
  selfieUrl: varchar("selfie_url", { length: 500 }),
  idDocumentType: varchar("id_document_type", { length: 50 }),
  idDocumentUrl: varchar("id_document_url", { length: 500 }),
  livenessScore: numeric("liveness_score", { precision: 5, scale: 2 }),
  faceMatchScore: numeric("face_match_score", { precision: 5, scale: 2 }),
  bvnVerified: boolean("bvn_verified").default(false),
  ninVerified: boolean("nin_verified").default(false),
  addressVerified: boolean("address_verified").default(false),
  tier: kycTierEnum("tier").default("tier1").notNull(),
  status: kycStatusEnum("status").default("pending").notNull(),
  riskRating: varchar("risk_rating", { length: 20 }).default("low"),
  pepFlag: boolean("pep_flag").default(false),
  sanctionsFlag: boolean("sanctions_flag").default(false),
  reviewedBy: varchar("reviewed_by", { length: 255 }),
  reviewedAt: timestamp("reviewed_at"),
  rejectionReason: text("rejection_reason"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type KycRecord = typeof kycRecords.$inferSelect;
export type InsertKycRecord = typeof kycRecords.$inferInsert;

export const amlCaseStatusEnum = pgEnum("aml_case_status", [
  "open", "under_investigation", "escalated", "filed_str", "closed_no_action", "closed_action_taken"
]);
export const amlCaseTypeEnum = pgEnum("aml_case_type", [
  "suspicious_transaction", "pep_match", "sanctions_match", "structuring",
  "unusual_pattern", "high_risk_country", "adverse_media", "threshold_breach"
]);

export const amlCases = pgTable("aml_cases", {
  id: serial("id").primaryKey(),
  caseRef: varchar("case_ref", { length: 50 }).unique().notNull(),
  organizationId: integer("organization_id").references(() => organizations.id),
  bankId: integer("bank_id").references(() => bankingInstitutions.id),
  subjectName: varchar("subject_name", { length: 255 }).notNull(),
  subjectType: varchar("subject_type", { length: 30 }).default("individual"),
  subjectBvn: varchar("subject_bvn", { length: 11 }),
  caseType: amlCaseTypeEnum("case_type").notNull(),
  status: amlCaseStatusEnum("status").default("open").notNull(),
  riskScore: integer("risk_score").default(0),
  pepMatch: boolean("pep_match").default(false),
  sanctionsMatch: boolean("sanctions_match").default(false),
  adverseMediaMatch: boolean("adverse_media_match").default(false),
  transactionAmount: bigint("transaction_amount", { mode: "number" }),
  transactionCurrency: varchar("transaction_currency", { length: 3 }).default("NGN"),
  transactionRef: varchar("transaction_ref", { length: 100 }),
  sourceOfFunds: text("source_of_funds"),
  narrative: text("narrative"),
  strReference: varchar("str_reference", { length: 50 }),
  strFiledAt: timestamp("str_filed_at"),
  assignedTo: varchar("assigned_to", { length: 255 }),
  escalatedTo: varchar("escalated_to", { length: 255 }),
  closedAt: timestamp("closed_at"),
  closureNotes: text("closure_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AmlCase = typeof amlCases.$inferSelect;
export type InsertAmlCase = typeof amlCases.$inferInsert;

export const watchlistSourceEnum = pgEnum("watchlist_source", [
  "ofac_sdn", "un_consolidated", "eu_consolidated", "uk_hmt",
  "cbn_internal", "interpol", "efcc", "nfiu", "local_court"
]);
export const watchlistCategoryEnum = pgEnum("watchlist_category", [
  "sanctions", "pep", "adverse_media", "terrorism", "fraud", "corruption", "money_laundering"
]);

export const watchlistEntries = pgTable("watchlist_entries", {
  id: serial("id").primaryKey(),
  entityId: varchar("entity_id", { length: 100 }).unique().notNull(),
  entityType: varchar("entity_type", { length: 30 }).default("individual"),
  primaryName: varchar("primary_name", { length: 255 }).notNull(),
  aliases: jsonb("aliases").$type<string[]>().default([]),
  dateOfBirth: varchar("date_of_birth", { length: 20 }),
  nationality: varchar("nationality", { length: 100 }),
  passportNumber: varchar("passport_number", { length: 50 }),
  source: watchlistSourceEnum("source").notNull(),
  category: watchlistCategoryEnum("category").notNull(),
  riskLevel: varchar("risk_level", { length: 20 }).default("high"),
  listingDate: timestamp("listing_date"),
  delistingDate: timestamp("delisting_date"),
  isActive: boolean("is_active").default(true),
  reason: text("reason"),
  additionalInfo: jsonb("additional_info"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type WatchlistEntry = typeof watchlistEntries.$inferSelect;
export type InsertWatchlistEntry = typeof watchlistEntries.$inferInsert;

export const nipStatusEnum = pgEnum("nip_status", [
  "initiated", "processing", "completed", "failed", "reversed", "pending_confirmation"
]);

export const nipTransactions = pgTable("nip_transactions", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id", { length: 40 }).unique().notNull(),
  nameEnquiryRef: varchar("name_enquiry_ref", { length: 40 }),
  senderBankCode: varchar("sender_bank_code", { length: 10 }).notNull(),
  senderBankName: varchar("sender_bank_name", { length: 100 }),
  senderAccountNumber: varchar("sender_account_number", { length: 20 }).notNull(),
  senderAccountName: varchar("sender_account_name", { length: 255 }),
  receiverBankCode: varchar("receiver_bank_code", { length: 10 }).notNull(),
  receiverBankName: varchar("receiver_bank_name", { length: 100 }),
  receiverAccountNumber: varchar("receiver_account_number", { length: 20 }).notNull(),
  receiverAccountName: varchar("receiver_account_name", { length: 255 }),
  amount: bigint("amount", { mode: "number" }).notNull(),
  currency: varchar("currency", { length: 3 }).default("NGN"),
  narration: varchar("narration", { length: 255 }),
  status: nipStatusEnum("status").default("initiated").notNull(),
  responseCode: varchar("response_code", { length: 10 }),
  responseMessage: varchar("response_message", { length: 255 }),
  nibssRef: varchar("nibss_ref", { length: 50 }),
  channelCode: varchar("channel_code", { length: 10 }),
  amlFlagged: boolean("aml_flagged").default(false),
  fraudFlagged: boolean("fraud_flagged").default(false),
  settlementDate: timestamp("settlement_date"),
  initiatedAt: timestamp("initiated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type NipTransaction = typeof nipTransactions.$inferSelect;
export type InsertNipTransaction = typeof nipTransactions.$inferInsert;

export const rtgsStatusEnum = pgEnum("rtgs_status", [
  "queued", "processing", "settled", "rejected", "cancelled", "pending_funds"
]);

export const rtgsTransactions = pgTable("rtgs_transactions", {
  id: serial("id").primaryKey(),
  reference: varchar("reference", { length: 50 }).unique().notNull(),
  senderBankCode: varchar("sender_bank_code", { length: 10 }).notNull(),
  senderBankName: varchar("sender_bank_name", { length: 100 }),
  senderAccountNumber: varchar("sender_account_number", { length: 20 }),
  receiverBankCode: varchar("receiver_bank_code", { length: 10 }).notNull(),
  receiverBankName: varchar("receiver_bank_name", { length: 100 }),
  receiverAccountNumber: varchar("receiver_account_number", { length: 20 }),
  amount: bigint("amount", { mode: "number" }).notNull(),
  currency: varchar("currency", { length: 3 }).default("NGN"),
  narration: text("narration"),
  status: rtgsStatusEnum("status").default("queued").notNull(),
  priority: varchar("priority", { length: 10 }).default("normal"),
  settlementCycle: varchar("settlement_cycle", { length: 10 }),
  cbnRef: varchar("cbn_ref", { length: 50 }),
  rejectionReason: text("rejection_reason"),
  queuedAt: timestamp("queued_at").defaultNow().notNull(),
  settledAt: timestamp("settled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type RtgsTransaction = typeof rtgsTransactions.$inferSelect;
export type InsertRtgsTransaction = typeof rtgsTransactions.$inferInsert;

export const swiftStatusEnum = pgEnum("swift_status", [
  "draft", "sent", "acknowledged", "processed", "rejected", "recalled"
]);

export const swiftMessages = pgTable("swift_messages", {
  id: serial("id").primaryKey(),
  messageRef: varchar("message_ref", { length: 50 }).unique().notNull(),
  messageType: varchar("message_type", { length: 10 }).notNull(),
  senderBic: varchar("sender_bic", { length: 11 }).notNull(),
  senderBankName: varchar("sender_bank_name", { length: 100 }),
  receiverBic: varchar("receiver_bic", { length: 11 }).notNull(),
  receiverBankName: varchar("receiver_bank_name", { length: 100 }),
  amount: bigint("amount", { mode: "number" }),
  currency: varchar("currency", { length: 3 }),
  valueDate: varchar("value_date", { length: 20 }),
  orderingCustomer: varchar("ordering_customer", { length: 255 }),
  beneficiaryCustomer: varchar("beneficiary_customer", { length: 255 }),
  remittanceInfo: text("remittance_info"),
  correspondentBic: varchar("correspondent_bic", { length: 11 }),
  status: swiftStatusEnum("status").default("draft").notNull(),
  ackNakCode: varchar("ack_nak_code", { length: 10 }),
  sanctionsScreened: boolean("sanctions_screened").default(false),
  sanctionsFlagged: boolean("sanctions_flagged").default(false),
  rawMessage: text("raw_message"),
  sentAt: timestamp("sent_at"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type SwiftMessage = typeof swiftMessages.$inferSelect;
export type InsertSwiftMessage = typeof swiftMessages.$inferInsert;

export const fraudAlertStatusEnum = pgEnum("fraud_alert_status", [
  "open", "investigating", "confirmed_fraud", "false_positive", "escalated", "resolved"
]);
export const fraudAlertTypeEnum = pgEnum("fraud_alert_type", [
  "velocity_breach", "unusual_amount", "geo_anomaly", "device_fingerprint",
  "account_takeover", "synthetic_identity", "card_not_present", "social_engineering",
  "insider_threat", "ml_anomaly"
]);

export const fraudAlerts = pgTable("fraud_alerts", {
  id: serial("id").primaryKey(),
  alertRef: varchar("alert_ref", { length: 50 }).unique().notNull(),
  bankId: integer("bank_id").references(() => bankingInstitutions.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  transactionRef: varchar("transaction_ref", { length: 100 }),
  transactionAmount: bigint("transaction_amount", { mode: "number" }),
  accountNumber: varchar("account_number", { length: 20 }),
  alertType: fraudAlertTypeEnum("alert_type").notNull(),
  riskScore: integer("risk_score").default(0),
  mlModel: varchar("ml_model", { length: 100 }),
  mlConfidence: numeric("ml_confidence", { precision: 5, scale: 2 }),
  ruleTriggered: varchar("rule_triggered", { length: 255 }),
  status: fraudAlertStatusEnum("status").default("open").notNull(),
  disposition: varchar("disposition", { length: 50 }),
  investigatorNotes: text("investigator_notes"),
  assignedTo: varchar("assigned_to", { length: 255 }),
  blockedAt: timestamp("blocked_at"),
  resolvedAt: timestamp("resolved_at"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type FraudAlert = typeof fraudAlerts.$inferSelect;
export type InsertFraudAlert = typeof fraudAlerts.$inferInsert;

export const cbnReportTypeEnum = pgEnum("cbn_report_type", [
  "str", "ctr", "scuml_report", "aml_annual", "prudential_return",
  "liquidity_return", "capital_adequacy", "credit_risk", "operational_risk"
]);
export const cbnReportStatusEnum = pgEnum("cbn_report_status", [
  "draft", "pending_review", "approved", "submitted", "acknowledged", "rejected", "overdue"
]);

export const cbnReports = pgTable("cbn_reports", {
  id: serial("id").primaryKey(),
  reportRef: varchar("report_ref", { length: 50 }).unique().notNull(),
  bankId: integer("bank_id").references(() => bankingInstitutions.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  reportType: cbnReportTypeEnum("report_type").notNull(),
  reportingPeriod: varchar("reporting_period", { length: 20 }).notNull(),
  status: cbnReportStatusEnum("status").default("draft").notNull(),
  filingDeadline: timestamp("filing_deadline"),
  submittedAt: timestamp("submitted_at"),
  acknowledgedAt: timestamp("acknowledged_at"),
  cbnAckRef: varchar("cbn_ack_ref", { length: 50 }),
  xmlPayload: text("xml_payload"),
  pdfUrl: varchar("pdf_url", { length: 500 }),
  totalTransactions: integer("total_transactions"),
  totalAmount: bigint("total_amount", { mode: "number" }),
  rejectionReason: text("rejection_reason"),
  preparedBy: varchar("prepared_by", { length: 255 }),
  approvedBy: varchar("approved_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type CbnReport = typeof cbnReports.$inferSelect;
export type InsertCbnReport = typeof cbnReports.$inferInsert;

export const correspondentRelationshipEnum = pgEnum("correspondent_relationship", [
  "nostro", "vostro", "loro", "bilateral"
]);
export const correspondentStatusEnum = pgEnum("correspondent_status", [
  "active", "suspended", "terminated", "under_review"
]);

export const correspondentBanks = pgTable("correspondent_banks", {
  id: serial("id").primaryKey(),
  bankId: integer("bank_id").references(() => bankingInstitutions.id),
  correspondentName: varchar("correspondent_name", { length: 255 }).notNull(),
  correspondentBic: varchar("correspondent_bic", { length: 11 }).unique().notNull(),
  country: varchar("country", { length: 100 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  relationshipType: correspondentRelationshipEnum("relationship_type").notNull(),
  nostroAccount: varchar("nostro_account", { length: 50 }),
  vostroAccount: varchar("vostro_account", { length: 50 }),
  status: correspondentStatusEnum("status").default("active").notNull(),
  dailyLimit: bigint("daily_limit", { mode: "number" }),
  monthlyLimit: bigint("monthly_limit", { mode: "number" }),
  kycCompleted: boolean("kyc_completed").default(false),
  amlRiskRating: varchar("aml_risk_rating", { length: 20 }).default("low"),
  lastReviewDate: timestamp("last_review_date"),
  nextReviewDate: timestamp("next_review_date"),
  agreementUrl: varchar("agreement_url", { length: 500 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type CorrespondentBank = typeof correspondentBanks.$inferSelect;
export type InsertCorrespondentBank = typeof correspondentBanks.$inferInsert;

// ─── TELECOM SECTOR (NCC) ────────────────────────────────────────────────────
export const telecomLicenceTypeEnum = pgEnum("telecom_licence_type", [
  "unified_access", "spectrum", "isp", "vsat", "type_approval", "infrastructure",
  "numbering", "mvno", "submarine_cable"
]);
export const telecomLicenceStatusEnum = pgEnum("telecom_licence_status", [
  "active", "suspended", "revoked", "expired", "pending_renewal", "under_review"
]);
export const spectrumBandEnum = pgEnum("spectrum_band", [
  "700mhz", "800mhz", "900mhz", "1800mhz", "2100mhz", "2300mhz", "2600mhz",
  "3500mhz", "26ghz", "28ghz"
]);
export const qosViolationTypeEnum = pgEnum("qos_violation_type", [
  "call_drop_rate", "voice_quality", "data_throughput", "latency", "availability",
  "coverage_gap", "interconnect_failure", "billing_dispute"
]);
export const interconnectDisputeStatusEnum = pgEnum("interconnect_dispute_status", [
  "filed", "under_investigation", "mediation", "arbitration", "resolved", "escalated"
]);

export const telecomOperators = pgTable("telecom_operators", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  operatorName: varchar("operator_name", { length: 255 }).notNull(),
  operatorCode: varchar("operator_code", { length: 10 }).unique().notNull(),
  operatorType: varchar("operator_type", { length: 50 }).notNull().default("mno"),
  nccLicenceNumber: varchar("ncc_licence_number", { length: 50 }).unique(),
  subscriberBase: bigint("subscriber_base", { mode: "number" }).default(0),
  marketShare: numeric("market_share", { precision: 5, scale: 2 }),
  coveragePercent: numeric("coverage_percent", { precision: 5, scale: 2 }),
  headquartersState: varchar("headquarters_state", { length: 100 }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type TelecomOperator = typeof telecomOperators.$inferSelect;

export const spectrumLicences = pgTable("spectrum_licences", {
  id: serial("id").primaryKey(),
  licenceRef: varchar("licence_ref", { length: 50 }).unique().notNull(),
  operatorId: integer("operator_id").references(() => telecomOperators.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  band: spectrumBandEnum("band").notNull(),
  frequencyRangeMhz: varchar("frequency_range_mhz", { length: 50 }).notNull(),
  bandwidthMhz: numeric("bandwidth_mhz", { precision: 6, scale: 2 }).notNull(),
  licenceType: telecomLicenceTypeEnum("licence_type").default("spectrum").notNull(),
  status: telecomLicenceStatusEnum("status").default("active").notNull(),
  geographicScope: varchar("geographic_scope", { length: 100 }).default("national"),
  annualFeeNgn: bigint("annual_fee_ngn", { mode: "number" }),
  issuedAt: timestamp("issued_at"),
  expiresAt: timestamp("expires_at"),
  lastRenewalAt: timestamp("last_renewal_at"),
  dataLocalisationCompliant: boolean("data_localisation_compliant").default(false),
  lawfulInterceptEnabled: boolean("lawful_intercept_enabled").default(false),
  nccNotes: text("ncc_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type SpectrumLicence = typeof spectrumLicences.$inferSelect;

export const qosViolations = pgTable("qos_violations", {
  id: serial("id").primaryKey(),
  violationRef: varchar("violation_ref", { length: 50 }).unique().notNull(),
  operatorId: integer("operator_id").references(() => telecomOperators.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  violationType: qosViolationTypeEnum("violation_type").notNull(),
  severity: severityEnum("severity").default("medium").notNull(),
  measuredValue: numeric("measured_value", { precision: 10, scale: 4 }),
  thresholdValue: numeric("threshold_value", { precision: 10, scale: 4 }),
  measurementUnit: varchar("measurement_unit", { length: 30 }),
  affectedRegion: varchar("affected_region", { length: 100 }),
  affectedSubscribers: integer("affected_subscribers"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  reportedAt: timestamp("reported_at"),
  resolvedAt: timestamp("resolved_at"),
  penaltyNgn: bigint("penalty_ngn", { mode: "number" }),
  status: varchar("status", { length: 30 }).default("open"),
  nccCaseRef: varchar("ncc_case_ref", { length: 50 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type QosViolation = typeof qosViolations.$inferSelect;

export const interconnectDisputes = pgTable("interconnect_disputes", {
  id: serial("id").primaryKey(),
  disputeRef: varchar("dispute_ref", { length: 50 }).unique().notNull(),
  complainantOperatorId: integer("complainant_operator_id").references(() => telecomOperators.id),
  respondentOperatorId: integer("respondent_operator_id").references(() => telecomOperators.id),
  disputeType: varchar("dispute_type", { length: 100 }).notNull(),
  description: text("description").notNull(),
  amountInDisputeNgn: bigint("amount_in_dispute_ngn", { mode: "number" }),
  status: interconnectDisputeStatusEnum("status").default("filed").notNull(),
  filedAt: timestamp("filed_at").defaultNow().notNull(),
  mediationDate: timestamp("mediation_date"),
  resolvedAt: timestamp("resolved_at"),
  resolution: text("resolution"),
  nccDecision: text("ncc_decision"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type InterconnectDispute = typeof interconnectDisputes.$inferSelect;

export const lawfulInterceptRequests = pgTable("lawful_intercept_requests", {
  id: serial("id").primaryKey(),
  requestRef: varchar("request_ref", { length: 50 }).unique().notNull(),
  operatorId: integer("operator_id").references(() => telecomOperators.id),
  requestingAgency: varchar("requesting_agency", { length: 100 }).notNull(),
  courtOrderRef: varchar("court_order_ref", { length: 100 }),
  targetIdentifier: varchar("target_identifier", { length: 255 }),
  requestType: varchar("request_type", { length: 50 }).default("call_data_records"),
  status: varchar("status", { length: 30 }).default("pending"),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  fulfilledAt: timestamp("fulfilled_at"),
  expiresAt: timestamp("expires_at"),
  dataRetentionDays: integer("data_retention_days").default(90),
  isUrgent: boolean("is_urgent").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type LawfulInterceptRequest = typeof lawfulInterceptRequests.$inferSelect;

// ─── HEALTHCARE SECTOR (NHIA/FMOH/NDPC) ─────────────────────────────────────
export const healthFacilityTypeEnum = pgEnum("health_facility_type", [
  "federal_hospital", "state_hospital", "private_hospital", "clinic",
  "pharmacy", "laboratory", "hmo", "telemedicine", "research_institute"
]);
export const healthDataCategoryEnum = pgEnum("health_data_category", [
  "patient_records", "clinical_trials", "genomic_data", "mental_health",
  "hiv_aids", "reproductive_health", "insurance_claims", "prescription_data"
]);
export const clinicalTrialStatusEnum = pgEnum("clinical_trial_status", [
  "protocol_review", "ethics_approved", "recruiting", "active", "completed",
  "suspended", "terminated", "results_pending"
]);

export const healthFacilities = pgTable("health_facilities", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  facilityName: varchar("facility_name", { length: 255 }).notNull(),
  facilityCode: varchar("facility_code", { length: 20 }).unique().notNull(),
  facilityType: healthFacilityTypeEnum("facility_type").notNull(),
  nhiaAccreditationNumber: varchar("nhia_accreditation_number", { length: 50 }),
  fmohLicenceNumber: varchar("fmoh_licence_number", { length: 50 }),
  state: varchar("state", { length: 100 }).notNull(),
  lga: varchar("lga", { length: 100 }),
  address: text("address"),
  bedCapacity: integer("bed_capacity"),
  patientRecordsCount: bigint("patient_records_count", { mode: "number" }).default(0),
  emrSystem: varchar("emr_system", { length: 100 }),
  dataLocalisationCompliant: boolean("data_localisation_compliant").default(false),
  ndpcRegistered: boolean("ndpc_registered").default(false),
  dpiaCompleted: boolean("dpia_completed").default(false),
  lastAuditDate: timestamp("last_audit_date"),
  complianceScore: numeric("compliance_score", { precision: 5, scale: 2 }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type HealthFacility = typeof healthFacilities.$inferSelect;

export const patientDataLocalisationChecks = pgTable("patient_data_localisation_checks", {
  id: serial("id").primaryKey(),
  checkRef: varchar("check_ref", { length: 50 }).unique().notNull(),
  facilityId: integer("facility_id").references(() => healthFacilities.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  dataCategory: healthDataCategoryEnum("data_category").notNull(),
  storageLocation: varchar("storage_location", { length: 255 }).notNull(),
  storageCountry: varchar("storage_country", { length: 100 }).notNull(),
  isLocallyStored: boolean("is_locally_stored").notNull(),
  crossBorderTransfer: boolean("cross_border_transfer").default(false),
  transferDestination: varchar("transfer_destination", { length: 255 }),
  transferBasis: varchar("transfer_basis", { length: 100 }),
  recordsAffected: bigint("records_affected", { mode: "number" }),
  status: residencyStatusEnum("status").default("unknown").notNull(),
  violationDetails: text("violation_details"),
  remediationDeadline: timestamp("remediation_deadline"),
  checkedAt: timestamp("checked_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type PatientDataLocalisationCheck = typeof patientDataLocalisationChecks.$inferSelect;

export const clinicalTrials = pgTable("clinical_trials", {
  id: serial("id").primaryKey(),
  trialRef: varchar("trial_ref", { length: 50 }).unique().notNull(),
  facilityId: integer("facility_id").references(() => healthFacilities.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  trialTitle: varchar("trial_title", { length: 500 }).notNull(),
  sponsorName: varchar("sponsor_name", { length: 255 }).notNull(),
  principalInvestigator: varchar("principal_investigator", { length: 255 }),
  phase: varchar("phase", { length: 20 }),
  therapeuticArea: varchar("therapeutic_area", { length: 100 }),
  status: clinicalTrialStatusEnum("status").default("protocol_review").notNull(),
  participantCount: integer("participant_count"),
  dataStorageCountry: varchar("data_storage_country", { length: 100 }),
  foreignSponsor: boolean("foreign_sponsor").default(false),
  ndpcApprovalRef: varchar("ndpc_approval_ref", { length: 50 }),
  ethicsApprovalRef: varchar("ethics_approval_ref", { length: 50 }),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  dataLocalisationCompliant: boolean("data_localisation_compliant").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type ClinicalTrial = typeof clinicalTrials.$inferSelect;

// ─── ENERGY SECTOR (NERC/DPR/NUPRC) ─────────────────────────────────────────
export const energyLicenceTypeEnum = pgEnum("energy_licence_type", [
  "generation", "transmission", "distribution", "trading", "system_operator",
  "oil_exploration", "oil_production", "gas_processing", "pipeline", "refinery"
]);
export const energyLicenceStatusEnum = pgEnum("energy_licence_status", [
  "active", "suspended", "revoked", "expired", "pending_renewal", "under_review"
]);
export const gridEventTypeEnum = pgEnum("grid_event_type", [
  "outage", "voltage_deviation", "frequency_deviation", "load_shedding",
  "equipment_failure", "cyber_incident", "natural_disaster", "planned_maintenance"
]);

export const energyCompanies = pgTable("energy_companies", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  companyName: varchar("company_name", { length: 255 }).notNull(),
  companyCode: varchar("company_code", { length: 20 }).unique().notNull(),
  sector: varchar("sector", { length: 50 }).notNull().default("electricity"),
  nercLicenceNumber: varchar("nerc_licence_number", { length: 50 }),
  nuprcLicenceNumber: varchar("nuprc_licence_number", { length: 50 }),
  installedCapacityMw: numeric("installed_capacity_mw", { precision: 10, scale: 2 }),
  distributionZone: varchar("distribution_zone", { length: 100 }),
  customerBase: bigint("customer_base", { mode: "number" }).default(0),
  dataLocalisationCompliant: boolean("data_localisation_compliant").default(false),
  scadaSystem: varchar("scada_system", { length: 100 }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type EnergyCompany = typeof energyCompanies.$inferSelect;

export const energyLicences = pgTable("energy_licences", {
  id: serial("id").primaryKey(),
  licenceRef: varchar("licence_ref", { length: 50 }).unique().notNull(),
  companyId: integer("company_id").references(() => energyCompanies.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  licenceType: energyLicenceTypeEnum("licence_type").notNull(),
  status: energyLicenceStatusEnum("status").default("active").notNull(),
  authorizedCapacityMw: numeric("authorized_capacity_mw", { precision: 10, scale: 2 }),
  geographicScope: varchar("geographic_scope", { length: 255 }),
  annualFeeNgn: bigint("annual_fee_ngn", { mode: "number" }),
  issuedAt: timestamp("issued_at"),
  expiresAt: timestamp("expires_at"),
  dataLocalisationCondition: boolean("data_localisation_condition").default(true),
  cyberSecurityCompliant: boolean("cyber_security_compliant").default(false),
  nercNotes: text("nerc_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type EnergyLicence = typeof energyLicences.$inferSelect;

export const gridMonitoringEvents = pgTable("grid_monitoring_events", {
  id: serial("id").primaryKey(),
  eventRef: varchar("event_ref", { length: 50 }).unique().notNull(),
  companyId: integer("company_id").references(() => energyCompanies.id),
  eventType: gridEventTypeEnum("event_type").notNull(),
  severity: severityEnum("severity").default("medium").notNull(),
  affectedRegion: varchar("affected_region", { length: 255 }),
  affectedCustomers: integer("affected_customers"),
  durationMinutes: integer("duration_minutes"),
  powerLossMw: numeric("power_loss_mw", { precision: 10, scale: 2 }),
  scadaDataExported: boolean("scada_data_exported").default(false),
  exportDestination: varchar("export_destination", { length: 255 }),
  dataLocalisationViolation: boolean("data_localisation_violation").default(false),
  reportedToNerc: boolean("reported_to_nerc").default(false),
  nercReportRef: varchar("nerc_report_ref", { length: 50 }),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  rootCause: text("root_cause"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type GridMonitoringEvent = typeof gridMonitoringEvents.$inferSelect;

export const oilGasDataReports = pgTable("oil_gas_data_reports", {
  id: serial("id").primaryKey(),
  reportRef: varchar("report_ref", { length: 50 }).unique().notNull(),
  companyId: integer("company_id").references(() => energyCompanies.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  reportType: varchar("report_type", { length: 50 }).notNull(),
  reportingPeriod: varchar("reporting_period", { length: 20 }).notNull(),
  productionBarrels: bigint("production_barrels", { mode: "number" }),
  reservesBarrels: bigint("reserves_barrels", { mode: "number" }),
  dataStorageLocation: varchar("data_storage_location", { length: 255 }),
  dataStorageCountry: varchar("data_storage_country", { length: 100 }),
  isLocallyStored: boolean("is_locally_stored").default(true),
  nuprcSubmitted: boolean("nuprc_submitted").default(false),
  nuprcAckRef: varchar("nuprc_ack_ref", { length: 50 }),
  status: varchar("status", { length: 30 }).default("draft"),
  submittedAt: timestamp("submitted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type OilGasDataReport = typeof oilGasDataReports.$inferSelect;

// ─── INSURANCE SECTOR (NAICOM) ───────────────────────────────────────────────
export const insuranceLicenceTypeEnum = pgEnum("insurance_licence_type", [
  "life", "non_life", "composite", "reinsurance", "broker", "loss_adjuster",
  "microinsurance", "takaful", "health_insurance"
]);
export const insuranceLicenceStatusEnum = pgEnum("insurance_licence_status", [
  "active", "suspended", "revoked", "expired", "provisional", "under_review"
]);
export const insuranceClaimStatusEnum = pgEnum("insurance_claim_status", [
  "submitted", "under_investigation", "approved", "partially_approved",
  "rejected", "appealed", "settled", "closed"
]);

export const insuranceCompanies = pgTable("insurance_companies", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  companyName: varchar("company_name", { length: 255 }).notNull(),
  naicomLicenceNumber: varchar("naicom_licence_number", { length: 50 }).unique(),
  licenceType: insuranceLicenceTypeEnum("licence_type").notNull(),
  status: insuranceLicenceStatusEnum("status").default("active").notNull(),
  policyCount: bigint("policy_count", { mode: "number" }).default(0),
  grossPremiumNgn: bigint("gross_premium_ngn", { mode: "number" }),
  claimsRatio: numeric("claims_ratio", { precision: 5, scale: 2 }),
  solvencyRatio: numeric("solvency_ratio", { precision: 5, scale: 2 }),
  dataLocalisationCompliant: boolean("data_localisation_compliant").default(false),
  ndpcRegistered: boolean("ndpc_registered").default(false),
  policyholderDataCountry: varchar("policyholder_data_country", { length: 100 }).default("Nigeria"),
  licenceExpiresAt: timestamp("licence_expires_at"),
  lastNaicomAudit: timestamp("last_naicom_audit"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type InsuranceCompany = typeof insuranceCompanies.$inferSelect;

export const insurancePolicies = pgTable("insurance_policies", {
  id: serial("id").primaryKey(),
  policyRef: varchar("policy_ref", { length: 50 }).unique().notNull(),
  companyId: integer("company_id").references(() => insuranceCompanies.id),
  policyType: varchar("policy_type", { length: 100 }).notNull(),
  policyholderName: varchar("policyholder_name", { length: 255 }).notNull(),
  policyholderNin: varchar("policyholder_nin", { length: 20 }),
  sumInsuredNgn: bigint("sum_insured_ngn", { mode: "number" }).notNull(),
  annualPremiumNgn: bigint("annual_premium_ngn", { mode: "number" }).notNull(),
  status: varchar("status", { length: 30 }).default("active"),
  dataStorageCountry: varchar("data_storage_country", { length: 100 }).default("Nigeria"),
  crossBorderReinsurance: boolean("cross_border_reinsurance").default(false),
  reinsuranceCountry: varchar("reinsurance_country", { length: 100 }),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type InsurancePolicy = typeof insurancePolicies.$inferSelect;

export const insuranceClaims = pgTable("insurance_claims", {
  id: serial("id").primaryKey(),
  claimRef: varchar("claim_ref", { length: 50 }).unique().notNull(),
  policyId: integer("policy_id").references(() => insurancePolicies.id),
  companyId: integer("company_id").references(() => insuranceCompanies.id),
  claimType: varchar("claim_type", { length: 100 }).notNull(),
  claimAmountNgn: bigint("claim_amount_ngn", { mode: "number" }).notNull(),
  approvedAmountNgn: bigint("approved_amount_ngn", { mode: "number" }),
  status: insuranceClaimStatusEnum("status").default("submitted").notNull(),
  fraudFlag: boolean("fraud_flag").default(false),
  fraudScore: numeric("fraud_score", { precision: 5, scale: 2 }),
  dataBreachRisk: boolean("data_breach_risk").default(false),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  settledAt: timestamp("settled_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type InsuranceClaim = typeof insuranceClaims.$inferSelect;

// ─── FINTECH SECTOR (CBN/SEC) ────────────────────────────────────────────────
export const fintechLicenceTypeEnum = pgEnum("fintech_licence_type", [
  "payment_service_bank", "mobile_money", "switching_company", "payment_solution_service",
  "super_agent", "microfinance_bank", "digital_bank", "crowdfunding", "robo_advisor",
  "crypto_exchange", "emoney_issuer"
]);
export const fintechLicenceStatusEnum = pgEnum("fintech_licence_status", [
  "active", "suspended", "revoked", "expired", "provisional", "sandbox", "under_review"
]);
export const fintechDataEventTypeEnum = pgEnum("fintech_data_event_type", [
  "transaction_data_export", "customer_data_transfer", "kyc_data_sharing",
  "credit_data_export", "fraud_data_sharing", "regulatory_reporting",
  "cross_border_payment", "data_breach"
]);

export const fintechCompanies = pgTable("fintech_companies", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  companyName: varchar("company_name", { length: 255 }).notNull(),
  cbnLicenceNumber: varchar("cbn_licence_number", { length: 50 }).unique(),
  secLicenceNumber: varchar("sec_licence_number", { length: 50 }),
  licenceType: fintechLicenceTypeEnum("licence_type").notNull(),
  status: fintechLicenceStatusEnum("status").default("active").notNull(),
  activeUsers: bigint("active_users", { mode: "number" }).default(0),
  monthlyTransactionVolumeNgn: bigint("monthly_transaction_volume_ngn", { mode: "number" }),
  dataLocalisationCompliant: boolean("data_localisation_compliant").default(false),
  sandboxMode: boolean("sandbox_mode").default(false),
  apiGatewayUrl: varchar("api_gateway_url", { length: 500 }),
  dataStorageCountry: varchar("data_storage_country", { length: 100 }).default("Nigeria"),
  licenceExpiresAt: timestamp("licence_expires_at"),
  lastCbnAudit: timestamp("last_cbn_audit"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type FintechCompany = typeof fintechCompanies.$inferSelect;

export const fintechDataEvents = pgTable("fintech_data_events", {
  id: serial("id").primaryKey(),
  eventRef: varchar("event_ref", { length: 50 }).unique().notNull(),
  companyId: integer("company_id").references(() => fintechCompanies.id),
  eventType: fintechDataEventTypeEnum("event_type").notNull(),
  dataCategory: dataClassificationEnum("data_category").default("tier2_financial").notNull(),
  recordsAffected: bigint("records_affected", { mode: "number" }),
  sourceCountry: varchar("source_country", { length: 100 }).default("Nigeria"),
  destinationCountry: varchar("destination_country", { length: 100 }),
  isLocalised: boolean("is_localised").default(true),
  violationDetected: boolean("violation_detected").default(false),
  violationDetails: text("violation_details"),
  regulatoryNotified: boolean("regulatory_notified").default(false),
  penaltyNgn: bigint("penalty_ngn", { mode: "number" }),
  status: varchar("status", { length: 30 }).default("detected"),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type FintechDataEvent = typeof fintechDataEvents.$inferSelect;

export const openBankingConsents = pgTable("open_banking_consents", {
  id: serial("id").primaryKey(),
  consentRef: varchar("consent_ref", { length: 50 }).unique().notNull(),
  companyId: integer("company_id").references(() => fintechCompanies.id),
  customerId: varchar("customer_id", { length: 100 }).notNull(),
  dataScopes: jsonb("data_scopes").notNull().default("[]"),
  thirdPartyName: varchar("third_party_name", { length: 255 }),
  thirdPartyCountry: varchar("third_party_country", { length: 100 }),
  consentStatus: consentStatusEnum("consent_status").default("active").notNull(),
  grantedAt: timestamp("granted_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  dataMinimisationCompliant: boolean("data_minimisation_compliant").default(true),
  crossBorderTransfer: boolean("cross_border_transfer").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type OpenBankingConsent = typeof openBankingConsents.$inferSelect;

// ─── Phase 12: NiFi / dbt / Airflow / Data Pipeline Tables ──────────────────
export const dataPipelineFlows = pgTable("data_pipeline_flows", {
  id: serial("id").primaryKey(),
  flowId: varchar("flow_id", { length: 100 }).unique().notNull(),
  flowName: varchar("flow_name", { length: 255 }).notNull(),
  engine: varchar("engine", { length: 50 }).notNull().default("nifi"),
  status: varchar("status", { length: 30 }).default("running").notNull(),
  orgId: integer("org_id").references(() => organizations.id),
  sourceSystem: varchar("source_system", { length: 255 }),
  targetSystem: varchar("target_system", { length: 255 }),
  recordsProcessed: bigint("records_processed", { mode: "number" }).default(0),
  errorCount: integer("error_count").default(0),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  scheduleExpression: varchar("schedule_expression", { length: 100 }),
  metadata: jsonb("metadata").default("{}"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DataPipelineFlow = typeof dataPipelineFlows.$inferSelect;

export const dbtModels = pgTable("dbt_models", {
  id: serial("id").primaryKey(),
  modelName: varchar("model_name", { length: 255 }).notNull(),
  schema: varchar("schema", { length: 100 }).notNull().default("compliance"),
  materialisation: varchar("materialisation", { length: 30 }).default("table"),
  status: varchar("status", { length: 30 }).default("success"),
  rowsAffected: bigint("rows_affected", { mode: "number" }).default(0),
  executionTimeMs: integer("execution_time_ms").default(0),
  lastRunAt: timestamp("last_run_at").defaultNow(),
  sqlDefinition: text("sql_definition"),
  description: text("description"),
  tags: jsonb("tags").default("[]"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type DbtModel = typeof dbtModels.$inferSelect;

export const airflowDags = pgTable("airflow_dags", {
  id: serial("id").primaryKey(),
  dagId: varchar("dag_id", { length: 255 }).unique().notNull(),
  dagName: varchar("dag_name", { length: 255 }).notNull(),
  description: text("description"),
  schedule: varchar("schedule", { length: 100 }).default("0 2 * * *"),
  isActive: boolean("is_active").default(true),
  isPaused: boolean("is_paused").default(false),
  lastRunStatus: varchar("last_run_status", { length: 30 }).default("success"),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  taskCount: integer("task_count").default(0),
  successCount: integer("success_count").default(0),
  failureCount: integer("failure_count").default(0),
  tags: jsonb("tags").default("[]"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AirflowDag = typeof airflowDags.$inferSelect;

export const dataLineageNodes = pgTable("data_lineage_nodes", {
  id: serial("id").primaryKey(),
  nodeId: varchar("node_id", { length: 100 }).unique().notNull(),
  nodeType: varchar("node_type", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  systemName: varchar("system_name", { length: 100 }),
  orgId: integer("org_id").references(() => organizations.id),
  piiContained: boolean("pii_contained").default(false),
  classificationLevel: varchar("classification_level", { length: 50 }).default("internal"),
  metadata: jsonb("metadata").default("{}"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type DataLineageNode = typeof dataLineageNodes.$inferSelect;

export const dataLineageEdges = pgTable("data_lineage_edges", {
  id: serial("id").primaryKey(),
  sourceNodeId: varchar("source_node_id", { length: 100 }).notNull(),
  targetNodeId: varchar("target_node_id", { length: 100 }).notNull(),
  transformationType: varchar("transformation_type", { length: 100 }),
  transformationLogic: text("transformation_logic"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type DataLineageEdge = typeof dataLineageEdges.$inferSelect;

export const consentLifecycleEvents = pgTable("consent_lifecycle_events", {
  id: serial("id").primaryKey(),
  consentId: varchar("consent_id", { length: 100 }).notNull(),
  orgId: integer("org_id").references(() => organizations.id),
  dataSubjectId: varchar("data_subject_id", { length: 100 }).notNull(),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  purposeCategory: varchar("purpose_category", { length: 100 }),
  legalBasis: varchar("legal_basis", { length: 100 }).default("consent"),
  dataCategories: jsonb("data_categories").default("[]"),
  retentionPeriodDays: integer("retention_period_days"),
  ipAddress: varchar("ip_address", { length: 45 }),
  evidenceHash: varchar("evidence_hash", { length: 64 }),
  ndpaArticle: varchar("ndpa_article", { length: 50 }),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type ConsentLifecycleEvent = typeof consentLifecycleEvents.$inferSelect;

export const regulatoryIntelligenceItems = pgTable("regulatory_intelligence_items", {
  id: serial("id").primaryKey(),
  itemType: varchar("item_type", { length: 50 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  summary: text("summary"),
  sourceUrl: varchar("source_url", { length: 1000 }),
  sourceOrg: varchar("source_org", { length: 255 }).default("NDPC"),
  jurisdiction: varchar("jurisdiction", { length: 100 }).default("Nigeria"),
  affectedSectors: jsonb("affected_sectors").default("[]"),
  ndpaArticles: jsonb("ndpa_articles").default("[]"),
  complianceDeadline: timestamp("compliance_deadline"),
  impactLevel: varchar("impact_level", { length: 20 }).default("medium"),
  actionRequired: boolean("action_required").default(false),
  publishedAt: timestamp("published_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type RegulatoryIntelligenceItem = typeof regulatoryIntelligenceItems.$inferSelect;

export const incidentPlaybooks = pgTable("incident_playbooks", {
  id: serial("id").primaryKey(),
  playbookCode: varchar("playbook_code", { length: 50 }).unique().notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  incidentType: varchar("incident_type", { length: 100 }).notNull(),
  severity: varchar("severity", { length: 20 }).default("high"),
  ndpaObligation: varchar("ndpa_obligation", { length: 100 }),
  steps: jsonb("steps").notNull().default("[]"),
  escalationMatrix: jsonb("escalation_matrix").default("{}"),
  slaHours: integer("sla_hours").default(72),
  isActive: boolean("is_active").default(true),
  lastReviewedAt: timestamp("last_reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type IncidentPlaybook = typeof incidentPlaybooks.$inferSelect;

export const incidentResponseActivations = pgTable("incident_response_activations", {
  id: serial("id").primaryKey(),
  activationRef: varchar("activation_ref", { length: 50 }).unique().notNull(),
  playbookId: integer("playbook_id").references(() => incidentPlaybooks.id),
  orgId: integer("org_id").references(() => organizations.id),
  incidentTitle: varchar("incident_title", { length: 255 }).notNull(),
  status: varchar("status", { length: 30 }).default("active"),
  currentStep: integer("current_step").default(1),
  completedSteps: jsonb("completed_steps").default("[]"),
  assignedTo: varchar("assigned_to", { length: 255 }),
  ndpcNotified: boolean("ndpc_notified").default(false),
  ndpcNotifiedAt: timestamp("ndpc_notified_at"),
  affectedRecords: integer("affected_records").default(0),
  activatedAt: timestamp("activated_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type IncidentResponseActivation = typeof incidentResponseActivations.$inferSelect;

export const complianceGapAssessments = pgTable("compliance_gap_assessments", {
  id: serial("id").primaryKey(),
  assessmentRef: varchar("assessment_ref", { length: 50 }).unique().notNull(),
  orgId: integer("org_id").references(() => organizations.id),
  assessmentType: varchar("assessment_type", { length: 50 }).default("ndpa_full"),
  overallScore: integer("overall_score").default(0),
  gapCount: integer("gap_count").default(0),
  criticalGaps: integer("critical_gaps").default(0),
  highGaps: integer("high_gaps").default(0),
  mediumGaps: integer("medium_gaps").default(0),
  lowGaps: integer("low_gaps").default(0),
  gaps: jsonb("gaps").default("[]"),
  recommendations: jsonb("recommendations").default("[]"),
  remediationPlan: jsonb("remediation_plan").default("{}"),
  assessedAt: timestamp("assessed_at").defaultNow().notNull(),
  nextAssessmentAt: timestamp("next_assessment_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type ComplianceGapAssessment = typeof complianceGapAssessments.$inferSelect;

export const vendorRiskProfiles = pgTable("vendor_risk_profiles", {
  id: serial("id").primaryKey(),
  vendorRef: varchar("vendor_ref", { length: 50 }).unique().notNull(),
  vendorName: varchar("vendor_name", { length: 255 }).notNull(),
  vendorType: varchar("vendor_type", { length: 100 }).notNull(),
  country: varchar("country", { length: 100 }).default("Nigeria"),
  orgId: integer("org_id").references(() => organizations.id),
  riskScore: integer("risk_score").default(50),
  riskLevel: varchar("risk_level", { length: 20 }).default("medium"),
  dataCategories: jsonb("data_categories").default("[]"),
  dpiaRequired: boolean("dpia_required").default(false),
  dpaExecuted: boolean("dpa_executed").default(false),
  dpaExpiresAt: timestamp("dpa_expires_at"),
  lastAuditAt: timestamp("last_audit_at"),
  nextAuditAt: timestamp("next_audit_at"),
  certifications: jsonb("certifications").default("[]"),
  contractStatus: varchar("contract_status", { length: 30 }).default("active"),
  ndpcRegistered: boolean("ndpc_registered").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type VendorRiskProfile = typeof vendorRiskProfiles.$inferSelect;

export const whistleblowerReports = pgTable("whistleblower_reports", {
  id: serial("id").primaryKey(),
  reportRef: varchar("report_ref", { length: 50 }).unique().notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  orgId: integer("org_id").references(() => organizations.id),
  description: text("description").notNull(),
  evidenceUrls: jsonb("evidence_urls").default("[]"),
  isAnonymous: boolean("is_anonymous").default(true),
  reporterEmail: varchar("reporter_email", { length: 255 }),
  status: varchar("status", { length: 30 }).default("received"),
  priority: varchar("priority", { length: 20 }).default("medium"),
  assignedTo: varchar("assigned_to", { length: 255 }),
  ndpcEscalated: boolean("ndpc_escalated").default(false),
  resolutionNotes: text("resolution_notes"),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type WhistleblowerReport = typeof whistleblowerReports.$inferSelect;

export const regulatorySandboxApplications = pgTable("regulatory_sandbox_applications", {
  id: serial("id").primaryKey(),
  applicationRef: varchar("application_ref", { length: 50 }).unique().notNull(),
  orgId: integer("org_id").references(() => organizations.id),
  projectTitle: varchar("project_title", { length: 255 }).notNull(),
  projectDescription: text("project_description"),
  innovationType: varchar("innovation_type", { length: 100 }).notNull(),
  dataTypesInvolved: jsonb("data_types_involved").default("[]"),
  proposedDuration: integer("proposed_duration").default(12),
  status: varchar("status", { length: 30 }).default("pending"),
  ndpcApprovalRef: varchar("ndpc_approval_ref", { length: 100 }),
  waivedRequirements: jsonb("waived_requirements").default("[]"),
  conditions: jsonb("conditions").default("[]"),
  progressReports: jsonb("progress_reports").default("[]"),
  approvedAt: timestamp("approved_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type RegulatorySandboxApplication = typeof regulatorySandboxApplications.$inferSelect;

export const aiEthicsReviews = pgTable("ai_ethics_reviews", {
  id: serial("id").primaryKey(),
  reviewRef: varchar("review_ref", { length: 50 }).unique().notNull(),
  orgId: integer("org_id").references(() => organizations.id),
  aiSystemName: varchar("ai_system_name", { length: 255 }).notNull(),
  aiSystemType: varchar("ai_system_type", { length: 100 }).notNull(),
  riskCategory: varchar("risk_category", { length: 30 }).default("high"),
  biasAssessmentScore: integer("bias_assessment_score"),
  explainabilityScore: integer("explainability_score"),
  fairnessScore: integer("fairness_score"),
  overallEthicsScore: integer("overall_ethics_score"),
  ndpaArticle24Compliant: boolean("ndpa_article_24_compliant").default(false),
  humanOversightEnabled: boolean("human_oversight_enabled").default(false),
  dataSubjectsInformed: boolean("data_subjects_informed").default(false),
  findings: jsonb("findings").default("[]"),
  recommendations: jsonb("recommendations").default("[]"),
  reviewStatus: varchar("review_status", { length: 30 }).default("pending"),
  reviewedAt: timestamp("reviewed_at"),
  nextReviewAt: timestamp("next_review_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type AiEthicsReview = typeof aiEthicsReviews.$inferSelect;

export const nationalIdVerifications = pgTable("national_id_verifications", {
  id: serial("id").primaryKey(),
  verificationRef: varchar("verification_ref", { length: 50 }).unique().notNull(),
  orgId: integer("org_id").references(() => organizations.id),
  idType: varchar("id_type", { length: 50 }).notNull(),
  verificationPurpose: varchar("verification_purpose", { length: 100 }),
  requestCount: integer("request_count").default(0),
  successCount: integer("success_count").default(0),
  failureCount: integer("failure_count").default(0),
  nimcApiStatus: varchar("nimc_api_status", { length: 30 }).default("active"),
  consentObtained: boolean("consent_obtained").default(true),
  dataRetentionDays: integer("data_retention_days").default(30),
  ndpaCompliant: boolean("ndpa_compliant").default(true),
  lastVerifiedAt: timestamp("last_verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type NationalIdVerification = typeof nationalIdVerifications.$inferSelect;

export const crossAgencyDataShares = pgTable("cross_agency_data_shares", {
  id: serial("id").primaryKey(),
  shareRef: varchar("share_ref", { length: 50 }).unique().notNull(),
  requestingAgency: varchar("requesting_agency", { length: 255 }).notNull(),
  providingAgency: varchar("providing_agency", { length: 255 }).notNull(),
  dataCategories: jsonb("data_categories").default("[]"),
  legalBasis: varchar("legal_basis", { length: 100 }).notNull(),
  ndpaArticle: varchar("ndpa_article", { length: 50 }),
  purpose: text("purpose").notNull(),
  status: varchar("status", { length: 30 }).default("pending"),
  approvedBy: varchar("approved_by", { length: 255 }),
  ndpcApprovalRef: varchar("ndpc_approval_ref", { length: 100 }),
  recordsShared: bigint("records_shared", { mode: "number" }).default(0),
  encryptionStandard: varchar("encryption_standard", { length: 50 }).default("AES-256"),
  dataMinimisationApplied: boolean("data_minimisation_applied").default(true),
  auditTrailEnabled: boolean("audit_trail_enabled").default(true),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type CrossAgencyDataShare = typeof crossAgencyDataShares.$inferSelect;

export const stripePaymentIntents = pgTable("stripe_payment_intents", {
  id: serial("id").primaryKey(),
  stripeIntentId: varchar("stripe_intent_id", { length: 255 }).unique().notNull(),
  penaltyId: integer("penalty_id").references(() => financialPenalties.id),
  orgId: integer("org_id").references(() => organizations.id),
  amountNgn: bigint("amount_ngn", { mode: "number" }).notNull(),
  amountUsd: integer("amount_usd"),
  currency: varchar("currency", { length: 10 }).default("usd"),
  status: varchar("status", { length: 30 }).default("pending"),
  stripeStatus: varchar("stripe_status", { length: 50 }),
  paymentMethodType: varchar("payment_method_type", { length: 50 }),
  receiptUrl: varchar("receipt_url", { length: 1000 }),
  failureReason: text("failure_reason"),
  metadata: jsonb("metadata").default("{}"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type StripePaymentIntent = typeof stripePaymentIntents.$inferSelect;

export const piaAssessments = pgTable("pia_assessments", {
  id: serial("id").primaryKey(),
  piaRef: varchar("pia_ref", { length: 50 }).unique().notNull(),
  orgId: integer("org_id").references(() => organizations.id),
  projectName: varchar("project_name", { length: 255 }).notNull(),
  projectDescription: text("project_description"),
  dataController: varchar("data_controller", { length: 255 }),
  processingPurpose: text("processing_purpose"),
  dataCategories: jsonb("data_categories").default("[]"),
  dataSubjectCount: integer("data_subject_count"),
  crossBorderTransfer: boolean("cross_border_transfer").default(false),
  automatedDecisionMaking: boolean("automated_decision_making").default(false),
  riskLevel: varchar("risk_level", { length: 20 }).default("medium"),
  riskScore: integer("risk_score").default(50),
  mitigationMeasures: jsonb("mitigation_measures").default("[]"),
  ndpcConsultationRequired: boolean("ndpc_consultation_required").default(false),
  ndpcConsultationRef: varchar("ndpc_consultation_ref", { length: 100 }),
  status: varchar("status", { length: 30 }).default("draft"),
  approvedBy: varchar("approved_by", { length: 255 }),
  approvedAt: timestamp("approved_at"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type PiaAssessment = typeof piaAssessments.$inferSelect;

export const platformNotifications = pgTable("platform_notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  orgId: integer("org_id").references(() => organizations.id),
  notificationType: varchar("notification_type", { length: 50 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  severity: varchar("severity", { length: 20 }).default("info"),
  isRead: boolean("is_read").default(false),
  actionUrl: varchar("action_url", { length: 500 }),
  metadata: jsonb("metadata").default("{}"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type PlatformNotification = typeof platformNotifications.$inferSelect;

// ─── Organization Users (join table: users ↔ organizations) ──────────────────
export const organizationUsers = pgTable("organization_users", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  role: varchar("role", { length: 64 }).default("member").notNull(),
  isPrimary: boolean("is_primary").default(false),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type OrganizationUser = typeof organizationUsers.$inferSelect;
export type InsertOrganizationUser = typeof organizationUsers.$inferInsert;

// ─── Sector Compliance Events (automated scan results from sector workers) ────
export const sectorComplianceEvents = pgTable("sector_compliance_events", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  sector: varchar("sector", { length: 64 }).notNull(),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  severity: varchar("severity", { length: 20 }).default("info").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  details: jsonb("details").default("{}"),
  workerName: varchar("worker_name", { length: 128 }),
  ruleId: varchar("rule_id", { length: 128 }),
  resolved: boolean("resolved").default(false),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: integer("resolved_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type SectorComplianceEvent = typeof sectorComplianceEvents.$inferSelect;
export type InsertSectorComplianceEvent = typeof sectorComplianceEvents.$inferInsert;

// ─── Phase 13 Runtime Contracts ──────────────────────────────────────────────
// These declarations mirror the raw-SQL tRPC procedures and migration 0025.

export const analyticsSnapshots = pgTable("analytics_snapshots", {
  id: serial("id").primaryKey(),
  metricName: text("metric_name").notNull(),
  dimension: text("dimension"),
  dimensionValue: text("dimension_value"),
  metricValue: numeric("metric_value", { precision: 20, scale: 4 }).notNull().default("0"),
  snapshotDate: date("snapshot_date").notNull().defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const article40Codes = pgTable("article40_codes", {
  id: serial("id").primaryKey(),
  codeName: text("code_name").notNull(),
  sector: text("sector").notNull(),
  description: text("description"),
  submittedBy: text("submitted_by"),
  documentUrl: text("document_url"),
  status: text("status").notNull().default("draft"),
  approvedBy: text("approved_by"),
  approvalDate: date("approval_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const complianceCalendarEvents = pgTable("compliance_calendar_events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  eventType: text("event_type").notNull(),
  dueDate: date("due_date").notNull(),
  priority: text("priority").notNull().default("medium"),
  description: text("description"),
  assignedTo: text("assigned_to"),
  reminderDays: integer("reminder_days").notNull().default(14),
  orgId: integer("org_id").references(() => organizations.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const consentRecordsV2 = pgTable("consent_records_v2", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  dataSubjectId: text("data_subject_id").notNull(),
  dataSubjectEmail: text("data_subject_email"),
  purpose: text("purpose").notNull(),
  legalBasis: text("legal_basis").notNull().default("consent"),
  dataCategories: jsonb("data_categories").$type<string[]>().notNull().default([]),
  thirdPartySharing: boolean("third_party_sharing").notNull().default(false),
  thirdParties: jsonb("third_parties").$type<string[]>().notNull().default([]),
  consentGiven: boolean("consent_given").notNull().default(true),
  status: text("status").notNull().default("active"),
  withdrawalDate: timestamp("withdrawal_date", { withTimezone: true }),
  expiryDate: timestamp("expiry_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationInbox = pgTable("notification_inbox", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  notificationType: text("notification_type").notNull(),
  priority: text("priority").notNull().default("normal"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at", { withTimezone: true }),
  actionUrl: text("action_url"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const publicComplianceRegistry = pgTable("public_compliance_registry", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().unique().references(() => organizations.id, { onDelete: "cascade" }),
  orgName: text("org_name").notNull(),
  registrationNumber: text("registration_number"),
  sector: text("sector"),
  complianceStatus: text("compliance_status").notNull().default("pending"),
  complianceScore: numeric("compliance_score", { precision: 5, scale: 2 }).notNull().default("0"),
  lastAssessmentDate: date("last_assessment_date"),
  isPublished: boolean("is_published").notNull().default(false),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiRateLimitStats = pgTable("api_rate_limit_stats", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  endpoint: text("endpoint").notNull(),
  clientIp: inet("client_ip"),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  requestsCount: integer("requests_count").notNull().default(0),
  blockedCount: integer("blocked_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const whistleblowerCases = pgTable("whistleblower_cases", {
  id: serial("id").primaryKey(),
  caseReference: text("case_reference").notNull().unique(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  category: text("category"),
  severity: text("severity").notNull().default("medium"),
  status: text("status").notNull().default("new"),
  assignedTo: text("assigned_to"),
  investigationNotes: text("investigation_notes"),
  resolution: text("resolution"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const penaltyCalculations = pgTable("penalty_calculations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  orgId: integer("org_id").references(() => organizations.id, { onDelete: "set null" }),
  orgName: text("org_name"),
  violationType: text("violation_type"),
  violationDate: date("violation_date"),
  annualTurnover: numeric("annual_turnover", { precision: 20, scale: 2 }),
  basePenalty: numeric("base_penalty", { precision: 20, scale: 2 }),
  finalPenalty: numeric("final_penalty", { precision: 20, scale: 2 }),
  aggravatingFactors: jsonb("aggravating_factors").$type<string[]>().notNull().default([]),
  mitigatingFactors: jsonb("mitigating_factors").$type<string[]>().notNull().default([]),
  aggravatingMultiplier: numeric("aggravating_multiplier", { precision: 8, scale: 4 }).notNull().default("1"),
  mitigatingReduction: numeric("mitigating_reduction", { precision: 8, scale: 4 }).notNull().default("0"),
  penaltyCap: numeric("penalty_cap", { precision: 20, scale: 2 }),
  calculationBasis: text("calculation_basis"),
  status: text("status").notNull().default("draft"),
  calculatedBy: text("calculated_by"),
  approvedBy: text("approved_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
