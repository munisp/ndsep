import { Link } from "expo-router";
import { ScrollView, StyleSheet, Text, View, Platform, Pressable } from "react-native";
import { useMemo, useState } from "react";

import { ScreenContainer } from "@/components/screen-container";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";
import type { ParcelRecord } from "@/lib/mobile-data";

type OverlayKey = "housing" | "row" | "mining" | "infrastructure";

type OverlayDefinition = {
  key: OverlayKey;
  label: string;
  color: string;
  description: string;
  points: Array<[number, number]>;
};

const overlayDefinitions: OverlayDefinition[] = [
  {
    key: "housing",
    label: "Housing growth corridor",
    color: "#2563EB",
    description: "Priority housing expansion and C of O regularisation belt.",
    points: [
      [6.62, 3.84],
      [6.59, 3.91],
      [6.56, 4.02],
      [6.54, 4.08],
    ],
  },
  {
    key: "row",
    label: "Right-of-way review",
    color: "#D97706",
    description: "Transport and utility right-of-way conflict review corridor.",
    points: [
      [9.11, 7.30],
      [9.09, 7.36],
      [9.07, 7.41],
      [9.04, 7.47],
    ],
  },
  {
    key: "mining",
    label: "Mining oversight corridor",
    color: "#7C3AED",
    description: "Illustrative extractives oversight corridor for license monitoring.",
    points: [
      [11.95, 8.44],
      [11.98, 8.49],
      [12.01, 8.55],
      [12.03, 8.61],
    ],
  },
  {
    key: "infrastructure",
    label: "Infrastructure delivery corridor",
    color: "#0F766E",
    description: "Capital works and resettlement coordination corridor.",
    points: [
      [6.83, 3.08],
      [6.82, 3.13],
      [6.81, 3.18],
      [6.80, 3.23],
    ],
  },
];

let leafletCssLoaded = false;

function ensureLeafletCss() {
  if (Platform.OS === "web" && !leafletCssLoaded) {
    require("leaflet/dist/leaflet.css");
    leafletCssLoaded = true;
  }
}

function toggleOverlay(current: OverlayKey[], key: OverlayKey) {
  return current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
}

