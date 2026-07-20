import { Link } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

function Pill({ label, active = false, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  const body = (
    <View className={`rounded-full border px-3 py-1.5 ${active ? "border-primary bg-primary/10" : "border-border bg-background"}`}>
      <Text className={`text-xs font-semibold uppercase tracking-wide ${active ? "text-primary" : "text-muted"}`}>{label}</Text>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}> 
      {body}
    </Pressable>
  );
}

function PermitCard({
  caseId,
  title,
  permitType,
  sector,
  stage,
  applicantName,
  locationLabel,
  priority,
}: {
  caseId: string;
  title: string;
  permitType: string;
  sector: string;
  stage: string;
  applicantName: string;
  locationLabel: string;
  priority: string;
}) {
  const toneClass =
    priority === "critical" ? "text-error" : priority === "elevated" ? "text-warning" : "text-success";

  return (
    <Link href={{ pathname: "/permit/[id]", params: { id: caseId } }} asChild>
      <Pressable style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}> 
        <View className="rounded-3xl border border-border bg-surface p-5">
          <View className="flex-row flex-wrap items-center gap-2">
            <Pill label={sector.replace("_", " ")} />
            <Pill label={permitType} />
          </View>
          <Text className="mt-4 text-lg font-semibold text-foreground">{title}</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">{applicantName} · {locationLabel}</Text>
          <View className="mt-4 flex-row items-center justify-between gap-4">
            <Text className="text-sm text-muted">Stage: {stage.replace(/_/g, " ")}</Text>
            <Text className={`text-sm font-semibold ${toneClass}`}>{priority}</Text>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

export default function PermitsScreen() {
  const platformQuery = trpc.permitting.getPlatform.useQuery();
  const activeAgencyUserQuery = trpc.permitting.getActiveAgencyUser.useQuery();
  const queueAnalyticsQuery = trpc.permitting.listQueueAnalytics.useQuery();
  const platform = platformQuery.data;
  const activeAgencyUser = activeAgencyUserQuery.data;
  const [selectedAgencyId, setSelectedAgencyId] = useState<string>("all");

  const filteredQueues = useMemo(() => {
    const queues = platform?.approvalQueues ?? [];
    return selectedAgencyId === "all" ? queues : queues.filter((queue) => queue.agencyId === selectedAgencyId);
  }, [platform?.approvalQueues, selectedAgencyId]);

  const filteredCases = useMemo(() => {
    const cases = platform?.permitCases ?? [];
    if (selectedAgencyId === "all") return cases;
    return cases.filter(
      (item) => item.leadAgencyId === selectedAgencyId || item.participatingAgencyIds.includes(selectedAgencyId),
    );
  }, [platform?.permitCases, selectedAgencyId]);

  const analytics = queueAnalyticsQuery.data ?? [];
  const totalPending = analytics.reduce((sum, item) => sum + item.pendingCount, 0);
  const totalOverdue = analytics.reduce((sum, item) => sum + item.overdueCount, 0);
  const activeAgencies = platform?.agencies.filter((item) => item.active).length ?? 0;

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
        <View className="rounded-[28px] bg-primary p-6">
          <Text className="text-sm font-medium text-white/80">Expanded permitting platform</Text>
          <Text className="mt-3 text-3xl font-bold text-white">Permits and licensing</Text>
          <Text className="mt-3 text-base leading-6 text-white/85">
            Track mining permits, oil and gas licensing, and multi-agency approvals from one shared product surface with parity across mobile and web.
          </Text>
          <Text className="mt-4 text-sm text-white/80">
            Active role: {activeAgencyUser?.role.replace(/_/g, " ") ?? "unassigned"}
          </Text>
        </View>

        <View className="flex-row gap-3">
          <View className="flex-1 rounded-3xl border border-border bg-surface p-5">
            <Text className="text-sm text-muted">Queued reviews</Text>
            <Text className="mt-3 text-3xl font-bold text-foreground">{totalPending}</Text>
          </View>
          <View className="flex-1 rounded-3xl border border-border bg-surface p-5">
            <Text className="text-sm text-muted">SLA risks</Text>
            <Text className="mt-3 text-3xl font-bold text-warning">{totalOverdue}</Text>
          </View>
          <View className="flex-1 rounded-3xl border border-border bg-surface p-5">
            <Text className="text-sm text-muted">Active agencies</Text>
            <Text className="mt-3 text-3xl font-bold text-success">{activeAgencies}</Text>
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Queue filters</Text>
          <Text className="mt-2 text-sm text-muted">
            Filter queues and permit cases by lead or participating agency to focus reviewer workload and SLA exposure.
          </Text>
          <View className="mt-4 flex-row flex-wrap gap-2">
            <Pill label="All agencies" active={selectedAgencyId === "all"} onPress={() => setSelectedAgencyId("all")} />
            {platform?.agencies.map((agency) => (
              <Pill
                key={agency.id}
                label={agency.name}
                active={selectedAgencyId === agency.id}
                onPress={() => setSelectedAgencyId(agency.id)}
              />
            ))}
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">SLA dashboard</Text>
          <View className="mt-4 gap-3">
            {filteredQueues.map((queue) => {
              const metric = analytics.find((item) => item.agencyId === queue.agencyId && item.role === queue.role);
              return (
                <View key={queue.id} className="rounded-2xl border border-border bg-background p-4">
                  <View className="flex-row items-center justify-between gap-4">
                    <Text className="flex-1 text-base font-semibold text-foreground">{queue.title}</Text>
                    <Text className="text-sm font-semibold text-primary">{metric?.pendingCount ?? queue.pendingCount} pending</Text>
                  </View>
                  <Text className="mt-2 text-sm leading-5 text-muted">{queue.description}</Text>
                  <Text className="mt-2 text-xs text-muted">
                    Avg SLA: {metric?.avgSlaHours ?? queue.avgSlaHours ?? 0}h · Overdue: {metric?.overdueCount ?? queue.overdueCount}
                  </Text>
                  <Text className="mt-1 text-xs text-muted">
                    Breached cases: {(metric?.breachedCaseIds ?? queue.breachedCaseIds ?? []).join(", ") || "None"}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Product parity</Text>
          <View className="mt-4 gap-3">
            {platform?.parity.map((item) => (
              <View key={item.surface} className="rounded-2xl border border-border bg-background p-4">
                <Text className="text-base font-semibold capitalize text-foreground">{item.surface.replace("_", " ")}</Text>
                <Text className="mt-2 text-sm text-muted">Parity score: {item.score}/100</Text>
                <Text className="mt-2 text-sm leading-5 text-muted">Next focus: {item.nextFocus}</Text>
              </View>
            ))}
          </View>
        </View>

        <View>
          <Text className="text-lg font-semibold text-foreground">Filtered permit cases</Text>
          <View className="mt-3 gap-3">
            {filteredCases.map((item) => (
              <PermitCard
                key={item.id}
                caseId={item.id}
                title={item.title}
                permitType={item.permitType}
                sector={item.sector}
                stage={item.stage}
                applicantName={item.applicantName}
                locationLabel={item.locationLabel}
                priority={item.priority}
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
