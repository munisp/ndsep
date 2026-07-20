import { Link, useLocalSearchParams } from "expo-router";
import { ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { findMissionByParcel, findWorkflowByParcel } from "@/lib/mobile-data";
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
  const parcelId = Number(id ?? bundle.parcels[0]?.id ?? 0);
  const parcel = bundle.parcels.find((item) => item.id === parcelId) ?? bundle.parcels[0];
  const mission = findMissionByParcel(parcel.id, bundle.missions);
  const workflow = findWorkflowByParcel(parcel.id, bundle.legalWorkflows);

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View>
          <Text className="text-3xl font-bold text-foreground">Parcel detail</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            Review parcel intelligence, field continuity, legal progression, and GeoLibre readiness from one native detail surface.
          </Text>
        </View>

        <View className="rounded-[28px] bg-primary p-5">
          <Text className="text-sm text-white/80">{parcel.parcelNumber}</Text>
          <Text className="mt-2 text-3xl font-bold text-white">{parcel.owner}</Text>
          <Text className="mt-2 text-sm leading-5 text-white/85">
            {parcel.lga}, {parcel.state} · {parcel.areaHectares} hectares · Risk score {parcel.riskScore}
          </Text>
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
