import { Text, View } from "react-native";

import type { ParcelRecord } from "@/lib/mobile-data";

export function WebLeafletMap({ parcel }: { parcel: ParcelRecord }) {
  return (
    <View className="rounded-[28px] border border-border bg-surface p-5">
      <Text className="text-lg font-semibold text-foreground">Native map available on device builds</Text>
      <Text className="mt-2 text-sm leading-5 text-muted">
        The native iOS and Android builds use the richer device map surface. This parcel is {parcel.parcelNumber} in {parcel.lga}, {parcel.state}.
      </Text>
    </View>
  );
}
