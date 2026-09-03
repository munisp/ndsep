import { boolean, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const mobileUserRole = pgEnum("mobile_user_role", ["user", "admin"]);
export const permitSector = pgEnum("mobile_permit_sector", ["mining", "oil_gas", "multi_agency"]);
export const permitStage = pgEnum("mobile_permit_stage", [
  "intake",
  "spatial_clearance",
  "technical_review",
  "environmental_review",
  "agency_coordination",
  "payment_pending",
  "approval",
  "issued",
  "active_monitoring",
]);
export const permitPriority = pgEnum("mobile_permit_priority", ["routine", "elevated", "critical"]);
export const obligationStatus = pgEnum("mobile_obligation_status", ["pending", "satisfied", "at_risk"]);
export const middlewareStatus = pgEnum("mobile_middleware_status", ["planned", "connected", "degraded"]);
export const serviceLanguage = pgEnum("mobile_service_language", ["typescript", "python", "go", "rust"]);
export const serviceRuntimeMode = pgEnum("mobile_service_runtime_mode", ["webdev_backend", "external_service", "reserved_worker"]);
export const serviceHealth = pgEnum("mobile_service_health", ["healthy", "warning"]);

const createdAt = timestamp("createdAt", { withTimezone: true }).defaultNow().notNull();
const updatedAt = timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull();

/**
 * Core user table backing the mobile and portable authentication flow.
 * PostgreSQL is the only supported relational persistence engine.
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mobileUserRole("role").default("user").notNull(),
  createdAt,
  updatedAt,
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true }).defaultNow().notNull(),
});

export const permittingAgencies = pgTable("permittingAgencies", {
  id: varchar("id", { length: 80 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  role: text("role").notNull(),
  jurisdiction: varchar("jurisdiction", { length: 120 }).notNull(),
  reviewSlaHours: integer("reviewSlaHours").notNull(),
  queueDepth: integer("queueDepth").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt,
  updatedAt,
});

export const permitCases = pgTable("permitCases", {
  id: varchar("id", { length: 80 }).primaryKey(),
  sector: permitSector("sector").notNull(),
  permitType: varchar("permitType", { length: 255 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  applicantName: varchar("applicantName", { length: 255 }).notNull(),
  locationLabel: varchar("locationLabel", { length: 255 }).notNull(),
  assetReference: varchar("assetReference", { length: 120 }).notNull(),
  stage: permitStage("stage").notNull(),
  priority: permitPriority("priority").notNull(),
  leadAgencyId: varchar("leadAgencyId", { length: 80 }).notNull(),
  participatingAgencyIds: jsonb("participatingAgencyIds").$type<string[]>().notNull(),
  summary: text("summary").notNull(),
  timeline: jsonb("timeline").$type<Array<Record<string, unknown>>>().notNull(),
  createdAt,
  updatedAt,
});

export const permitObligations = pgTable("permitObligations", {
  id: varchar("id", { length: 80 }).primaryKey(),
  permitCaseId: varchar("permitCaseId", { length: 80 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  dueAt: timestamp("dueAt", { withTimezone: true }).notNull(),
  status: obligationStatus("status").notNull(),
  owner: varchar("owner", { length: 255 }).notNull(),
  createdAt,
  updatedAt,
});

export const middlewareComponents = pgTable("middlewareComponents", {
  key: varchar("key", { length: 80 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  purpose: text("purpose").notNull(),
  status: middlewareStatus("status").notNull(),
  ownerService: varchar("ownerService", { length: 120 }).notNull(),
  createdAt,
  updatedAt,
});

export const serviceTopology = pgTable("serviceTopology", {
  id: varchar("id", { length: 80 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  language: serviceLanguage("language").notNull(),
  responsibility: text("responsibility").notNull(),
  runtimeMode: serviceRuntimeMode("runtimeMode").notNull(),
  endpointPath: varchar("endpointPath", { length: 255 }).notNull(),
  health: serviceHealth("health").notNull(),
  middlewareKeys: jsonb("middlewareKeys").$type<string[]>().notNull(),
  createdAt,
  updatedAt,
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
