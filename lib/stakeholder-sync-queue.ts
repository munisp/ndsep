import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { BusinessProfileRecord } from "@/lib/mobile-data";
import { createTRPCClient } from "@/lib/trpc";
import { readStakeholderSyncIndex, writeStakeholderSyncIndex, type PendingStakeholderSyncItem, type StakeholderSyncKind, type StakeholderSyncStatus } from "@/lib/stakeholder-sync-index";
import { validateDeadLetterEdit } from "@/lib/stakeholder-sync-validation";
import { describeStakeholderSyncFailure } from "@/lib/stakeholder-sync-error-details";
import { getNextStakeholderRetryAt, isStakeholderItemDueForAutomaticRetry } from "@/lib/stakeholder-sync-retry";
export { describeStakeholderSyncFailure } from "@/lib/stakeholder-sync-error-details";
export type { PendingStakeholderSyncItem, StakeholderSyncKind, StakeholderSyncStatus } from "@/lib/stakeholder-sync-index";

type StakeholderSyncPayload =
  | { kind: "profile"; profile: BusinessProfileRecord }
  | { kind: "identity_document"; type: string; fileName: string; mimeType: string; base64Data: string }
  | { kind: "business_document"; type: string; fileName: string; mimeType: string; base64Data: string };
export type EditableStakeholderPayload = { kind: StakeholderSyncKind; profile?: Pick<BusinessProfileRecord, "companyName" | "cacNumber" | "tinNumber" | "businessEmail" | "businessPhone" | "businessAddress" | "contactPerson">; document?: { type: string; fileName: string; mimeType: string } };
type Envelope = { version: 1; nonce: string; ciphertext: string };
const KEY_NAME = "idlr_pts_mobile.stakeholder_queue_key.v1";
const DIRECTORY = `${FileSystem.documentDirectory ?? ""}idlr-pts/stakeholder-sync/`;
const MAX_SERIALIZED_BYTES = 8 * 1024 * 1024;
const label = (kind: StakeholderSyncKind) => kind === "profile" ? "Stakeholder profile submission" : kind === "identity_document" ? "Identity document submission" : "Business document submission";

async function cipher() { const [aes, codecs] = await Promise.all([import("@noble/ciphers/aes.js"), import("@noble/ciphers/utils.js")]); return { ...aes, ...codecs }; }
async function key() { if (Platform.OS === "web") throw new Error("Encrypted queue operations are available only in the native application."); const c = await cipher(); const stored = await SecureStore.getItemAsync(KEY_NAME); if (stored) return c.hexToBytes(stored); const generated = Crypto.getRandomBytes(32); await SecureStore.setItemAsync(KEY_NAME, c.bytesToHex(generated)); return generated; }
async function seal(payload: StakeholderSyncPayload, aad: string): Promise<Envelope> { const c = await cipher(); const plaintext = JSON.stringify(payload); if (c.utf8ToBytes(plaintext).byteLength > MAX_SERIALIZED_BYTES) throw new Error("This offline submission is too large to store securely on this device."); const nonce = Crypto.getRandomBytes(12); return { version: 1, nonce: c.bytesToHex(nonce), ciphertext: c.bytesToHex(c.gcm(await key(), nonce, c.utf8ToBytes(aad)).encrypt(c.utf8ToBytes(plaintext))) }; }
async function unseal(envelope: Envelope, aad: string): Promise<StakeholderSyncPayload> { if (envelope.version !== 1) throw new Error("Unsupported encrypted queue format."); const c = await cipher(); const bytes = c.gcm(await key(), c.hexToBytes(envelope.nonce), c.utf8ToBytes(aad)).decrypt(c.hexToBytes(envelope.ciphertext)); return JSON.parse(c.bytesToUtf8(bytes)) as StakeholderSyncPayload; }
async function loadPayload(item: PendingStakeholderSyncItem) { const raw = await FileSystem.readAsStringAsync(item.payloadPath, { encoding: FileSystem.EncodingType.UTF8 }); return unseal(JSON.parse(raw) as Envelope, `${item.id}|${item.idempotencyKey}`); }
async function replaceItem(id: string, update: Partial<PendingStakeholderSyncItem>) { const items = await readStakeholderSyncIndex(); const next = items.map((item) => item.id === id ? { ...item, ...update } : item); await writeStakeholderSyncIndex(next); return next.find((item) => item.id === id); }

