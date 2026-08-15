import { useMemo } from "react";
import { Link, useLocalSearchParams } from "expo-router";
import { ScrollView, Share, Text, View, Pressable } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { findMissionByParcel, findWorkflowByParcel } from "@/lib/mobile-data";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";

function buildGeoJson(parcel: {
  id: number;
  parcelNumber: string;
  owner: string;
  state: string;
  lga: string;
  areaHectares: number;
  titleStatus: string;
  workflowStage: string;
  latitude: number;
  longitude: number;
  riskScore: number;
  lastAction: string;
  geolibreReady: boolean;
}) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          parcelId: parcel.id,
          parcelNumber: parcel.parcelNumber,
          owner: parcel.owner,
          state: parcel.state,
          lga: parcel.lga,
          areaHectares: parcel.areaHectares,
          titleStatus: parcel.titleStatus,
          workflowStage: parcel.workflowStage,
          riskScore: parcel.riskScore,
          lastAction: parcel.lastAction,
          geolibreReady: parcel.geolibreReady,
        },
        geometry: {
          type: "Point",
          coordinates: [parcel.longitude, parcel.latitude],
        },
      },
    ],
  };
}

export default function GeoLibreLaunchScreen() {
  const { parcelId } = useLocalSearchParams<{ parcelId?: string }>();
  const { bundle } = useMobilePlatformBundle();
  const parcel = bundle.parcels.find((item) => String(item.id) === String(parcelId)) ?? bundle.parcels[0];
  const mission = findMissionByParcel(parcel.id, bundle.missions);
  const workflow = findWorkflowByParcel(parcel.id, bundle.legalWorkflows);

  const geoJson = useMemo(() => buildGeoJson(parcel), [parcel]);
  const exportBundle = useMemo(
    () => ({
      parcel,
      mission: mission ?? null,
      workflow: workflow ?? null,
      geoJson,
      syncMeta: bundle.syncMeta,
      generatedAt: new Date().toISOString(),
    }),
    [bundle.syncMeta, geoJson, mission, parcel, workflow],
  );

  async function sharePayload(title: string, payload: unknown) {
    await Share.share({
      title,
      message: JSON.stringify(payload, null, 2),
    });
  }

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View>
          <Text className="text-3xl font-bold text-foreground">GeoLibre launch</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            Prepare parcel exports, preserve task context, and hand the selected parcel into the GeoLibre workflow with complete mobile continuity.
          </Text>
        </View>

        <View className="rounded-[28px] bg-primary p-5">
          <Text className="text-sm text-white/80">Selected parcel</Text>
          <Text className="mt-2 text-3xl font-bold text-white">{parcel.parcelNumber}</Text>
          <Text className="mt-2 text-sm leading-5 text-white/85">
            {parcel.owner} · {parcel.lga}, {parcel.state} · Risk {parcel.riskScore}
          </Text>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Launch readiness</Text>
          <Text className="mt-2 text-sm text-muted">GeoLibre status: {parcel.geolibreReady ? "Prepared" : "Needs preparation"}</Text>
          <Text className="mt-2 text-sm text-muted">Sync source: {bundle.syncMeta.source} · Pending mutations: {bundle.syncMeta.pendingMutations}</Text>
          {mission ? <Text className="mt-2 text-sm text-muted">Field mission: {mission.title} · {mission.status}</Text> : null}
          {workflow ? <Text className="mt-2 text-sm text-muted">Legal workflow: {workflow.type} · {workflow.status}</Text> : null}
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Export controls</Text>
          <Text className="mt-2 text-sm text-muted">Use these controls to export parcel context, GeoJSON payloads, and combined handoff bundles for downstream GIS work.</Text>
          <View className="mt-4 gap-3">
            <Pressable onPress={() => void sharePayload("Parcel GeoJSON", geoJson)}>
              <View className="rounded-2xl bg-foreground px-4 py-4">
                <Text className="text-center font-semibold text-background">Share GeoJSON payload</Text>
              </View>
            </Pressable>
            <Pressable onPress={() => void sharePayload("Parcel export bundle", exportBundle)}>
              <View className="rounded-2xl border border-border bg-background px-4 py-4">
                <Text className="text-center font-semibold text-foreground">Share full parcel bundle</Text>
              </View>
            </Pressable>
            <Pressable onPress={() => void sharePayload("GeoLibre launch manifest", {
              parcelId: parcel.id,
              parcelNumber: parcel.parcelNumber,
              coordinates: [parcel.longitude, parcel.latitude],
              geoLibreReady: parcel.geolibreReady,
              workflowStatus: workflow?.status ?? null,
              syncSource: bundle.syncMeta.source,
            })}>
              <View className="rounded-2xl border border-border bg-background px-4 py-4">
                <Text className="text-center font-semibold text-foreground">Share launch manifest</Text>
              </View>
            </Pressable>
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">GeoJSON preview</Text>
          <View className="mt-4 rounded-2xl border border-border bg-background p-4">
            <Text className="font-mono text-xs leading-5 text-foreground">{JSON.stringify(geoJson, null, 2)}</Text>
          </View>
        </View>

        <View className="gap-3">
          <Link href={{ pathname: "/(tabs)/geo" } as never} asChild>
            <View className="rounded-2xl border border-border bg-background px-4 py-4">
              <Text className="text-center font-semibold text-foreground">Return to geospatial workspace</Text>
            </View>
          </Link>
          <Link href={{ pathname: "/parcel/[id]", params: { id: String(parcel.id) } } as never} asChild>
            <View className="rounded-2xl border border-border bg-background px-4 py-4">
              <Text className="text-center font-semibold text-foreground">Return to parcel detail</Text>
            </View>
          </Link>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
