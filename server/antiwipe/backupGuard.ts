/**
 * Anti-Wipe Backup Verification & Ransomware Canary
 * ==================================================
 * backup_manifest: every backup is registered with the SHA-256 of its dump
 * artifact (the format produced by scripts/backup-postgres.sh, which already
 * writes <dump>.sha256 sidecars). verifyBackup() re-hashes the artifact and
 * flips `verified` — a backup that cannot be re-hashed to its manifest value
 * must be treated as non-existent for restore planning.
 *
 * Canaries: writeCanary() drops small tripwire files with known content/hashes
 * into watched directories (vault, backup dir, quarantine). checkCanaries()
 * re-hashes them; a modified or missing canary is an early wipe/ransomware
 * signal and raises an alert via audit_logs + console.error (picked up by the
 * existing SIEM/Wazuh pipeline).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { q } from "./db";
import { appendLedger } from "./ledger";
import { getQuarantineRoot } from "./guards";
import { getVaultDir, sha256Hex } from "./vault";

// ── Backup manifest ─────────────────────────────────────────────────────────

export interface BackupRecord {
  backupId: string;
  type: string;
  path: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  sizeBytes: number | null;
  sha256: string | null;
  verified: boolean;
  verifiedAt: Date | null;
  notes: string | null;
}

function rowToBackup(r: Record<string, unknown>): BackupRecord {
  return {
    backupId: String(r.backup_id),
    type: String(r.type),
    path: String(r.path),
    startedAt: (r.started_at as Date) ?? null,
    finishedAt: (r.finished_at as Date) ?? null,
    sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
    sha256: (r.sha256 as string) ?? null,
    verified: Boolean(r.verified),
    verifiedAt: (r.verified_at as Date) ?? null,
    notes: (r.notes as string) ?? null,
  };
}

async function hashFile(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    let size = 0;
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      h.update(chunk);
    });
    stream.on("end", () => resolve({ sha256: h.digest("hex"), sizeBytes: size }));
    stream.on("error", reject);
  });
}

/**
 * Register a completed backup. If sha256/size are omitted they are computed
 * from the artifact at `path` (so callers can register right after pg_dump).
 * Also honours the <dump>.sha256 sidecar written by scripts/backup-postgres.sh
 * when present, cross-checking it against the computed hash.
 */
