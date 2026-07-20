import { Link } from "expo-router";
import { ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";
import { trpc } from "@/lib/trpc";

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
    | "/(tabs)/permits"
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
  const permittingQuery = trpc.permitting.getPlatform.useQuery();
  const activeMission = bundle.missions[0];
  const activeParcel = bundle.parcels[0];
  const activeWorkflow = bundle.legalWorkflows[0];
  const platform = permittingQuery.data;
  const criticalPermitCount = platform?.permitCases.filter((item) => item.priority === "critical").length ?? 0;
  const activeAgencyCount = platform?.agencies.filter((item) => item.active).length ?? 0;

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
        <View className="rounded-[28px] bg-primary p-6">
          <Text className="text-sm font-medium text-white/80">IDLR-PTS Platform</Text>
          <Text className="mt-3 text-3xl font-bold text-white">Permitting operations hub</Text>
          <Text className="mt-3 text-base leading-6 text-white/85">
            Coordinate field work, mining permits, oil and gas licensing, and multi-agency approvals from one product surface across native mobile and PWA.
          </Text>
          <View className="mt-4 rounded-2xl bg-white/10 px-4 py-3">
            <Text className="text-sm text-white/85">
              Sync source: {bundle.syncMeta.source} · Pending mutations: {bundle.syncMeta.pendingMutations} · {hasLiveConnection ? "Live API connected" : "Offline cache active"}
            </Text>
            {isRefetching ? <Text className="mt-2 text-xs text-white/70">Refreshing platform data…</Text> : null}
          </View>
        </View>

        <View className="flex-row flex-wrap gap-4">
          <StatCard label="Permit queues" value={String(platform?.permitCases.length ?? 0)} />
          <StatCard label="Critical reviews" value={String(criticalPermitCount)} tone="warning" />
          <StatCard label="Active agencies" value={String(activeAgencyCount)} tone="success" />
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Expanded platform scope</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            The platform now scaffolds three coordinated product lanes: mineral-title administration, petroleum licensing and compliance, and one-stop multi-agency permitting with shared workflow and middleware topology.
          </Text>
          <View className="mt-4 flex-row flex-wrap gap-3">
            {platform?.parity.map((item) => (
              <View key={item.surface} className="min-w-[150px] flex-1 rounded-2xl border border-border bg-background p-4">
                <Text className="text-sm font-semibold capitalize text-foreground">{item.surface.replace("_", " ")}</Text>
                <Text className="mt-2 text-2xl font-bold text-primary">{item.score}</Text>
                <Text className="mt-2 text-xs text-muted">Next focus: {item.nextFocus}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Resume current field work</Text>
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
            <ActionCard title="Permits dashboard" description="Review mining, oil and gas, and multi-agency cases with service topology and parity visibility." href="/(tabs)/permits" />
            <ActionCard title="Parcel lookup" description="Search recent parcels and open the detail context for field, geo, and legal work." href="/(tabs)/parcels" />
            <ActionCard title="Geospatial review" description="Inspect parcel intelligence, location context, and GeoLibre readiness on mobile and web." href="/(tabs)/geo" />
            <ActionCard title="Stakeholder onboarding" description="Run step-by-step KYC, KYB, document analysis, and liveness checks." href="/onboarding" />
            <ActionCard title="Notifications inbox" description="Review synchronized, queued, replayed, and AI-prioritized field plus workflow events in one activity feed." href="/notifications" />
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
