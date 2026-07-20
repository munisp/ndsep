import { useLocalSearchParams } from "expo-router";
import { ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="rounded-3xl border border-border bg-surface p-5">
      <Text className="text-lg font-semibold text-foreground">{title}</Text>
      <View className="mt-4 gap-3">{children}</View>
    </View>
  );
}

export default function PermitDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const caseId = params.id ?? "permit-mining-001";
  const platformQuery = trpc.permitting.getPlatform.useQuery();
  const record = platformQuery.data?.permitCases.find((item) => item.id === caseId) ?? null;
  const agencies = platformQuery.data?.agencies ?? [];
  const services = platformQuery.data?.services ?? [];

  if (!record) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <Text className="text-lg font-semibold text-foreground">Permit case not found</Text>
        <Text className="mt-2 text-center text-sm text-muted">The selected permit detail could not be loaded from the expanded platform snapshot.</Text>
      </ScreenContainer>
    );
  }

  const leadAgency = agencies.find((item) => item.id === record.leadAgencyId) ?? null;
  const participatingAgencies = agencies.filter((item) => record.participatingAgencyIds.includes(item.id));

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
        <View className="rounded-[28px] bg-primary p-6">
          <Text className="text-sm font-medium text-white/80">{record.permitType}</Text>
          <Text className="mt-3 text-3xl font-bold text-white">{record.title}</Text>
          <Text className="mt-3 text-base leading-6 text-white/85">{record.summary}</Text>
          <Text className="mt-4 text-sm text-white/80">{record.applicantName} · {record.locationLabel} · {record.assetReference}</Text>
        </View>

        <SectionCard title="Lifecycle timeline">
          {record.timeline.map((entry) => (
            <View key={entry.key} className="rounded-2xl border border-border bg-background p-4">
              <Text className="text-base font-semibold text-foreground">{entry.label}</Text>
              <Text className="mt-1 text-sm text-muted">{entry.completed ? "Completed" : "Pending"}</Text>
              <Text className="mt-1 text-xs text-muted">{entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "Awaiting progression"}</Text>
            </View>
          ))}
        </SectionCard>

        <SectionCard title="Obligations and risk">
          {record.obligations.map((item) => (
            <View key={item.id} className="rounded-2xl border border-border bg-background p-4">
              <View className="flex-row items-center justify-between gap-4">
                <Text className="flex-1 text-base font-semibold text-foreground">{item.title}</Text>
                <Text className="text-sm font-semibold text-primary">{item.status}</Text>
              </View>
              <Text className="mt-2 text-sm text-muted">Owner: {item.owner}</Text>
              <Text className="mt-1 text-xs text-muted">Due {new Date(item.dueAt).toLocaleString()}</Text>
            </View>
          ))}
        </SectionCard>

        <SectionCard title="Agency coordination">
          <View className="rounded-2xl border border-border bg-background p-4">
            <Text className="text-base font-semibold text-foreground">Lead agency</Text>
            <Text className="mt-2 text-sm text-muted">{leadAgency?.name ?? "Unknown lead agency"}</Text>
            <Text className="mt-1 text-xs text-muted">{leadAgency?.role ?? "Lead role unavailable"}</Text>
          </View>
          {participatingAgencies.map((agency) => (
            <View key={agency.id} className="rounded-2xl border border-border bg-background p-4">
              <Text className="text-base font-semibold text-foreground">{agency.name}</Text>
              <Text className="mt-2 text-sm text-muted">{agency.role}</Text>
              <Text className="mt-1 text-xs text-muted">{agency.jurisdiction} · SLA {agency.reviewSlaHours}h</Text>
            </View>
          ))}
        </SectionCard>

        <SectionCard title="Polyglot service topology">
          {services.map((service) => (
            <View key={service.id} className="rounded-2xl border border-border bg-background p-4">
              <View className="flex-row items-center justify-between gap-4">
                <Text className="flex-1 text-base font-semibold text-foreground">{service.name}</Text>
                <Text className="text-sm font-semibold text-primary">{service.language}</Text>
              </View>
              <Text className="mt-2 text-sm leading-5 text-muted">{service.responsibility}</Text>
              <Text className="mt-2 text-xs text-muted">Runtime: {service.runtimeMode.replace(/_/g, " ")} · Endpoint: {service.endpointPath}</Text>
            </View>
          ))}
        </SectionCard>
      </ScrollView>
    </ScreenContainer>
  );
}
