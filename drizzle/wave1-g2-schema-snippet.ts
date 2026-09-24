/**
 * Wave-1 Gap-2 schema snippet — Drizzle table definitions for gaps 7, 8, 11, 12.
 *
 * DO NOT import this file at runtime. Copy each block below into
 * drizzle/schema.ts (append at the end). The corresponding DDL lives in:
 *   drizzle/migrations/0040_whistleblower_channel.sql
 *   drizzle/migrations/0041_regulator_reconciliation.sql
 *   drizzle/migrations/0042_dpo_marketplace.sql
 *   drizzle/migrations/0043_fine_payment_reconciliation.sql
 *
 * Required imports already present in schema.ts:
 *   pgTable, serial, varchar, text, boolean, integer, jsonb, numeric, timestamp
 */
import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { organizations, whistleblowerReports } from "./schema";

// NOTE: enforcement_fines is managed by raw SQL (server/routers/phase11Features.ts)
// and has no Drizzle table def, so penaltyId columns below are plain integers
// (the FK exists only at the SQL level in migration 0043).

// ─── Gap 7: Whistleblower follow-up channel ─────────────────────────────────

export const whistleblowerChannelTokens = pgTable("whistleblower_channel_tokens", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").notNull().references(() => whistleblowerReports.id),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  issuedTo: varchar("issued_to", { length: 20 }).notNull().default("reporter"),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type WhistleblowerChannelToken = typeof whistleblowerChannelTokens.$inferSelect;

export const whistleblowerMessages = pgTable("whistleblower_messages", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").notNull().references(() => whistleblowerReports.id),
  sender: varchar("sender", { length: 20 }).notNull(),
  body: text("body").notNull(),
  encrypted: boolean("encrypted").notNull().default(true),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type WhistleblowerMessage = typeof whistleblowerMessages.$inferSelect;

export const protectionFlags = pgTable("protection_flags", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").references(() => whistleblowerReports.id),
  reporterEmail: varchar("reporter_email", { length: 255 }),
  employerName: varchar("employer_name", { length: 255 }),
  retaliationType: varchar("retaliation_type", { length: 50 }).notNull().default("other"),
  description: text("description").notNull(),
  status: varchar("status", { length: 30 }).notNull().default("open"),
  protectiveMeasures: text("protective_measures"),
  priority: varchar("priority", { length: 20 }).notNull().default("high"),
  assignedTo: varchar("assigned_to", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});
export type ProtectionFlag = typeof protectionFlags.$inferSelect;

export const whistleblowerRewards = pgTable("whistleblower_rewards", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").notNull().references(() => whistleblowerReports.id),
  rewardType: varchar("reward_type", { length: 30 }).notNull().default("recognition"),
  amount: numeric("amount", { precision: 14, scale: 2 }),
  currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
  citation: text("citation"),
  status: varchar("status", { length: 30 }).notNull().default("nominated"),
  decidedBy: varchar("decided_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type WhistleblowerReward = typeof whistleblowerRewards.$inferSelect;

// ─── Gap 8: Sector-regulator reconciliation ─────────────────────────────────

export const jurisdictionConflicts = pgTable("jurisdiction_conflicts", {
  id: serial("id").primaryKey(),
  matterRef: varchar("matter_ref", { length: 100 }).notNull(),
  regulators: jsonb("regulators").notNull().default([]),
  conflictType: varchar("conflict_type", { length: 50 }).notNull().default("overlapping_mandate"),
  description: text("description"),
  status: varchar("status", { length: 30 }).notNull().default("raised"),
  precedenceDecision: text("precedence_decision"),
  leadRegulator: varchar("lead_regulator", { length: 50 }),
  decidedBy: varchar("decided_by", { length: 255 }),
  raisedBy: varchar("raised_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});
export type JurisdictionConflict = typeof jurisdictionConflicts.$inferSelect;

export const caseReferrals = pgTable("case_referrals", {
  id: serial("id").primaryKey(),
  referralRef: varchar("referral_ref", { length: 50 }).notNull().unique(),
  fromRegulator: varchar("from_regulator", { length: 50 }).notNull(),
  toRegulator: varchar("to_regulator", { length: 50 }).notNull(),
  matterRef: varchar("matter_ref", { length: 100 }),
  casePayload: jsonb("case_payload").notNull().default({}),
  status: varchar("status", { length: 30 }).notNull().default("sent"),
  notes: text("notes"),
  respondedBy: varchar("responded_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  acknowledgedAt: timestamp("acknowledged_at"),
  respondedAt: timestamp("responded_at"),
  resolvedAt: timestamp("resolved_at"),
});
export type CaseReferral = typeof caseReferrals.$inferSelect;

// ─── Gap 11: DPO marketplace ────────────────────────────────────────────────

export const dpoMarketplaceProfiles = pgTable("dpo_marketplace_profiles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  profileType: varchar("profile_type", { length: 20 }).notNull().default("dpo"),
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  bio: text("bio"),
  sectors: jsonb("sectors").notNull().default([]),
  regions: jsonb("regions").notNull().default([]),
  languages: jsonb("languages").notNull().default([]),
  capacity: integer("capacity").notNull().default(1),
  verified: boolean("verified").notNull().default(false),
  verifiedBy: varchar("verified_by", { length: 255 }),
  verifiedAt: timestamp("verified_at"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DpoMarketplaceProfile = typeof dpoMarketplaceProfiles.$inferSelect;

export const marketplaceEngagements = pgTable("marketplace_engagements", {
  id: serial("id").primaryKey(),
  engagementRef: varchar("engagement_ref", { length: 50 }).notNull().unique(),
  orgId: integer("org_id").references(() => organizations.id),
  orgName: varchar("org_name", { length: 255 }).notNull(),
  contactEmail: varchar("contact_email", { length: 255 }).notNull(),
  requirements: jsonb("requirements").notNull().default({}),
  status: varchar("status", { length: 30 }).notNull().default("open"),
  matchedProfileId: integer("matched_profile_id").references(() => dpoMarketplaceProfiles.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type MarketplaceEngagement = typeof marketplaceEngagements.$inferSelect;

// ─── Gap 12: Fine payment & reconciliation ──────────────────────────────────

export const paymentRrrCodes = pgTable("payment_rrr_codes", {
  id: serial("id").primaryKey(),
  rrr: varchar("rrr", { length: 20 }).notNull().unique(),
  penaltyId: integer("penalty_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
  status: varchar("status", { length: 20 }).notNull().default("generated"),
  gatewayRef: varchar("gateway_ref", { length: 100 }),
  expiresAt: timestamp("expires_at").notNull(),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type PaymentRrrCode = typeof paymentRrrCodes.$inferSelect;

export const paymentReconciliations = pgTable("payment_reconciliations", {
  id: serial("id").primaryKey(),
  rrr: varchar("rrr", { length: 20 }).notNull(),
  penaltyId: integer("penalty_id"),
  matchedAmount: numeric("matched_amount", { precision: 14, scale: 2 }),
  matchStatus: varchar("match_status", { length: 20 }).notNull().default("unmatched"),
  batchDate: date("batch_date").defaultNow().notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type PaymentReconciliation = typeof paymentReconciliations.$inferSelect;

export const paymentInstallments = pgTable("payment_installments", {
  id: serial("id").primaryKey(),
  planRef: varchar("plan_ref", { length: 50 }).notNull().unique(),
  penaltyId: integer("penalty_id").notNull(),
  schedule: jsonb("schedule").notNull().default([]),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  defaultedAt: timestamp("defaulted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type PaymentInstallment = typeof paymentInstallments.$inferSelect;

export const receipts = pgTable("receipts", {
  id: serial("id").primaryKey(),
  receiptNumber: varchar("receipt_number", { length: 30 }).notNull().unique(),
  rrr: varchar("rrr", { length: 20 }),
  penaltyId: integer("penalty_id"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
  payerEmail: varchar("payer_email", { length: 255 }),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
});
export type Receipt = typeof receipts.$inferSelect;

export const refundRequests = pgTable("refund_requests", {
  id: serial("id").primaryKey(),
  refundRef: varchar("refund_ref", { length: 50 }).notNull().unique(),
  rrr: varchar("rrr", { length: 20 }),
  penaltyId: integer("penalty_id"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
  reason: text("reason").notNull(),
  requestedBy: varchar("requested_by", { length: 255 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("requested"),
  decidedBy: varchar("decided_by", { length: 255 }),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type RefundRequest = typeof refundRequests.$inferSelect;