export async function registerBackup(input: {
  backupId: string;
  type?: string;
  path: string;
  startedAt?: Date;
  finishedAt?: Date;
  sizeBytes?: number;
  sha256?: string;
  notes?: string;
}): Promise<BackupRecord> {
  let { sha256, sizeBytes } = input;
  if (sha256 == null || sizeBytes == null) {
    const computed = await hashFile(input.path);
    sha256 = sha256 ?? computed.sha256;
    sizeBytes = sizeBytes ?? computed.sizeBytes;
  }
  // Cross-check the shell script's sidecar checksum when it exists.
  try {
    const sidecar = await fsp.readFile(`${input.path}.sha256`, "utf8");
    const sidecarHash = sidecar.trim().split(/\s+/)[0];
    if (sidecarHash && sidecarHash !== sha256) {
      throw new Error(
        `antiwipe: backup sidecar checksum mismatch for ${input.backupId} — refusing to register`,
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const rows = await q(
    `INSERT INTO backup_manifest
       (backup_id, type, path, started_at, finished_at, size_bytes, sha256, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (backup_id) DO NOTHING
     RETURNING *`,
    [
      input.backupId,
      input.type ?? "postgres",
      input.path,
      input.startedAt ?? null,
      input.finishedAt ?? new Date(),
      sizeBytes,
      sha256,
      input.notes ?? null,
    ],
  );
  const record = rowToBackup(
    rows.length
      ? rows[0]
      : (await q(`SELECT * FROM backup_manifest WHERE backup_id = $1`, [input.backupId]))[0],
  );
  await appendLedger(
    "backup.registered",
    { backupId: record.backupId, type: record.type, sha256: record.sha256, sizeBytes: record.sizeBytes },
    "antiwipe",
  ).catch(() => undefined); // ledger is defence-in-depth; never fail registration on it
  return record;
}

export interface BackupVerification {
  backupId: string;
  ok: boolean;
  reason?: "not_found" | "artifact_missing" | "hash_mismatch" | "size_mismatch";
  expectedHash?: string | null;
  recomputedHash?: string;
}

/** Re-hash the artifact and compare with the manifest; marks verified on success. */
export async function verifyBackup(backupId: string): Promise<BackupVerification> {
  const rows = await q(`SELECT * FROM backup_manifest WHERE backup_id = $1`, [backupId]);
  if (!rows.length) return { backupId, ok: false, reason: "not_found" };
  const record = rowToBackup(rows[0]);

  let computed: { sha256: string; sizeBytes: number };
  try {
    computed = await hashFile(record.path);
  } catch {
    return { backupId, ok: false, reason: "artifact_missing", expectedHash: record.sha256 };
  }
  if (record.sizeBytes != null && computed.sizeBytes !== record.sizeBytes) {
    return { backupId, ok: false, reason: "size_mismatch", expectedHash: record.sha256, recomputedHash: computed.sha256 };
  }
  if (record.sha256 != null && computed.sha256 !== record.sha256) {
    return { backupId, ok: false, reason: "hash_mismatch", expectedHash: record.sha256, recomputedHash: computed.sha256 };
  }

  await q(
    `UPDATE backup_manifest SET verified = true, verified_at = now(), sha256 = $2, size_bytes = $3
      WHERE backup_id = $1`,
    [backupId, computed.sha256, computed.sizeBytes],
  );
  await appendLedger(
    "backup.verified",
    { backupId, sha256: computed.sha256, sizeBytes: computed.sizeBytes },
    "antiwipe",
  ).catch(() => undefined);
  return { backupId, ok: true, recomputedHash: computed.sha256 };
}

export async function listBackups(limit = 50): Promise<BackupRecord[]> {
  const rows = await q(
    `SELECT * FROM backup_manifest ORDER BY created_at DESC LIMIT $1`,
    [Math.min(limit, 500)],
  );
  return rows.map(rowToBackup);
}

// ── Ransomware canaries ─────────────────────────────────────────────────────

/** Directories that get tripwire canaries. Configurable, vault/backup/quarantine by default. */
export function watchedDirs(): string[] {
  const env = process.env.ANTWIPE_CANARY_DIRS;
  if (env) return env.split(",").map((d) => path.resolve(d.trim())).filter(Boolean);
  return [
    getVaultDir(),
    path.resolve(process.env.BACKUP_DIR ?? "/var/backups/ndsep"),
    getQuarantineRoot(),
  ];
}

export interface CanaryRecord {
  path: string;
  sha256: string;
  directory: string;
  status: string;
}

/**
 * Drop a timestamped canary with known content into each watched dir and
 * register its hash. Canary content embeds the timestamp + a random nonce so
 * an attacker cannot precompute a "valid-looking" replacement.
 */
export async function writeCanary(dirs: string[] = watchedDirs()): Promise<CanaryRecord[]> {
  const written: CanaryRecord[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const dir of dirs) {
    await fsp.mkdir(dir, { recursive: true });
    const nonce = crypto.randomBytes(16).toString("hex");
    const content = `NDSEP ANTIWIPE CANARY — do not modify or delete.\nwritten_at=${stamp}\nnonce=${nonce}\n`;
    const filePath = path.join(dir, `.antiwipe-canary-${stamp}.txt`);
    await fsp.writeFile(filePath, content, { flag: "wx", mode: 0o444 });
    const sha256 = sha256Hex(content);
    await q(
      `INSERT INTO canary_files (path, sha256, directory)
       VALUES ($1, $2, $3)
       ON CONFLICT (path) DO UPDATE SET sha256 = EXCLUDED.sha256, status = 'ok', last_checked_at = NULL`,
      [filePath, sha256, dir],
    );
    written.push({ path: filePath, sha256, directory: dir, status: "ok" });
  }
  return written;
}

export interface CanaryCheckResult {
  total: number;
  ok: number;
  failed: Array<{ path: string; status: "modified" | "missing"; expected: string; actual: string | null }>;
}

/**
 * Re-hash every registered canary. On any modification/deletion: update its
 * status row, write an audit_logs entry, console.error (SIEM picks it up),
 * and append to the hash-chained ledger.
 */
export async function checkCanaries(): Promise<CanaryCheckResult> {
  const rows = await q<{ path: string; sha256: string }>(
    `SELECT path, sha256 FROM canary_files WHERE status <> 'disabled'`,
  );
  const failed: CanaryCheckResult["failed"] = [];
  let ok = 0;

  for (const r of rows) {
    let actual: string | null = null;
    let status: "ok" | "modified" | "missing" = "ok";
    try {
      actual = sha256Hex(await fsp.readFile(r.path));
      if (actual !== r.sha256) status = "modified";
    } catch {
      status = "missing";
    }
    await q(
      `UPDATE canary_files SET last_checked_at = now(), status = $2 WHERE path = $1`,
      [r.path, status],
    );
    if (status === "ok") {
      ok += 1;
    } else {
      failed.push({ path: r.path, status, expected: r.sha256, actual });
    }
  }

  if (failed.length > 0) {
    // Early wipe/ransomware signal — scream through every channel available.
    console.error(
      `[ANTWIPE] CANARY ALERT: ${failed.length} canary file(s) modified/missing — ` +
        `possible ransomware or wipe in progress: ${failed.map((f) => `${f.path}(${f.status})`).join(", ")}`,
    );
    await q(
      `INSERT INTO audit_logs (user_id, organization_id, action, resource_type, details, metadata)
       VALUES (NULL, NULL, 'antiwipe.canary_alert', 'canary_files', $1, $2::jsonb)`,
      [
        `Canary tripwire triggered: ${failed.length} modified/missing`,
        JSON.stringify({ failed, severity: "critical", detectedAt: new Date().toISOString() }),
      ],
    ).catch((err) => console.error("[ANTWIPE] failed to write canary alert to audit_logs:", err));
    await appendLedger(
      "antiwipe.canary_alert",
      { failed, detectedAt: new Date().toISOString() },
      "antiwipe",
    ).catch(() => undefined);
  }

  return { total: rows.length, ok, failed };
}
