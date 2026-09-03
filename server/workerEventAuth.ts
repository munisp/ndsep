import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const WORKER_EVENT_SIGNATURE_VERSION = "ndsep-worker-event-v1";
const MAX_EVENT_AGE_MS = 5 * 60 * 1000;
const ALLOWED_EVENT = /^[a-z][a-z0-9_.:-]{2,127}$/;
const ALLOWED_NONCE = /^[A-Za-z0-9_-]{22,128}$/;

export interface WorkerEventEnvelope {
  workerId: string;
  timestamp: string;
  nonce: string;
  signature: string;
  rawBody: Buffer;
}

export function validateWorkerEventShape(workerId: string, event: unknown, data: unknown): string | undefined {
  if (!workerId || !ALLOWED_EVENT.test(workerId)) return "invalid worker identity";
  if (typeof event !== "string" || !ALLOWED_EVENT.test(event)) return "invalid event name";
  if (data === null || typeof data !== "object" || Array.isArray(data)) return "event data must be an object";
  return undefined;
}

export function createWorkerEventSignature(secret: string, workerId: string, timestamp: string, nonce: string, rawBody: Buffer): string {
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const signed = [WORKER_EVENT_SIGNATURE_VERSION, workerId, timestamp, nonce, bodyHash].join("\n");
  return createHmac("sha256", secret).update(signed).digest("hex");
}

export function verifyWorkerEventSignature(secret: string, envelope: WorkerEventEnvelope, now = Date.now()): string | undefined {
  if (!secret || secret.length < 32) return "worker event authentication is not configured";
  if (!ALLOWED_NONCE.test(envelope.nonce)) return "invalid event nonce";
  if (!/^\d{13}$/.test(envelope.timestamp)) return "invalid event timestamp";
  const eventTime = Number(envelope.timestamp);
  if (!Number.isSafeInteger(eventTime) || Math.abs(now - eventTime) > MAX_EVENT_AGE_MS) return "event timestamp outside accepted freshness window";
  if (!/^[a-f0-9]{64}$/i.test(envelope.signature)) return "invalid event signature encoding";
  const expected = Buffer.from(createWorkerEventSignature(secret, envelope.workerId, envelope.timestamp, envelope.nonce, envelope.rawBody), "hex");
  const actual = Buffer.from(envelope.signature, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return "event signature verification failed";
  return undefined;
}

export function workerEventNonceKey(workerId: string, nonce: string): string {
  return `ndsep:worker-event:nonce:${workerId}:${nonce}`;
}

export const WORKER_EVENT_MAX_AGE_MS = MAX_EVENT_AGE_MS;
