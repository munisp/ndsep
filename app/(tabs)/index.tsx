import { Link } from "expo-router";
import { ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";

function StatCard({ label, value, tone = "primary" }: { label: string; value: string; tone?: "primary" | "success" | "warning" }) {
  const colors = useColors();
  const accent = tone === "success" ? colors.success : tone === "warning" ? colors.warning : colors.primary;

  return (
    <View className="flex-1 rounded-3xl border border-border bg-surface p-4" style={{ minWidth: 150 }}>
      <Text className="text-sm text-muted">{label}</Text>
      <Text className="mt-3 text-3xl font-bold text-foreground" style={{ color: accent }}>
        {value}
      </Text>
    </View>
  );
}

function ActionCard({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href:
    | "/(tabs)/parcels"
    | "/(tabs)/field"
    | "/(tabs)/geo"
    | "/(tabs)/profile"
    | "/onboarding"
    | "/legal-workflow"
    | "/notifications";
}) {
  return (
    <Link href={href as never} asChild>
      <View className="rounded-3xl border border-border bg-surface p-4">
        <Text className="text-base font-semibold text-foreground">{title}</Text>
        <Text className="mt-2 text-sm leading-5 text-muted">{description}</Text>
      </View>
    </Link>
  );
}

export default function HomeScreen() {
  const { bundle, isRefetching, hasLiveConnection } = useMobilePlatformBundle();
  const activeMission = bundle.missions[0];
  const activeParcel = bundle.parcels[0];
  const activeWorkflow = bundle.legalWorkflows[0];

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
        <View className="rounded-[28px] bg-primary p-6">
          <Text className="text-sm font-medium text-white/80">IDLR-PTS Mobile</Text>
          <Text className="mt-3 text-3xl font-bold text-white">Mission Hub</Text>
          <Text className="mt-3 text-base leading-6 text-white/85">
            Continue field work, parcel intelligence, onboarding, and land-rights operations from one native mobile shell.
          </Text>
          <View className="mt-4 rounded-2xl bg-white/10 px-4 py-3">
            <Text className="text-sm text-white/85">
              Sync source: {bundle.syncMeta.source} · Pending mutations: {bundle.syncMeta.pendingMutations} · {hasLiveConnection ? "Live API connected" : "Offline cache active"}
            </Text>
            {isRefetching ? <Text className="mt-2 text-xs text-white/70">Refreshing platform data…</Text> : null}
          </View>
        </View>

        <View className="flex-row flex-wrap gap-4">
          <StatCard label="Parcels in focus" value={String(bundle.parcels.length)} />
          <StatCard label="Active missions" value={String(bundle.missions.filter((mission) => mission.status !== "synced").length)} tone="success" />
          <StatCard label="Onboarding readiness" value={`${bundle.onboarding.readiness}%`} tone="warning" />
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Resume current work</Text>
          <Text className="mt-2 text-sm text-muted">{activeMission.title}</Text>
          <Text className="mt-3 text-sm text-muted">
            Parcel {activeParcel.parcelNumber} · {activeMission.evidenceCount} evidence items · Sync risk {activeMission.syncRisk}
          </Text>
          <Link href={"/(tabs)/field" as never} asChild>
            <View className="mt-4 rounded-2xl bg-foreground px-4 py-4">
              <Text className="text-center text-base font-semibold text-background">Open field mission</Text>
            </View>
          </Link>
        </View>

        <View>
          <Text className="text-lg font-semibold text-foreground">Quick actions</Text>
          <View className="mt-3 gap-3">
            <ActionCard title="Parcel lookup" description="Search recent parcels and open the detail context for field, geo, and legal work." href="/(tabs)/parcels" />
            <ActionCard title="Geospatial review" description="Inspect parcel intelligence, location context, and GeoLibre readiness on mobile." href="/(tabs)/geo" />
            <ActionCard title="Stakeholder onboarding" description="Run step-by-step KYC, KYB, document analysis, and liveness checks." href="/onboarding" />
            <ActionCard title="C of O workflow" description="Advance Certificate of Occupancy and related legal records through review, signing, and registration." href="/legal-workflow" />
            <ActionCard title="Notifications inbox" description="Review synchronized, queued, and replayed field plus workflow events in one mobile activity feed." href="/notifications" />
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Legal workflow status</Text>
          <Text className="mt-2 text-sm text-muted">{activeWorkflow.type} for parcel {activeParcel.parcelNumber}</Text>
          <Text className="mt-3 text-sm text-muted">Current state: {activeWorkflow.status} · Desk: {activeWorkflow.assignedDesk}</Text>
          <Text className="mt-2 text-sm text-muted">Registration reference: {activeWorkflow.registrationNumber ?? "Pending final issuance"}</Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
