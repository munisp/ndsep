import { Link } from "expo-router";
import { memo, useMemo, useState } from "react";
import { FlatList, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { findMissionByParcel, findWorkflowByParcel, type ParcelRecord } from "@/lib/mobile-data";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";
import type { MobilePlatformBundle } from "@/lib/mobile-data";

function Pill({ label }: { label: string }) {
  return (
    <View className="rounded-full border border-border bg-background px-3 py-1">
      <Text className="text-xs font-medium text-foreground">{label}</Text>
    </View>
  );
}

// Memoized row: large parcel lists only re-render rows whose data changed.
const ParcelCard = memo(function ParcelCard({
  parcel,
  bundle,
}: {
  parcel: ParcelRecord;
  bundle: MobilePlatformBundle;
}) {
  const mission = findMissionByParcel(parcel.id, bundle.missions);
  const workflow = findWorkflowByParcel(parcel.id, bundle.legalWorkflows);
  return (
    <View className="rounded-3xl border border-border bg-surface p-5">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-lg font-semibold text-foreground">{parcel.parcelNumber}</Text>
          <Text className="mt-1 text-sm text-muted">{parcel.owner} · {parcel.lga}, {parcel.state}</Text>
        </View>
        <Pill label={`Risk ${parcel.riskScore}`} />
      </View>

      <View className="mt-4 flex-row flex-wrap gap-2">
        <Pill label={parcel.titleStatus} />
        <Pill label={parcel.workflowStage} />
        {parcel.geolibreReady ? <Pill label="GeoLibre ready" /> : <Pill label="Geo review pending" />}
      </View>

      <Text className="mt-4 text-sm text-muted">{parcel.lastAction}</Text>
      {mission ? <Text className="mt-2 text-sm text-muted">Mission: {mission.title}</Text> : null}
      {workflow ? <Text className="mt-2 text-sm text-muted">Legal: {workflow.type} · {workflow.status}</Text> : null}

      <View className="mt-4 gap-3">
        <Link href={{ pathname: "/parcel/[id]", params: { id: String(parcel.id) } } as never} asChild>
          <View className="rounded-2xl bg-foreground px-4 py-3">
            <Text className="text-center font-semibold text-background">Open parcel detail</Text>
          </View>
        </Link>
        <Link href={"/(tabs)/field" as never} asChild>
          <View className="rounded-2xl border border-border bg-background px-4 py-3">
            <Text className="text-center font-semibold text-foreground">Open field workflow</Text>
          </View>
        </Link>
        <Link href={{ pathname: "/geolibre-launch", params: { parcelId: String(parcel.id) } } as never} asChild>
          <View className="rounded-2xl border border-border bg-background px-4 py-3">
            <Text className="text-center font-semibold text-foreground">Open GeoLibre launch</Text>
          </View>
        </Link>
        <Link href={"/legal-workflow" as never} asChild>
          <View className="rounded-2xl border border-border bg-background px-4 py-3">
            <Text className="text-center font-semibold text-foreground">Open legal workflow</Text>
          </View>
        </Link>
      </View>
    </View>
  );
});

export default function ParcelsScreen() {
  const { bundle } = useMobilePlatformBundle();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return bundle.parcels;
    return bundle.parcels.filter((parcel) =>
      [parcel.parcelNumber, parcel.owner, parcel.lga, parcel.state].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [bundle.parcels, query]);

  return (
    <ScreenContainer className="bg-background">
      <FlatList
        data={filtered}
        keyExtractor={(parcel) => String(parcel.id)}
        renderItem={({ item }) => <ParcelCard parcel={item} bundle={bundle} />}
        contentContainerStyle={{ padding: 20, paddingBottom: 32 }}
        ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
        windowSize={7}
        maxToRenderPerBatch={8}
        initialNumToRender={10}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews
        ListHeaderComponent={
          <View style={{ gap: 16, marginBottom: 16 }}>
            <View>
              <Text className="text-3xl font-bold text-foreground">Parcels</Text>
              <Text className="mt-2 text-sm leading-5 text-muted">Search recent parcel records and move directly into field, geospatial, or legal follow-up.</Text>
            </View>

            <View className="rounded-3xl border border-border bg-surface p-4">
              <Text className="text-sm font-medium text-foreground">Quick lookup</Text>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search parcel number, owner, or LGA"
                placeholderTextColor="#94A3B8"
                className="mt-3 rounded-2xl border border-border bg-background px-4 py-3 text-foreground"
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          <View className="rounded-2xl border border-border bg-surface p-4">
            <Text className="text-sm text-muted">No parcels match the current search.</Text>
          </View>
        }
      />
    </ScreenContainer>
  );
}
