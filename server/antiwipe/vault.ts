/**
 * Anti-Wipe Append-Only Evidence Vault
 * =====================================
 * Write-once, content-addressed store for evidence files and their metadata.
 *
 * Design guarantees:
 *  - Content addressing: the SHA-256 of the bytes IS the primary key, so any
 *    post-write modification of the file is detectable by re-hashing.
 *  - Directory-per-day layout (vault/YYYY-MM-DD/<hash>) keeps directories
 *    small and lets infra teams apply day-granularity WORM/object-lock rules.
 *  - The API surface physically lacks mutation: there is deliberately NO
 *    update/remove/expunge export. The only permitted state transition is
 *    one-way sealing (sealed: false -> true), which is also enforced by a
 *    database trigger (see drizzle/migrations/0060_antiwipe_evidence_vault.sql).
 *  - DELETE on the metadata table is blocked by trigger; the filesystem guard
 *    (server/antiwipe/guards.ts#safeDeleteFile) refuses to delete vault paths.
 *
 * App-level controls complement — not replace — infrastructure immutability
 * (chattr +i, S3 Object Lock, WORM storage). See docs/runbooks/antiwipe-protection.md.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { q } from "./db";

export interface VaultEntry {
  hash: string;
  path: string;
  sizeBytes: number;
  contentType: string | null;
  uploaderId: number | null;
  uploaderName: string | null;
  caseRef: string | null;
  sealed: boolean;
  sealedAt: Date | null;
  createdAt: Date;
}

export interface VaultVerification {
  hash: string;
  ok: boolean;
  reason?: "missing_file" | "hash_mismatch" | "size_mismatch" | "missing_metadata";
  sizeBytes?: number;
  expectedSize?: number;
  recomputedHash?: string;
  sealed: boolean;
}

export function getVaultDir(): string {
  return path.resolve(process.env.EVIDENCE_VAULT_DIR ?? "./data/vault");
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function dayDir(date = new Date()): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/** Vault-relative path for a hash written on a given day. */
export function vaultRelativePath(hash: string, date = new Date()): string {
  return path.posix.join(dayDir(date), hash);
}

function rowToEntry(r: Record<string, unknown>): VaultEntry {
  return {
    hash: String(r.hash),
    path: String(r.path),
    sizeBytes: Number(r.size_bytes),
    contentType: (r.content_type as string) ?? null,
    uploaderId: r.uploader_id == null ? null : Number(r.uploader_id),
    uploaderName: (r.uploader_name as string) ?? null,
    caseRef: (r.case_ref as string) ?? null,
    sealed: Boolean(r.sealed),
    sealedAt: (r.sealed_at as Date) ?? null,
    createdAt: r.created_at as Date,
  };
}

/**
 * Store evidence bytes in the vault. Write-once: if the same content was
 * already stored, the existing entry is returned unchanged (idempotent
 * dedupe) — bytes are never overwritten.
 */
export async function putEvidence(
  content: Buffer,
  meta: {
    uploaderId?: number | null;
    uploaderName?: string | null;
    caseRef?: string | null;
    contentType?: string | null;
  } = {},
): Promise<{ entry: VaultEntry; deduplicated: boolean }> {
  const hash = sha256Hex(content);
  const rel = vaultRelativePath(hash);
  const abs = path.join(getVaultDir(), rel);

  await fsp.mkdir(path.dirname(abs), { recursive: true });

  let deduplicated = false;
  if (fs.existsSync(abs)) {
    // Write-once: never overwrite. Confirm the on-disk bytes really match the
    // content address before treating this as a dedupe hit.
    const onDisk = await fsp.readFile(abs);
    if (sha256Hex(onDisk) !== hash) {
      throw new Error(
        `antiwipe vault: on-disk content at ${rel} does not match its content address — possible tampering`,
      );
    }
    deduplicated = true;
  } else {
    // O_EXCL: fail rather than overwrite if a racer created the file.
    await fsp.writeFile(abs, content, { flag: "wx", mode: 0o440 });
  }

  const rows = await q(
    `INSERT INTO evidence_vault_entries
       (hash, path, size_bytes, content_type, uploader_id, uploader_name, case_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (hash) DO NOTHING
     RETURNING *`,
    [
      hash,
      rel,
      content.length,
      meta.contentType ?? null,
      meta.uploaderId ?? null,
      meta.uploaderName ?? null,
      meta.caseRef ?? null,
    ],
  );

  if (rows.length > 0) {
    return { entry: rowToEntry(rows[0]), deduplicated };
  }
  const existing = await getEvidenceMeta(hash);
  if (!existing) {
    throw new Error("antiwipe vault: metadata insert raced and row is unreadable");
  }
  return { entry: existing, deduplicated: true };
}

