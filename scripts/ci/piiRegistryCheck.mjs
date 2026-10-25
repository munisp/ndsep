#!/usr/bin/env node
/**
 * PII registry coverage gate (round-10, auditor recommendation)
 * =============================================================
 * Two-directional check between the runtime encryption registry
 * (PII_FIELDS in server/encryption.ts) and the migration chain
 * (drizzle/00*.sql journal files + drizzle/migrations/*.sql):
 *
 *   1. REGISTRY SOUNDNESS — every PII_FIELDS table.column must exist in the
 *      migration chain (a registry entry for a non-existent column means
 *      encryption silently never happens).
 *   2. REGISTRY COMPLETENESS — every obviously-PII column created by the
 *      migration chain (name/email/phone/dob/d-o-b/nin/bvn/guardian/reporter
 *      patterns) must either be in PII_FIELDS or on the justified allowlist
 *      below (e.g. hashed/pseudonymous lookup keys, officer usernames,
 *      organisation-level contacts that are not data subjects).
 *
 * Exit 0 = pass, exit 1 = violations (each printed with file evidence).
 *
 * Usage: node scripts/ci/piiRegistryCheck.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ── Allowlist with justification (table.column → reason) ────────────────────
// Every entry MUST have a justification; keep alphabetised by table.
// Justifications starting with "GAP(round-10):" are KNOWN data-subject PII
// registry gaps: the gate prints them as warnings and tracks the count, but
// does not fail on them (registering them in PII_FIELDS without the matching
// encrypt-at-write router changes would break decryption of existing
// plaintext rows). Any NEW PII-named column that is neither registered nor
// allowlisted here FAILS the gate.
const ALLOWLIST = new Map(Object.entries({
  // ── Organisation/professional contact points (not data subjects) ──────────
  "dpco_accreditation_applications.email": "DPCO business contact email (organisation applying for accreditation, not a data subject)",
  "dpco_accreditation_applications.phone": "DPCO business contact phone (organisation, not a data subject)",
  "dpco_engagement_requests.contact_email": "DPCO-firm business contact (organisation, not a data subject)",
  "dpco_engagement_requests.contact_phone": "DPCO-firm business contact (organisation, not a data subject)",
  "dpco_invoices.client_email": "organisation billing contact (B2B), not data-subject PII",
  "dpco_organisations.dpo_email": "DPO role contact for an organisation; role-based professional contact",
  "dpco_organisations.email": "organisation general inbox, not data-subject PII",
  "dpco_organisations.phone": "organisation switchboard, not data-subject PII",
  "notification_settings.dpo_email": "organisation DPO role inbox (notification routing config)",
  "notification_settings.legal_email": "organisation legal role inbox (notification routing config)",
  "notification_settings.technical_email": "organisation technical role inbox (notification routing config)",
  // ── Boolean/derived columns that merely name an identifier ────────────────
  "kyc_records.bvn_verified": "boolean verification flag, not the BVN identifier itself",
  "kyc_records.nin_verified": "boolean verification flag, not the NIN identifier itself",
  // Round-10: all former GAP(round-10) entries (kyc_records.*, aml_cases.subject_bvn,
  // insurance_policies.policyholder_nin, watchlist_entries.date_of_birth,
  // penalty_appeals.contact_email, dpco_training_participants.participant_email)
  // are now REGISTERED in PII_FIELDS (server/encryption.ts) and removed from
  // this allowlist. Do not re-add GAP entries; fix the registry instead.
}));

/**
 * Column-name patterns that are "obviously PII" when they appear as columns
 * created by migrations. Deliberately conservative (word-boundary matching)
 * to avoid flagging e.g. `username` inside `username_hash` twice — the hash
 * suffix carve-outs below handle pseudonymous keys.
 */
const PII_NAME_RE = /(^|_)(full_?name|first_?name|last_?name|email|e_?mail|phone|phone_?number|mobile|msisdn|dob|date_?of_?birth|nin|bvn|guardian_?name|guardian_?contact|reporter_?name|reporter_?email|reporter_?phone)(_|$)/i;
/** Suffixes that make a value pseudonymous/non-reversible → not raw PII. */
const PSEUDONYM_RE = /(_hmac|_hash|_last4|_fingerprint)$/i;
/** Columns on enumerated reference/lookup tables are never data-subject PII. */
const NON_PII_COLUMN_RE = /^(id|.*_id|status|.*_status|created_at|updated_at|created_by|updated_by)$/i;

