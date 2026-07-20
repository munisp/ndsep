import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import { getNotificationPreferences, shouldNotifyForParcel } from "./mobile-notification-preferences";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const CHANNEL_ID = "field-updates";

export async function ensureNotificationPermissions() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Field Updates",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 200, 150, 200],
      lightColor: "#1D4ED8",
    });
  }

  const current = await Notifications.getPermissionsAsync();
  if (current.status === "granted") return current.status;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status;
}

export async function scheduleFieldUpdateNotification(input: {
  title: string;
  body: string;
  category?: "field" | "onboarding" | "legal" | "geospatial";
  parcelId?: number | null;
  workflowStatus?: "draft" | "pending_review" | "approved" | "signed" | "registered" | "rejected" | null;
  data?: Record<string, unknown>;
}) {
  const preferences = await getNotificationPreferences();
  const category = input.category ?? "field";

  if (!preferences.pushEnabled) return null;
  if (category === "field" && !preferences.fieldAlerts) return null;
  if (category === "onboarding" && !preferences.onboardingAlerts) return null;
  if (category === "legal" && !preferences.legalAlerts) return null;
  if (category === "geospatial" && !preferences.geospatialAlerts) return null;
  if (!(await shouldNotifyForParcel({ parcelId: input.parcelId, workflowStatus: input.workflowStatus }))) return null;

  return Notifications.scheduleNotificationAsync({
    content: {
      title: input.title,
      body: input.body,
      data: {
        ...input.data,
        category,
        parcelId: input.parcelId ?? null,
      },
    },
    trigger: null,
  });
}

export { CHANNEL_ID };
