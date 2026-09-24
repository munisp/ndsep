/**
 * NIN privacy invariant tests (round 8) — static analysis, no database.
 *
 * Asserts that the identity-verification schema (migration 0093) and the
 * ninIdentity router can never persist a raw National Identification Number:
 *   - no column in identity_verifications / verification_audit_log may hold
 *     a raw NIN (only nin_hmac, verification_token, assurance level, timestamps);
 *   - the router hashes the NIN (HMAC) and never encrypts-and-stores or logs it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const MIGRATION_SQL = readFileSync(
  path.join(REPO_ROOT, "drizzle/migrations/0093_identity_verification.sql"),
  "utf-8",
);
const ROUTER_TS = readFileSync(
  path.join(REPO_ROOT, "server/routers/ninIdentity.ts"),
  "utf-8",
);

/** Extract the body of one CREATE TABLE block from the migration. */
function tableBlock(sql: string, tableName: string): string {
  const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName}\\s*\\(([\\s\\S]*?)\\n\\);`, "i");
  const m = sql.match(re);
  if (!m) throw new Error(`table ${tableName} not found in migration 0093`);
  return m[1];
}

/** Column names declared in a CREATE TABLE body. */
function columnNames(block: string): string[] {
  const skip = new Set(["constraint", "unique", "primary", "foreign", "check"]);
  return block
    .split("\n")
    .map((line) => line.trim())
    .map((line) => line.match(/^([a-z_][a-z0-9_]*)\s+/i)?.[1])
    .filter((name): name is string => !!name && !skip.has(name.toLowerCase()));
}

describe("migration 0093 — no raw NIN can be persisted", () => {
  it("identity_verifications stores only HMAC + token + level + timestamps", () => {
    const cols = columnNames(tableBlock(MIGRATION_SQL, "identity_verifications"));
    // Required privacy-preserving columns exist.
    for (const required of ["nin_hmac", "verification_token", "assurance_level", "verified_at", "expires_at", "subject_type", "subject_ref", "status"]) {
      expect(cols).toContain(required);
    }
    // No column capable of holding a raw NIN.
    for (const col of cols) {
      expect(col, `column '${col}' looks like it could hold a raw NIN`).not.toMatch(/^nin(_raw|_number|_plain|_full|_value|_encrypted)?$/i);
      expect(col).not.toMatch(/national_identification|national_identity_number/i);
    }
  });

  it("verification_audit_log has no NIN column either", () => {
    const cols = columnNames(tableBlock(MIGRATION_SQL, "verification_audit_log"));
    for (const col of cols) {
      expect(col).not.toMatch(/^nin(_raw|_number|_plain|_full|_value|_encrypted)?$/i);
    }
    expect(cols).toContain("details"); // JSONB details — router redacts 11-digit values before writing
  });

  it("the schema documents the never-store-raw-NIN invariant", () => {
    expect(MIGRATION_SQL).toMatch(/NEVER/i);
    expect(MIGRATION_SQL).toMatch(/no column capable of holding a raw[\s\S]{0,20}NIN/i);
  });
});

describe("ninIdentity router — raw NIN never reaches storage", () => {
  it("hashes the NIN with HMAC before any persistence", () => {
    expect(ROUTER_TS).toContain("ninHmac(input.nin)");
    expect(ROUTER_TS).toContain("createHmac");
  });

  it("never encrypt-and-stores the raw NIN via the field-encryption helper", () => {
    expect(ROUTER_TS).not.toContain("encryptField(input.nin");
    expect(ROUTER_TS).not.toContain("encryptField(nin");
  });

  it("never writes the raw NIN into an INSERT parameter list", () => {
    // Every exec(INSERT ...) in the router must not pass input.nin raw.
    const inserts = ROUTER_TS.match(/INSERT INTO[\s\S]*?\],\s*\[[\s\S]*?\]\s*,?\n\s*\);/g) ?? [];
    for (const insert of inserts) {
      expect(insert).not.toMatch(/input\.nin(?!\w)/);
    }
  });

  it("never logs the raw NIN", () => {
    for (const line of ROUTER_TS.split("\n")) {
      if (/logger\.(info|warn|error|debug)/.test(line) || /logVerification\(/.test(line)) {
        expect(line).not.toMatch(/input\.nin(?!\w)/);
      }
    }
  });

  it("biometric/liveness is explicitly an unimplemented adapter interface", () => {
    expect(ROUTER_TS).toContain("NOT_IMPLEMENTED");
    expect(ROUTER_TS).toContain("biometric_not_implemented");
  });

  it("returns explicit UNCONFIGURED status without NIMC credentials", () => {
    expect(ROUTER_TS).toContain("UNCONFIGURED");
    expect(ROUTER_TS).toContain("NIMC_API_BASE");
    expect(ROUTER_TS).toContain("NIMC_API_KEY");
    expect(ROUTER_TS).toContain("verify_unconfigured");
  });
});
