import { Platform } from "react-native";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";

import { replayQueuedFieldMutations } from "@/lib/mobile-sync-replay";

export const FIELD_SYNC_TASK = "idlr_pts_mobile.field_sync_replay";

if (Platform.OS !== "web") {
  try {
    TaskManager.defineTask(FIELD_SYNC_TASK, async () => {
      try {
        const result = await replayQueuedFieldMutations();
        return result.replayed > 0 ? BackgroundTask.BackgroundTaskResult.Success : BackgroundTask.BackgroundTaskResult.Success;
      } catch {
        return BackgroundTask.BackgroundTaskResult.Failed;
      }
    });
  } catch {
    // Task may already be defined during fast refresh.
  }
}

export async function registerFieldSyncBackgroundTask() {
  if (Platform.OS === "web") return false;
  const isRegistered = await TaskManager.isTaskRegisteredAsync(FIELD_SYNC_TASK);
  if (!isRegistered) {
    await BackgroundTask.registerTaskAsync(FIELD_SYNC_TASK, {
      minimumInterval: 15 * 60,
    });
  }
  return true;
}
