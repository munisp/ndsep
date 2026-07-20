import { useEffect, useState } from "react";
import { Link } from "expo-router";
import { RefreshControl, ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import type { ActivityRecord } from "@/lib/mobile-activity";
import { getActivityFeed } from "@/lib/mobile-activity";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";

const toneStyles = {
  info: "bg-primary/10 text-primary border-primary/20",
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
} as const;

export default function NotificationsScreen() {
  const { bundle, refresh, isRefetching } = useMobilePlatformBundle();
  const [items, setItems] = useState<ActivityRecord[]>([]);

  async function loadFeed() {
    const feed = await getActivityFeed();
    setItems(feed);
  }

  useEffect(() => {
    void loadFeed();
  }, []);

  async function handleRefresh() {
    await refresh();
    await loadFeed();
  }

  return (
    <ScreenContainer className="bg-background">
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void handleRefresh()} />}
      >
        <View>
          <Text className="text-3xl font-bold text-foreground">Notifications</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            Review synchronized field updates, offline replay events, onboarding changes, and legal workflow progression from one mobile inbox.
          </Text>
        </View>

        <View className="rounded-[28px] bg-primary p-5">
          <Text className="text-sm text-white/80">Inbox status</Text>
          <Text className="mt-2 text-3xl font-bold text-white">{items.length} recent events</Text>
          <Text className="mt-2 text-sm leading-5 text-white/85">
            Sync source: {bundle.syncMeta.source} · Pending mutations: {bundle.syncMeta.pendingMutations} · Offline ready: {bundle.syncMeta.offlineReady ? "Yes" : "No"}
          </Text>
        </View>

        <View className="gap-3">
          {items.map((item) => (
            <View key={item.id} className="rounded-3xl border border-border bg-surface p-5">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1">
                  <Text className="text-base font-semibold text-foreground">{item.title}</Text>
                  <Text className="mt-2 text-sm leading-5 text-muted">{item.description}</Text>
                </View>
                <View className={`rounded-full border px-3 py-1 ${toneStyles[item.tone]}`}>
                  <Text className="text-xs font-semibold uppercase tracking-wide">{item.category}</Text>
                </View>
              </View>
              <Text className="mt-3 text-xs text-muted">{new Date(item.timestamp).toLocaleString()}</Text>
              {item.route ? (
                <Link
                  href={
                    item.routeParams
                      ? ({ pathname: item.route, params: item.routeParams } as never)
                      : (item.route as never)
                  }
                  asChild
                >
                  <View className="mt-4 rounded-2xl border border-border bg-background px-4 py-3">
                    <Text className="text-center font-semibold text-foreground">Open related task</Text>
                  </View>
                </Link>
              ) : null}
            </View>
          ))}
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-lg font-semibold text-foreground">Quick follow-up</Text>
          <View className="mt-4 gap-3">
            <Link href={"/(tabs)/field" as never} asChild>
              <View className="rounded-2xl bg-foreground px-4 py-3">
                <Text className="text-center font-semibold text-background">Review field updates</Text>
              </View>
            </Link>
            <Link href={"/onboarding" as never} asChild>
              <View className="rounded-2xl border border-border bg-background px-4 py-3">
                <Text className="text-center font-semibold text-foreground">Review onboarding</Text>
              </View>
            </Link>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
