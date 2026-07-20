import AsyncStorage from "@react-native-async-storage/async-storage";

export type NotificationPreferences = {
  pushEnabled: boolean;
  fieldAlerts: boolean;
  onboardingAlerts: boolean;
  legalAlerts: boolean;
  geospatialAlerts: boolean;
  onlyAssignedParcels: boolean;
  followedParcelIds: number[];
};

const STORAGE_KEY = "idlr_pts_mobile.notification_preferences.v1";

export const defaultNotificationPreferences: NotificationPreferences = {
  pushEnabled: true,
  fieldAlerts: true,
  onboardingAlerts: true,
  legalAlerts: true,
  geospatialAlerts: true,
  onlyAssignedParcels: false,
  followedParcelIds: [6, 11],
};

export async function getNotificationPreferences() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultNotificationPreferences;
    return {
      ...defaultNotificationPreferences,
      ...(JSON.parse(raw) as Partial<NotificationPreferences>),
    };
  } catch {
    return defaultNotificationPreferences;
  }
}

export async function saveNotificationPreferences(preferences: NotificationPreferences) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  return preferences;
}

export async function updateNotificationPreferences(partial: Partial<NotificationPreferences>) {
  const current = await getNotificationPreferences();
  const next = {
    ...current,
    ...partial,
  } satisfies NotificationPreferences;
  await saveNotificationPreferences(next);
  return next;
}

export async function toggleParcelSubscription(parcelId: number) {
  const current = await getNotificationPreferences();
  const alreadyFollowing = current.followedParcelIds.includes(parcelId);
  const followedParcelIds = alreadyFollowing
    ? current.followedParcelIds.filter((id) => id !== parcelId)
    : [...current.followedParcelIds, parcelId].sort((a, b) => a - b);

  return updateNotificationPreferences({ followedParcelIds });
}

export async function shouldNotifyForParcel(parcelId?: number | null) {
  const preferences = await getNotificationPreferences();
  if (!preferences.pushEnabled) return false;
  if (!preferences.onlyAssignedParcels) return true;
  if (parcelId == null) return true;
  return preferences.followedParcelIds.includes(parcelId);
}
