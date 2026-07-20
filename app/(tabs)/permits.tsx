import { Link } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

function Pill({ label }: { label: string }) {
  return (
    <View className="rounded-full border border-border bg-background px-3 py-1.5">
      <Text className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</Text>
    </View>
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
  const toneClass = priority === "critical" ? "text-error" : priority === "elevated" ? "text-warning" : "text-success";

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
  const platform = platformQuery.data;

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
        <View className="rounded-[28px] bg-primary p-6">
          <Text className="text-sm font-medium text-white/80">Expanded permitting platform</Text>
          <Text className="mt-3 text-3xl font-bold text-white">Permits and licensing</Text>
          <Text className="mt-3 text-base leading-6 text-white/85">
            Track mining permits, oil and gas licensing, and multi-agency approvals from one shared product surface with parity across mobile and web.
          </Text>
          <View className="mt-4 flex-row flex-wrap gap-3">
            <View className="rounded-2xl bg-white/10 px-4 py-3">
              <Text className="text-xs text-white/70">Cases</Text>
              <Text className="mt-1 text-xl font-semibold text-white">{platform?.permitCases.length ?? 0}</Text>
            </View>
            <View className="rounded-2xl bg-white/10 px-4 py-3">
              <Text className="text-xs text-white/70">Agencies</Text>
              <Text className="mt-1 text-xl font-semibold text-white">{platform?.agencies.length ?? 0}</Text>
            </View>
            <View className="rounded-2xl bg-white/10 px-4 py-3">
              <Text className="text-xs text-white/70">Middleware</Text>
              <Text className="mt-1 text-xl font-semibold text-white">{platform?.middleware.length ?? 0}</Text>
            </View>
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
          <Text className="text-lg font-semibold text-foreground">Active permit queues</Text>
          <View className="mt-3 gap-3">
            {platform?.permitCases.map((item) => (
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

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Agency routing readiness</Text>
          <View className="mt-4 gap-3">
            {platform?.agencies.map((agency) => (
              <View key={agency.id} className="rounded-2xl border border-border bg-background p-4">
                <View className="flex-row items-center justify-between gap-4">
                  <Text className="flex-1 text-base font-semibold text-foreground">{agency.name}</Text>
                  <Text className="text-sm font-semibold text-primary">{agency.queueDepth} queued</Text>
                </View>
                <Text className="mt-2 text-sm leading-5 text-muted">{agency.role}</Text>
                <Text className="mt-2 text-xs text-muted">{agency.jurisdiction} · SLA {agency.reviewSlaHours}h</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
