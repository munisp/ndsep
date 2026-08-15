import * as FileSystem from "expo-file-system/legacy";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import CryptoJS from "crypto-js";

const KEY_PREFIX = "audit-cache-key";
const MANIFEST_PREFIX = "audit-cache-manifest";

export type CachedAuditPackage = {
  format: "csv" | "pdf";
  fileName: string;
  mimeType: string;
  payload: string;
  updatedAt: string;
};

export type CachedAuditManifest = {
  csvPath?: string;
  pdfPath?: string;
  updatedAt: string;
};

async function ensureBiometricAccess() {
  const compatible = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!compatible || !enrolled) return false;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock offline audit cache",
    fallbackLabel: "Use device credential",
    disableDeviceFallback: false,
  });
  return result.success;
}

async function getOrCreateSecret(caseId: string) {
  const keyName = `${KEY_PREFIX}:${caseId}`;
  const existing = await SecureStore.getItemAsync(keyName, { requireAuthentication: true });
  if (existing) return existing;
  const generated = CryptoJS.lib.WordArray.random(32).toString();
  await SecureStore.setItemAsync(keyName, generated, { requireAuthentication: true, keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  return generated;
}

function getCachePath(caseId: string, format: "csv" | "pdf") {
  return `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory}${caseId}-${format}.audit.enc`;
}

export async function saveEncryptedAuditPackage(caseId: string, input: CachedAuditPackage) {
  const unlocked = await ensureBiometricAccess();
  if (!unlocked) throw new Error("Biometric authentication failed");
  const secret = await getOrCreateSecret(caseId);
  const encrypted = CryptoJS.AES.encrypt(JSON.stringify(input), secret).toString();
  const targetPath = getCachePath(caseId, input.format);
  await FileSystem.writeAsStringAsync(targetPath, encrypted, { encoding: FileSystem.EncodingType.UTF8 });
  const manifest = (await loadAuditCacheManifest(caseId)) ?? { updatedAt: input.updatedAt };
  if (input.format === "csv") manifest.csvPath = targetPath;
  if (input.format === "pdf") manifest.pdfPath = targetPath;
  manifest.updatedAt = input.updatedAt;
  await SecureStore.setItemAsync(`${MANIFEST_PREFIX}:${caseId}`, JSON.stringify(manifest));
  return manifest;
}

export async function loadAuditCacheManifest(caseId: string): Promise<CachedAuditManifest | null> {
  const raw = await SecureStore.getItemAsync(`${MANIFEST_PREFIX}:${caseId}`);
  return raw ? (JSON.parse(raw) as CachedAuditManifest) : null;
}

export async function readEncryptedAuditPackage(caseId: string, format: "csv" | "pdf") {
  const unlocked = await ensureBiometricAccess();
  if (!unlocked) throw new Error("Biometric authentication failed");
  const secret = await getOrCreateSecret(caseId);
  const path = getCachePath(caseId, format);
  const exists = await FileSystem.getInfoAsync(path);
  if (!exists.exists) return null;
  const encrypted = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.UTF8 });
  const bytes = CryptoJS.AES.decrypt(encrypted, secret);
  const payload = bytes.toString(CryptoJS.enc.Utf8);
  return payload ? (JSON.parse(payload) as CachedAuditPackage) : null;
}
