import { Link } from "expo-router";
import { ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";

export default function ProfileScreen() {
  const { bundle, hasLiveConnection } = useMobilePlatformBundle();
  const registeredCount = bundle.legalWorkflows.filter((workflow) => workflow.status === "registered").length;

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View className="rounded-[28px] bg-surface p-5">
          <Text className="text-sm text-muted">Operator profile</Text>
          <Text className="mt-2 text-3xl font-bold text-foreground">Registry Operations</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            This mobile shell is tuned for field continuity, parcel intelligence, onboarding, and land-rights progression.
          </Text>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Stakeholder onboarding</Text>
          <Text className="mt-2 text-sm text-muted">Focus stakeholder: {bundle.onboarding.stakeholder}</Text>
          <Text className="mt-2 text-sm text-muted">Next action: {bundle.onboarding.nextAction}</Text>

          <View className="mt-4 flex-row gap-3">
            <View className="flex-1 rounded-2xl border border-border bg-background p-4">
              <Text className="text-xs uppercase tracking-wide text-muted">Readiness</Text>
              <Text className="mt-2 text-2xl font-semibold text-foreground">{bundle.onboarding.readiness}%</Text>
            </View>
            <View className="flex-1 rounded-2xl border border-border bg-background p-4">
              <Text className="text-xs uppercase tracking-wide text-muted">Liveness</Text>
              <Text className="mt-2 text-base font-semibold text-foreground">{bundle.onboarding.livenessStatus}</Text>
            </View>
          </View>

          <View className="mt-4 gap-2">
            <Text className="text-sm text-muted">NIN: {bundle.onboarding.ninStatus}</Text>
            <Text className="text-sm text-muted">BVN: {bundle.onboarding.bvnStatus}</Text>
            <Text className="text-sm text-muted">KYB: {bundle.onboarding.kybStatus}</Text>
            <Text className="text-sm text-muted">Sync: {hasLiveConnection ? "Live API connected" : "Offline cache in use"}</Text>
          </View>

          <Link href={"/onboarding" as never} asChild>
            <View className="mt-4 rounded-2xl bg-foreground px-4 py-4">
              <Text className="text-center font-semibold text-background">Open onboarding workflow</Text>
            </View>
          </Link>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Land-rights workflow continuity</Text>
          <Text className="mt-2 text-sm text-muted">Registered workflows: {registeredCount} of {bundle.legalWorkflows.length}</Text>
          <View className="mt-4 gap-3">
            {bundle.legalWorkflows.map((workflow) => (
              <View key={workflow.id} className="rounded-2xl border border-border bg-background p-4">
                <Text className="font-semibold text-foreground">{workflow.type}</Text>
                <Text className="mt-1 text-sm text-muted">Status: {workflow.status}</Text>
                <Text className="mt-1 text-sm text-muted">Desk: {workflow.assignedDesk}</Text>
                <Text className="mt-1 text-sm text-muted">Updated: {new Date(workflow.updatedAt).toLocaleString()}</Text>
              </View>
            ))}
          </View>

          <Link href={"/legal-workflow" as never} asChild>
            <View className="mt-4 rounded-2xl border border-border bg-background px-4 py-4">
              <Text className="text-center font-semibold text-foreground">Open legal workflow</Text>
            </View>
          </Link>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">App readiness</Text>
          <Text className="mt-2 text-sm text-muted">
            The native shell is now connected to live mobile APIs for parcel, onboarding, mission, and legal workflow continuity while preserving offline cache recovery.
          </Text>
          <Text className="mt-3 text-sm text-muted">
            Store-ready credentials, external compliance integrations, and production infrastructure still remain environment-level concerns beyond this in-repository implementation.
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
