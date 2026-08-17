import { Link } from "expo-router";
import { ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";
import { trpc } from "@/lib/trpc";
import { useMemo, useState } from "react";

type StakeholderView = "federal" | "state" | "builder";

function StatCard({ label, value, tone = "primary", detail }: { label: string; value: string; tone?: "primary" | "success" | "warning"; detail?: string }) {
  const colors = useColors();
  const accent = tone === "success" ? colors.success : tone === "warning" ? colors.warning : colors.primary;

  return (
    <View className="min-w-[150px] flex-1 rounded-3xl border border-border bg-surface p-4">
      <Text className="text-sm text-muted">{label}</Text>
      <Text className="mt-3 text-3xl font-bold text-foreground" style={{ color: accent }}>
        {value}
      </Text>
      {detail ? <Text className="mt-2 text-xs leading-5 text-muted">{detail}</Text> : null}
    </View>
  );
}

function AudiencePill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Link href={"#" as never} onPress={onPress} asChild>
      <View className={`rounded-full border px-4 py-2 ${active ? "border-primary bg-primary/10" : "border-border bg-background"}`}>
        <Text className={`text-xs font-semibold uppercase tracking-wide ${active ? "text-primary" : "text-muted"}`}>{label}</Text>
      </View>
    </Link>
  );
}

