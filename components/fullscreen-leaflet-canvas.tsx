import { Text, View } from "react-native";

import type { LayerKey, OverlayDefinition, StateDefinition } from "@/lib/fullscreen-map-data";
import type { ParcelRecord } from "@/lib/mobile-data";

type FullscreenLeafletCanvasProps = {
  activeLayers: LayerKey[];
  mapKey: string;
  overlays: OverlayDefinition[];
  selectedParcelId: number | null;
  stateDataset: StateDefinition;
  stateParcels: ParcelRecord[];
  onSelectParcel: (parcelId: number) => void;
};

/** TypeScript fallback; platform resolution selects the web or native module at runtime. */
export function FullscreenLeafletCanvas({ stateDataset }: FullscreenLeafletCanvasProps) {
  return (
    <View className="mt-5 rounded-3xl border border-border bg-surface p-5">
      <Text className="text-base font-semibold text-foreground">Map workspace opens in the web review surface</Text>
      <Text className="mt-2 text-sm leading-6 text-muted">The active jurisdiction is {stateDataset.label}. Native field mapping remains available through the device map workflow.</Text>
    </View>
  );
}
