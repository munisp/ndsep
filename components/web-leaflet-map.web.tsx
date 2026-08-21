import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { ParcelRecord } from "@/lib/mobile-data";

type LeafletRuntime = Pick<typeof import("react-leaflet"), "CircleMarker" | "MapContainer" | "Popup" | "TileLayer">;

export function WebLeafletMap({ parcel }: { parcel: ParcelRecord }) {
  const [leaflet, setLeaflet] = useState<LeafletRuntime | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void import("leaflet/dist/leaflet.css");
    void import("react-leaflet")
      .then((module) => {
        if (active) setLeaflet(module);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!leaflet) {
    return (
      <View className="rounded-[28px] border border-border bg-surface p-5">
        <Text className="text-lg font-semibold text-foreground">{loadError ? "Web map unavailable" : "Preparing web map"}</Text>
        <Text className="mt-2 text-sm leading-5 text-muted">{loadError ? "The browser map library could not be loaded. Parcel details remain available below." : "Loading the browser-only geospatial workspace without starting a native map dependency."}</Text>
      </View>
    );
  }

  const { CircleMarker, MapContainer, Popup, TileLayer } = leaflet;
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
          attributionControl
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
    </View>
  );
}

const styles = StyleSheet.create({
  mapShell: { width: "100%", height: 360, marginTop: 16, overflow: "hidden", borderRadius: 20, backgroundColor: "#F3F4F6" },
  leafletMap: { width: "100%", height: "100%" },
});
