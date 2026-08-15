import { Link, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { findMissionByParcel, findWorkflowByParcel, type GeofenceTransition } from "@/lib/mobile-data";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 rounded-2xl border border-border bg-background p-4">
      <Text className="text-xs uppercase tracking-wide text-muted">{label}</Text>
      <Text className="mt-2 text-base font-semibold text-foreground">{value}</Text>
    </View>
  );
}

function SelectionChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}> 
      <View className={`rounded-full border px-4 py-2 ${active ? "border-primary bg-primary/10" : "border-border bg-background"}`}>
        <Text className={`text-sm font-semibold ${active ? "text-primary" : "text-foreground"}`}>{label}</Text>
      </View>
    </Pressable>
  );
}

export default function ParcelDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { bundle, toggleParcelSubscription, updateParcelGeofence, geofenceRuntime } = useMobilePlatformBundle();

  const parcelId = Number(id ?? bundle.parcels[0]?.id ?? 0);
  const parcel = bundle.parcels.find((item) => item.id === parcelId) ?? bundle.parcels[0];
  const mission = findMissionByParcel(parcel.id, bundle.missions);
  const workflow = findWorkflowByParcel(parcel.id, bundle.legalWorkflows);
  const preferences = bundle.notificationPreferences;
  const isFollowed = preferences.followedParcelIds.includes(parcel.id);
  const geofence = preferences.geofenceSubscriptions.find((item) => item.parcelId === parcel.id);
  const geofenceEnabled = Boolean(geofence?.enabled);

  async function handleToggleFollow() {
    await toggleParcelSubscription(parcel.id);
  }

  async function handleToggleGeofence() {
    await updateParcelGeofence({ parcelId: parcel.id, enabled: !geofenceEnabled });
  }

  async function handleRadius(radiusMeters: number) {
    await updateParcelGeofence({ parcelId: parcel.id, enabled: true, radiusMeters });
  }

  async function handleTransition(transition: GeofenceTransition) {
    await updateParcelGeofence({ parcelId: parcel.id, enabled: true, transition });
  }

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View>
          <Text className="text-3xl font-bold text-foreground">Parcel detail</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            Review parcel intelligence, field continuity, legal progression, GeoLibre readiness, and parcel-specific alert control from one native detail surface.
          </Text>
        </View>

        <View className="rounded-[28px] bg-primary p-5">
          <Text className="text-sm text-white/80">{parcel.parcelNumber}</Text>
          <Text className="mt-2 text-3xl font-bold text-white">{parcel.owner}</Text>
          <Text className="mt-2 text-sm leading-5 text-white/85">
            {parcel.lga}, {parcel.state} · {parcel.areaHectares} hectares · Risk score {parcel.riskScore}
          </Text>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Parcel notification subscription</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            {isFollowed
              ? "This parcel is currently followed for parcel-tagged alerts and inbox discovery."
              : "This parcel is not currently followed for parcel-tagged alerts."}
          </Text>
          <Text className="mt-2 text-sm text-muted">
            Delivery mode: {preferences.onlyAssignedParcels ? "Assigned/followed parcels only" : "All parcel-tagged events"}
          </Text>
          <Pressable onPress={() => void handleToggleFollow()} style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}> 
            <View className={`mt-4 rounded-2xl px-4 py-4 ${isFollowed ? "bg-foreground" : "border border-border bg-background"}`}>
              <Text className={`text-center font-semibold ${isFollowed ? "text-background" : "text-foreground"}`}>
                {isFollowed ? "Unfollow parcel alerts" : "Follow parcel alerts"}
              </Text>
            </View>
          </Pressable>
          <Link href={"/notifications-preferences" as never} asChild>
            <Pressable style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}> 
              <View className="mt-3 rounded-2xl border border-border bg-background px-4 py-4">
                <Text className="text-center font-semibold text-foreground">Open notification preferences</Text>
              </View>
            </Pressable>
          </Link>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Geofence parcel alerts</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            Enable location-aware parcel alerts so the mobile client can detect when a field officer enters or exits this parcel’s operating radius.
          </Text>
          <Text className="mt-3 text-sm text-muted">
            {geofenceEnabled
              ? `Geofence preference saved · ${geofence?.radiusMeters ?? 150}m radius · ${geofence?.transition ?? "both"} transitions`
              : "Geofence paused for this parcel"}
          </Text>
          <Text className={`mt-2 text-xs ${geofenceRuntime.status === "active" ? "text-success" : "text-warning"}`}>
            Device monitoring: {geofenceRuntime.status.replace(/_/g, " ")}
            {geofenceRuntime.status === "active"
              ? ` · ${geofenceRuntime.activeRegionCount} registered region${geofenceRuntime.activeRegionCount === 1 ? "" : "s"}`
              : geofenceRuntime.reason
                ? ` · ${geofenceRuntime.reason}`
                : ""}
          </Text>
          <Text className="mt-2 text-xs text-muted">
            {geofence?.lastTriggeredAt
              ? `Last trigger: ${new Date(geofence.lastTriggeredAt).toLocaleString()} · ${geofence.lastTransition ?? "unknown transition"}`
              : "No geofence transition has been recorded on this device yet."}
          </Text>
          <Pressable onPress={() => void handleToggleGeofence()} disabled={!isFollowed} style={({ pressed }) => [{ opacity: pressed || !isFollowed ? 0.7 : 1 }]}> 
            <View className={`mt-4 rounded-2xl px-4 py-4 ${geofenceEnabled ? "bg-foreground" : "border border-border bg-background"}`}>
              <Text className={`text-center font-semibold ${geofenceEnabled ? "text-background" : "text-foreground"}`}>
                {geofenceEnabled ? "Pause geofence preference" : "Save geofence preference"}
              </Text>
            </View>
          </Pressable>
          {!isFollowed ? <Text className="mt-2 text-xs text-muted">Follow the parcel first to activate geofence tracking.</Text> : null}
          <View className="mt-4 flex-row flex-wrap gap-2">
            <SelectionChip label="100m" active={geofence?.radiusMeters === 100} onPress={() => void handleRadius(100)} />
            <SelectionChip label="150m" active={(geofence?.radiusMeters ?? 150) === 150} onPress={() => void handleRadius(150)} />
            <SelectionChip label="250m" active={geofence?.radiusMeters === 250} onPress={() => void handleRadius(250)} />
          </View>
          <View className="mt-3 flex-row flex-wrap gap-2">
            <SelectionChip label="Enter" active={geofence?.transition === "enter"} onPress={() => void handleTransition("enter")} />
            <SelectionChip label="Exit" active={geofence?.transition === "exit"} onPress={() => void handleTransition("exit")} />
            <SelectionChip label="Both" active={(geofence?.transition ?? "both") === "both"} onPress={() => void handleTransition("both")} />
          </View>
        </View>

        <View className="flex-row gap-3">
          <DetailCard label="Title" value={parcel.titleStatus} />
          <DetailCard label="Workflow" value={parcel.workflowStage} />
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Current parcel state</Text>
          <Text className="mt-3 text-sm text-muted">Last action: {parcel.lastAction}</Text>
          <Text className="mt-2 text-sm text-muted">Coordinates: {parcel.latitude.toFixed(4)}, {parcel.longitude.toFixed(4)}</Text>
          <Text className="mt-2 text-sm text-muted">GeoLibre readiness: {parcel.geolibreReady ? "Prepared for export and launch" : "Needs additional geospatial preparation"}</Text>
        </View>

        {mission ? (
          <View className="rounded-3xl border border-border bg-surface p-5">
            <Text className="text-lg font-semibold text-foreground">Field mission continuity</Text>
            <Text className="mt-2 text-sm text-muted">{mission.title}</Text>
            <Text className="mt-2 text-sm text-muted">Status: {mission.status} · Sync risk: {mission.syncRisk}</Text>
            <Text className="mt-2 text-sm text-muted">Evidence items: {mission.evidenceCount}</Text>
          </View>
        ) : null}

        {workflow ? (
          <View className="rounded-3xl border border-border bg-surface p-5">
            <Text className="text-lg font-semibold text-foreground">Legal workflow continuity</Text>
            <Text className="mt-2 text-sm text-muted">{workflow.type}</Text>
            <Text className="mt-2 text-sm text-muted">Status: {workflow.status} · Desk: {workflow.assignedDesk}</Text>
            <Text className="mt-2 text-sm text-muted">Registration: {workflow.registrationNumber ?? "Pending final registration"}</Text>
          </View>
        ) : null}

        <View className="gap-3">
          <Link href={{ pathname: "/(tabs)/field" } as never} asChild>
            <View className="rounded-2xl bg-foreground px-4 py-4">
              <Text className="text-center font-semibold text-background">Open field workflow</Text>
            </View>
          </Link>
          <Link href={{ pathname: "/(tabs)/geo" } as never} asChild>
            <View className="rounded-2xl border border-border bg-background px-4 py-4">
              <Text className="text-center font-semibold text-foreground">Open geospatial review</Text>
            </View>
          </Link>
          <Link href={{ pathname: "/legal-workflow" } as never} asChild>
            <View className="rounded-2xl border border-border bg-background px-4 py-4">
              <Text className="text-center font-semibold text-foreground">Open legal workflow</Text>
            </View>
          </Link>
          <Link href={{ pathname: "/geolibre-launch", params: { parcelId: String(parcel.id) } } as never} asChild>
            <View className="rounded-2xl border border-border bg-background px-4 py-4">
              <Text className="text-center font-semibold text-foreground">Launch GeoLibre workspace</Text>
            </View>
          </Link>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
