import { ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { onboarding, legalWorkflows } from "@/lib/mobile-data";

export default function ProfileScreen() {
  const registeredCount = legalWorkflows.filter((workflow) => workflow.status === "registered").length;

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View className="rounded-[28px] bg-surface p-5">
          <Text className="text-sm text-muted">Operator profile</Text>
          <Text className="mt-2 text-3xl font-bold text-foreground">Registry Operations</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">This mobile shell is tuned for field continuity, parcel intelligence, onboarding, and land-rights progression.</Text>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Stakeholder onboarding</Text>
          <Text className="mt-2 text-sm text-muted">Focus stakeholder: {onboarding.stakeholder}</Text>
          <Text className="mt-2 text-sm text-muted">Next action: {onboarding.nextAction}</Text>

          <View className="mt-4 flex-row gap-3">
            <View className="flex-1 rounded-2xl border border-border bg-background p-4">
              <Text className="text-xs uppercase tracking-wide text-muted">Readiness</Text>
              <Text className="mt-2 text-2xl font-semibold text-foreground">{onboarding.readiness}%</Text>
            </View>
            <View className="flex-1 rounded-2xl border border-border bg-background p-4">
              <Text className="text-xs uppercase tracking-wide text-muted">Liveness</Text>
              <Text className="mt-2 text-base font-semibold text-foreground">{onboarding.livenessStatus}</Text>
            </View>
          </View>

          <View className="mt-4 gap-2">
            <Text className="text-sm text-muted">NIN: {onboarding.ninStatus}</Text>
            <Text className="text-sm text-muted">BVN: {onboarding.bvnStatus}</Text>
            <Text className="text-sm text-muted">KYB: {onboarding.kybStatus}</Text>
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Land-rights workflow continuity</Text>
          <Text className="mt-2 text-sm text-muted">Registered workflows: {registeredCount} of {legalWorkflows.length}</Text>
          <View className="mt-4 gap-3">
            {legalWorkflows.map((workflow) => (
              <View key={workflow.id} className="rounded-2xl border border-border bg-background p-4">
                <Text className="font-semibold text-foreground">{workflow.type}</Text>
                <Text className="mt-1 text-sm text-muted">Status: {workflow.status}</Text>
                <Text className="mt-1 text-sm text-muted">Desk: {workflow.assignedDesk}</Text>
                <Text className="mt-1 text-sm text-muted">Updated: {new Date(workflow.updatedAt).toLocaleString()}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">App readiness</Text>
          <Text className="mt-2 text-sm text-muted">The native shell is ready for authenticated task routing, parcel review, field workflows, and mobile geospatial continuity.</Text>
          <Text className="mt-3 text-sm text-muted">Store-ready native packaging, device credentials, and external service keys remain environment-level concerns beyond this initial in-repository implementation.</Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
