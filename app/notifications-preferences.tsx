import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import type { GeofenceTransition, ParcelMuteDuration } from "@/lib/mobile-data";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";

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

function MuteChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}> 
      <View className={`rounded-full border px-4 py-2 ${active ? "border-primary bg-primary/10" : "border-border bg-background"}`}>
        <Text className={`text-sm font-semibold ${active ? "text-primary" : "text-foreground"}`}>{label}</Text>
      </View>
    </Pressable>
  );
}

export default function NotificationsPreferencesScreen() {
  const { bundle, updateNotificationPreferences, setParcelMute, clearParcelMute, updateParcelGeofence } = useMobilePlatformBundle();
  const preferences = bundle.notificationPreferences;

  const followedParcelCards = useMemo(
    () =>
      bundle.parcels.filter((parcel) => preferences.followedParcelIds.includes(parcel.id)).map((parcel) => {
        const mute = preferences.parcelMutes.find((item) => item.parcelId === parcel.id);
        const geofence = preferences.geofenceSubscriptions.find((item) => item.parcelId === parcel.id);
        return { parcel, mute, geofence };
      }),
    [bundle.parcels, preferences.followedParcelIds, preferences.parcelMutes, preferences.geofenceSubscriptions],
  );

  async function togglePreference(key: keyof typeof preferences) {
    if (typeof preferences[key] !== "boolean") return;
    await updateNotificationPreferences({ [key]: !preferences[key] });
  }

  async function handleMute(parcelId: number, duration: ParcelMuteDuration) {
    await setParcelMute(parcelId, duration);
  }

  async function handleClearMute(parcelId: number) {
    await clearParcelMute(parcelId);
  }

  async function handleGeofence(parcelId: number, input: { enabled?: boolean; radiusMeters?: number; transition?: GeofenceTransition }) {
    await updateParcelGeofence({ parcelId, ...input });
  }

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View>
          <Text className="text-3xl font-bold text-foreground">Notification preferences</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            Control cross-device alert delivery, parcel following, mute durations, and location-aware geofence monitoring for specific properties.
          </Text>
        </View>

        <View className="rounded-[28px] bg-primary p-5">
          <Text className="text-sm text-white/80">Delivery profile</Text>
          <Text className="mt-2 text-3xl font-bold text-white">{preferences.onlyAssignedParcels ? "Assigned parcels only" : "All active parcels"}</Text>
          <Text className="mt-2 text-sm leading-5 text-white/85">
            Following {preferences.followedParcelIds.length} parcel{preferences.followedParcelIds.length === 1 ? "" : "s"}. Settings sync from the live platform bundle so they remain consistent across devices.
          </Text>
        </View>

        <View className="gap-3">
          <PreferenceRow title="Push delivery" description="Master switch for local push alerts and sync notifications." value={preferences.pushEnabled} onToggle={() => void togglePreference("pushEnabled")} />
          <PreferenceRow title="Field alerts" description="Receive mission progress, offline queue, and replay success alerts." value={preferences.fieldAlerts} onToggle={() => void togglePreference("fieldAlerts")} />
          <PreferenceRow title="Onboarding alerts" description="Receive KYC, KYB, OCR, and liveness workflow changes." value={preferences.onboardingAlerts} onToggle={() => void togglePreference("onboardingAlerts")} />
          <PreferenceRow title="Legal alerts" description="Receive Certificate of Occupancy and land-rights progression alerts." value={preferences.legalAlerts} onToggle={() => void togglePreference("legalAlerts")} />
          <PreferenceRow title="Geo alerts" description="Receive parcel export, GeoLibre continuity, and location-sensitive field notifications." value={preferences.geospatialAlerts} onToggle={() => void togglePreference("geospatialAlerts")} />
          <PreferenceRow title="Geofence parcel alerts" description="Allow the mobile client to notify when you enter or exit followed parcel regions." value={preferences.geofenceAlerts} onToggle={() => void togglePreference("geofenceAlerts")} />
          <PreferenceRow title="Follow assigned parcels only" description="Limit parcel-tagged alerts to parcels you explicitly follow from parcel detail." value={preferences.onlyAssignedParcels} onToggle={() => void togglePreference("onlyAssignedParcels")} />
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Followed parcels, mute windows, and geofence radius</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            Choose how long to silence parcel-specific alerts without losing the subscription itself, then tune location-aware parcel monitoring with per-parcel radius and transition behavior.
          </Text>

          <View className="mt-4 gap-4">
            {followedParcelCards.map(({ parcel, mute, geofence }) => (
              <View key={parcel.id} className="rounded-2xl border border-border bg-background p-4">
                <Text className="text-base font-semibold text-foreground">{parcel.parcelNumber}</Text>
                <Text className="mt-1 text-sm text-muted">{parcel.owner} · {parcel.state}</Text>
                <Text className="mt-2 text-xs text-muted">
                  {mute
                    ? mute.duration === "until_workflow_completion"
                      ? "Muted until workflow completion"
                      : `Muted until ${mute.mutedUntil ? new Date(mute.mutedUntil).toLocaleString() : "the selected window ends"}`
                    : "Notifications active"}
                </Text>
                <Text className="mt-2 text-xs text-muted">
                  {geofence?.enabled
                    ? `Geofence active · ${geofence.radiusMeters}m · ${geofence.transition} transitions`
                    : "Geofence paused"}
                </Text>
                <View className="mt-3 flex-row flex-wrap gap-2">
                  <MuteChip label="1 hour" active={mute?.duration === "1h"} onPress={() => void handleMute(parcel.id, "1h")} />
                  <MuteChip label="1 day" active={mute?.duration === "1d"} onPress={() => void handleMute(parcel.id, "1d")} />
                  <MuteChip
                    label="Until complete"
                    active={mute?.duration === "until_workflow_completion"}
                    onPress={() => void handleMute(parcel.id, "until_workflow_completion")}
                  />
                  {mute ? <MuteChip label="Unmute" active={false} onPress={() => void handleClearMute(parcel.id)} /> : null}
                </View>
                <View className="mt-3 flex-row flex-wrap gap-2">
                  <MuteChip label="Pause geofence" active={!geofence?.enabled} onPress={() => void handleGeofence(parcel.id, { enabled: false })} />
                  <MuteChip label="100m" active={geofence?.radiusMeters === 100} onPress={() => void handleGeofence(parcel.id, { enabled: true, radiusMeters: 100 })} />
                  <MuteChip label="150m" active={(geofence?.radiusMeters ?? 150) === 150} onPress={() => void handleGeofence(parcel.id, { enabled: true, radiusMeters: 150 })} />
                  <MuteChip label="250m" active={geofence?.radiusMeters === 250} onPress={() => void handleGeofence(parcel.id, { enabled: true, radiusMeters: 250 })} />
                </View>
                <View className="mt-3 flex-row flex-wrap gap-2">
                  <MuteChip label="Enter" active={geofence?.transition === "enter"} onPress={() => void handleGeofence(parcel.id, { enabled: true, transition: "enter" })} />
                  <MuteChip label="Exit" active={geofence?.transition === "exit"} onPress={() => void handleGeofence(parcel.id, { enabled: true, transition: "exit" })} />
                  <MuteChip label="Both" active={(geofence?.transition ?? "both") === "both"} onPress={() => void handleGeofence(parcel.id, { enabled: true, transition: "both" })} />
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
