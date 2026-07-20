import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

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
  data?: Record<string, unknown>;
}) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: input.title,
      body: input.body,
      data: input.data,
    },
    trigger: null,
  });
}

export { CHANNEL_ID };
