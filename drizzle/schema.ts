import { int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const permittingAgencies = mysqlTable("permittingAgencies", {
  id: varchar("id", { length: 80 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  role: text("role").notNull(),
  jurisdiction: varchar("jurisdiction", { length: 120 }).notNull(),
  reviewSlaHours: int("reviewSlaHours").notNull(),
  queueDepth: int("queueDepth").notNull(),
  active: int("active").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const permitCases = mysqlTable("permitCases", {
  id: varchar("id", { length: 80 }).primaryKey(),
  sector: mysqlEnum("sector", ["mining", "oil_gas", "multi_agency"]).notNull(),
  permitType: varchar("permitType", { length: 255 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  applicantName: varchar("applicantName", { length: 255 }).notNull(),
  locationLabel: varchar("locationLabel", { length: 255 }).notNull(),
  assetReference: varchar("assetReference", { length: 120 }).notNull(),
  stage: mysqlEnum("stage", [
    "intake",
    "spatial_clearance",
    "technical_review",
    "environmental_review",
    "agency_coordination",
    "payment_pending",
    "approval",
    "issued",
    "active_monitoring",
  ]).notNull(),
  priority: mysqlEnum("priority", ["routine", "elevated", "critical"]).notNull(),
  leadAgencyId: varchar("leadAgencyId", { length: 80 }).notNull(),
  participatingAgencyIds: json("participatingAgencyIds").$type<string[]>().notNull(),
  summary: text("summary").notNull(),
  timeline: json("timeline").$type<Array<Record<string, unknown>>>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const permitObligations = mysqlTable("permitObligations", {
  id: varchar("id", { length: 80 }).primaryKey(),
  permitCaseId: varchar("permitCaseId", { length: 80 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  dueAt: timestamp("dueAt").notNull(),
  status: mysqlEnum("status", ["pending", "satisfied", "at_risk"]).notNull(),
  owner: varchar("owner", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const middlewareComponents = mysqlTable("middlewareComponents", {
  key: varchar("key", { length: 80 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  purpose: text("purpose").notNull(),
  status: mysqlEnum("status", ["planned", "connected", "degraded"]).notNull(),
  ownerService: varchar("ownerService", { length: 120 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const serviceTopology = mysqlTable("serviceTopology", {
  id: varchar("id", { length: 80 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  language: mysqlEnum("language", ["typescript", "python", "go", "rust"]).notNull(),
  responsibility: text("responsibility").notNull(),
  runtimeMode: mysqlEnum("runtimeMode", ["webdev_backend", "external_service", "reserved_worker"]).notNull(),
  endpointPath: varchar("endpointPath", { length: 255 }).notNull(),
  health: mysqlEnum("health", ["healthy", "warning"]).notNull(),
  middlewareKeys: json("middlewareKeys").$type<string[]>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const diagnosticAttestationReceipts = mysqlTable("diagnosticAttestationReceipts", {
  receiptId: varchar("receiptId", { length: 80 }).primaryKey(),
  packageType: mysqlEnum("packageType", ["passphrase_encrypted", "administrative_public_key"]).notNull(),
  packageSha256: varchar("packageSha256", { length: 64 }).notNull(),
  attestedForSubject: varchar("attestedForSubject", { length: 255 }).notNull(),
  signerKeyId: varchar("signerKeyId", { length: 120 }).notNull(),
  signerFingerprint: varchar("signerFingerprint", { length: 64 }).notNull(),
  receiptJson: text("receiptJson").notNull(),
  revokedAt: timestamp("revokedAt"),
  revokedBy: varchar("revokedBy", { length: 255 }),
  revocationReason: text("revocationReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type PermittingAgency = typeof permittingAgencies.$inferSelect;
export type InsertPermittingAgency = typeof permittingAgencies.$inferInsert;
export type PermitCase = typeof permitCases.$inferSelect;
export type InsertPermitCase = typeof permitCases.$inferInsert;
export type PermitObligation = typeof permitObligations.$inferSelect;
export type InsertPermitObligation = typeof permitObligations.$inferInsert;
export type MiddlewareComponent = typeof middlewareComponents.$inferSelect;
export type InsertMiddlewareComponent = typeof middlewareComponents.$inferInsert;
export type ServiceTopology = typeof serviceTopology.$inferSelect;
export type InsertServiceTopology = typeof serviceTopology.$inferInsert;
export type DiagnosticAttestationReceipt = typeof diagnosticAttestationReceipts.$inferSelect;
export type InsertDiagnosticAttestationReceipt = typeof diagnosticAttestationReceipts.$inferInsert;
