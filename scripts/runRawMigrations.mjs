#!/usr/bin/env node
/**
 * NDSEP Raw SQL Migration Runner (drizzle/migrations/*.sql)
 * ==========================================================
 * The drizzle-kit journal (drizzle/0000_*.sql … 0034_*.sql, drizzle/meta/) is
 * applied by `scripts/migrate.sh` via drizzle-kit. The hand-written operational
 * migrations in drizzle/migrations/ (0019–0096 + round-9 forward fixes) are NOT
 * in the drizzle journal and previously had no runner at all — this script is
 * that runner.
 *
 * Guarantees:
 *   - PostgreSQL only (uses `pg`; connection from DATABASE_URL / NDSEP_PG_URL /
 *     PG* env vars).
 *   - Ordered: files applied in numeric filename order, subject to the explicit
 *     ORDER OVERRIDE map below.
 *   - Idempotent: applied filenames are recorded in public.schema_migrations;
 *     already-applied files are skipped. Safe to run at every boot.
 *   - Transactional: each file runs inside BEGIN/COMMIT with ROLLBACK on error,
 *     EXCEPT files containing CREATE INDEX CONCURRENTLY (0070, 0071), which
 *     cannot run inside a transaction block — those are split into individual
 *     statements and executed sequentially outside a transaction. Every such
 *     statement is itself idempotent (IF NOT EXISTS), so a mid-file failure is
 *     safely resumable on the next run.
 *   - Serialized: a Postgres advisory lock prevents two runners racing.
 *
 * ORDER OVERRIDE MAP (documented, do not remove):
 *   0043_fine_payment_reconciliation.sql creates tables whose FKs reference
 *   enforcement_fines(id), and 0070_performance_indexes.sql builds indexes on
 *   enforcement_fines — but enforcement_fines was only ever created by
 *   0075_enforcement_fines_canonical.sql (a historical ordering break: the
 *   earlier migrations referenced a phantom table). Per policy we never rewrite
 *   old migrations, so this runner applies 0075 BEFORE 0043/0070 on clean
 *   databases. schema_migrations rows record the real wall-clock application
 *   order, so the history remains auditable.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../drizzle/migrations");
const ADVISORY_LOCK_KEY = 0x4D494752; // "MIGR" — serializes concurrent runners

/**
 * Explicit order overrides: `before` files must be applied before `after` files
 * even though their filenames sort later. Each entry is justified above.
 */
const ORDER_OVERRIDES = [
  {
    before: "0075_enforcement_fines_canonical.sql",
    after: ["0043_fine_payment_reconciliation.sql", "0070_performance_indexes.sql"],
    reason:
      "0043/0070 reference enforcement_fines which only 0075 creates " +
      "(phantom-table ordering break; old migrations are never rewritten).",
  },
];

function resolveDatabaseUrl() {
  const url =
    process.env.DATABASE_URL ??
    process.env.NDSEP_PG_URL ??
    (process.env.PGHOST
      ? `postgresql://${process.env.PGUSER ?? "ndsep_user"}:${process.env.PGPASSWORD ?? ""}@${process.env.PGHOST}:${process.env.PGPORT ?? "5432"}/${process.env.PGDATABASE ?? "ndsep_db"}`
      : null);
  if (!url) {
    throw new Error(
      "[runRawMigrations] No database connection configured. Set DATABASE_URL (or NDSEP_PG_URL / PGHOST...)."
    );
  }
  return url;
}

function sslConfig() {
  const mode = (process.env.PGSSLMODE ?? "").toLowerCase();
  if (mode === "require" || mode === "verify-ca" || mode === "verify-full" || process.env.DATABASE_SSL === "true") {
    return { rejectUnauthorized: mode.startsWith("verify") };
  }
  return undefined;
}

