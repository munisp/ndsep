/**
 * NDSEP API Key Rotation Mechanism
 * ==================================
 * Provides API key lifecycle management:
 *   - Key generation with configurable expiry
 *   - Automatic rotation with overlap period
 *   - Key revocation
 *   - Usage tracking
 *
 * Environment:
 *   API_KEY_DEFAULT_TTL_DAYS — default key lifetime (default: 90)
 *   API_KEY_ROTATION_OVERLAP_HOURS — overlap period during rotation (default: 24)
 */

import crypto from "crypto";
import { Pool } from "pg";
import { getDatabaseUrl } from "./config";
import { getPgSslConfig } from "./dbSslConfig";
import { logger } from "./logger";

export interface ApiKey {
  id: number;
  userId: string;
  keyPrefix: string;
  keyHash: string;
  name: string;
  scopes: string[];
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

const DEFAULT_TTL_DAYS = parseInt(process.env.API_KEY_DEFAULT_TTL_DAYS ?? "90", 10);
const ROTATION_OVERLAP_HOURS = parseInt(process.env.API_KEY_ROTATION_OVERLAP_HOURS ?? "24", 10);

let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: getDatabaseUrl(), ssl: getPgSslConfig(), max: 3 });
  }
  return _pool;
}

function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  const prefix = raw.substring(0, 8);
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { key: `ndsep_${raw}`, prefix: `ndsep_${prefix}`, hash };
}

export async function createApiKey(
  userId: string,
  name: string,
  scopes: string[] = ["read"],
  ttlDays: number = DEFAULT_TTL_DAYS
): Promise<{ id: number; key: string; prefix: string; expiresAt: Date }> {
  const pool = getPool();
  const { key, prefix, hash } = generateApiKey();
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  const { rows: [row] } = await pool.query(
    `INSERT INTO api_keys (user_id, key_prefix, key_hash, name, scopes, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING id`,
    [userId, prefix, hash, name, JSON.stringify(scopes), expiresAt]
  );

  logger.info({ userId, keyPrefix: prefix, name, ttlDays }, "[ApiKey] Created new API key");
  return { id: row.id, key, prefix, expiresAt };
}

export async function rotateApiKey(
  keyId: number
): Promise<{ id: number; key: string; prefix: string; expiresAt: Date } | null> {
  const pool = getPool();

  const { rows: [existing] } = await pool.query(
    `SELECT user_id, name, scopes FROM api_keys WHERE id = $1 AND revoked_at IS NULL`,
    [keyId]
  );
  if (!existing) return null;

  // Create new key
  const newKey = await createApiKey(
    existing.user_id,
    `${existing.name} (rotated)`,
    JSON.parse(existing.scopes)
  );

  // Schedule old key expiry after overlap period
  const overlapExpiry = new Date(Date.now() + ROTATION_OVERLAP_HOURS * 60 * 60 * 1000);
  await pool.query(
    `UPDATE api_keys SET expires_at = LEAST(expires_at, $1) WHERE id = $2`,
    [overlapExpiry, keyId]
  );

  logger.info({ oldKeyId: keyId, newKeyId: newKey.id }, "[ApiKey] Key rotated with %dh overlap", ROTATION_OVERLAP_HOURS);
  return newKey;
}

export async function revokeApiKey(keyId: number): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
    [keyId]
  );
  if (rowCount && rowCount > 0) {
    logger.info({ keyId }, "[ApiKey] Key revoked");
    return true;
  }
  return false;
}

export async function validateApiKey(rawKey: string): Promise<ApiKey | null> {
  const pool = getPool();
  const hash = crypto.createHash("sha256").update(rawKey.replace(/^ndsep_/, "")).digest("hex");

  const { rows } = await pool.query(
    `SELECT id, user_id, key_prefix, key_hash, name, scopes, expires_at, last_used_at, revoked_at, created_at
     FROM api_keys
     WHERE key_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
    [hash]
  );

  if (rows.length === 0) return null;

  // Update last_used_at
  await pool.query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [rows[0].id]);

  return rows[0] as ApiKey;
}

export async function listUserKeys(userId: string): Promise<ApiKey[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, user_id, key_prefix, name, scopes, expires_at, last_used_at, revoked_at, created_at
     FROM api_keys
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows as ApiKey[];
}
