import { useEffect, useMemo, useState } from "react";
import { Link } from "expo-router";
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import type { ActivityFilter, ActivityRecord } from "@/lib/mobile-activity";
import {
  filterActivities,
  getActivityFeed,
  getUnreadActivityCount,
  markActivityRead,
  markAllActivitiesRead,
} from "@/lib/mobile-activity";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";

const toneStyles = {
  info: "bg-primary/10 text-primary border-primary/20",
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
} as const;

const filters: Array<{ key: ActivityFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "field", label: "Field" },
  { key: "onboarding", label: "Onboarding" },
  { key: "legal", label: "Legal" },
  { key: "geospatial", label: "Geo" },
];

export default function NotificationsScreen() {
  const {
    bundle,
    refresh,
    isRefetching,
    approveIdentityDocument,
    approveLegalWorkflow,
  } = useMobilePlatformBundle();
  const [items, setItems] = useState<ActivityRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActivityFilter>("all");
  const [unreadCount, setUnreadCount] = useState(0);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);

  async function loadFeed() {
    const [feed, unread] = await Promise.all([getActivityFeed(), getUnreadActivityCount()]);
    setItems(feed);
    setUnreadCount(unread);
  }

  useEffect(() => {
    void loadFeed();
  }, []);

  async function handleRefresh() {
    await refresh();
    await loadFeed();
  }

  async function handleOpenItem(item: ActivityRecord) {
    if (item.unread) {
      await markActivityRead(item.id);
      await loadFeed();
    }
  }

  async function handleInlineAction(item: ActivityRecord) {
    if (!item.action) return;
    setBusyActionId(item.id);
    try {
      if (item.action.kind === "approve_kyc" && item.action.onboardingDocumentId) {
        await approveIdentityDocument(item.action.onboardingDocumentId);
      }
      if (item.action.kind === "approve_legal" && item.action.legalWorkflowId) {
        await approveLegalWorkflow(item.action.legalWorkflowId);
      }
      await markActivityRead(item.id);
      await loadFeed();
    } finally {
      setBusyActionId(null);
    }
  }

  const visibleItems = useMemo(() => filterActivities(items, activeFilter, searchTerm), [items, activeFilter, searchTerm]);

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
          <Text className="mt-2 text-3xl font-bold text-white">{visibleItems.length} visible events</Text>
          <Text className="mt-2 text-sm leading-5 text-white/85">
            {unreadCount} unread · Sync source: {bundle.syncMeta.source} · Pending mutations: {bundle.syncMeta.pendingMutations}
          </Text>
          <Pressable
            onPress={() => void markAllActivitiesRead().then(() => loadFeed())}
            style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
          >
            <View className="mt-4 rounded-2xl bg-white/10 px-4 py-3">
              <Text className="text-center font-semibold text-white">Mark all as read</Text>
            </View>
          </Pressable>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-4">
          <Text className="text-sm font-semibold text-foreground">Find parcel-specific events</Text>
          <TextInput
            value={searchTerm}
            onChangeText={setSearchTerm}
            placeholder="Search parcel number, event, or workflow"
            placeholderTextColor="#98A2B3"
            className="mt-3 rounded-2xl border border-border bg-background px-4 py-3 text-foreground"
            returnKeyType="search"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 12 }}>
            {filters.map((filter) => {
              const selected = activeFilter === filter.key;
              return (
                <Pressable
                  key={filter.key}
                  onPress={() => setActiveFilter(filter.key)}
                  style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}
                >
                  <View className={`rounded-full border px-4 py-2 ${selected ? "border-primary bg-primary/10" : "border-border bg-background"}`}>
                    <Text className={`text-sm font-semibold ${selected ? "text-primary" : "text-foreground"}`}>{filter.label}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View className="gap-3">
          {visibleItems.map((item) => {
            const relatedHref = item.route
              ? item.routeParams
                ? ({ pathname: item.route, params: item.routeParams } as never)
                : (item.route as never)
              : null;

            return (
              <View key={item.id} className={`rounded-3xl border bg-surface p-5 ${item.unread ? "border-primary/30" : "border-border"}`}>
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-foreground">{item.title}</Text>
                    <Text className="mt-2 text-sm leading-5 text-muted">{item.description}</Text>
                    {item.parcelNumber ? <Text className="mt-2 text-xs font-medium text-primary">Parcel {item.parcelNumber}</Text> : null}
                  </View>
                  <View className={`rounded-full border px-3 py-1 ${toneStyles[item.tone]}`}>
                    <Text className="text-xs font-semibold uppercase tracking-wide">{item.category}</Text>
                  </View>
                </View>
                <View className="mt-3 flex-row items-center justify-between gap-3">
                  <Text className="text-xs text-muted">{new Date(item.timestamp).toLocaleString()}</Text>
                  {item.unread ? <Text className="text-xs font-semibold text-primary">Unread</Text> : null}
                </View>
                {relatedHref ? (
                  <Link href={relatedHref} asChild>
                    <Pressable onPress={() => void handleOpenItem(item)} style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}>
                      <View className="mt-4 rounded-2xl border border-border bg-background px-4 py-3">
                        <Text className="text-center font-semibold text-foreground">Open related task</Text>
                      </View>
                    </Pressable>
                  </Link>
                ) : null}
                {item.action ? (
                  <Pressable
                    onPress={() => void handleInlineAction(item)}
                    disabled={busyActionId === item.id}
                    style={({ pressed }) => [{ opacity: pressed || busyActionId === item.id ? 0.7 : 1 }]}
                  >
                    <View className="mt-3 rounded-2xl bg-foreground px-4 py-3">
                      <Text className="text-center text-sm font-semibold text-background">
                        {busyActionId === item.id ? "Processing…" : item.action.label}
                      </Text>
                    </View>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
