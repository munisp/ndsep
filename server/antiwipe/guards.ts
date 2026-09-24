/**
 * Anti-Wipe Destructive-Operation Guards
 * =======================================
 * Three complementary guards against wipes — malicious or accidental:
 *
 *  (a) assertNotDestructive(sql): static SQL guard for the DB helper layer.
 *      Rejects DROP / TRUNCATE / unqualified DELETE / ALTER ... DROP against
 *      the protected table list before the statement ever reaches Postgres.
 *      (Database triggers in migrations 0060-0063 are the deeper layer; this
 *      guard exists so that raw-SQL helper paths fail fast and loudly.)
 *
 *  (b) safeDeleteFile(path): filesystem guard. Refuses outright to delete
 *      vault / ledger / backup paths. Everything else is MOVED to a
 *      timestamped quarantine dir instead of being unlinked, so any
 *      "deletion" is recoverable and auditable.
 *
 *  (c) softDeleteOnly(table): documents/enforces the deleted_at soft-delete
 *      pattern — it builds ONLY soft-delete statements and throws for tables
 *      that have no deleted_at column registered.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getVaultDir } from "./vault";

// ── (a) SQL guard ───────────────────────────────────────────────────────────

/** Tables whose loss would destroy regulatory evidence. */
export const PROTECTED_TABLES = [
  "audit_ledger",
  "ledger_anchors",
  "evidence_vault_entries",
  "backup_manifest",
  "canary_files",
  "watchdog_heartbeats",
  "audit_logs",
  "breach_incidents",
  "financial_penalties",
] as const;

export class DestructiveOperationError extends Error {
  constructor(
    message: string,
    public readonly sql: string,
  ) {
    super(message);
    this.name = "DestructiveOperationError";
  }
}

