import { Link } from "expo-router";
import { useEffect } from "react";
import { ScrollView, StyleSheet, Text, View, Platform } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";
import type { ParcelRecord } from "@/lib/mobile-data";


function WebLeafletMap({ parcel }: { parcel: ParcelRecord }) {
  useEffect(() => {
    if (Platform.OS === "web") {
      void import("leaflet/dist/leaflet.css");
    }
  }, []);

  if (Platform.OS !== "web") {
    return (
      <View className="rounded-[28px] border border-border bg-surface p-5">
        <Text className="text-lg font-semibold text-foreground">Native map available on device builds</Text>
        <Text className="mt-2 text-sm leading-5 text-muted">
          The native iOS and Android builds use the richer device map surface. The web view now includes a true browser-rendered parcel map for dashboard review and presentation capture.
        </Text>
      </View>
    );
  }

  const { MapContainer, TileLayer, CircleMarker, Popup } = require("react-leaflet");

  return (
    <View className="rounded-[28px] border border-border bg-surface p-5">
      <View className="flex-row items-start justify-between gap-4">
        <View className="flex-1">
          <Text className="text-lg font-semibold text-foreground">Live parcel map in web preview</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            This browser-rendered map is centered on {parcel.parcelNumber} in {parcel.lga}, {parcel.state}. It uses seeded parcel coordinates and OpenStreetMap tiles to provide a true web geospatial view.
          </Text>
        </View>
        <View className="rounded-full bg-background px-3 py-1">
          <Text className="text-xs font-semibold text-foreground">Web map</Text>
        </View>
      </View>

      <View style={styles.mapShell as never}>
        <MapContainer
          center={[parcel.latitude, parcel.longitude]}
          zoom={12}
          scrollWheelZoom={false}
          attributionControl={true}
          style={styles.leafletMap as never}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <CircleMarker
            center={[parcel.latitude, parcel.longitude]}
            radius={12}
            pathOptions={{ color: "#0A5C36", fillColor: "#2563EB", fillOpacity: 0.85, weight: 3 }}
          >
            <Popup>
              <strong>{parcel.parcelNumber}</strong>
              <br />
              {parcel.owner}
              <br />
              {parcel.lga}, {parcel.state}
            </Popup>
          </CircleMarker>
        </MapContainer>
      </View>

      <View className="mt-4 rounded-2xl bg-background p-4">
        <Text className="text-sm text-muted">Current parcel focus</Text>
        <Text className="mt-2 text-lg font-semibold text-foreground">{parcel.parcelNumber}</Text>
        <Text className="mt-1 text-sm text-muted">
          {parcel.owner} · {parcel.lga}, {parcel.state}
        </Text>
        <Text className="mt-1 text-sm text-muted">
          Coordinates: {parcel.latitude.toFixed(4)}, {parcel.longitude.toFixed(4)}
        </Text>
      </View>

      <Link href="/fullscreen-map" asChild>
        <View className="mt-4 rounded-2xl bg-foreground px-4 py-3">
          <Text className="text-center font-semibold text-background">Open full-screen parcel map</Text>
        </View>
      </Link>
    </View>
  );
}

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
  mapShell: {
    width: "100%",
    height: 360,
    marginTop: 16,
    overflow: "hidden",
    borderRadius: 20,
    backgroundColor: "#F3F4F6",
  },
  leafletMap: {
    width: "100%",
    height: "100%",
  },
});
