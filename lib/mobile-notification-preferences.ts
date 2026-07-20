import AsyncStorage from "@react-native-async-storage/async-storage";

import type { NotificationPreferences, ParcelMuteDuration } from "@/lib/mobile-data";
import { defaultNotificationPreferences } from "@/lib/mobile-data";

const STORAGE_KEY = "idlr_pts_mobile.notification_preferences.v2";

export async function getNotificationPreferences() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultNotificationPreferences;
    return {
      ...defaultNotificationPreferences,
      ...(JSON.parse(raw) as Partial<NotificationPreferences>),
    } satisfies NotificationPreferences;
  } catch {
    return defaultNotificationPreferences;
  }
}

export async function saveNotificationPreferences(preferences: NotificationPreferences) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  return preferences;
}

export async function setParcelMute(input: {
  parcelId: number;
  duration: ParcelMuteDuration;
  mutedUntil: string | null;
  workflowId?: string | null;
}) {
  const current = await getNotificationPreferences();
  const parcelMutes = [
    ...current.parcelMutes.filter((item) => item.parcelId !== input.parcelId),
    {
      parcelId: input.parcelId,
      duration: input.duration,
      mutedAt: new Date().toISOString(),
      mutedUntil: input.mutedUntil,
      workflowId: input.workflowId ?? null,
    },
  ];
  return saveNotificationPreferences({
    ...current,
    parcelMutes,
    updatedAt: new Date().toISOString(),
  });
}

export async function clearParcelMute(parcelId: number) {
  const current = await getNotificationPreferences();
  return saveNotificationPreferences({
    ...current,
    parcelMutes: current.parcelMutes.filter((item) => item.parcelId !== parcelId),
    updatedAt: new Date().toISOString(),
  });
}

export async function toggleParcelSubscription(parcelId: number) {
  const current = await getNotificationPreferences();
  const alreadyFollowing = current.followedParcelIds.includes(parcelId);
  const followedParcelIds = alreadyFollowing
    ? current.followedParcelIds.filter((id) => id !== parcelId)
    : [...current.followedParcelIds, parcelId].sort((a, b) => a - b);

  return saveNotificationPreferences({
    ...current,
    followedParcelIds,
    updatedAt: new Date().toISOString(),
  });
}

export async function shouldNotifyForParcel(input: {
  parcelId?: number | null;
  workflowStatus?: "draft" | "pending_review" | "approved" | "signed" | "registered" | "rejected" | null;
}) {
  const preferences = await getNotificationPreferences();
  if (!preferences.pushEnabled) return false;
  if (preferences.onlyAssignedParcels && input.parcelId != null && !preferences.followedParcelIds.includes(input.parcelId)) {
    return false;
  }

  const mute = preferences.parcelMutes.find((item) => item.parcelId === input.parcelId);
  if (!mute) return true;

  if (mute.duration === "until_workflow_completion") {
    return input.workflowStatus === "registered" || input.workflowStatus === "rejected";
  }

  if (mute.mutedUntil && new Date(mute.mutedUntil).getTime() > Date.now()) {
    return false;
  }

  return true;
}
