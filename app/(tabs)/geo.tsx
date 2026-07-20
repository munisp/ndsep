import { ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { parcels } from "@/lib/mobile-data";

export default function GeoScreen() {
  const primaryParcel = parcels[0];

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View>
          <Text className="text-3xl font-bold text-foreground">Geospatial</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">Inspect parcel intelligence, nearby records, and GeoLibre readiness from the mobile shell.</Text>
        </View>

        <View className="rounded-[28px] border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Native map available on device builds</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            The native iOS and Android builds use a real mobile map surface. The web preview keeps the parcel intelligence workflow available without requiring native map rendering.
          </Text>
          <View className="mt-4 rounded-2xl bg-background p-4">
            <Text className="text-sm text-muted">Primary parcel</Text>
            <Text className="mt-2 text-lg font-semibold text-foreground">{primaryParcel.parcelNumber}</Text>
            <Text className="mt-1 text-sm text-muted">{primaryParcel.owner} · {primaryParcel.lga}, {primaryParcel.state}</Text>
          </View>
        </View>

        <View className="gap-4">
          {parcels.map((parcel) => (
            <View key={parcel.id} className="rounded-3xl border border-border bg-surface p-5">
              <View className="flex-row items-start justify-between gap-4">
                <View className="flex-1">
                  <Text className="text-lg font-semibold text-foreground">{parcel.parcelNumber}</Text>
                  <Text className="mt-1 text-sm text-muted">{parcel.owner} · {parcel.lga}, {parcel.state}</Text>
                </View>
                <View className="rounded-full bg-background px-3 py-1">
                  <Text className="text-xs font-semibold text-foreground">Risk {parcel.riskScore}</Text>
                </View>
              </View>

              <Text className="mt-4 text-sm text-muted">Last action: {parcel.lastAction}</Text>
              <Text className="mt-2 text-sm text-muted">Workflow stage: {parcel.workflowStage} · Title status: {parcel.titleStatus}</Text>

              <View className="mt-4 flex-row gap-3">
                <View className="flex-1 rounded-2xl border border-border bg-background p-4">
                  <Text className="text-xs uppercase tracking-wide text-muted">Area</Text>
                  <Text className="mt-2 text-base font-semibold text-foreground">{parcel.areaHectares} ha</Text>
                </View>
                <View className="flex-1 rounded-2xl border border-border bg-background p-4">
                  <Text className="text-xs uppercase tracking-wide text-muted">GeoLibre</Text>
                  <Text className="mt-2 text-base font-semibold text-foreground">{parcel.geolibreReady ? "Ready" : "Pending"}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