export async function enqueueStakeholderSubmission(payload: StakeholderSyncPayload) {
  if (Platform.OS === "web") throw new Error("Offline encrypted stakeholder submissions are unavailable in the browser.");
  const id = Crypto.randomUUID(); const idempotencyKey = Crypto.randomUUID(); const payloadPath = `${DIRECTORY}${id}.sealed`;
  await FileSystem.makeDirectoryAsync(DIRECTORY, { intermediates: true });
  await FileSystem.writeAsStringAsync(payloadPath, JSON.stringify(await seal(payload, `${id}|${idempotencyKey}`)), { encoding: FileSystem.EncodingType.UTF8 });
  const item: PendingStakeholderSyncItem = { id, idempotencyKey, kind: payload.kind, label: label(payload.kind), queuedAt: new Date().toISOString(), status: "pending", retryCount: 0, payloadPath };
  await writeStakeholderSyncIndex([item, ...(await readStakeholderSyncIndex())]); return item;
}
export async function getPendingStakeholderSyncItems() { return readStakeholderSyncIndex(); }
export async function getDeadLetterForEditing(id: string): Promise<EditableStakeholderPayload> { const item = (await readStakeholderSyncIndex()).find((entry) => entry.id === id); if (!item || item.status !== "dead_letter") throw new Error("Only quarantined dead-letter items can be edited."); const payload = await loadPayload(item); return payload.kind === "profile" ? { kind: payload.kind, profile: { companyName: payload.profile.companyName, cacNumber: payload.profile.cacNumber, tinNumber: payload.profile.tinNumber, businessEmail: payload.profile.businessEmail, businessPhone: payload.profile.businessPhone, businessAddress: payload.profile.businessAddress, contactPerson: payload.profile.contactPerson } } : { kind: payload.kind, document: { type: payload.type, fileName: payload.fileName, mimeType: payload.mimeType } }; }
export async function updateDeadLetterForRetry(id: string, edit: EditableStakeholderPayload) {
  const validationErrors = validateDeadLetterEdit(edit); if (Object.keys(validationErrors).length > 0) throw new Error(Object.values(validationErrors)[0]);
  const item = (await readStakeholderSyncIndex()).find((entry) => entry.id === id); if (!item || item.status !== "dead_letter") throw new Error("Only quarantined dead-letter items can be edited."); const existing = await loadPayload(item); let payload: StakeholderSyncPayload;
  if (existing.kind === "profile" && edit.profile) payload = { kind: "profile", profile: { ...existing.profile, ...edit.profile } };
  else if (existing.kind !== "profile" && edit.document) payload = { ...existing, ...edit.document };
  else throw new Error("The edited data does not match the quarantined submission type.");
  const idempotencyKey = Crypto.randomUUID(); await FileSystem.writeAsStringAsync(item.payloadPath, JSON.stringify(await seal(payload, `${item.id}|${idempotencyKey}`)), { encoding: FileSystem.EncodingType.UTF8 });
  await replaceItem(item.id, { idempotencyKey, status: "failed", retryCount: 0, nextRetryAt: undefined, lastErrorCode: undefined, lastErrorMessage: undefined });
}
export async function retryStakeholderSyncItem(id: string) {
  const item = (await readStakeholderSyncIndex()).find((entry) => entry.id === id); if (!item) throw new Error("Queue item not found."); await replaceItem(id, { status: "retrying" });
  try { const payload = await loadPayload(item); const result = await createTRPCClient().onboarding.replayStakeholderSubmission.mutate({ idempotencyKey: item.idempotencyKey, payload }); await FileSystem.deleteAsync(item.payloadPath, { idempotent: true }); await writeStakeholderSyncIndex((await readStakeholderSyncIndex()).filter((entry) => entry.id !== id)); return result; }
  catch (error) { const message = error instanceof Error ? error.message : String(error); const nextRetry = item.retryCount + 1; const decryptFailed = /decrypt|cipher|key|encrypted/i.test(message); const deadLetter = decryptFailed || nextRetry >= 3; await replaceItem(id, { retryCount: nextRetry, status: deadLetter ? "dead_letter" : "failed", nextRetryAt: deadLetter ? undefined : getNextStakeholderRetryAt(nextRetry), lastErrorCode: decryptFailed ? "payload_decryption_failed" : /idempotency|invalid|reject/i.test(message) ? "replay_rejected" : "transport_failed", lastErrorMessage: message.slice(0, 280) }); throw error; }
}
let automaticReplayInFlight = false;
export async function replayPendingStakeholderSyncItems() {
  if (automaticReplayInFlight) return { synchronized: 0, failed: 0 };
  automaticReplayInFlight = true;
  try {
    const candidates = (await readStakeholderSyncIndex()).filter((item) => isStakeholderItemDueForAutomaticRetry(item)); let synchronized = 0; let failed = 0;
    for (const item of candidates) { try { await retryStakeholderSyncItem(item.id); synchronized += 1; } catch { failed += 1; } }
    return { synchronized, failed };
  } finally { automaticReplayInFlight = false; }
}
export async function retryAllRecoverableStakeholderSyncItems() {
  const candidates = (await readStakeholderSyncIndex()).filter((item) => item.status === "failed"); let synchronized = 0; let failed = 0;
  for (const item of candidates) { try { await retryStakeholderSyncItem(item.id); synchronized += 1; } catch { failed += 1; } }
  return { attempted: candidates.length, synchronized, failed };
}
