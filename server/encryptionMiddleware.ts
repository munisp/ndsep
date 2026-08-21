/**
 * NDSEP Encryption Middleware
 * ============================
 * Express middleware and tRPC helpers that transparently encrypt PII fields
 * on write and decrypt them on read.
 *
 * Architecture:
 * - On INSERT/UPDATE: PII fields are encrypted before being written to DB
 * - On SELECT: PII fields are decrypted after being read from DB
 * - Encryption is transparent to the rest of the application
 * - If FIELD_ENCRYPTION_KEY is not set, all operations pass through unchanged
 */

import type { Request, Response, NextFunction } from "express";
import {
  encryptField,
  decryptField,
  encryptRow,
  decryptRow,
  decryptRows,
  isEncryptionEnabled,
  PII_FIELDS,
} from "./encryption";
import pino from "pino";

const logger = pino({ name: "ndsep-encryption" });

// ─── Express Middleware ─────────────────────────────────────────────────────

/**
 * Middleware: pass-through placeholder.
 *
 * Encryption of PII is NOT done at the Express/request level because the
 * middleware runs BEFORE tRPC's Zod input validation. Encrypting fields
 * like email before validation causes `.email()` checks to reject the
 * `enc:v1:...` ciphertext.
 *
 * Instead, PII encryption happens at the database write point:
 * - Raw SQL routers: use encryptField() on PII values before INSERT/UPDATE
 * - Query results: autoDecryptRows() handles transparent decryption on read
 */
export function encryptRequestPii(_req: Request, _res: Response, next: NextFunction): void {
  next();
}

/**
 * Recursively scan an object for known PII field names and encrypt their values.
 */
function encryptPiiInObject(obj: unknown, depth = 0): void {
  if (depth > 10 || obj == null || typeof obj !== "object") return;

  // Collect all PII field names across all tables
  const allPiiFields = new Set<string>();
  for (const fields of Object.values(PII_FIELDS)) {
    for (const f of fields) allPiiFields.add(f);
    // Also add camelCase versions (DB uses snake_case, app uses camelCase)
    for (const f of fields) allPiiFields.add(snakeToCamel(f));
  }

  if (Array.isArray(obj)) {
    for (const item of obj) encryptPiiInObject(item, depth + 1);
    return;
  }

  const record = obj as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && allPiiFields.has(key)) {
      record[key] = encryptField(value);
    } else if (typeof value === "object" && value !== null) {
      encryptPiiInObject(value, depth + 1);
    }
  }
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

// ─── Database Query Helpers ──────────────────────────────────────────────────

/**
 * Encrypt specific fields in a parameterized query's values array.
 * Use this when building raw SQL queries with PII fields.
 *
 * Example:
 *   const values = encryptQueryParams("users", { email: "test@example.com", name: "John" });
 */
export function encryptQueryParams<T extends Record<string, unknown>>(tableName: string, params: T): T {
  return encryptRow(tableName, params);
}

/**
 * Decrypt a single row returned from a raw SQL query.
 */
export function decryptQueryResult<T extends Record<string, unknown>>(tableName: string, row: T): T {
  return decryptRow(tableName, row);
}

/**
 * Decrypt an array of rows returned from a raw SQL query.
 */
export function decryptQueryResults<T extends Record<string, unknown>>(tableName: string, rows: T[]): T[] {
  return decryptRows(tableName, rows);
}

// ─── Drizzle ORM Helpers ─────────────────────────────────────────────────────

/**
 * Wrap a Drizzle insert/update values object to encrypt PII fields.
 * Use before passing values to drizzle's .insert().values() or .update().set().
 *
 * Example:
 *   await db.insert(users).values(encryptForInsert("users", { email: "foo@bar.com", name: "Test" }));
 */
export function encryptForInsert<T extends Record<string, unknown>>(tableName: string, values: T): T {
  return encryptRow(tableName, values);
}

/**
 * Decrypt a row returned from Drizzle select.
 *
 * Example:
 *   const user = await db.select().from(users).where(eq(users.id, 1));
 *   return decryptFromSelect("users", user[0]);
 */
export function decryptFromSelect<T extends Record<string, unknown>>(tableName: string, row: T | undefined): T | undefined {
  if (!row) return row;
  return decryptRow(tableName, row);
}

// ─── Auto-Decrypt for Raw SQL Results ────────────────────────────────────────

/**
 * Parse a SQL query to extract table names referenced in FROM / JOIN clauses,
 * then decrypt PII fields for any matching tables in PII_FIELDS.
 *
 * This enables transparent decryption when using raw pool.query() calls
 * without requiring each router to explicitly call decryptQueryResults().
 */
export function autoDecryptRows<T extends Record<string, unknown>>(sql: string, rows: T[]): T[] {
  if (!isEncryptionEnabled() || !rows || rows.length === 0) return rows;

  const tables = extractTableNames(sql);
  if (tables.length === 0) return rows;

  return rows.map(row => {
    let decrypted = { ...row };
    for (const table of tables) {
      const fields = PII_FIELDS[table];
      if (!fields) continue;
      for (const field of fields) {
        const val = decrypted[field];
        if (typeof val === "string") {
          (decrypted as Record<string, unknown>)[field] = decryptField(val);
        }
        // Also check camelCase version of the field name
        const camelField = snakeToCamel(field);
        const camelVal = decrypted[camelField];
        if (typeof camelVal === "string") {
          (decrypted as Record<string, unknown>)[camelField] = decryptField(camelVal);
        }
      }
    }
    return decrypted;
  });
}

/**
 * Extract table names from a SQL query by matching FROM and JOIN clauses.
 * Handles aliases (e.g., "FROM users u" → "users").
 */
function extractTableNames(sql: string): string[] {
  const normalized = sql.replace(/\s+/g, " ").toLowerCase();
  const tables = new Set<string>();
  // Match: FROM <table>, JOIN <table>, INTO <table>, UPDATE <table>
  const patterns = [
    /\bfrom\s+(\w+)/g,
    /\bjoin\s+(\w+)/g,
    /\binto\s+(\w+)/g,
    /\bupdate\s+(\w+)/g,
  ];
  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(normalized)) !== null) {
      const table = m[1];
      if (PII_FIELDS[table]) tables.add(table);
    }
  }
  return Array.from(tables);
}

/**
 * Encrypt PII fields in a values object before a raw SQL INSERT/UPDATE.
 * Detects the table name from the SQL and encrypts matching fields.
 */
export function autoEncryptParams<T extends Record<string, unknown>>(sql: string, values: T): T {
  if (!isEncryptionEnabled()) return values;
  const tables = extractTableNames(sql);
  let encrypted = { ...values };
  for (const table of tables) {
    encrypted = encryptRow(table, encrypted);
  }
  return encrypted;
}

// ─── Logging ──────────────────────────────────────────────────────────────────

/**
 * Log encryption status for monitoring.
 */
export function logEncryptionStatus(): void {
  if (isEncryptionEnabled()) {
    const tableCount = Object.keys(PII_FIELDS).length;
    const fieldCount = Object.values(PII_FIELDS).reduce((sum, f) => sum + f.length, 0);
    logger.info(
      { tables: tableCount, fields: fieldCount },
      "[Encryption] Field-level encryption ENABLED — %d PII fields across %d tables",
      fieldCount,
      tableCount
    );
  } else {
    logger.warn("[Encryption] Field-level encryption DISABLED — FIELD_ENCRYPTION_KEY not set");
  }
}
