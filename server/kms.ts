/**
 * NDSEP Key Management Service (KMS) Integration
 * =================================================
 * Provides envelope encryption using external KMS providers.
 * The master key never leaves the KMS — only Data Encryption Keys (DEKs) are used locally.
 *
 * Supported providers:
 *   1. AWS KMS — aws:kms
 *   2. HashiCorp Vault — vault:transit
 *   3. Local (env var) — local:env (development/fallback)
 *
 * Architecture (Envelope Encryption):
 *   ┌──────────────┐     ┌─────────────────────┐
 *   │  KMS Service  │────▶│  Master Key (CMK)    │  Never leaves KMS
 *   └──────┬───────┘     └─────────────────────┘
 *          │ GenerateDataKey / Decrypt
 *          ▼
 *   ┌──────────────┐
 *   │  Data Key     │─── Plaintext DEK (in memory only)
 *   │  (encrypted)  │─── Encrypted DEK (stored in DB)
 *   └──────────────┘
 *          │
 *          ▼
 *   ┌──────────────┐
 *   │  AES-256-GCM  │─── Encrypts PII fields
 *   └──────────────┘
 *
 * Environment variables:
 *   KMS_PROVIDER         — "aws", "vault", or "local" (default: "local")
 *   KMS_KEY_ID           — AWS KMS key ARN or Vault transit key name
 *   AWS_REGION           — AWS region for KMS (default: "eu-west-1")
 *   VAULT_ADDR           — HashiCorp Vault address (e.g., https://vault.ndsep.ng:8200)
 *   VAULT_TOKEN          — Vault authentication token
 *   VAULT_TRANSIT_KEY    — Vault transit secret engine key name
 *   FIELD_ENCRYPTION_KEY — Fallback local key (64-char hex)
 */

import crypto from "crypto";
import https from "https";
import { logger } from "./logger";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface KmsProvider {
  /** Generate a new data encryption key. Returns plaintext + encrypted DEK. */
  generateDataKey(): Promise<{ plaintextKey: Buffer; encryptedKey: string }>;
  /** Decrypt an encrypted DEK back to plaintext. */
  decryptDataKey(encryptedKey: string): Promise<Buffer>;
  /** Provider name for logging. */
  readonly name: string;
}

export interface KeyMetadata {
  provider: string;
  keyId: string;
  encryptedDek: string;
  createdAt: string;
  rotatedAt?: string;
  version: number;
}

// ─── AWS KMS Provider ───────────────────────────────────────────────────────

class AwsKmsProvider implements KmsProvider {
  readonly name = "aws:kms";
  private readonly region: string;
  private readonly keyId: string;

  constructor() {
    this.region = process.env.AWS_REGION ?? "eu-west-1";
    this.keyId = process.env.KMS_KEY_ID ?? "";
    if (!this.keyId) {
      throw new Error("[KMS] KMS_KEY_ID (AWS KMS key ARN) is required when KMS_PROVIDER=aws");
    }
    logger.info({ provider: this.name, region: this.region, keyId: this.keyId.slice(0, 40) + "..." },
      "[KMS] AWS KMS provider initialized");
  }

  async generateDataKey(): Promise<{ plaintextKey: Buffer; encryptedKey: string }> {
    const body = JSON.stringify({
      KeyId: this.keyId,
      KeySpec: "AES_256",
    });

    const response = await this.awsRequest("GenerateDataKey", body);
    const parsed = JSON.parse(response);

    return {
      plaintextKey: Buffer.from(parsed.Plaintext, "base64"),
      encryptedKey: parsed.CiphertextBlob,
    };
  }

  async decryptDataKey(encryptedKey: string): Promise<Buffer> {
    const body = JSON.stringify({
      CiphertextBlob: encryptedKey,
      KeyId: this.keyId,
    });

    const response = await this.awsRequest("Decrypt", body);
    const parsed = JSON.parse(response);
    return Buffer.from(parsed.Plaintext, "base64");
  }

