/**
 * offlineSync.ts — Minimal offline mutation queue for field-inspection evidence.
 *
 * PURPOSE
 *   Field inspectors capture evidence (photos, notes, observations) where
 *   connectivity is unreliable. This module persists those mutations to
 *   AsyncStorage and replays them against the NDSEP server's batch sync API
 *   (`fieldInspection.syncBatch`, server/routers/fieldInspection.ts) with
 *   retry-and-backoff once connectivity returns.
 *
 * DESIGN
 *   - Queue is append-only JSON in AsyncStorage (key below), FIFO on replay.
 *   - Items are grouped per inspection case and flushed through the server's
 *     idempotent `syncBatch` endpoint (upsert keyed by client-generated
 *     `evidence_uuid`, last-write-wins with version-vector merge), so replays
 *     are safe to repeat after partial failure.
 *   - Retry uses exponential backoff (1s → 2s → 4s … capped at 5 min) with
 *     per-item attempt counters; items exceeding MAX_ATTEMPTS are moved to a
 *     dead-letter key for operator review instead of being silently dropped.
 *   - The flush is called from `replayQueuedFieldMutations`
 *     (lib/mobile-sync-replay.ts), which already runs on reconnect and from
 *     the registered background task (lib/background-sync.ts), so no extra
 *     scheduler is needed.
 *
 * USAGE
 *   await queueInspectionEvidence({ caseUuid, evidenceUuid, evidenceType: "photo", ... });
 *   const result = await flushInspectionQueue(); // { synced, failed, deadLettered }
 *
 * NOTE
 *   This queue targets the deployed NDSEP API (see constants/oauth
 *   getApiBaseUrl), not the template's bundled demo server. The tRPC client
 *   is intentionally untyped (`createTRPCUntypedClient`) because the mobile
 *   workspace's typed AppRouter is the template server, which does not
 *   expose the fieldInspection router.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createTRPCUntypedClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";

import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "@/lib/_core/auth";

export type InspectionEvidenceType = "photo" | "document" | "interview_note" | "observation" | "screenshot";

export type QueuedInspectionEvidence = {
  /** Client-generated UUID — idempotency key for the server upsert. */
  evidenceUuid: string;
  /** UUID of the inspection case this evidence belongs to. */
  caseUuid: string;
  evidenceType: InspectionEvidenceType;
  payload?: Record<string, unknown>;
  capturedAt?: string;
  clientUpdatedAt: string;
  versionVector?: Record<string, number>;
  deleted: boolean;
  /** Device identifier sent as client_device_id for conflict attribution. */
  deviceId: string;
  queuedAt: string;
  attempts: number;
  /** Epoch ms after which the next replay attempt is allowed (backoff). */
  notBefore: number;
};

export type FlushResult = { synced: number; failed: number; deadLettered: number; remaining: number };

const QUEUE_KEY = "ndsep_mobile.inspection_sync_queue.v1";
const DEAD_LETTER_KEY = "ndsep_mobile.inspection_sync_dead_letter.v1";
const DEVICE_ID_KEY = "ndsep_mobile.sync_device_id.v1";

const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 5 * 60_000;
/** Server syncBatch accepts at most 500 items per call. */
const BATCH_SIZE = 200;

function randomUuid(): string {
  // RFC4122 v4 without a crypto dependency (Hermes lacks crypto.randomUUID).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function getSyncDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = `device-${randomUuid()}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return "device-unknown";
  }
}

