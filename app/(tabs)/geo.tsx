import { Link } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { WebLeafletMap } from "@/components/web-leaflet-map";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";

export default function GeoScreen() {
  const { bundle } = useMobilePlatformBundle();
  const primaryParcel = bundle.parcels[0];

  if (!primaryParcel) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <Text className="text-lg font-semibold text-foreground">No parcel data available</Text>
        <Text className="mt-2 text-center text-sm leading-5 text-muted">
          Seed or sync parcel records to render the geospatial workbench.
        </Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={styles.contentContainer}>
        <View>
          <Text className="text-3xl font-bold text-foreground">Geospatial</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            Inspect parcel intelligence, web map context, nearby records, and GeoLibre readiness from the mobile shell.
          </Text>
        </View>

        <WebLeafletMap parcel={primaryParcel} />

        <View className="gap-4">
          {bundle.parcels.map((parcel) => (
            <View key={parcel.id} className="rounded-3xl border border-border bg-surface p-5">
              <View className="flex-row items-start justify-between gap-4">
                <View className="flex-1">
                  <Text className="text-lg font-semibold text-foreground">{parcel.parcelNumber}</Text>
                  <Text className="mt-1 text-sm text-muted">
                    {parcel.owner} · {parcel.lga}, {parcel.state}
                  </Text>
                </View>
                <View className="rounded-full bg-background px-3 py-1">
                  <Text className="text-xs font-semibold text-foreground">Risk {parcel.riskScore}</Text>
                </View>
              </View>

              <Text className="mt-4 text-sm text-muted">Last action: {parcel.lastAction}</Text>
              <Text className="mt-2 text-sm text-muted">
                Workflow stage: {parcel.workflowStage} · Title status: {parcel.titleStatus}
              </Text>
              <Text className="mt-1 text-sm text-muted">
                Coordinates: {parcel.latitude.toFixed(4)}, {parcel.longitude.toFixed(4)}
              </Text>

              <View className="mt-4 flex-row gap-3">
                <View className="flex-1 rounded-2xl border border-border bg-background p-4">
                  <Text className="text-xs uppercase tracking-wide text-muted">Area</Text>
                  <Text className="mt-2 text-base font-semibold text-foreground">{parcel.areaHectares} ha</Text>
                </View>
                <View className="flex-1 rounded-2xl border border-border bg-background p-4">
                  <Text className="text-xs uppercase tracking-wide text-muted">GeoLibre</Text>
                  <Text className="mt-2 text-base font-semibold text-foreground">
                    {parcel.geolibreReady ? "Ready" : "Pending"}
                  </Text>
                </View>
              </View>

              <View className="mt-4 gap-3">
                <Link href={{ pathname: "/parcel/[id]", params: { id: String(parcel.id) } } as never} asChild>
                  <View className="rounded-2xl bg-foreground px-4 py-3">
                    <Text className="text-center font-semibold text-background">Open parcel detail</Text>
                  </View>
                </Link>
                <Link href={{ pathname: "/geolibre-launch", params: { parcelId: String(parcel.id) } } as never} asChild>
                  <View className="rounded-2xl border border-border bg-background px-4 py-3">
                    <Text className="text-center font-semibold text-foreground">Open GeoLibre launch</Text>
                  </View>
                </Link>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    padding: 20,
    gap: 16,
  },
});
