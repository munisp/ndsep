import AsyncStorage from "@react-native-async-storage/async-storage";

import { createTRPCClient } from "./trpc";
import type { OfflineFieldAttachment } from "./offline-field-attachments";

export type OfflineFieldEvidenceDraft = {
  id: string;
  missionId: string;
  parcelId: number;
  observationType: "boundary_marker" | "occupancy" | "encroachment" | "infrastructure" | "community_engagement" | "other";
  notes: string;
  capturedAt: string;
  coordinateSource: "parcel_reference" | "operator_entered" | "unavailable";
  latitude: number | null;
  longitude: number | null;
  attachmentCount: number;
  attachments: OfflineFieldAttachment[];
  verificationState: "unverified";
  queuedAt: string;
  attempts: number;
  lastError: string | null;
};

const QUEUE_KEY = "idlr_pts_mobile.offline_field_evidence.v1";

async function readQueue() {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as OfflineFieldEvidenceDraft[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: OfflineFieldEvidenceDraft[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function queueOfflineFieldEvidence(input: Omit<OfflineFieldEvidenceDraft, "id" | "queuedAt" | "attempts" | "lastError">) {
  const queue = await readQueue();
  const draft: OfflineFieldEvidenceDraft = {
    ...input,
    id: `field-evidence-${input.missionId}-${Date.now()}`,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  };
  queue.unshift(draft);
  await writeQueue(queue);
  return draft;
}

export async function getOfflineFieldEvidenceQueue() {
  return readQueue();
}

export async function replayOfflineFieldEvidence() {
  const queue = await readQueue();
  const client = createTRPCClient();
  const remaining: OfflineFieldEvidenceDraft[] = [];
  let recorded = 0;
  let duplicates = 0;

  for (const draft of queue.reverse()) {
    try {
      const result = await client.fieldEvidence.record.mutate({
        ...draft,
        origin: "offline_queue",
      });
      if (result.status === "recorded") recorded += 1;
      else duplicates += 1;
    } catch (error) {
      remaining.unshift({
        ...draft,
        attempts: draft.attempts + 1,
        lastError: error instanceof Error ? error.message : "Evidence gateway unavailable.",
      });
    }
  }

  await writeQueue(remaining);
  return { recorded, duplicates, pending: remaining.length };
}
