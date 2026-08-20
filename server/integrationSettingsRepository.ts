import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { recordIntegrationSettingsSaved } from "./securityOperations";

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
  "INTEGRATION_EXECUTION_MODE",
  "WAF_TELEMETRY_URL",
  "WAF_TELEMETRY_BEARER_TOKEN",
  "SECURITY_TELEMETRY_ALLOWED_HOSTS",
  "SIEM_CORRELATION_URL_TEMPLATE",
  "KEYCLOAK_ADMIN_BASE_URL",
  "KEYCLOAK_ADMIN_REALM",
  "KEYCLOAK_ADMIN_CLIENT_ID",
  "KEYCLOAK_ADMIN_CLIENT_SECRET",
  "KEYCLOAK_ADMIN_ALLOWED_HOSTS",
] as const;

export type IntegrationField = (typeof INTEGRATION_FIELDS)[number];
export type IntegrationExecutionMode = "staging" | "simulation";
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
    executionMode: getIntegrationExecutionMode(),
    simulationAllowed: isSimulationModeAllowed(),
  };
}

export function isSimulationModeAllowed(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV !== "production" && env.ENABLE_DEVELOPMENT_PROVIDER_EMULATORS === "true";
}

export function getIntegrationExecutionMode(): IntegrationExecutionMode {
  return getConfiguredIntegrationValue("INTEGRATION_EXECUTION_MODE") === "simulation" ? "simulation" : "staging";
}

export function saveIntegrationSettings(input: Partial<Record<IntegrationField, string>>, actor = "unknown-administrator") {
  const key = encryptionKey();
  if (!key) throw new Error("Secure integration settings storage is unavailable. Configure INTEGRATION_SETTINGS_ENCRYPTION_KEY on the server first.");
  if (input.INTEGRATION_EXECUTION_MODE === "simulation" && !isSimulationModeAllowed()) {
    throw new Error("Simulation mode is permitted only in non-production environments with ENABLE_DEVELOPMENT_PROVIDER_EMULATORS=true. Production integrations remain fail closed.");
  }
  if (input.INTEGRATION_EXECUTION_MODE && input.INTEGRATION_EXECUTION_MODE !== "simulation" && input.INTEGRATION_EXECUTION_MODE !== "staging") {
    throw new Error("Integration execution mode must be either staging or simulation.");
  }
  const store = readStore();
  for (const field of INTEGRATION_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value.trim()) store[field] = encrypt(value.trim(), key);
  }
  writeStore(store);
  recordIntegrationSettingsSaved({ actor, configuredFields: Object.entries(input).filter(([, value]) => typeof value === "string" && value.trim()).map(([field]) => field) });
  return getIntegrationSettingsStatus();
}