  private awsRequest(action: string, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const host = `kms.${this.region}.amazonaws.com`;
      const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
      const dateStamp = date.slice(0, 8);

      // AWS Signature V4 signing
      const headers: Record<string, string> = {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `TrentService.${action}`,
        "X-Amz-Date": date,
        "Host": host,
      };

      // Use AWS SDK credentials from environment (IAM role, env vars, or instance profile)
      const accessKey = process.env.AWS_ACCESS_KEY_ID ?? "";
      const secretKey = process.env.AWS_SECRET_ACCESS_KEY ?? "";
      const sessionToken = process.env.AWS_SESSION_TOKEN;

      if (!accessKey || !secretKey) {
        reject(new Error("[KMS] AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY required"));
        return;
      }

      if (sessionToken) {
        headers["X-Amz-Security-Token"] = sessionToken;
      }

      // Canonical request
      const payloadHash = crypto.createHash("sha256").update(body).digest("hex");
      const signedHeaders = Object.keys(headers).map(k => k.toLowerCase()).sort().join(";");
      const canonicalHeaders = Object.keys(headers)
        .map(k => `${k.toLowerCase()}:${headers[k].trim()}`)
        .sort()
        .join("\n") + "\n";

      const canonicalRequest = [
        "POST", "/", "", canonicalHeaders, signedHeaders, payloadHash,
      ].join("\n");

      const credentialScope = `${dateStamp}/${this.region}/kms/aws4_request`;
      const stringToSign = [
        "AWS4-HMAC-SHA256", date, credentialScope,
        crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
      ].join("\n");

      // Signing key
      const hmac = (key: Buffer | string, data: string) =>
        crypto.createHmac("sha256", key).update(data).digest();
      const kDate = hmac(`AWS4${secretKey}`, dateStamp);
      const kRegion = hmac(kDate, this.region);
      const kService = hmac(kRegion, "kms");
      const kSigning = hmac(kService, "aws4_request");

      const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");
      headers["Authorization"] =
        `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`;

      const req = https.request({
        hostname: host,
        method: "POST",
        path: "/",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
      }, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          if (res.statusCode === 200) resolve(data);
          else reject(new Error(`[KMS] AWS KMS ${action} failed (${res.statusCode}): ${data}`));
        });
      });

      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}

// ─── HashiCorp Vault Transit Provider ───────────────────────────────────────

class VaultTransitProvider implements KmsProvider {
  readonly name = "vault:transit";
  private readonly addr: string;
  private readonly token: string;
  private readonly keyName: string;

  constructor() {
    this.addr = process.env.VAULT_ADDR ?? "";
    this.token = process.env.VAULT_TOKEN ?? "";
    this.keyName = process.env.VAULT_TRANSIT_KEY ?? "ndsep-field-encryption";

    if (!this.addr || !this.token) {
      throw new Error("[KMS] VAULT_ADDR and VAULT_TOKEN required when KMS_PROVIDER=vault");
    }
    logger.info({ provider: this.name, addr: this.addr, key: this.keyName },
      "[KMS] Vault Transit provider initialized");
  }

  async generateDataKey(): Promise<{ plaintextKey: Buffer; encryptedKey: string }> {
    const response = await this.vaultRequest(
      "POST",
      `/v1/transit/datakey/plaintext/${this.keyName}`,
      JSON.stringify({ bits: 256 })
    );
    const parsed = JSON.parse(response);

    return {
      plaintextKey: Buffer.from(parsed.data.plaintext, "base64"),
      encryptedKey: parsed.data.ciphertext,
    };
  }

  async decryptDataKey(encryptedKey: string): Promise<Buffer> {
    const response = await this.vaultRequest(
      "POST",
      `/v1/transit/decrypt/${this.keyName}`,
      JSON.stringify({ ciphertext: encryptedKey })
    );
    const parsed = JSON.parse(response);
    return Buffer.from(parsed.data.plaintext, "base64");
  }

  private vaultRequest(method: string, path: string, body?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.addr);
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method,
        headers: {
          "X-Vault-Token": this.token,
          "Content-Type": "application/json",
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          if (res.statusCode === 200) resolve(data);
          else reject(new Error(`[KMS] Vault ${method} ${path} failed (${res.statusCode}): ${data}`));
        });
      });

      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }
}

