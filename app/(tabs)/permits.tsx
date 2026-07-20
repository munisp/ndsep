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
  return <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>{body}</Pressable>;
}

function daysUntil(dateString: string) {
  const diff = new Date(dateString).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function hoursUntil(dateString: string) {
  const diff = new Date(dateString).getTime() - Date.now();
  return Math.max(0, Math.round(diff / (1000 * 60 * 60)));
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
  nearestDueDays,
  urgentHandoffHours,
}: {
  caseId: string;
  title: string;
  permitType: string;
  sector: string;
  stage: string;
  applicantName: string;
  locationLabel: string;
  priority: string;
  nearestDueDays: number | null;
  urgentHandoffHours: number | null;
}) {
  const toneClass = priority === "critical" ? "text-error" : priority === "elevated" ? "text-warning" : "text-success";
  const warningLabel = nearestDueDays === null ? null : nearestDueDays <= 1 ? "Due within 24h" : nearestDueDays <= 3 ? "Due within 72h" : null;
  const handoffLabel = urgentHandoffHours === null ? null : urgentHandoffHours <= 6 ? `Escalates in ${urgentHandoffHours}h` : urgentHandoffHours <= 24 ? `Handoff due in ${urgentHandoffHours}h` : null;

  return (
    <Link href={{ pathname: "/permit/[id]", params: { id: caseId } }} asChild>
      <Pressable style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
        <View className="rounded-3xl border border-border bg-surface p-5">
          <View className="flex-row flex-wrap items-center gap-2">
            <Pill label={sector.replace("_", " ")} />
            <Pill label={permitType} />
            {warningLabel ? <Pill label={warningLabel} active /> : null}
            {handoffLabel ? <Pill label={handoffLabel} active /> : null}
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

function AnalyticsBar({ label, value, max, tone }: { label: string; value: number; max: number; tone: "primary" | "warning" | "error" | "success" }) {
  const width = (max > 0 ? `${Math.max(10, (value / max) * 100)}%` : "10%") as unknown as `${number}%`;
  const toneClass = tone === "error" ? "bg-error" : tone === "warning" ? "bg-warning" : tone === "success" ? "bg-success" : "bg-primary";
  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-foreground">{label}</Text>
        <Text className="text-xs font-semibold text-muted">{value}</Text>
      </View>
      <View className="h-3 rounded-full bg-border/50">
        <View className={`h-3 rounded-full ${toneClass}`} style={{ width }} />
      </View>
    </View>
  );
}

export default function PermitsScreen() {
  const platformQuery = trpc.permitting.getPlatform.useQuery();
  const activeAgencyUserQuery = trpc.permitting.getActiveAgencyUser.useQuery();
  const queueAnalyticsQuery = trpc.permitting.listQueueAnalytics.useQuery();
  const reminderQuery = trpc.permitting.listReminderQueue.useQuery({ role: activeAgencyUserQuery.data?.role });
  const supervisorAnalyticsQuery = trpc.permitting.listSupervisorExceptionAnalytics.useQuery();

  const platform = platformQuery.data;
  const activeAgencyUser = activeAgencyUserQuery.data;
  const analytics = queueAnalyticsQuery.data ?? [];
  const reminders = reminderQuery.data ?? [];
  const supervisorAnalytics = supervisorAnalyticsQuery.data ?? [];

  const [selectedAgencyId, setSelectedAgencyId] = useState<string>("all");
  const [chartMetric, setChartMetric] = useState<"pending" | "overdue" | "critical">("pending");
  const [exceptionMetric, setExceptionMetric] = useState<"escalatedCount" | "reassignmentCount" | "avgHoursToAssignment">("escalatedCount");

  const filteredQueues = useMemo(() => {
    const queues = platform?.approvalQueues ?? [];
    return selectedAgencyId === "all" ? queues : queues.filter((queue) => queue.agencyId === selectedAgencyId);
  }, [platform?.approvalQueues, selectedAgencyId]);

  const filteredCases = useMemo(() => {
    const cases = platform?.permitCases ?? [];
    if (selectedAgencyId === "all") return cases;
    return cases.filter((item) => item.leadAgencyId === selectedAgencyId || item.participatingAgencyIds.includes(selectedAgencyId));
  }, [platform?.permitCases, selectedAgencyId]);

  const chartData = filteredQueues.map((queue) => {
    const metric = analytics.find((item) => item.agencyId === queue.agencyId && item.role === queue.role);
    return {
      id: queue.id,
      label: queue.title,
      pending: metric?.pendingCount ?? queue.pendingCount,
      overdue: metric?.overdueCount ?? queue.overdueCount,
      critical: metric?.criticalCaseIds.length ?? 0,
    };
  });

  const supervisorChartData = supervisorAnalytics
    .filter((item) => selectedAgencyId === "all" || item.agencyId === selectedAgencyId)
    .map((item) => ({
      id: item.agencyId,
      label: platform?.agencies.find((agency) => agency.id === item.agencyId)?.name ?? item.agencyId,
      escalatedCount: item.escalatedCount,
      reassignmentCount: item.reassignmentCount,
      avgHoursToAssignment: item.avgHoursToAssignment,
      atRiskCaseIds: item.atRiskCaseIds,
    }));

  const chartMax = Math.max(1, ...chartData.map((item) => item[chartMetric]));
  const exceptionMax = Math.max(1, ...supervisorChartData.map((item) => item[exceptionMetric]));
  const totalPending = analytics.reduce((sum, item) => sum + item.pendingCount, 0);
  const totalOverdue = analytics.reduce((sum, item) => sum + item.overdueCount, 0);
  const totalCritical = analytics.reduce((sum, item) => sum + item.criticalCaseIds.length, 0);
  const activeAgencies = platform?.agencies.filter((item) => item.active).length ?? 0;
  const triggeredReminders = reminders.filter((item) => item.status === "triggered").length;
  const warningReminders = reminders.filter((item) => item.severity === "warning").length;

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
        <View className="rounded-[28px] bg-primary p-6">
          <Text className="text-sm font-medium text-white/80">Expanded permitting platform</Text>
          <Text className="mt-3 text-3xl font-bold text-white">Permits and licensing</Text>
          <Text className="mt-3 text-base leading-6 text-white/85">Track mining permits, oil and gas licensing, and multi-agency approvals from one shared product surface with parity across mobile and web.</Text>
          <Text className="mt-4 text-sm text-white/80">Active role: {activeAgencyUser?.role.replace(/_/g, " ") ?? "unassigned"} · Triggered reminders: {triggeredReminders} · Warning reminders: {warningReminders}</Text>
        </View>

        <View className="flex-row gap-3">
          <View className="flex-1 rounded-3xl border border-border bg-surface p-5">
            <Text className="text-sm text-muted">Queued reviews</Text>
            <Text className="mt-3 text-3xl font-bold text-foreground">{totalPending}</Text>
          </View>
          <View className="flex-1 rounded-3xl border border-warning bg-warning/5 p-5">
            <Text className="text-sm text-muted">Reminder warnings</Text>
            <Text className="mt-3 text-3xl font-bold text-warning">{warningReminders}</Text>
          </View>
          <View className="flex-1 rounded-3xl border border-error bg-error/5 p-5">
            <Text className="text-sm text-muted">Escalation due soon</Text>
            <Text className="mt-3 text-3xl font-bold text-error">{triggeredReminders}</Text>
          </View>
          <View className="flex-1 rounded-3xl border border-border bg-surface p-5">
            <Text className="text-sm text-muted">Active agencies</Text>
            <Text className="mt-3 text-3xl font-bold text-success">{activeAgencies}</Text>
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Queue filters</Text>
          <Text className="mt-2 text-sm text-muted">Filter queues and permit cases by lead or participating agency to focus reviewer workload, reminder load, and SLA exposure.</Text>
          <View className="mt-4 flex-row flex-wrap gap-2">
            <Pill label="All agencies" active={selectedAgencyId === "all"} onPress={() => setSelectedAgencyId("all")} />
            {platform?.agencies.map((agency) => (
              <Pill key={agency.id} label={agency.name} active={selectedAgencyId === agency.id} onPress={() => setSelectedAgencyId(agency.id)} />
            ))}
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <View className="flex-row items-center justify-between gap-4">
            <Text className="text-lg font-semibold text-foreground">Background reminder schedule</Text>
            <Text className="text-sm text-muted">Near-due handoffs surfaced for reviewers and supervisors</Text>
          </View>
          <View className="mt-4 gap-3">
            {reminders.length === 0 ? (
              <View className="rounded-2xl border border-border bg-background p-4">
                <Text className="text-sm text-muted">No pending handoff reminders for the active role.</Text>
              </View>
            ) : (
              reminders.slice(0, 5).map((reminder) => (
                <Link key={reminder.id} href={{ pathname: "/permit/[id]", params: { id: reminder.caseId } } as never} asChild>
                  <Pressable style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}> 
                    <View className={`rounded-2xl border p-4 ${reminder.severity === "critical" ? "border-error bg-error/5" : reminder.severity === "warning" ? "border-warning bg-warning/5" : "border-border bg-background"}`}>
                      <View className="flex-row items-center justify-between gap-3">
                        <Text className="flex-1 text-sm font-semibold text-foreground">{reminder.summary}</Text>
                        <Text className={`text-xs font-semibold ${reminder.severity === "critical" ? "text-error" : reminder.severity === "warning" ? "text-warning" : "text-primary"}`}>{reminder.status}</Text>
                      </View>
                      <Text className="mt-2 text-xs text-muted">Reminder at {new Date(reminder.reminderAt).toLocaleString()} · Due in {hoursUntil(reminder.dueAt)}h</Text>
                    </View>
                  </Pressable>
                </Link>
              ))
            )}
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <View className="flex-row items-center justify-between gap-4">
            <Text className="text-lg font-semibold text-foreground">Interactive queue analytics</Text>
            <View className="flex-row gap-2">
              <Pill label="Pending" active={chartMetric === "pending"} onPress={() => setChartMetric("pending")} />
              <Pill label="Overdue" active={chartMetric === "overdue"} onPress={() => setChartMetric("overdue")} />
              <Pill label="Critical" active={chartMetric === "critical"} onPress={() => setChartMetric("critical")} />
            </View>
          </View>
          <View className="mt-4 gap-4">
            {chartData.map((item) => (
              <AnalyticsBar key={item.id} label={item.label} value={item[chartMetric]} max={chartMax} tone={chartMetric === "critical" ? "error" : chartMetric === "overdue" ? "warning" : "primary"} />
            ))}
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">SLA dashboard</Text>
          <View className="mt-4 gap-3">
            {filteredQueues.map((queue) => {
              const metric = analytics.find((item) => item.agencyId === queue.agencyId && item.role === queue.role);
              const nearDeadline = filteredCases.filter((item) => queue.caseIds.includes(item.id)).some((item) => item.obligations.some((obligation) => daysUntil(obligation.dueAt) <= 3));
              const triggeredForQueue = reminders.filter((item) => queue.caseIds.includes(item.caseId) && item.status === "triggered").length;
              return (
                <View key={queue.id} className={`rounded-2xl border p-4 ${triggeredForQueue > 0 ? "border-error bg-error/5" : nearDeadline ? "border-warning bg-warning/5" : "border-border bg-background"}`}>
                  <View className="flex-row items-center justify-between gap-4">
                    <Text className="flex-1 text-base font-semibold text-foreground">{queue.title}</Text>
                    <Text className={`text-sm font-semibold ${triggeredForQueue > 0 ? "text-error" : nearDeadline ? "text-warning" : "text-primary"}`}>{metric?.pendingCount ?? queue.pendingCount} pending</Text>
                  </View>
                  <Text className="mt-2 text-sm leading-5 text-muted">{queue.description}</Text>
                  <Text className="mt-2 text-xs text-muted">Avg SLA: {metric?.avgSlaHours ?? queue.avgSlaHours ?? 0}h · Overdue: {metric?.overdueCount ?? queue.overdueCount} · Triggered reminders: {triggeredForQueue}</Text>
                  <Text className="mt-1 text-xs text-muted">Breached cases: {(metric?.breachedCaseIds ?? queue.breachedCaseIds ?? []).join(", ") || "None"}</Text>
                  {triggeredForQueue > 0 ? <Text className="mt-2 text-xs font-semibold text-error">Urgent: one or more handoffs in this queue are within six hours of escalation.</Text> : nearDeadline ? <Text className="mt-2 text-xs font-semibold text-warning">Warning: one or more permits in this queue approach deadline within 72 hours.</Text> : null}
                </View>
              );
            })}
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <View className="flex-row items-center justify-between gap-4">
            <Text className="text-lg font-semibold text-foreground">Supervisor exception dashboard</Text>
            <View className="flex-row gap-2">
              <Pill label="Escalations" active={exceptionMetric === "escalatedCount"} onPress={() => setExceptionMetric("escalatedCount")} />
              <Pill label="Reassignments" active={exceptionMetric === "reassignmentCount"} onPress={() => setExceptionMetric("reassignmentCount")} />
              <Pill label="Handoff hrs" active={exceptionMetric === "avgHoursToAssignment"} onPress={() => setExceptionMetric("avgHoursToAssignment")} />
            </View>
          </View>
          <Text className="mt-2 text-sm text-muted">Visualize escalation trends, reassignment patterns, and assignment latency to identify workflow bottlenecks across agencies.</Text>
          <View className="mt-4 gap-4">
            {supervisorChartData.map((item) => (
              <View key={item.id} className="rounded-2xl border border-border bg-background p-4">
                <AnalyticsBar label={item.label} value={item[exceptionMetric]} max={exceptionMax} tone={exceptionMetric === "avgHoursToAssignment" ? "warning" : exceptionMetric === "reassignmentCount" ? "primary" : "error"} />
                <Text className="mt-2 text-xs text-muted">At-risk cases: {item.atRiskCaseIds.join(", ") || "None"}</Text>
              </View>
            ))}
          </View>
        </View>

        <View>
          <Text className="text-lg font-semibold text-foreground">Filtered permit cases</Text>
          <View className="mt-3 gap-3">
            {filteredCases.map((item) => {
              const dueDays = item.obligations.length ? Math.min(...item.obligations.map((obligation) => daysUntil(obligation.dueAt))) : null;
              const reminderHours = reminders
                .filter((reminder) => reminder.caseId === item.id)
                .map((reminder) => hoursUntil(reminder.dueAt));
              const nearestReminderHours = reminderHours.length ? Math.min(...reminderHours) : null;
              return (
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
                  nearestDueDays={Number.isFinite(dueDays as number) ? (dueDays as number) : null}
                  urgentHandoffHours={nearestReminderHours}
                />
              );
            })}
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