function ScenarioCard({ title, description, metrics }: { title: string; description: string; metrics: Array<{ label: string; value: string }> }) {
  return (
    <View className="rounded-3xl border border-border bg-surface p-5">
      <Text className="text-lg font-semibold text-foreground">{title}</Text>
      <Text className="mt-2 text-sm leading-5 text-muted">{description}</Text>
      <View className="mt-4 gap-2">
        {metrics.map((metric) => (
          <View key={metric.label} className="flex-row items-center justify-between rounded-2xl border border-border bg-background px-4 py-3">
            <Text className="text-sm text-foreground">{metric.label}</Text>
            <Text className="text-sm font-semibold text-primary">{metric.value}</Text>
          </View>
        ))}
      </View>
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
    | "/login"
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
  const [stakeholderView, setStakeholderView] = useState<StakeholderView>("federal");

  const activeMission = bundle.missions[0];
  const activeParcel = bundle.parcels[0];
  const activeWorkflow = bundle.legalWorkflows[0];
  const platform = permittingQuery.data;

  const metrics = useMemo(() => {
    const permitCases = platform?.permitCases ?? [];
    const agencies = platform?.agencies ?? [];
    const queues = platform?.approvalQueues ?? [];
    const reminders = platform?.reminderQueue ?? [];
    const parcels = bundle.parcels ?? [];
    const missions = bundle.missions ?? [];
    const legal = bundle.legalWorkflows ?? [];

    const federalCases = permitCases.filter((item) => ["mining-cadastre", "petroleum-regulator"].includes(item.leadAgencyId));
    const stateCases = permitCases.filter((item) => ["planning-authority", "land-bureau"].includes(item.leadAgencyId));
    const builderCases = permitCases.filter((item) => item.sector === "multi_agency" || item.title.toLowerCase().includes("housing") || item.title.toLowerCase().includes("corridor"));

    return {
      totalPermits: permitCases.length,
      criticalPermits: permitCases.filter((item) => item.priority === "critical").length,
      activeAgencies: agencies.filter((item) => item.active).length,
      totalQueues: queues.length,
      warningReminders: reminders.filter((item) => item.severity === "warning").length,
      criticalReminders: reminders.filter((item) => item.severity === "critical").length,
      activeParcels: parcels.length,
      activeMissions: missions.filter((item) => item.status === "active").length,
      completedLegal: legal.filter((item) => item.status === "registered" || item.status === "approved").length,
      federalCases,
      stateCases,
      builderCases,
    };
  }, [bundle.legalWorkflows, bundle.missions, bundle.parcels, platform]);

  const scenario = useMemo(() => {
    if (stakeholderView === "federal") {
      return {
        title: "Federal regulator view",
        description:
          "This view emphasizes national licensing throughput, critical approvals, inter-agency escalations, and the integrity controls needed for federal oversight across extractives and strategic infrastructure.",
        hero: "Track national permit exposure, escalation risk, and audit integrity from one federal command surface.",
        stats: [
          { label: "Federal permits in scope", value: String(metrics.federalCases.length) },
          { label: "Critical national cases", value: String(metrics.federalCases.filter((item) => item.priority === "critical").length) },
          { label: "Near-due federal reminders", value: String(metrics.criticalReminders + metrics.warningReminders) },
          { label: "Active federal agencies", value: String(metrics.activeAgencies) },
        ],
      };
    }
    if (stakeholderView === "state") {
      return {
        title: "State land agency view",
        description:
          "This view focuses on land regularization, planning approvals, title progression, and public service delivery metrics that matter to governors, commissioners, and land bureau directors.",
        hero: "Coordinate titles, planning clearances, and field verification with state-level visibility into service backlogs and public outcomes.",
        stats: [
          { label: "State-led permits", value: String(metrics.stateCases.length) },
          { label: "Parcels under active management", value: String(metrics.activeParcels) },
          { label: "Active field missions", value: String(metrics.activeMissions) },
          { label: "Registered or approved legal files", value: String(metrics.completedLegal) },
        ],
      };
    }
    return {
      title: "Builder and delivery partner view",
      description:
        "This view highlights project certainty, coordinated approvals, site-readiness, beneficiary and corridor visibility, and the practical reduction of approval delays that affect builders and investors.",
      hero: "Reduce approval uncertainty, surface blockers early, and coordinate housing, infrastructure, and utility permissions from one operating workflow.",
      stats: [
        { label: "Builder-relevant permits", value: String(metrics.builderCases.length) },
        { label: "Open queue touchpoints", value: String(metrics.totalQueues) },
        { label: "Reminder warnings", value: String(metrics.warningReminders) },
        { label: "Critical reviews", value: String(metrics.criticalPermits) },
      ],
    };
  }, [metrics, stakeholderView]);

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
        <View className="rounded-[28px] bg-primary p-6">
          <Text className="text-sm font-medium text-white/80">IDLR-PTS Platform</Text>
          <Text className="mt-3 text-3xl font-bold text-white">Permitting operations hub</Text>
          <Text className="mt-3 text-base leading-6 text-white/85">{scenario.hero}</Text>
          <View className="mt-4 rounded-2xl bg-white/10 px-4 py-3">
            <Text className="text-sm text-white/85">
              Sync source: {bundle.syncMeta.source} · Pending mutations: {bundle.syncMeta.pendingMutations} · {hasLiveConnection ? "Live API connected" : "Offline cache active"}
            </Text>
            {isRefetching ? <Text className="mt-2 text-xs text-white/70">Refreshing platform data…</Text> : null}
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Audience mode</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">Switch the dashboard emphasis to show the value story most relevant to federal regulators, state land agencies, or builders and delivery partners.</Text>
          <View className="mt-4 flex-row flex-wrap gap-2">
            <AudiencePill label="Federal" active={stakeholderView === "federal"} onPress={() => setStakeholderView("federal")} />
            <AudiencePill label="State" active={stakeholderView === "state"} onPress={() => setStakeholderView("state")} />
            <AudiencePill label="Builders" active={stakeholderView === "builder"} onPress={() => setStakeholderView("builder")} />
          </View>
        </View>

        <View className="flex-row flex-wrap gap-4">
          {scenario.stats.map((item, index) => (
            <StatCard
              key={item.label}
              label={item.label}
              value={item.value}
              tone={index === 1 ? "warning" : index === 3 ? "success" : "primary"}
            />
          ))}
        </View>

        <ScenarioCard title={scenario.title} description={scenario.description} metrics={scenario.stats} />

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Live operating snapshot</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            The seeded platform now reflects realistic Nigerian permitting activity across extractives, infrastructure, land administration, field inspection, and affordable housing workflows.
          </Text>
          <View className="mt-4 flex-row flex-wrap gap-3">
            <View className="min-w-[160px] flex-1 rounded-2xl border border-border bg-background p-4">
              <Text className="text-sm font-semibold text-foreground">Permit queues</Text>
              <Text className="mt-2 text-2xl font-bold text-primary">{metrics.totalQueues}</Text>
              <Text className="mt-2 text-xs text-muted">Across mining, petroleum, environmental, and planning authorities.</Text>
            </View>
            <View className="min-w-[160px] flex-1 rounded-2xl border border-border bg-background p-4">
              <Text className="text-sm font-semibold text-foreground">Permits in flight</Text>
              <Text className="mt-2 text-2xl font-bold text-foreground">{metrics.totalPermits}</Text>
              <Text className="mt-2 text-xs text-muted">Including housing, corridor, quarry, offshore, and mineral title scenarios.</Text>
            </View>
            <View className="min-w-[160px] flex-1 rounded-2xl border border-border bg-background p-4">
              <Text className="text-sm font-semibold text-foreground">Near-due reminders</Text>
              <Text className="mt-2 text-2xl font-bold text-warning">{metrics.warningReminders + metrics.criticalReminders}</Text>
              <Text className="mt-2 text-xs text-muted">Scheduled warnings and escalations for handoffs approaching SLA deadlines.</Text>
            </View>
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
            <ActionCard title="Permits dashboard" description="Review live queue analytics, stakeholder scenarios, and deadline urgency signals from the seeded operating data." href="/(tabs)/permits" />
            <ActionCard title="Parcel lookup" description="Search recent parcels and open the detail context for field, geo, and legal work." href="/(tabs)/parcels" />
            <ActionCard title="Geospatial review" description="Inspect parcel intelligence, location context, and GeoLibre readiness on mobile and web." href="/(tabs)/geo" />
            <ActionCard title="Stakeholder onboarding" description="Review realistic KYC, KYB, document analysis, and liveness workflows for builders and cooperatives." href="/onboarding" />
            <ActionCard title="Secure stakeholder sign-in" description="Use an approved enterprise identity to sign in, bind the native session to device biometrics, or begin authorised registration." href="/login" />
            <ActionCard title="Notifications center" description="See deadline alerts, supervisor digests, and AI-prioritized field plus workflow events in one activity feed." href="/notifications" />
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
