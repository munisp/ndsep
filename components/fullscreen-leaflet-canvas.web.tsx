import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import type { LayerKey, OverlayDefinition, StateDefinition } from "@/lib/fullscreen-map-data";
import type { ParcelRecord } from "@/lib/mobile-data";

type LeafletRuntime = Pick<typeof import("react-leaflet"), "CircleMarker" | "MapContainer" | "Polygon" | "Polyline" | "Popup" | "TileLayer">;

type FullscreenLeafletCanvasProps = {
  activeLayers: LayerKey[];
  mapKey: string;
  overlays: OverlayDefinition[];
  selectedParcelId: number | null;
  stateDataset: StateDefinition;
  stateParcels: ParcelRecord[];
  onSelectParcel: (parcelId: number) => void;
};

export function FullscreenLeafletCanvas({ activeLayers, mapKey, overlays, selectedParcelId, stateDataset, stateParcels, onSelectParcel }: FullscreenLeafletCanvasProps) {
  const [leaflet, setLeaflet] = useState<LeafletRuntime | null>(null);
  const selectedParcel = useMemo(() => stateParcels.find((parcel) => parcel.id === selectedParcelId) ?? null, [selectedParcelId, stateParcels]);
  const center = selectedParcel ? [selectedParcel.latitude, selectedParcel.longitude] as [number, number] : stateDataset.center;

  useEffect(() => {
    let active = true;
    void import("leaflet/dist/leaflet.css");
    void import("react-leaflet").then((module) => {
      if (active) setLeaflet(module);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!leaflet) return <View style={styles.mapShell} />;

  const { CircleMarker, MapContainer, Polygon, Polyline, Popup, TileLayer } = leaflet;

  return (
    <View style={styles.mapShell}>
      <MapContainer center={center} zoom={stateDataset.zoom} scrollWheelZoom style={styles.mapCanvas} key={mapKey}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {activeLayers.includes("boundaries") ? <Polygon positions={stateDataset.boundary} pathOptions={{ color: "#0A5C36", weight: 3, fillColor: "#22C55E", fillOpacity: 0.08 }} /> : null}
        {activeLayers.includes("districts")
          ? stateDataset.districtLines.map((line, index) => <Polyline key={`${stateDataset.key}-district-${index}`} positions={line} pathOptions={{ color: "#1D4ED8", weight: 2, opacity: 0.7, dashArray: "8 8" }} />)
          : null}
        {activeLayers.includes("parcels")
          ? stateParcels.map((parcel) => (
              <CircleMarker
                key={parcel.id}
                center={[parcel.latitude, parcel.longitude]}
                radius={selectedParcelId === parcel.id ? 12 : 9}
                pathOptions={{ color: selectedParcelId === parcel.id ? "#0A5C36" : "#1D4ED8", fillColor: selectedParcelId === parcel.id ? "#22C55E" : "#3B82F6", fillOpacity: 0.86, weight: 3 }}
                eventHandlers={{ click: () => onSelectParcel(parcel.id) }}
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
        {overlays.map((overlay) => <Polyline key={overlay.key} positions={overlay.points} pathOptions={{ color: overlay.color, weight: 6, opacity: 0.75, dashArray: "10 8" }} />)}
      </MapContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  mapShell: { width: "100%", height: 620, marginTop: 18, overflow: "hidden", borderRadius: 24, backgroundColor: "#E5E7EB" },
  mapCanvas: { width: "100%", height: "100%" },
});