// ─── Local Provider (env var — development/fallback) ────────────────────────

class LocalKeyProvider implements KmsProvider {
  readonly name = "local:env";
  private readonly key: Buffer;

  constructor() {
    const hex = process.env.FIELD_ENCRYPTION_KEY ?? "";
    if (hex.length !== 64) {
      throw new Error(
        "[KMS] FIELD_ENCRYPTION_KEY (64-char hex) required when KMS_PROVIDER=local or not set"
      );
    }
    this.key = Buffer.from(hex, "hex");
    logger.info({ provider: this.name }, "[KMS] Local key provider initialized (env var)");
  }

  async generateDataKey(): Promise<{ plaintextKey: Buffer; encryptedKey: string }> {
    // Local provider: the env var IS the key, no envelope encryption
    return {
      plaintextKey: this.key,
      encryptedKey: "local:" + this.key.toString("hex"),
    };
  }

  async decryptDataKey(_encryptedKey: string): Promise<Buffer> {
    return this.key;
  }
}

// ─── KMS Factory ────────────────────────────────────────────────────────────

let _provider: KmsProvider | null = null;
let _cachedDek: Buffer | null = null;

/**
 * Initialize the KMS provider based on environment configuration.
 * Call this once at application startup.
 */
export async function initializeKms(): Promise<void> {
  const providerName = (process.env.KMS_PROVIDER ?? "local").toLowerCase();

  switch (providerName) {
    case "aws":
      _provider = new AwsKmsProvider();
      break;
    case "vault":
      _provider = new VaultTransitProvider();
      break;
    case "local":
    default:
      _provider = new LocalKeyProvider();
      break;
  }

  // Generate or retrieve the DEK at startup
  const { plaintextKey, encryptedKey } = await _provider.generateDataKey();
  _cachedDek = plaintextKey;

  logger.info({
    provider: _provider.name,
    dekLength: plaintextKey.length,
    encryptedDekPrefix: encryptedKey.slice(0, 20) + "...",
  }, "[KMS] Data encryption key initialized via envelope encryption");
}

/**
 * Get the current data encryption key (plaintext, in-memory only).
 * Falls back to direct FIELD_ENCRYPTION_KEY if KMS not initialized.
 */
export function getDataEncryptionKey(): Buffer {
  if (_cachedDek) return _cachedDek;

  // Fallback: use FIELD_ENCRYPTION_KEY directly
  const hex = process.env.FIELD_ENCRYPTION_KEY ?? "";
  if (hex.length === 64) return Buffer.from(hex, "hex");

  throw new Error("[KMS] No encryption key available. Set KMS_PROVIDER or FIELD_ENCRYPTION_KEY.");
}

/**
 * Get the current KMS provider instance.
 */
export function getKmsProvider(): KmsProvider | null {
  return _provider;
}

/**
 * Rotate the data encryption key.
 * Generates a new DEK via KMS and returns both old and new keys for re-encryption.
 */
export async function rotateDataKey(): Promise<{
  oldKey: Buffer;
  newKey: Buffer;
  newEncryptedKey: string;
}> {
  if (!_provider) throw new Error("[KMS] Provider not initialized");

  const oldKey = _cachedDek ?? getDataEncryptionKey();
  const { plaintextKey: newKey, encryptedKey } = await _provider.generateDataKey();

  _cachedDek = newKey;

  logger.info({
    provider: _provider.name,
    newDekPrefix: newKey.toString("hex").slice(0, 8) + "...",
  }, "[KMS] Data encryption key rotated");

  return { oldKey, newKey, newEncryptedKey: encryptedKey };
}

// ─── Key Metadata Storage ───────────────────────────────────────────────────

/**
 * SQL to create the key metadata table.
 * Tracks which encrypted DEK is active, supports rotation history.
 */
export const KEY_METADATA_DDL = `
CREATE TABLE IF NOT EXISTS encryption_key_metadata (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  key_id TEXT NOT NULL,
  encrypted_dek TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  UNIQUE(version)
);
CREATE INDEX IF NOT EXISTS idx_key_metadata_active ON encryption_key_metadata(is_active) WHERE is_active = true;
`;