function MapExperience({ parcels }: { parcels: ParcelRecord[] }) {
  const [activeOverlays, setActiveOverlays] = useState<OverlayKey[]>(["housing", "row", "mining", "infrastructure"]);
  const [selectedParcelId, setSelectedParcelId] = useState<number>(parcels[0]?.id ?? 0);

  if (Platform.OS !== "web") {
    return (
      <View className="rounded-[28px] border border-border bg-surface p-6">
        <Text className="text-xl font-semibold text-foreground">Full-screen geospatial map is available on web</Text>
        <Text className="mt-3 text-sm leading-6 text-muted">
          Use the web surface for presentation-grade map review with multiple parcel markers, legends, and corridor overlays. Native builds continue to support in-field map workflows.
        </Text>
      </View>
    );
  }

  ensureLeafletCss();

  const { MapContainer, TileLayer, CircleMarker, Popup, Polyline } = require("react-leaflet");

  const center = useMemo<[number, number]>(() => {
    const selected = parcels.find((parcel) => parcel.id === selectedParcelId) ?? parcels[0];
    return selected ? [selected.latitude, selected.longitude] : [9.082, 8.6753];
  }, [parcels, selectedParcelId]);

  const overlaysToRender = overlayDefinitions.filter((overlay) => activeOverlays.includes(overlay.key));
  const selectedParcel = parcels.find((parcel) => parcel.id === selectedParcelId) ?? parcels[0] ?? null;

  return (
    <View className="gap-5">
      <View className="rounded-[28px] border border-border bg-surface p-5">
        <View className="flex-row items-start justify-between gap-4">
          <View className="flex-1">
            <Text className="text-2xl font-semibold text-foreground">National parcel map workspace</Text>
            <Text className="mt-2 text-sm leading-6 text-muted">
              Review parcel concentration, overlay corridors, and location-sensitive approval context from a true browser-rendered map surface. Each marker opens parcel intelligence for land administration, right-of-way, mining, and infrastructure decisions.
            </Text>
          </View>
          <Link href="/geo" asChild>
            <Pressable style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}>
              <Text className="text-sm font-semibold text-background">Return to Geo</Text>
            </Pressable>
          </Link>
        </View>

        <View style={styles.mapShell}>
          <MapContainer center={center} zoom={6} scrollWheelZoom style={styles.mapCanvas}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {parcels.map((parcel) => (
              <CircleMarker
                key={parcel.id}
                center={[parcel.latitude, parcel.longitude]}
                radius={selectedParcelId === parcel.id ? 12 : 9}
                pathOptions={{
                  color: selectedParcelId === parcel.id ? "#0A5C36" : "#1D4ED8",
                  fillColor: selectedParcelId === parcel.id ? "#22C55E" : "#3B82F6",
                  fillOpacity: 0.86,
                  weight: 3,
                }}
                eventHandlers={{ click: () => setSelectedParcelId(parcel.id) }}
              >
                <Popup>
                  <strong>{parcel.parcelNumber}</strong>
                  <br />
                  {parcel.owner}
                  <br />
                  {parcel.lga}, {parcel.state}
                  <br />
                  Title: {parcel.titleStatus}
                </Popup>
              </CircleMarker>
            ))}
            {overlaysToRender.map((overlay) => (
              <Polyline
                key={overlay.key}
                positions={overlay.points}
                pathOptions={{ color: overlay.color, weight: 6, opacity: 0.75, dashArray: "10 8" }}
              />
            ))}
          </MapContainer>
        </View>
      </View>

      <View className="flex-row gap-4">
        <View className="flex-1 rounded-[28px] border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Layer legend</Text>
          <Text className="mt-2 text-sm leading-6 text-muted">
            Toggle layers to compare housing delivery, corridor conflict, extractives oversight, and infrastructure review context on the same parcel map.
          </Text>
          <View className="mt-4 gap-3">
            {overlayDefinitions.map((overlay) => {
              const active = activeOverlays.includes(overlay.key);
              return (
                <Pressable
                  key={overlay.key}
                  onPress={() => setActiveOverlays((current) => toggleOverlay(current, overlay.key))}
                  style={({ pressed }) => [styles.legendRow, active && styles.legendRowActive, pressed && styles.legendRowPressed]}
                >
                  <View style={[styles.legendSwatch, { backgroundColor: overlay.color }]} />
                  <View style={styles.legendTextWrap}>
                    <Text className="text-sm font-semibold text-foreground">{overlay.label}</Text>
                    <Text className="mt-1 text-xs leading-5 text-muted">{overlay.description}</Text>
                  </View>
                  <Text className="text-xs font-semibold text-foreground">{active ? "ON" : "OFF"}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="w-[360px] rounded-[28px] border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Selected parcel intelligence</Text>
          {selectedParcel ? (
            <View className="mt-4 gap-4">
              <View className="rounded-2xl bg-background p-4">
                <Text className="text-xs uppercase tracking-wide text-muted">Parcel</Text>
                <Text className="mt-2 text-xl font-semibold text-foreground">{selectedParcel.parcelNumber}</Text>
                <Text className="mt-1 text-sm text-muted">{selectedParcel.owner} · {selectedParcel.lga}, {selectedParcel.state}</Text>
              </View>
              <View className="rounded-2xl bg-background p-4">
                <Text className="text-xs uppercase tracking-wide text-muted">Workflow context</Text>
                <Text className="mt-2 text-sm leading-6 text-foreground">Title status: {selectedParcel.titleStatus}</Text>
                <Text className="text-sm leading-6 text-foreground">Workflow stage: {selectedParcel.workflowStage}</Text>
                <Text className="text-sm leading-6 text-foreground">Risk score: {selectedParcel.riskScore}</Text>
                <Text className="text-sm leading-6 text-foreground">Area: {selectedParcel.areaHectares} ha</Text>
              </View>
              <View className="rounded-2xl bg-background p-4">
                <Text className="text-xs uppercase tracking-wide text-muted">Coordinates</Text>
                <Text className="mt-2 text-sm leading-6 text-foreground">
                  {selectedParcel.latitude.toFixed(4)}, {selectedParcel.longitude.toFixed(4)}
                </Text>
                <Text className="mt-2 text-sm leading-6 text-muted">Last action: {selectedParcel.lastAction}</Text>
              </View>
            </View>
          ) : (
            <Text className="mt-4 text-sm leading-6 text-muted">No parcel selected.</Text>
          )}
        </View>
      </View>
    </View>
  );
}

export default function FullscreenMapScreen() {
  const { bundle } = useMobilePlatformBundle();

  return (
    <ScreenContainer className="bg-background" edges={["top", "bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.contentContainer}>
        <View>
          <Text className="text-3xl font-bold text-foreground">Full-screen parcel map</Text>
          <Text className="mt-2 text-sm leading-6 text-muted">
            A browser-rendered geospatial workspace for parcel review, corridor comparison, and stakeholder presentation across land, housing, right-of-way, mining, and infrastructure workflows.
          </Text>
        </View>

        <MapExperience parcels={bundle.parcels} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    padding: 20,
    gap: 16,
  },
  actionButton: {
    backgroundColor: "#0F172A",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  actionButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  mapShell: {
    width: "100%",
    height: 620,
    marginTop: 18,
    overflow: "hidden",
    borderRadius: 24,
    backgroundColor: "#E5E7EB",
  },
  mapCanvas: {
    width: "100%",
    height: "100%",
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#D5D7DA",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
  },
  legendRowActive: {
    borderColor: "#0A5C36",
    backgroundColor: "#F0FDF4",
  },
  legendRowPressed: {
    opacity: 0.9,
  },
  legendSwatch: {
    width: 18,
    height: 18,
    borderRadius: 999,
    marginTop: 2,
  },
  legendTextWrap: {
    flex: 1,
  },
});
