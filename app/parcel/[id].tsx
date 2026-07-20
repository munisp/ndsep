import { useEffect, useState } from "react";
import { Link, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { findMissionByParcel, findWorkflowByParcel } from "@/lib/mobile-data";
import { getNotificationPreferences, toggleParcelSubscription } from "@/lib/mobile-notification-preferences";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 rounded-2xl border border-border bg-background p-4">
      <Text className="text-xs uppercase tracking-wide text-muted">{label}</Text>
      <Text className="mt-2 text-base font-semibold text-foreground">{value}</Text>
    </View>
  );
}

export default function ParcelDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { bundle } = useMobilePlatformBundle();
  const [followedParcelIds, setFollowedParcelIds] = useState<number[]>([]);
  const [onlyAssignedParcels, setOnlyAssignedParcels] = useState(false);

  const parcelId = Number(id ?? bundle.parcels[0]?.id ?? 0);
  const parcel = bundle.parcels.find((item) => item.id === parcelId) ?? bundle.parcels[0];
  const mission = findMissionByParcel(parcel.id, bundle.missions);
  const workflow = findWorkflowByParcel(parcel.id, bundle.legalWorkflows);
  const isFollowed = followedParcelIds.includes(parcel.id);

  useEffect(() => {
    getNotificationPreferences()
      .then((preferences) => {
        setFollowedParcelIds(preferences.followedParcelIds);
        setOnlyAssignedParcels(preferences.onlyAssignedParcels);
      })
      .catch(() => undefined);
  }, []);

  async function handleToggleFollow() {
    const next = await toggleParcelSubscription(parcel.id);
    setFollowedParcelIds(next.followedParcelIds);
    setOnlyAssignedParcels(next.onlyAssignedParcels);
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
            Delivery mode: {onlyAssignedParcels ? "Assigned/followed parcels only" : "All parcel-tagged events"}
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
