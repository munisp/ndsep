import AsyncStorage from "@react-native-async-storage/async-storage";

import type { GeofenceTransition, NotificationPreferences, ParcelMuteDuration } from "@/lib/mobile-data";
import { defaultNotificationPreferences } from "@/lib/mobile-data";

const STORAGE_KEY = "idlr_pts_mobile.notification_preferences.v3";
const LEGACY_KEYS = ["idlr_pts_mobile.notification_preferences.v2"];

function normalizePreferences(raw: Partial<NotificationPreferences> | null | undefined): NotificationPreferences {
  return {
    ...defaultNotificationPreferences,
    ...(raw ?? {}),
    followedParcelIds: raw?.followedParcelIds ?? defaultNotificationPreferences.followedParcelIds,
    parcelMutes: raw?.parcelMutes ?? defaultNotificationPreferences.parcelMutes,
    geofenceSubscriptions: raw?.geofenceSubscriptions ?? defaultNotificationPreferences.geofenceSubscriptions,
  } satisfies NotificationPreferences;
}

export async function getNotificationPreferences() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) return normalizePreferences(JSON.parse(raw) as Partial<NotificationPreferences>);

    for (const legacyKey of LEGACY_KEYS) {
      const legacy = await AsyncStorage.getItem(legacyKey);
      if (legacy) {
        const migrated = normalizePreferences(JSON.parse(legacy) as Partial<NotificationPreferences>);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    }

    return defaultNotificationPreferences;
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

  const geofenceSubscriptions = alreadyFollowing
    ? current.geofenceSubscriptions.filter((item) => item.parcelId !== parcelId)
    : current.geofenceSubscriptions.some((item) => item.parcelId === parcelId)
      ? current.geofenceSubscriptions
      : [
          ...current.geofenceSubscriptions,
          {
            parcelId,
            radiusMeters: 150,
            transition: "both" as const,
            enabled: true,
            lastTriggeredAt: null,
            lastTransition: null,
          },
        ];

  return saveNotificationPreferences({
    ...current,
    followedParcelIds,
    geofenceSubscriptions,
    updatedAt: new Date().toISOString(),
  });
}

export async function toggleParcelGeofence(input: {
  parcelId: number;
  enabled?: boolean;
  radiusMeters?: number;
  transition?: GeofenceTransition;
}) {
  const current = await getNotificationPreferences();
  const existing = current.geofenceSubscriptions.find((item) => item.parcelId === input.parcelId);
  const nextSubscription = {
    parcelId: input.parcelId,
    radiusMeters: input.radiusMeters ?? existing?.radiusMeters ?? 150,
    transition: input.transition ?? existing?.transition ?? "both",
    enabled: input.enabled ?? !(existing?.enabled ?? false),
    lastTriggeredAt: existing?.lastTriggeredAt ?? null,
    lastTransition: existing?.lastTransition ?? null,
  };

  return saveNotificationPreferences({
    ...current,
    geofenceSubscriptions: [...current.geofenceSubscriptions.filter((item) => item.parcelId !== input.parcelId), nextSubscription].sort((a, b) => a.parcelId - b.parcelId),
    updatedAt: new Date().toISOString(),
  });
}

export async function recordParcelGeofenceTrigger(input: {
  parcelId: number;
  transition: "enter" | "exit";
  triggeredAt: string;
}) {
  const current = await getNotificationPreferences();
  return saveNotificationPreferences({
    ...current,
    geofenceSubscriptions: current.geofenceSubscriptions.map((item) =>
      item.parcelId === input.parcelId
        ? {
            ...item,
            lastTriggeredAt: input.triggeredAt,
            lastTransition: input.transition,
          }
        : item,
    ),
    updatedAt: new Date().toISOString(),
  });
}

export async function shouldNotifyForParcel(input: {
  parcelId?: number | null;
  workflowStatus?: "draft" | "pending_review" | "approved" | "signed" | "registered" | "rejected" | null;
  geofenceTransition?: "enter" | "exit" | null;
}) {
  const preferences = await getNotificationPreferences();
  if (!preferences.pushEnabled) return false;
  if (preferences.onlyAssignedParcels && input.parcelId != null && !preferences.followedParcelIds.includes(input.parcelId)) {
    return false;
  }

  if (input.geofenceTransition) {
    if (!preferences.geofenceAlerts) return false;
    const geofence = preferences.geofenceSubscriptions.find((item) => item.parcelId === input.parcelId);
    if (!geofence?.enabled) return false;
    if (geofence.transition !== "both" && geofence.transition !== input.geofenceTransition) return false;
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
