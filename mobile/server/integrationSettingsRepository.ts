import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SETTINGS_PATH = path.join(process.cwd(), "server", "data", "integration-settings.enc.json");

export const INTEGRATION_FIELDS = [
  "OIDC_ISSUER",
  "OIDC_AUDIENCE",
  "OIDC_JWKS_URL",
  "DOCLING_SERVICE_URL",
  "DOCLING_SERVICE_API_KEY",
  "NIMC_NVS_BRIDGE_URL",
  "NIMC_NVS_BRIDGE_TOKEN",
  "CAC_VAS_BRIDGE_URL",
  "CAC_VAS_BRIDGE_TOKEN",
  "STATE_REGISTRY_BRIDGE_URL",
  "STATE_REGISTRY_BRIDGE_TOKEN",
  "PAYMENT_GATEWAY_ACTIVE_PROVIDER",
  "PAYMENT_GATEWAY_PUBLIC_BASE_URL",
  "PAYSTACK_SECRET_KEY",
  "FLUTTERWAVE_WEBHOOK_SECRET_HASH",
  "FLUTTERWAVE_SECRET_KEY",
] as const;

export type IntegrationField = (typeof INTEGRATION_FIELDS)[number];
type StoredCiphertext = { iv: string; tag: string; ciphertext: string; updatedAt: string };
type StoredSettings = Partial<Record<IntegrationField, StoredCiphertext>>;

function encryptionKey() {
  const secret = process.env.INTEGRATION_SETTINGS_ENCRYPTION_KEY;
  return secret ? crypto.createHash("sha256").update(secret).digest() : null;
}

function readStore(): StoredSettings {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) as StoredSettings;
  } catch {
    return {};
  }
}

function writeStore(store: StoredSettings) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(store, null, 2));
}

function encrypt(value: string, key: Buffer): StoredCiphertext {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64"), updatedAt: new Date().toISOString() };
}

function decrypt(value: StoredCiphertext, key: Buffer) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export function getConfiguredIntegrationValue(field: IntegrationField) {
  const key = encryptionKey();
  if (key) {
    const stored = readStore()[field];
    if (stored) {
      try {
        return decrypt(stored, key);
      } catch {
        return null;
      }
    }
  }
  return process.env[field] ?? null;
}

export function getIntegrationSettingsStatus() {
  const store = readStore();
  const keyAvailable = Boolean(encryptionKey());
  return {
    secureStorageAvailable: keyAvailable,
    reason: keyAvailable ? null : "Secure save is disabled until INTEGRATION_SETTINGS_ENCRYPTION_KEY is configured on the server.",
    fields: INTEGRATION_FIELDS.map((field) => ({
      field,
      configured: Boolean(store[field] || process.env[field]),
      source: store[field] ? "encrypted_settings" : process.env[field] ? "server_environment" : "unconfigured",
      updatedAt: store[field]?.updatedAt ?? null,
    })),
  };
}

export function saveIntegrationSettings(input: Partial<Record<IntegrationField, string>>) {
  const key = encryptionKey();
  if (!key) throw new Error("Secure integration settings storage is unavailable. Configure INTEGRATION_SETTINGS_ENCRYPTION_KEY on the server first.");
  const store = readStore();
  for (const field of INTEGRATION_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value.trim()) store[field] = encrypt(value.trim(), key);
  }
  writeStore(store);
  return getIntegrationSettingsStatus();
}