/** Split SQL into statements, respecting $$...$$ dollar-quoted bodies and '...' literals. */
function splitStatements(sql) {
  const statements = [];
  let current = "";
  let i = 0;
  let inSingle = false;
  let dollarTag = null; // e.g. "$$" or "$body$"
  while (i < sql.length) {
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
      } else {
        current += sql[i++];
      }
      continue;
    }
    if (inSingle) {
      current += sql[i];
      if (sql[i] === "'") {
        if (sql[i + 1] === "'") { current += sql[i + 1]; i += 2; continue; } // escaped ''
        inSingle = false;
      }
      i++;
      continue;
    }
    const ch = sql[i];
    if (ch === "'") { inSingle = true; current += ch; i++; continue; }
    if (ch === "-" && sql[i + 1] === "-") {
      // line comment — keep (harmless) but skip to EOL
      const eol = sql.indexOf("\n", i);
      const comment = eol === -1 ? sql.slice(i) : sql.slice(i, eol);
      current += comment;
      i += comment.length;
      continue;
    }
    if (ch === "$") {
      const m = sql.slice(i).match(/^\$[A-Za-z_]*\$/);
      if (m) { dollarTag = m[0]; current += m[0]; i += m[0].length; continue; }
    }
    if (ch === ";") {
      if (current.trim()) statements.push(current);
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (current.trim()) statements.push(current);
  return statements;
}

/** Toposort filenames ascending with ORDER_OVERRIDES applied. */
function orderMigrations(files) {
  const sorted = [...files].sort();
  // Simple stable approach: repeatedly extract the lowest-sorting file whose
  // "must come after" prerequisites are already emitted.
  const mustPrecede = new Map(); // file -> Set(files that must be emitted first)
  for (const ov of ORDER_OVERRIDES) {
    for (const after of ov.after) {
      if (!mustPrecede.has(after)) mustPrecede.set(after, new Set());
      mustPrecede.get(after).add(ov.before);
    }
  }
  const emitted = new Set();
  const result = [];
  const remaining = new Set(sorted);
  while (remaining.size > 0) {
    let progressed = false;
    for (const f of sorted) {
      if (!remaining.has(f)) continue;
      const prereqs = [...(mustPrecede.get(f) ?? [])].filter((p) => remaining.has(p));
      if (prereqs.length === 0) {
        result.push(f);
        emitted.add(f);
        remaining.delete(f);
        progressed = true;
      }
    }
    if (!progressed) {
      throw new Error(`[runRawMigrations] ORDER_OVERRIDES cycle among: ${[...remaining].join(", ")}`);
    }
  }
  return result;
}

async function main() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f));
  const ordered = orderMigrations(files);

  const client = new pg.Client({ connectionString: resolveDatabaseUrl(), ssl: sslConfig() });
  await client.connect();
  console.log(`[runRawMigrations] Connected. ${ordered.length} migration files discovered.`);

  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        filename    TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        checksum    TEXT NOT NULL
      )
    `);

    const { rows } = await client.query("SELECT filename, checksum FROM public.schema_migrations");
    const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

    let appliedCount = 0;
    for (const file of ordered) {
      const full = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(full, "utf8");
      const checksum = (await import("node:crypto")).createHash("sha256").update(sql).digest("hex");

      if (applied.has(file)) {
        if (applied.get(file) !== checksum) {
          console.warn(`[runRawMigrations] WARNING: ${file} already applied but checksum changed (file edited after application?)`);
        }
        continue;
      }

      // CREATE INDEX CONCURRENTLY and CREATE EVENT TRIGGER cannot run inside a
      // transaction block — split those files into individual idempotent
      // statements executed sequentially (resumable on failure).
      const nonTransactional =
        /CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/i.test(sql) ||
        /CREATE\s+EVENT\s+TRIGGER/i.test(sql);
      console.log(`[runRawMigrations] Applying ${file}${nonTransactional ? " (non-transactional: CONCURRENTLY)" : ""} ...`);
      try {
        if (nonTransactional) {
          for (const stmt of splitStatements(sql)) {
            await client.query(stmt);
          }
        } else {
          await client.query("BEGIN");
          await client.query(sql);
          await client.query(
            "INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING",
            [file, checksum]
          );
          await client.query("COMMIT");
        }
        if (nonTransactional) {
          await client.query(
            "INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING",
            [file, checksum]
          );
        }
        appliedCount++;
      } catch (err) {
        if (!nonTransactional) await client.query("ROLLBACK").catch(() => {});
        throw new Error(`[runRawMigrations] FAILED applying ${file}: ${err.message}`);
      }
    }
    console.log(`[runRawMigrations] Done. ${appliedCount} applied, ${ordered.length - appliedCount} already up to date.`);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
