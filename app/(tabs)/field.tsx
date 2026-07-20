import { ScrollView, Text, View, Pressable } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { findParcel } from "@/lib/mobile-data";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";

function RiskTone({ label, value }: { label: string; value: string }) {
  const accent = value === "high" ? "#DC2626" : value === "moderate" ? "#D97706" : "#059669";
  return (
    <View className="rounded-2xl border border-border bg-background px-4 py-3" style={{ borderColor: accent }}>
      <Text className="text-xs uppercase tracking-wide text-muted">{label}</Text>
      <Text className="mt-2 text-sm font-semibold" style={{ color: accent }}>
        {value}
      </Text>
    </View>
  );
}

export default function FieldScreen() {
  const { bundle, updateMissionStatus } = useMobilePlatformBundle();

  async function advanceMission(missionId: string, currentStatus: "queued" | "active" | "synced") {
    const nextStatus = currentStatus === "queued" ? "active" : "synced";
    await updateMissionStatus({ missionId, status: nextStatus });
  }

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View>
          <Text className="text-3xl font-bold text-foreground">Field Mission</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">A mobile-first field workspace for evidence capture, queue awareness, and sync-safe parcel operations.</Text>
        </View>

        <View className="rounded-3xl bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Mission control</Text>
          <Text className="mt-2 text-sm text-muted">{bundle.missions.filter((mission) => mission.status !== "synced").length} missions need attention. Prioritize high-risk sync packages first.</Text>
          <View className="mt-4 flex-row flex-wrap gap-3">
            <RiskTone label="Queued" value={String(bundle.missions.filter((mission) => mission.status === "queued").length)} />
            <RiskTone label="Active" value={String(bundle.missions.filter((mission) => mission.status === "active").length)} />
            <RiskTone label="High-risk sync" value={String(bundle.missions.filter((mission) => mission.syncRisk === "high").length)} />
          </View>
        </View>

        <View className="gap-4">
          {bundle.missions.map((mission) => {
            const parcel = findParcel(mission.parcelId, bundle.parcels);
            return (
              <View key={mission.id} className="rounded-3xl border border-border bg-surface p-5">
                <View className="flex-row items-start justify-between gap-4">
                  <View className="flex-1">
                    <Text className="text-lg font-semibold text-foreground">{mission.title}</Text>
                    <Text className="mt-1 text-sm text-muted">Parcel {parcel.parcelNumber} · {parcel.lga}, {parcel.state}</Text>
                  </View>
                  <View className="rounded-full bg-background px-3 py-1">
                    <Text className="text-xs font-semibold text-foreground">{mission.status}</Text>
                  </View>
                </View>

                <Text className="mt-4 text-sm text-muted">Evidence items: {mission.evidenceCount} · Last updated: {new Date(mission.lastUpdated).toLocaleString()}</Text>

                <View className="mt-4 flex-row gap-3">
                  <View className="flex-1 rounded-2xl border border-border bg-background p-4">
                    <Text className="text-xs uppercase tracking-wide text-muted">Sync risk</Text>
                    <Text className="mt-2 text-base font-semibold text-foreground">{mission.syncRisk}</Text>
                  </View>
                  <View className="flex-1 rounded-2xl border border-border bg-background p-4">
                    <Text className="text-xs uppercase tracking-wide text-muted">Workflow stage</Text>
                    <Text className="mt-2 text-base font-semibold text-foreground">{parcel.workflowStage}</Text>
                  </View>
                </View>

                <Pressable onPress={() => void advanceMission(mission.id, mission.status)}>
                  <View className="mt-4 rounded-2xl bg-foreground px-4 py-3">
                    <Text className="text-center font-semibold text-background">{mission.status === "queued" ? "Start mission" : mission.status === "active" ? "Mark as synced" : "Synced"}</Text>
                  </View>
                </Pressable>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
