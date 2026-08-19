import { Link } from "expo-router";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";

import { trpc } from "@/lib/trpc";

export function RuntimeUnavailableNotice() {
  const readiness = trpc.system.runtimeReadiness.useQuery(undefined, { retry: false, refetchInterval: 30_000 });
  const blocked = readiness.data?.mode === "production" && readiness.data.ok === false;
  if (!blocked) return null;
  const missing = readiness.data?.missingRequiredChecks ?? [];
  return (
    <Modal transparent animationType="fade" visible>
      <View className="flex-1 items-center justify-center bg-black/60 p-6">
        <View className="w-full max-w-xl rounded-3xl border border-error bg-background p-6">
          <Text className="text-sm font-semibold text-error">Service protection active</Text>
          <Text className="mt-2 text-2xl font-bold text-foreground">This environment is not ready</Text>
          <Text className="mt-3 text-sm leading-5 text-muted">IDLR-PTS has paused protected operations because required runtime safeguards are unavailable. No provider, payment, or evidence outcome is being represented as valid.</Text>
          <Text className="mt-4 text-sm font-semibold text-foreground">Missing controls</Text>
          <Text className="mt-1 text-sm leading-5 text-muted">{missing.join(", ") || "Runtime readiness could not determine the missing controls."}</Text>
          <Text className="mt-4 text-sm leading-5 text-muted">Contact your platform administrator. Administrators can review non-secret status and configure approved staging services; simulation cannot be enabled in production.</Text>
          <View className="mt-5 flex-row gap-3">
            <Pressable onPress={() => void readiness.refetch()} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.78 : 1 }]}>
              <View className="items-center rounded-2xl bg-foreground px-4 py-3">{readiness.isFetching ? <ActivityIndicator color="#FFFFFF" /> : <Text className="font-semibold text-background">Check again</Text>}</View>
            </Pressable>
            <Link href={"/runtime-unavailable" as never} asChild><Pressable style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.78 : 1 }]}><View className="items-center rounded-2xl border border-border px-4 py-3"><Text className="font-semibold text-foreground">View guidance</Text></View></Pressable></Link>
          </View>
        </View>
      </View>
    </Modal>
  );
}
