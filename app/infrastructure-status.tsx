import { Link } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

const stateStyle: Record<string, string> = { ready: "text-success", emulator: "text-warning", unavailable: "text-warning", blocked: "text-error", disabled: "text-muted", failed: "text-error" };

export default function InfrastructureStatusScreen() {
  const status = trpc.system.infrastructureStatus.useQuery(undefined, { retry: false, refetchInterval: 15_000 });
  const data = status.data;
  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View className="rounded-3xl bg-foreground p-6"><Text className="text-sm text-background/70">Administrator operations</Text><Text className="mt-2 text-3xl font-bold text-background">Infrastructure readiness</Text><Text className="mt-3 text-sm leading-5 text-background/80">Live configuration posture only. “Emulator” never means an authority provider is connected or that a result is production-valid.</Text></View>
        {status.isLoading ? <ActivityIndicator color="#155EEF" /> : null}
        {status.error ? <View className="rounded-2xl border border-error bg-error/10 p-4"><Text className="font-semibold text-error">Administrator access required</Text><Text className="mt-1 text-sm text-foreground">{status.error.message}</Text></View> : null}
        {data ? <>
          <View className={`rounded-3xl border p-5 ${data.runtime.ok ? "border-success bg-success/10" : "border-error bg-error/10"}`}><Text className={`text-lg font-semibold ${data.runtime.ok ? "text-success" : "text-error"}`}>{data.runtime.ok ? "Runtime safeguards present" : "Runtime safeguards incomplete"}</Text><Text className="mt-2 text-sm leading-5 text-foreground">{data.runtime.ok ? "The runtime configuration contract is present. Provider authorization and external evidence remain separate checks." : `Missing: ${data.runtime.missingRequiredChecks.join(", ")}`}</Text></View>
          <View className="rounded-3xl border border-border bg-surface p-5"><Text className="text-lg font-semibold text-foreground">Execution mode</Text><Text className={`mt-2 text-sm font-semibold ${data.executionMode === "simulation" ? "text-warning" : "text-success"}`}>{data.executionMode === "simulation" ? "Simulation — non-authoritative" : "Staging — approved endpoints required"}</Text><Text className="mt-1 text-sm leading-5 text-muted">{data.simulationAllowed ? "Simulation is permitted only because this is a development environment with emulator support explicitly enabled." : "Simulation is disabled for this environment."}</Text></View>
          <View className="gap-3">{data.services.map((service) => <View key={service.id} className="rounded-2xl border border-border bg-surface p-4"><View className="flex-row items-center justify-between gap-3"><Text className="flex-1 text-base font-semibold text-foreground">{service.label}</Text><Text className={`text-xs font-semibold ${stateStyle[service.state] ?? "text-muted"}`}>{service.state.toUpperCase()}</Text></View><Text className="mt-2 text-sm leading-5 text-muted">{service.detail}</Text><Text className="mt-2 text-xs text-muted">{service.authoritative ? "Configured status only; validate the external provider separately." : "Non-authoritative development simulation or disabled capability."}</Text></View>)}</View>
          <Text className="text-center text-xs text-muted">Updated {new Date(data.generatedAt).toLocaleTimeString()}; refreshes every 15 seconds while open.</Text>
        </> : null}
        <Pressable onPress={() => void status.refetch()} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}><View className="rounded-2xl border border-border bg-surface px-4 py-4"><Text className="text-center font-semibold text-foreground">Refresh status</Text></View></Pressable>
        <Link href="/integration-settings" asChild><Pressable style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}><View className="rounded-2xl bg-primary px-4 py-4"><Text className="text-center font-semibold text-background">Open integration settings</Text></View></Pressable></Link>
      </ScrollView>
    </ScreenContainer>
  );
}
