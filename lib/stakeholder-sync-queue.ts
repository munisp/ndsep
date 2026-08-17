import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { BusinessProfileRecord } from "@/lib/mobile-data";
import { createTRPCClient } from "@/lib/trpc";
import { readStakeholderSyncIndex, writeStakeholderSyncIndex, type PendingStakeholderSyncItem, type StakeholderSyncKind, type StakeholderSyncStatus } from "@/lib/stakeholder-sync-index";

export type { PendingStakeholderSyncItem, StakeholderSyncKind, StakeholderSyncStatus } from "@/lib/stakeholder-sync-index";

type StakeholderSyncPayload =
  | { kind: "profile"; profile: BusinessProfileRecord }
  | { kind: "identity_document"; type: string; fileName: string; mimeType: string; base64Data: string }
  | { kind: "business_document"; type: string; fileName: string; mimeType: string; base64Data: string };

type SealedPayload = { version: 1; nonce: string; ciphertext: string };
const KEY_KEY = "idlr_pts_mobile.stakeholder_sync.aes_key.v1";
const DIRECTORY = `${FileSystem.documentDirectory ?? ""}idlr_pts/stakeholder-sync/`;
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

async function cipherSupport() {
  const [aes, codecs] = await Promise.all([import("@noble/ciphers/aes.js"), import("@noble/ciphers/utils.js")]);
  return { gcm: aes.gcm, bytesToHex: codecs.bytesToHex, bytesToUtf8: codecs.bytesToUtf8, hexToBytes: codecs.hexToBytes, utf8ToBytes: codecs.utf8ToBytes };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function labelFor(payload: StakeholderSyncPayload) {
  if (payload.kind === "profile") return "Stakeholder profile submission";
  return payload.kind === "identity_document" ? "Identity document submission" : "Business document submission";
}

async function getEncryptionKey() {
  if (Platform.OS === "web") throw new Error("Encrypted stakeholder replay is available only in the native application.");
  const { bytesToHex, hexToBytes } = await cipherSupport();
  const existing = await SecureStore.getItemAsync(KEY_KEY);
  if (existing) return hexToBytes(existing);
  const key = Crypto.getRandomBytes(32);
  await SecureStore.setItemAsync(KEY_KEY, bytesToHex(key));
  return key;
}
async function seal(payload: StakeholderSyncPayload, aad: string): Promise<SealedPayload> {
  const { gcm, bytesToHex, utf8ToBytes } = await cipherSupport();
  const plaintext = canonicalJson(payload);
  if (utf8ToBytes(plaintext).byteLength > MAX_PAYLOAD_BYTES) throw new Error("This offline submission is too large to encrypt safely on this device.");
  const key = await getEncryptionKey();
  const nonce = Crypto.getRandomBytes(12);
  const ciphertext = gcm(key, nonce, utf8ToBytes(aad)).encrypt(utf8ToBytes(plaintext));
  return { version: 1, nonce: bytesToHex(nonce), ciphertext: bytesToHex(ciphertext) };
}
async function unseal(envelope: SealedPayload, aad: string): Promise<StakeholderSyncPayload> {
  const { gcm, bytesToUtf8, hexToBytes, utf8ToBytes } = await cipherSupport();
  if (envelope.version !== 1) throw new Error("Unsupported encrypted queue payload version.");
  const key = await getEncryptionKey();
  const plaintext = gcm(key, hexToBytes(envelope.nonce), utf8ToBytes(aad)).decrypt(hexToBytes(envelope.ciphertext));
  return JSON.parse(bytesToUtf8(plaintext)) as StakeholderSyncPayload;
}
async function setStatus(id: string, update: Partial<PendingStakeholderSyncItem>) {
  const queue = await readStakeholderSyncIndex();
  const next = queue.map((item) => item.id === id ? { ...item, ...update } : item);
  await writeStakeholderSyncIndex(next);
  return next.find((item) => item.id === id) ?? null;
}

export async function enqueueStakeholderSubmission(payload: StakeholderSyncPayload) {
  if (Platform.OS === "web") throw new Error("Offline stakeholder replay is unavailable in the browser because local encrypted key storage is not supported.");
  const id = Crypto.randomUUID();
  const idempotencyKey = Crypto.randomUUID();
  const payloadHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, canonicalJson(payload));
  await FileSystem.makeDirectoryAsync(DIRECTORY, { intermediates: true });
  const payloadPath = `${DIRECTORY}${id}.sealed`;
  const aad = `${id}|${idempotencyKey}|${payloadHash}`;
  await FileSystem.writeAsStringAsync(payloadPath, JSON.stringify(await seal(payload, aad)), { encoding: FileSystem.EncodingType.UTF8 });
  const item: PendingStakeholderSyncItem = { id, idempotencyKey, kind: payload.kind, label: labelFor(payload), queuedAt: new Date().toISOString(), status: "pending", retryCount: 0, payloadPath, payloadHash };
  await writeStakeholderSyncIndex([item, ...(await readStakeholderSyncIndex())]);
  return item;
}

export async function queueStakeholderProfile(profile: BusinessProfileRecord) { return enqueueStakeholderSubmission({ kind: "profile", profile }); }
export async function queueStakeholderDocument(kind: "identity_document" | "business_document", document: Omit<Extract<StakeholderSyncPayload, { kind: "identity_document" }> | Extract<StakeholderSyncPayload, { kind: "business_document" }>, "kind">) { return enqueueStakeholderSubmission({ kind, ...document } as StakeholderSyncPayload); }
export async function getPendingStakeholderSyncItems() { return readStakeholderSyncIndex(); }

export async function replayQueuedStakeholderSyncItem(id: string) {
  const item = (await readStakeholderSyncIndex()).find((candidate) => candidate.id === id);
  if (!item) throw new Error("The requested stakeholder synchronization item no longer exists.");
  await setStatus(id, { status: "retrying" });
  try {
    const raw = await FileSystem.readAsStringAsync(item.payloadPath, { encoding: FileSystem.EncodingType.UTF8 });
    const payload = await unseal(JSON.parse(raw) as SealedPayload, `${item.id}|${item.idempotencyKey}|${item.payloadHash}`);
    const response = await createTRPCClient().onboarding.replayStakeholderSubmission.mutate({ idempotencyKey: item.idempotencyKey, payloadHash: item.payloadHash, payload });
    await FileSystem.deleteAsync(item.payloadPath, { idempotent: true });
    await writeStakeholderSyncIndex((await readStakeholderSyncIndex()).filter((candidate) => candidate.id !== item.id));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Synchronization failed.";
    const decryptionFailure = /decrypt|cipher|encrypted|payload version/i.test(message);
    const rejected = /idempotency|invalid|reject/i.test(message);
    const retryCount = item.retryCount + 1;
    await setStatus(item.id, { retryCount, status: decryptionFailure || retryCount >= 3 ? "dead_letter" : "failed", lastErrorCode: decryptionFailure ? "payload_decryption_failed" : rejected ? "replay_rejected" : "transport_failed" });
    throw new Error(decryptionFailure ? "The encrypted payload could not be opened and was moved to dead-letter inspection." : rejected ? "The server rejected this replay and it was retained for inspection." : "The submission could not be synchronized. It remains in the queue for retry.");
  }
}
export async function replayPendingStakeholderSyncItems() {
  const queue = await readStakeholderSyncIndex();
  let replayed = 0; let failed = 0;
  for (const item of queue.filter((candidate) => candidate.status !== "dead_letter")) {
    try { await replayQueuedStakeholderSyncItem(item.id); replayed += 1; } catch { failed += 1; }
  }
  return { replayed, failed };
}
