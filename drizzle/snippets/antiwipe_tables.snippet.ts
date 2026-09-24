/**
 * SNIPPET — antiwipe table definitions for drizzle/schema.ts
 * ===========================================================
 * This file is NOT imported anywhere. It holds the Drizzle ORM table
 * definitions matching migrations drizzle/migrations/0060..0063 so the
 * schema owner can paste them into drizzle/schema.ts without a merge
 * conflict from this workstream. Keep column names in sync with the SQL.
 */
import {
  bigserial,
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// ─── Anti-wipe: append-only evidence vault (0060) ────────────────────────────

export const evidenceVaultEntries = pgTable("evidence_vault_entries", {
  hash: text("hash").primaryKey(), // sha256 hex of file content
  path: text("path").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  contentType: text("content_type"),
  uploaderId: integer("uploader_id"),
  uploaderName: text("uploader_name"),
  caseRef: text("case_ref"),
  sealed: boolean("sealed").notNull().default(false),
  sealedAt: timestamp("sealed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export type EvidenceVaultEntry = typeof evidenceVaultEntries.$inferSelect;

// ─── Anti-wipe: hash-chained audit ledger + anchors (0061) ───────────────────

export const auditLedger = pgTable("audit_ledger", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  prevHash: text("prev_hash").notNull(),
  entryHash: text("entry_hash").notNull().unique(),
  payload: jsonb("payload").notNull(),
  actor: text("actor"),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export type AuditLedgerEntry = typeof auditLedger.$inferSelect;

export const ledgerAnchors = pgTable("ledger_anchors", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  anchorDate: date("anchor_date").notNull().unique(),
  rootHash: text("root_hash").notNull(),
  firstSeq: bigint("first_seq", { mode: "number" }),
  lastSeq: bigint("last_seq", { mode: "number" }),
  entryCount: integer("entry_count").notNull(),
  externalAnchor: jsonb("external_anchor"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export type LedgerAnchorRow = typeof ledgerAnchors.$inferSelect;

// ─── Anti-wipe: backup manifest + canary registry (0062) ─────────────────────

export const backupManifest = pgTable("backup_manifest", {
  backupId: text("backup_id").primaryKey(),
  type: text("type").notNull().default("postgres"),
  path: text("path").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  sha256: text("sha256"),
  verified: boolean("verified").notNull().default(false),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export type BackupManifestRow = typeof backupManifest.$inferSelect;

export const canaryFiles = pgTable("canary_files", {
  path: text("path").primaryKey(),
  sha256: text("sha256").notNull(),
  directory: text("directory").notNull(),
  writtenAt: timestamp("written_at", { withTimezone: true }).defaultNow().notNull(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  status: text("status").notNull().default("ok"),
});
export type CanaryFileRow = typeof canaryFiles.$inferSelect;

// ─── Anti-wipe: watchdog heartbeats (0063) ───────────────────────────────────

export const watchdogHeartbeats = pgTable("watchdog_heartbeats", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  workerId: text("worker_id").notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
  vaultFiles: integer("vault_files"),
  vaultVerified: integer("vault_verified"),
  canariesOk: integer("canaries_ok"),
  canariesFailed: integer("canaries_failed"),
  ledgerHeadHash: text("ledger_head_hash"),
  ledgerOk: boolean("ledger_ok"),
  status: text("status").notNull(),
  details: jsonb("details"),
});
export type WatchdogHeartbeatRow = typeof watchdogHeartbeats.$inferSelect;
