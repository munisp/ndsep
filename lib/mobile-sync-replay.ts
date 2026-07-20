import AsyncStorage from "@react-native-async-storage/async-storage";

import { appendActivityAudit } from "./mobile-activity";
import { scheduleFieldUpdateNotification } from "./mobile-notifications";
import { createTRPCClient } from "./trpc";

export type PendingFieldMutation =
  | {
      id: string;
      type: "mission_status";
      missionId: string;
      status: "queued" | "active" | "synced";
      queuedAt: string;
    }
  | {
      id: string;
      type: "geofence_event";
      parcelId: number;
      transition: "enter" | "exit";
      radiusMeters: number;
      latitude: number;
      longitude: number;
      triggeredAt: string;
      activityId: string;
      queuedAt: string;
    };

const QUEUE_KEY = "idlr_pts_mobile.pending_field_mutations.v2";
const LEGACY_QUEUE_KEY = "idlr_pts_mobile.pending_field_mutations.v1";

async function readQueue() {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (raw) return JSON.parse(raw) as PendingFieldMutation[];

    const legacyRaw = await AsyncStorage.getItem(LEGACY_QUEUE_KEY);
    return legacyRaw ? (JSON.parse(legacyRaw) as PendingFieldMutation[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: PendingFieldMutation[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function queueMissionStatusMutation(input: Omit<Extract<PendingFieldMutation, { type: "mission_status" }>, "id" | "queuedAt">) {
  const queue = await readQueue();
  const mutation: Extract<PendingFieldMutation, { type: "mission_status" }> = {
    id: `${input.missionId}-${Date.now()}`,
    queuedAt: new Date().toISOString(),
    ...input,
  };
  queue.unshift(mutation);
  await writeQueue(queue);
  return mutation;
}

export async function queueGeofenceEventMutation(
  input: Omit<Extract<PendingFieldMutation, { type: "geofence_event" }>, "id" | "queuedAt">,
) {
  const queue = await readQueue();
  const mutation: Extract<PendingFieldMutation, { type: "geofence_event" }> = {
    id: `geofence-${input.parcelId}-${input.triggeredAt}`,
    queuedAt: new Date().toISOString(),
    ...input,
  };
  queue.unshift(mutation);
  await writeQueue(queue);
  return mutation;
}

export async function getQueuedFieldMutations() {
  return readQueue();
}

export async function replayQueuedFieldMutations() {
  const queue = await readQueue();
  if (queue.length === 0) {
    return { replayed: 0, failed: 0, reconciled: 0 };
  }

  const client = createTRPCClient();
  const remaining: PendingFieldMutation[] = [];
  let replayed = 0;
  let failed = 0;
  let reconciled = 0;

  for (const mutation of queue.reverse()) {
    try {
      if (mutation.type === "mission_status") {
        await client.sync.updateMissionStatus.mutate({
          missionId: mutation.missionId,
          status: mutation.status,
        });
        replayed += 1;
        continue;
      }

      const result = await client.notifications.replayGeofenceEvent.mutate({
        parcelId: mutation.parcelId,
        transition: mutation.transition,
        radiusMeters: mutation.radiusMeters,
        latitude: mutation.latitude,
        longitude: mutation.longitude,
        triggeredAt: mutation.triggeredAt,
      });

      if (result.status === "accepted") {
        replayed += 1;
      } else {
        reconciled += 1;
      }

      await appendActivityAudit(mutation.activityId, {
        kind: result.status === "accepted" ? "preference_synced" : "priority_ranked",
        label: result.status === "accepted" ? "Geofence replay synchronized" : "Geofence replay reconciled",
        actor: "system",
        detail:
          result.status === "accepted"
            ? "The offline geofence event was synchronized successfully after connectivity returned."
            : `The offline geofence event was reconciled as ${result.status} against newer parcel-transition state.`,
        metadata: {
          status: result.status,
          parcelId: mutation.parcelId,
          transition: mutation.transition,
        },
      });
    } catch {
      remaining.unshift(mutation);
      failed += 1;
    }
  }

  await writeQueue(remaining);

  if (replayed > 0 || reconciled > 0) {
    await scheduleFieldUpdateNotification({
      title: "Offline replay completed",
      body: `${replayed} queued update${replayed === 1 ? "" : "s"} synchronized and ${reconciled} geofence event${reconciled === 1 ? " was" : "s were"} reconciled.`,
      data: { replayed, failed, reconciled },
    });
  }

  return { replayed, failed, reconciled };
}
