import AsyncStorage from "@react-native-async-storage/async-storage";

import { createTRPCClient } from "./trpc";
import { scheduleFieldUpdateNotification } from "./mobile-notifications";

export type PendingFieldMutation = {
  id: string;
  type: "mission_status";
  missionId: string;
  status: "queued" | "active" | "synced";
  queuedAt: string;
};

const QUEUE_KEY = "idlr_pts_mobile.pending_field_mutations.v1";

async function readQueue() {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as PendingFieldMutation[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: PendingFieldMutation[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function queueMissionStatusMutation(input: Omit<PendingFieldMutation, "id" | "queuedAt">) {
  const queue = await readQueue();
  const mutation: PendingFieldMutation = {
    id: `${input.missionId}-${Date.now()}`,
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
    return { replayed: 0, failed: 0 };
  }

  const client = createTRPCClient();
  const remaining: PendingFieldMutation[] = [];
  let replayed = 0;
  let failed = 0;

  for (const mutation of queue.reverse()) {
    try {
      if (mutation.type === "mission_status") {
        await client.sync.updateMissionStatus.mutate({
          missionId: mutation.missionId,
          status: mutation.status,
        });
      }
      replayed += 1;
    } catch {
      remaining.unshift(mutation);
      failed += 1;
    }
  }

  await writeQueue(remaining);

  if (replayed > 0) {
    await scheduleFieldUpdateNotification({
      title: "Field sync replay completed",
      body: `${replayed} queued field update${replayed === 1 ? "" : "s"} synchronized successfully.`,
      data: { replayed, failed },
    });
  }

  return { replayed, failed };
}