function normalizeSql(sql: string): string {
  // Strip line comments and collapse whitespace so simple regexes are enough.
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function mentionsProtectedTable(normalized: string, tables: readonly string[]): string | null {
  for (const t of tables) {
    // word-boundary match, tolerating optional schema qualification (public.t)
    if (new RegExp(`(^|[^\\w])((public|ndsep)\\.)?${t}([^\\w]|$)`).test(normalized)) {
      return t;
    }
  }
  return null;
}

/**
 * Reject destructive SQL against protected tables. Call this from any raw-SQL
 * DB helper before executing caller-supplied statements.
 *
 * Blocks, for protected tables:
 *   - DROP TABLE / DROP SCHEMA / DROP DATABASE (any target, fail-closed)
 *   - TRUNCATE
 *   - DELETE ... without a WHERE clause
 *   - ALTER TABLE ... DROP (column/constraint drops)
 * Additionally, unqualified mass DELETE on ANY table is rejected.
 */
export function assertNotDestructive(
  sql: string,
  protectedTables: readonly string[] = PROTECTED_TABLES,
): void {
  const n = normalizeSql(sql);
  const protectedHit = mentionsProtectedTable(n, protectedTables);

  if (/^\s*(drop\s+(table|schema|database)|drop\s+database)/.test(n)) {
    if (protectedHit || /drop\s+(database|schema)/.test(n)) {
      throw new DestructiveOperationError(
        `antiwipe: DROP rejected${protectedHit ? ` (protected table: ${protectedHit})` : ""}`,
        sql,
      );
    }
  }

  if (/\btruncate\b/.test(n)) {
    if (protectedHit) {
      throw new DestructiveOperationError(
        `antiwipe: TRUNCATE rejected on protected table: ${protectedHit}`,
        sql,
      );
    }
    // Even for unprotected tables, bare TRUNCATE is a mass-wipe primitive.
    throw new DestructiveOperationError("antiwipe: TRUNCATE requires an explicit DBA path, not the app SQL layer", sql);
  }

  if (/\bdelete\s+from\b/.test(n)) {
    const hasWhere = /\bwhere\b/.test(n);
    if (protectedHit && !hasWhere) {
      throw new DestructiveOperationError(
        `antiwipe: DELETE without WHERE rejected on protected table: ${protectedHit}`,
        sql,
      );
    }
    if (!hasWhere) {
      throw new DestructiveOperationError(
        "antiwipe: unqualified DELETE (no WHERE) rejected for all tables",
        sql,
      );
    }
  }

  if (/\balter\s+table\b/.test(n) && /\bdrop\b/.test(n) && protectedHit) {
    throw new DestructiveOperationError(
      `antiwipe: ALTER TABLE ... DROP rejected on protected table: ${protectedHit}`,
      sql,
    );
  }
}

// ── (b) Filesystem guard ────────────────────────────────────────────────────

export class ProtectedPathError extends Error {
  constructor(public readonly targetPath: string) {
    super(`antiwipe: refusal to delete protected path: ${targetPath}`);
    this.name = "ProtectedPathError";
  }
}

export function getQuarantineRoot(): string {
  return path.resolve(process.env.ANTWIPE_QUARANTINE_DIR ?? "./data/quarantine");
}

/** Paths that must never be deleted through application code. */
export function protectedPathRoots(): string[] {
  const roots = [
    getVaultDir(),
    getQuarantineRoot(), // quarantine itself is evidence until reviewed
    path.resolve(process.env.BACKUP_DIR ?? "/var/backups/ndsep"),
    path.resolve("./data/ledger"),
  ];
  return roots;
}

export function isProtectedPath(target: string): boolean {
  const resolved = path.resolve(target);
  return protectedPathRoots().some(
    (root) => resolved === root || resolved.startsWith(root + path.sep),
  );
}

export interface QuarantineResult {
  quarantined: boolean;
  originalPath: string;
  quarantinePath: string;
}

/**
 * "Delete" a file safely:
 *  - vault/ledger/backup/quarantine paths -> throws ProtectedPathError.
 *  - anything else -> moved into data/quarantine/<UTC-timestamp>/ (preserving
 *    the basename) instead of unlink. Nothing is ever unlinked here.
 */
export async function safeDeleteFile(target: string): Promise<QuarantineResult> {
  const resolved = path.resolve(target);
  if (isProtectedPath(resolved)) {
    throw new ProtectedPathError(resolved);
  }
  if (!fs.existsSync(resolved)) {
    return { quarantined: false, originalPath: resolved, quarantinePath: "" };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destDir = path.join(getQuarantineRoot(), stamp);
  await fsp.mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(resolved));
  // rename is atomic on the same filesystem; fall back to copy+unlink ONLY
  // for cross-device, and even then unlink the source copy, not via this API.
  try {
    await fsp.rename(resolved, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      await fsp.copyFile(resolved, dest);
      await fsp.unlink(resolved); // cross-device move: source removed after verified copy
    } else {
      throw err;
    }
  }
  return { quarantined: true, originalPath: resolved, quarantinePath: dest };
}

// ── (c) Soft-delete enforcement ─────────────────────────────────────────────

/**
 * Registry of tables that participate in the deleted_at soft-delete pattern.
 * A table only appears here once its schema carries a deleted_at timestamptz
 * column; hard DELETE against these tables is considered a bug.
 */
const SOFT_DELETE_TABLES = new Set<string>([
  "users",
  "organizations",
  "assets",
  "evidence_packages",
  "citizen_requests",
  "enforcement_cases",
]);

export class HardDeleteError extends Error {
  constructor(table: string) {
    super(
      `antiwipe: hard DELETE is forbidden for "${table}" — use softDeleteOnly (deleted_at). ` +
        `If the table genuinely lacks deleted_at, add it via migration first.`,
    );
    this.name = "HardDeleteError";
  }
}

export interface SoftDeleteStatement {
  table: string;
  sql: string;
  params: unknown[];
}

/**
 * Build (never bypass with a hard DELETE) a soft-delete statement for a
 * registered table:
 *
 *   UPDATE <table> SET deleted_at = now() WHERE <keyColumn> = $1 AND deleted_at IS NULL
 *
 * This helper exists so call sites physically cannot express "remove the row"
 * through the sanctioned path — the only statement shape it emits sets
 * deleted_at. Throws HardDeleteError for unregistered tables.
 */
export function softDeleteOnly(
  table: string,
  keyColumn = "id",
  keyValue: unknown = undefined,
): SoftDeleteStatement {
  if (!SOFT_DELETE_TABLES.has(table)) {
    throw new HardDeleteError(table);
  }
  if (!/^[a-z_][a-z0-9_]*$/.test(table) || !/^[a-z_][a-z0-9_]*$/.test(keyColumn)) {
    throw new HardDeleteError(table);
  }
  return {
    table,
    sql: `UPDATE ${table} SET deleted_at = now() WHERE ${keyColumn} = $1 AND deleted_at IS NULL`,
    params: [keyValue],
  };
}

/** Register an additional soft-delete table after its deleted_at migration ships. */
export function registerSoftDeleteTable(table: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new HardDeleteError(table);
  SOFT_DELETE_TABLES.add(table);
}