// ── Load PII_FIELDS from server/encryption.ts (static parse) ────────────────
function loadPiiFields() {
  const src = fs.readFileSync(path.join(ROOT, "server/encryption.ts"), "utf8");
  const start = src.indexOf("export const PII_FIELDS");
  if (start === -1) throw new Error("PII_FIELDS export not found in server/encryption.ts");
  // Slice the object literal (first { ... }; after the export).
  const open = src.indexOf("{", start);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(open + 1, end).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const registry = new Map(); // table -> Set(columns)
  const entryRe = /([a-z_][a-z0-9_]*)\s*:\s*\[([^\]]*)\]/gi;
  let m;
  while ((m = entryRe.exec(body))) {
    const cols = [...m[2].matchAll(/"([^"]+)"/g)].map((c) => c[1]);
    registry.set(m[1], new Set(cols));
  }
  return registry;
}

// ── Extract (table, column) pairs created by the migration chain ────────────
function migrationFiles() {
  const files = [];
  const journalPath = path.join(ROOT, "drizzle/meta/_journal.json");
  if (fs.existsSync(journalPath)) {
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    for (const e of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
      files.push(path.join(ROOT, "drizzle", `${e.tag}.sql`));
    }
  }
  const migDir = path.join(ROOT, "drizzle/migrations");
  for (const f of fs.readdirSync(migDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    files.push(path.join(migDir, f));
  }
  return files.filter((f) => fs.existsSync(f));
}

/** Very small CREATE TABLE column extractor (good enough for DDL audit). */
function extractSchema(files) {
  const tables = new Map(); // table -> {columns:Set, file}
  const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(([\s\S]*?)\)\s*;/gi;
  const alterAddRe = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
  for (const file of files) {
    const sql = fs.readFileSync(file, "utf8").replace(/--[^\n]*/g, "");
    let m;
    while ((m = createRe.exec(sql))) {
      const [, table, bodyRaw] = m;
      if (!tables.has(table)) tables.set(table, { columns: new Set(), file: path.relative(ROOT, file) });
      const t = tables.get(table);
      // split body on top-level commas
      let depth = 0, cur = "";
      const parts = [];
      for (const ch of bodyRaw) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
      }
      parts.push(cur);
      for (const p of parts) {
        const cm = p.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+/i);
        if (cm && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|EXCLUDE)$/i.test(cm[1])) {
          t.columns.add(cm[1]);
        }
      }
    }
    while ((m = alterAddRe.exec(sql))) {
      const [, table, col] = m;
      if (!tables.has(table)) tables.set(table, { columns: new Set(), file: path.relative(ROOT, file) });
      tables.get(table).columns.add(col);
    }
  }
  return tables;
}

function main() {
  const registry = loadPiiFields();
  const schema = extractSchema(migrationFiles());
  const violations = [];
  const knownGaps = [];

  // 1. Registry soundness: every registered table.column must exist.
  for (const [table, cols] of registry) {
    const t = schema.get(table);
    if (!t) {
      violations.push(`SOUNDNESS: PII_FIELDS table '${table}' is not created by any migration`);
      continue;
    }
    for (const col of cols) {
      if (!t.columns.has(col)) {
        violations.push(`SOUNDNESS: PII_FIELDS ${table}.${col} — column not found in migrations (${t.file} creates ${table})`);
      }
    }
  }

  // 2. Registry completeness: obviously-PII columns must be registered or allowlisted.
  for (const [table, { columns, file }] of [...schema].sort()) {
    for (const col of [...columns].sort()) {
      if (NON_PII_COLUMN_RE.test(col)) continue;
      if (PSEUDONYM_RE.test(col)) continue;
      if (!PII_NAME_RE.test(col)) continue;
      const registered = registry.get(table)?.has(col);
      const allowReason = ALLOWLIST.get(`${table}.${col}`);
      if (!registered && !allowReason) {
        violations.push(
          `COMPLETENESS: ${table}.${col} (${file}) matches PII naming pattern but is neither in PII_FIELDS nor allowlisted`
        );
      } else if (!registered && allowReason?.startsWith("GAP(round-10):")) {
        knownGaps.push(`${table}.${col} — ${allowReason}`);
      }
    }
  }

  if (knownGaps.length) {
    console.warn(`[pii-registry-check] ${knownGaps.length} known registry gap(s) tracked (allowlisted GAP(round-10) entries):`);
    for (const g of knownGaps) console.warn(`  ~ ${g}`);
  }

  if (violations.length) {
    console.error(`[pii-registry-check] FAILED — ${violations.length} violation(s):`);
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log(
    `[pii-registry-check] OK — ${registry.size} registry tables sound; ` +
    `${schema.size} migrated tables scanned for unregistered PII-named columns.`
  );
}

main();