/** Read evidence bytes by hash. Read-only; never mutates. */
export async function getEvidence(
  hash: string,
): Promise<{ entry: VaultEntry; content: Buffer } | null> {
  const entry = await getEvidenceMeta(hash);
  if (!entry) return null;
  const abs = path.join(getVaultDir(), entry.path);
  try {
    const content = await fsp.readFile(abs);
    return { entry, content };
  } catch {
    return null;
  }
}

export async function getEvidenceMeta(hash: string): Promise<VaultEntry | null> {
  const rows = await q(`SELECT * FROM evidence_vault_entries WHERE hash = $1`, [hash]);
  return rows.length ? rowToEntry(rows[0]) : null;
}

export async function listEvidence(options: {
  caseRef?: string;
  sealed?: boolean;
  limit?: number;
  offset?: number;
} = {}): Promise<{ entries: VaultEntry[]; total: number }> {
  const limit = Math.min(options.limit ?? 50, 500);
  const offset = options.offset ?? 0;
  const rows = await q(
    `SELECT * FROM evidence_vault_entries
     WHERE ($1::text IS NULL OR case_ref = $1)
       AND ($2::boolean IS NULL OR sealed = $2)
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [options.caseRef ?? null, options.sealed ?? null, limit, offset],
  );
  const count = await q<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM evidence_vault_entries
     WHERE ($1::text IS NULL OR case_ref = $1)
       AND ($2::boolean IS NULL OR sealed = $2)`,
    [options.caseRef ?? null, options.sealed ?? null],
  );
  return {
    entries: rows.map(rowToEntry),
    total: parseInt(count[0]?.count ?? "0", 10),
  };
}

/**
 * Integrity verification: recompute the SHA-256 of the on-disk bytes and
 * compare against the content address + recorded size. This is the core
 * tamper-evidence check and is what the watchdog runs continuously.
 */
export async function verifyEvidence(hash: string): Promise<VaultVerification> {
  const entry = await getEvidenceMeta(hash);
  if (!entry) {
    return { hash, ok: false, reason: "missing_metadata", sealed: false };
  }
  const abs = path.join(getVaultDir(), entry.path);
  let content: Buffer;
  try {
    content = await fsp.readFile(abs);
  } catch {
    return { hash, ok: false, reason: "missing_file", sealed: entry.sealed };
  }
  if (content.length !== entry.sizeBytes) {
    return {
      hash,
      ok: false,
      reason: "size_mismatch",
      sizeBytes: content.length,
      expectedSize: entry.sizeBytes,
      sealed: entry.sealed,
    };
  }
  const recomputed = sha256Hex(content);
  if (recomputed !== entry.hash) {
    return {
      hash,
      ok: false,
      reason: "hash_mismatch",
      recomputedHash: recomputed,
      sealed: entry.sealed,
    };
  }
  return { hash, ok: true, sizeBytes: content.length, sealed: entry.sealed };
}

/** Verify the N most recent vault entries (used by router + watchdog flows). */
export async function verifyRecentEvidence(limit = 25): Promise<{
  checked: number;
  failures: VaultVerification[];
}> {
  const rows = await q<{ hash: string }>(
    `SELECT hash FROM evidence_vault_entries ORDER BY created_at DESC LIMIT $1`,
    [Math.min(limit, 1000)],
  );
  const failures: VaultVerification[] = [];
  for (const r of rows) {
    const v = await verifyEvidence(r.hash);
    if (!v.ok) failures.push(v);
  }
  return { checked: rows.length, failures };
}

/**
 * One-way seal: marks an entry as legally sealed (e.g. after case closure).
 * Irreversible by design — the DB trigger permits only false -> true and
 * freezes every content-identity column.
 */
export async function sealEvidence(hash: string): Promise<VaultEntry | null> {
  const rows = await q(
    `UPDATE evidence_vault_entries
        SET sealed = true, sealed_at = now()
      WHERE hash = $1 AND sealed = false
      RETURNING *`,
    [hash],
  );
  if (rows.length) return rowToEntry(rows[0]);
  return getEvidenceMeta(hash); // already sealed or missing
}

// ────────────────────────────────────────────────────────────────────────────
// NOTE: Intentionally NO updateEvidence / deleteEvidence / purgeVault exports.
// The vault is append-only at the API level; retention/disposal is an
// infrastructure-level, break-glass operation documented in the runbook.
// ────────────────────────────────────────────────────────────────────────────
