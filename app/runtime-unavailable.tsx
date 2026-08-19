import { Link } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

export default function RuntimeUnavailableScreen() {
  const readiness = trpc.system.runtimeReadiness.useQuery(undefined, { retry: false });
  const report = readiness.data;
  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View className="rounded-3xl border border-error bg-error/10 p-6">
          <Text className="text-sm font-semibold text-error">Fail-closed protection</Text>
          <Text className="mt-2 text-3xl font-bold text-foreground">Protected operations are paused</Text>
          <Text className="mt-3 text-sm leading-6 text-muted">This page appears when this target environment lacks required safeguards. It does not mean a provider returned a negative result; it means IDLR-PTS is deliberately declining to proceed.</Text>
        </View>
        {readiness.isLoading ? <ActivityIndicator color="#155EEF" /> : null}
        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Next steps</Text>
          <Text className="mt-3 text-sm leading-6 text-muted">1. Confirm the required runtime settings in the target environment. 2. Run the production configuration preflight. 3. Review the administrator infrastructure dashboard. 4. Do not switch to simulation in production or treat simulations as authority-provider evidence.</Text>
          <Text className="mt-4 text-sm font-semibold text-foreground">Current missing controls</Text>
          <Text className="mt-1 text-sm leading-5 text-muted">{report?.missingRequiredChecks?.join(", ") || "No missing controls were reported. Retry the readiness check or contact an administrator."}</Text>
        </View>
        <Pressable onPress={() => void readiness.refetch()} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}><View className="rounded-2xl bg-foreground px-4 py-4"><Text className="text-center font-semibold text-background">Retry readiness check</Text></View></Pressable>
        <Link href="/(tabs)/profile" asChild><Pressable style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}><View className="rounded-2xl border border-border bg-surface px-4 py-4"><Text className="text-center font-semibold text-foreground">Return to profile</Text></View></Pressable></Link>
      </ScrollView>
    </ScreenContainer>
  );
}
