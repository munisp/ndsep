import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import type { NotificationPreferences } from "@/lib/mobile-notification-preferences";
import { defaultNotificationPreferences, getNotificationPreferences, updateNotificationPreferences } from "@/lib/mobile-notification-preferences";

function PreferenceRow({
  title,
  description,
  value,
  onToggle,
}: {
  title: string;
  description: string;
  value: boolean;
  onToggle: () => void;
}) {
  return (
    <View className="rounded-2xl border border-border bg-background p-4">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1">
          <Text className="text-base font-semibold text-foreground">{title}</Text>
          <Text className="mt-1 text-sm leading-5 text-muted">{description}</Text>
        </View>
        <Pressable onPress={onToggle} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
          <View className={`rounded-full px-4 py-2 ${value ? "bg-primary" : "bg-surface border border-border"}`}>
            <Text className={`text-sm font-semibold ${value ? "text-white" : "text-foreground"}`}>{value ? "On" : "Off"}</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

export default function NotificationsPreferencesScreen() {
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultNotificationPreferences);

  useEffect(() => {
    getNotificationPreferences().then(setPreferences).catch(() => undefined);
  }, []);

  async function toggle<K extends keyof NotificationPreferences>(key: K) {
    if (typeof preferences[key] !== "boolean") return;
    const next = await updateNotificationPreferences({ [key]: !preferences[key] } as Partial<NotificationPreferences>);
    setPreferences(next);
  }

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View>
          <Text className="text-3xl font-bold text-foreground">Notification preferences</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            Control mobile alerts, sync-delivery noise, and whether notifications should follow only your assigned parcels.
          </Text>
        </View>

        <View className="rounded-[28px] bg-primary p-5">
          <Text className="text-sm text-white/80">Delivery profile</Text>
          <Text className="mt-2 text-3xl font-bold text-white">
            {preferences.onlyAssignedParcels ? "Assigned parcels only" : "All active parcels"}
          </Text>
          <Text className="mt-2 text-sm leading-5 text-white/85">
            Following {preferences.followedParcelIds.length} parcel{preferences.followedParcelIds.length === 1 ? "" : "s"} for parcel-aware alerts.
          </Text>
        </View>

        <View className="gap-3">
          <PreferenceRow
            title="Push delivery"
            description="Master switch for local push alerts and sync notifications."
            value={preferences.pushEnabled}
            onToggle={() => void toggle("pushEnabled")}
          />
          <PreferenceRow
            title="Field alerts"
            description="Receive mission progress, offline queue, and replay success alerts."
            value={preferences.fieldAlerts}
            onToggle={() => void toggle("fieldAlerts")}
          />
          <PreferenceRow
            title="Onboarding alerts"
            description="Receive KYC, KYB, OCR, and liveness workflow changes."
            value={preferences.onboardingAlerts}
            onToggle={() => void toggle("onboardingAlerts")}
          />
          <PreferenceRow
            title="Legal alerts"
            description="Receive Certificate of Occupancy and land-rights progression alerts."
            value={preferences.legalAlerts}
            onToggle={() => void toggle("legalAlerts")}
          />
          <PreferenceRow
            title="Geo alerts"
            description="Receive parcel export and GeoLibre continuity notifications."
            value={preferences.geospatialAlerts}
            onToggle={() => void toggle("geospatialAlerts")}
          />
          <PreferenceRow
            title="Follow assigned parcels only"
            description="Limit parcel-tagged alerts to parcels you explicitly follow from parcel detail."
            value={preferences.onlyAssignedParcels}
            onToggle={() => void toggle("onlyAssignedParcels")}
          />
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Currently followed parcels</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            Parcel subscriptions are managed from each parcel detail screen. They determine which parcel-tagged alerts remain visible when assigned-only delivery is enabled.
          </Text>
          <View className="mt-4 flex-row flex-wrap gap-2">
            {preferences.followedParcelIds.map((parcelId) => (
              <View key={parcelId} className="rounded-full border border-primary/20 bg-primary/10 px-3 py-2">
                <Text className="text-sm font-semibold text-primary">Parcel {parcelId}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
