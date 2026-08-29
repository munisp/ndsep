import { Link } from "expo-router";
import { ScrollView, StyleSheet, Text, View, Platform, Pressable } from "react-native";
import { useMemo, useState } from "react";

import { ScreenContainer } from "@/components/screen-container";
import {
  countTitleMix,
  filterParcelsForState,
  filterSupportedStateParcels,
  overlayDefinitions,
  stateDefinitions,
  stateKeyFromParcel,
  toggleLayer,
  toggleOverlay,
  type LayerKey,
  type OverlayKey,
  type StateKey,
} from "@/lib/fullscreen-map-data";
import type { ParcelRecord } from "@/lib/mobile-data";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";

let leafletCssLoaded = false;

function ensureLeafletCss() {
  if (Platform.OS === "web" && !leafletCssLoaded) {
    require("leaflet/dist/leaflet.css");
    leafletCssLoaded = true;
  }
}

function MapExperience({ parcels }: { parcels: ParcelRecord[] }) {
  const [activeOverlays, setActiveOverlays] = useState<OverlayKey[]>(["housing", "row", "mining", "infrastructure"]);
  const [activeLayers, setActiveLayers] = useState<LayerKey[]>(["parcels", "boundaries", "districts"]);
  const [selectedState, setSelectedState] = useState<StateKey>("lagos");
  const [selectedParcelId, setSelectedParcelId] = useState<number>(0);

  const supportedParcels = useMemo(() => filterSupportedStateParcels(parcels), [parcels]);

  const stateDataset = useMemo(
    () => stateDefinitions.find((state) => state.key === selectedState) ?? stateDefinitions[0],
    [selectedState],
  );

  const stateParcels = useMemo(() => filterParcelsForState(supportedParcels, selectedState), [selectedState, supportedParcels]);

  const selectedParcel = useMemo(() => {
    const fromSelection = stateParcels.find((parcel) => parcel.id === selectedParcelId);
    return fromSelection ?? stateParcels[0] ?? null;
  }, [selectedParcelId, stateParcels]);

  const center = useMemo<[number, number]>(() => {
    if (selectedParcel) {
      return [selectedParcel.latitude, selectedParcel.longitude];
    }
    return stateDataset.center;
  }, [selectedParcel, stateDataset.center]);

  const titleMix = useMemo(() => countTitleMix(stateParcels), [stateParcels]);

  if (Platform.OS !== "web") {
    return (
      <View className="rounded-[28px] border border-border bg-surface p-6">
        <Text className="text-xl font-semibold text-foreground">Full-screen geospatial map is available on web</Text>
        <Text className="mt-3 text-sm leading-6 text-muted">
          Use the web surface for presentation-grade map review with state parcel layers, administrative boundaries, legends, and corridor overlays. Native builds continue to support in-field map workflows.
        </Text>
      </View>
    );
  }

  ensureLeafletCss();

  const { MapContainer, TileLayer, CircleMarker, Popup, Polyline, Polygon } = require("react-leaflet");

  const overlaysToRender = overlayDefinitions.filter((overlay) => activeOverlays.includes(overlay.key));

  return (
    <View className="gap-5">
      <View className="rounded-[28px] border border-border bg-surface p-5">
        <View className="flex-row items-start justify-between gap-4">
          <View className="flex-1">
            <Text className="text-2xl font-semibold text-foreground">State parcel map workspace</Text>
            <Text className="mt-2 text-sm leading-6 text-muted">
              Switch between Lagos, FCT, and Kano to review parcel markers, administrative boundaries, district lines, and corridor overlays from a true browser-rendered map surface.
            </Text>
          </View>
          <Link href="/(tabs)/geo" asChild>
            <Pressable style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}>
              <Text className="text-sm font-semibold text-background">Return to Geo</Text>
            </Pressable>
          </Link>
        </View>

        <View className="mt-4 flex-row flex-wrap gap-3">
          {stateDefinitions.map((state) => {
            const active = state.key === selectedState;
            return (
              <Pressable
                key={state.key}
                onPress={() => {
                  setSelectedState(state.key);
                  setSelectedParcelId(0);
                }}
                style={({ pressed }) => [styles.stateChip, active && styles.stateChipActive, pressed && styles.stateChipPressed]}
              >
                <Text style={[styles.stateChipLabel, active && styles.stateChipLabelActive]}>{state.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.mapShell}>
          <MapContainer center={center} zoom={stateDataset.zoom} scrollWheelZoom style={styles.mapCanvas} key={selectedState}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {activeLayers.includes("boundaries") ? (
              <Polygon
                positions={stateDataset.boundary}
                pathOptions={{ color: "#0A5C36", weight: 3, fillColor: "#22C55E", fillOpacity: 0.08 }}
              />
            ) : null}
            {activeLayers.includes("districts")
              ? stateDataset.districtLines.map((line, index) => (
                  <Polyline
                    key={`${stateDataset.key}-district-${index}`}
                    positions={line}
                    pathOptions={{ color: "#1D4ED8", weight: 2, opacity: 0.7, dashArray: "8 8" }}
                  />
                ))
              : null}
            {activeLayers.includes("parcels")
              ? stateParcels.map((parcel) => (
                  <CircleMarker
                    key={parcel.id}
                    center={[parcel.latitude, parcel.longitude]}
                    radius={selectedParcel?.id === parcel.id ? 12 : 9}
                    pathOptions={{
                      color: selectedParcel?.id === parcel.id ? "#0A5C36" : "#1D4ED8",
                      fillColor: selectedParcel?.id === parcel.id ? "#22C55E" : "#3B82F6",
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
                ))
              : null}
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
          <Text className="text-lg font-semibold text-foreground">State dataset and layer controls</Text>
          <Text className="mt-2 text-sm leading-6 text-muted">{stateDataset.summary}</Text>

          <View className="mt-4 flex-row gap-3">
            <View className="flex-1 rounded-2xl bg-background p-4">
              <Text className="text-xs uppercase tracking-wide text-muted">Parcels in view</Text>
              <Text className="mt-2 text-2xl font-semibold text-foreground">{stateParcels.length}</Text>
            </View>
            <View className="flex-1 rounded-2xl bg-background p-4">
              <Text className="text-xs uppercase tracking-wide text-muted">LGAs represented</Text>
              <Text className="mt-2 text-2xl font-semibold text-foreground">{new Set(stateParcels.map((parcel) => parcel.lga)).size}</Text>
            </View>
            <View className="flex-1 rounded-2xl bg-background p-4">
              <Text className="text-xs uppercase tracking-wide text-muted">Registered titles</Text>
              <Text className="mt-2 text-2xl font-semibold text-foreground">{titleMix.registered}</Text>
            </View>
          </View>

          <Text className="mt-5 text-sm font-semibold text-foreground">Base layers</Text>
          <View className="mt-3 gap-3">
            {[
              { key: "parcels" as const, label: "Parcel markers", description: "Interactive state-specific parcel records for the active jurisdiction." },
              { key: "boundaries" as const, label: "State boundary", description: "Administrative boundary layer for the active state view." },
              { key: "districts" as const, label: "District lines", description: "Illustrative internal review lines for desk-to-field coordination." },
            ].map((layer) => {
              const active = activeLayers.includes(layer.key);
              return (
                <Pressable
                  key={layer.key}
                  onPress={() => setActiveLayers((current) => toggleLayer(current, layer.key))}
                  style={({ pressed }) => [styles.legendRow, active && styles.legendRowActive, pressed && styles.legendRowPressed]}
                >
                  <View style={[styles.legendSwatch, { backgroundColor: active ? "#0A5C36" : "#9CA3AF" }]} />
                  <View style={styles.legendTextWrap}>
                    <Text className="text-sm font-semibold text-foreground">{layer.label}</Text>
                    <Text className="mt-1 text-xs leading-5 text-muted">{layer.description}</Text>
                  </View>
                  <Text className="text-xs font-semibold text-foreground">{active ? "ON" : "OFF"}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text className="mt-5 text-sm font-semibold text-foreground">Corridor overlays</Text>
          <View className="mt-3 gap-3">
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
                <Text className="mt-2 text-sm leading-6 text-foreground">{selectedParcel.latitude.toFixed(4)}, {selectedParcel.longitude.toFixed(4)}</Text>
                <Text className="mt-2 text-sm leading-6 text-muted">Last action: {selectedParcel.lastAction}</Text>
              </View>
            </View>
          ) : (
            <Text className="mt-4 text-sm leading-6 text-muted">No parcel records are available for this state view.</Text>
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
            A browser-rendered geospatial workspace for Lagos, FCT, and Kano parcel review, administrative boundaries, corridor comparison, and stakeholder presentation across land, housing, right-of-way, mining, and infrastructure workflows.
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
  stateChip: {
    borderWidth: 1,
    borderColor: "#D5D7DA",
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  stateChipActive: {
    borderColor: "#0A5C36",
    backgroundColor: "#F0FDF4",
  },
  stateChipPressed: {
    opacity: 0.9,
  },
  stateChipLabel: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "600",
  },
  stateChipLabelActive: {
    color: "#0A5C36",
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