async function readQueue(): Promise<QueuedInspectionEvidence[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedInspectionEvidence[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: QueuedInspectionEvidence[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/** Persist a captured evidence mutation for later batch sync. FIFO order. */
export async function queueInspectionEvidence(
  input: Omit<QueuedInspectionEvidence, "queuedAt" | "attempts" | "notBefore" | "deviceId" | "clientUpdatedAt" | "evidenceUuid" | "deleted"> &
    Partial<Pick<QueuedInspectionEvidence, "evidenceUuid" | "clientUpdatedAt" | "deleted" | "versionVector">>,
): Promise<QueuedInspectionEvidence> {
  const queue = await readQueue();
  const item: QueuedInspectionEvidence = {
    evidenceUuid: input.evidenceUuid ?? randomUuid(),
    clientUpdatedAt: input.clientUpdatedAt ?? new Date().toISOString(),
    deleted: input.deleted ?? false,
    versionVector: input.versionVector,
    deviceId: await getSyncDeviceId(),
    queuedAt: new Date().toISOString(),
    attempts: 0,
    notBefore: 0,
    ...input,
  };
  queue.push(item);
  await writeQueue(queue);
  return item;
}

export async function getQueuedInspectionEvidence(): Promise<QueuedInspectionEvidence[]> {
  return readQueue();
}

function nextBackoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}

async function moveToDeadLetter(item: QueuedInspectionEvidence): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(DEAD_LETTER_KEY);
    const dead = raw ? (JSON.parse(raw) as QueuedInspectionEvidence[]) : [];
    dead.push(item);
    await AsyncStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(dead));
  } catch {
    // Dead-letter persistence is best-effort.
  }
}

type SyncBatchOutcome = {
  evidence_uuid: string;
  outcome: "inserted" | "updated" | "conflict_server_wins" | "conflict_client_wins" | "unchanged";
};

function createSyncClient() {
  return createTRPCUntypedClient({
    links: [
      httpBatchLink({
        url: `${getApiBaseUrl()}/api/trpc`,
        transformer: superjson,
        async headers() {
          const token = await Auth.getSessionToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        fetch(url, options) {
          return fetch(url, { ...options, credentials: "include" });
        },
      }),
    ],
  });
}

let flushInFlight: Promise<FlushResult> | null = null;

/**
 * Replay queued evidence against fieldInspection.syncBatch.
 * Deduplicated: concurrent callers share one flush. Safe to call on every
 * reconnect and from the background sync task.
 */
export function flushInspectionQueue(): Promise<FlushResult> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = flushInspectionQueueInner().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function flushInspectionQueueInner(): Promise<FlushResult> {
  const now = Date.now();
  const queue = await readQueue();
  if (queue.length === 0) return { synced: 0, failed: 0, deadLettered: 0, remaining: 0 };

  const eligible = queue.filter((item) => item.notBefore <= now);
  const waiting = queue.filter((item) => item.notBefore > now);
  if (eligible.length === 0) {
    return { synced: 0, failed: 0, deadLettered: 0, remaining: waiting.length };
  }

  const client = createSyncClient();
  const remaining: QueuedInspectionEvidence[] = [];
  let synced = 0;
  let failed = 0;
  let deadLettered = 0;

  // Group by case — syncBatch is scoped to a single case_uuid per call.
  const byCase = new Map<string, QueuedInspectionEvidence[]>();
  for (const item of eligible) {
    const group = byCase.get(item.caseUuid) ?? [];
    group.push(item);
    byCase.set(item.caseUuid, group);
  }

  for (const [caseUuid, items] of byCase) {
    for (let offset = 0; offset < items.length; offset += BATCH_SIZE) {
      const batch = items.slice(offset, offset + BATCH_SIZE);
      try {
        const results = (await (client as any).fieldInspection.syncBatch.mutate({
          case_uuid: caseUuid,
          client_device_id: batch[0]?.deviceId ?? (await getSyncDeviceId()),
          items: batch.map((item) => ({
            evidence_uuid: item.evidenceUuid,
            evidence_type: item.evidenceType,
            payload: item.payload,
            captured_at: item.capturedAt,
            client_updated_at: item.clientUpdatedAt,
            version_vector: item.versionVector,
            deleted: item.deleted,
          })),
        })) as SyncBatchOutcome[];
        // Batch accepted: every item in it was reconciled server-side.
        synced += Array.isArray(results) ? results.length : batch.length;
      } catch {
        failed += batch.length;
        for (const item of batch) {
          const attempts = item.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            deadLettered += 1;
            await moveToDeadLetter({ ...item, attempts });
          } else {
            remaining.push({ ...item, attempts, notBefore: now + nextBackoffMs(attempts) });
          }
        }
      }
    }
  }

  await writeQueue([...remaining, ...waiting]);
  return { synced, failed, deadLettered, remaining: remaining.length + waiting.length };
}
