import { Link } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { PanResponder, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { ScreenContainer } from "@/components/screen-container";
import type { ActivityFilter, ActivityRecord } from "@/lib/mobile-activity";
import {
  dismissActivity,
  filterActivities,
  getActivityFeed,
  getUnreadActivityCount,
  markActivityRead,
  markAllActivitiesRead,
  recordActivityAction,
  subscribeActivityFeed,
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

const animatedCardBaseStyle = {
  borderWidth: 1,
  borderRadius: 24,
  padding: 20,
} as const;

function SwipeActivityCard({
  item,
  busy,
  onInlineAction,
  onDismiss,
  onMarkRead,
}: {
  item: ActivityRecord;
  busy: boolean;
  onInlineAction: (item: ActivityRecord) => void;
  onDismiss: (id: string) => void;
  onMarkRead: (id: string) => void;
}) {
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);
  const unreadProgress = useSharedValue(item.unread ? 0 : 1);

  useEffect(() => {
    unreadProgress.value = withTiming(item.unread ? 0 : 1, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [item.unread, unreadProgress]);

  const resetPosition = () => {
    translateX.value = withTiming(0, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    });
    opacity.value = withTiming(1, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    });
  };

  const animateDismiss = () => {
    translateX.value = withTiming(-220, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
    opacity.value = withTiming(
      0,
      {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      },
      (finished) => {
        if (finished) {
          runOnJS(onDismiss)(item.id);
        }
      },
    );
  };

  const animateMarkRead = () => {
    translateX.value = withTiming(
      28,
      {
        duration: 120,
        easing: Easing.out(Easing.cubic),
      },
      (finished) => {
        if (finished) {
          runOnJS(onMarkRead)(item.id);
        }
      },
    );
    opacity.value = withTiming(
      0.96,
      {
        duration: 120,
        easing: Easing.out(Easing.cubic),
      },
      (finished) => {
        if (finished) {
          translateX.value = withTiming(0, {
            duration: 200,
            easing: Easing.out(Easing.cubic),
          });
          opacity.value = withTiming(1, {
            duration: 200,
            easing: Easing.out(Easing.cubic),
          });
        }
      },
    );
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dx) > 24 && Math.abs(gestureState.dy) < 16,
        onPanResponderMove: (_, gestureState) => {
          const limited = Math.max(-140, Math.min(70, gestureState.dx));
          translateX.value = limited;
          opacity.value = limited < 0 ? Math.max(0.72, 1 - Math.abs(limited) / 240) : 1;
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx < -80) {
            animateDismiss();
            return;
          }
          if (gestureState.dx > 80 && item.unread) {
            animateMarkRead();
            return;
          }
          resetPosition();
        },
        onPanResponderTerminate: () => {
          resetPosition();
        },
      }),
    [item.id, item.unread, onDismiss, onMarkRead],
  );

  const animatedCardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: opacity.value,
    backgroundColor: interpolateColor(unreadProgress.value, [0, 1], ["rgba(29,78,216,0.08)", "rgba(255,255,255,1)"]),
    borderColor: interpolateColor(unreadProgress.value, [0, 1], ["rgba(29,78,216,0.28)", "rgba(208,213,221,1)"]),
  }));

  const relatedHref = item.route
    ? item.routeParams
      ? ({ pathname: item.route, params: item.routeParams } as never)
      : (item.route as never)
    : null;

  return (
    <Animated.View {...panResponder.panHandlers} style={[animatedCardBaseStyle, animatedCardStyle]}>
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="text-[11px] font-medium uppercase tracking-wide text-muted">Swipe right to mark read · left to dismiss</Text>
        {item.unread ? <Text className="text-xs font-semibold text-primary">Unread</Text> : <Text className="text-xs text-muted">Read</Text>}
      </View>

      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-base font-semibold text-foreground">{item.title}</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">{item.aiInsight?.summary ?? item.description}</Text>
          {item.parcelNumber ? <Text className="mt-2 text-xs font-medium text-primary">Parcel {item.parcelNumber}</Text> : null}
          {item.aiInsight ? (
            <Text className="mt-2 text-xs text-muted">
              Priority {item.aiInsight.priorityLevel} · Score {item.aiInsight.priorityScore}
            </Text>
          ) : null}
        </View>
        <View className={`rounded-full border px-3 py-1 ${toneStyles[item.tone]}`}>
          <Text className="text-xs font-semibold uppercase tracking-wide">{item.category}</Text>
        </View>
      </View>

      <View className="mt-3 flex-row items-center justify-between gap-3">
        <Text className="text-xs text-muted">{new Date(item.timestamp).toLocaleString()}</Text>
        <Text className="text-xs text-muted">{item.auditHistory.length} audit event{item.auditHistory.length === 1 ? "" : "s"}</Text>
      </View>

      <Link href={{ pathname: "/notification/[id]", params: { id: item.id } } as never} asChild>
        <Pressable style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}> 
          <View className="mt-4 rounded-2xl border border-border bg-background px-4 py-3">
            <Text className="text-center font-semibold text-foreground">Open alert detail</Text>
          </View>
        </Pressable>
      </Link>

      {relatedHref ? (
        <Link href={relatedHref} asChild>
          <Pressable style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}> 
            <View className="mt-3 rounded-2xl border border-border bg-background px-4 py-3">
              <Text className="text-center font-semibold text-foreground">Open related task</Text>
            </View>
          </Pressable>
        </Link>
      ) : null}

      {item.action ? (
        <Pressable onPress={() => onInlineAction(item)} disabled={busy} style={({ pressed }) => [{ opacity: pressed || busy ? 0.7 : 1 }]}> 
          <View className="mt-3 rounded-2xl bg-foreground px-4 py-3">
            <Text className="text-center text-sm font-semibold text-background">{busy ? "Processing…" : item.action.label}</Text>
          </View>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

export default function NotificationsScreen() {
  const { bundle, refresh, isRefetching, approveIdentityDocument, approveLegalWorkflow, analyzeActivities } = useMobilePlatformBundle();
  const [items, setItems] = useState<ActivityRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActivityFilter>("all");
  const [unreadCount, setUnreadCount] = useState(0);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [isAnalyzingInsights, setIsAnalyzingInsights] = useState(false);

  async function loadFeed() {
    const [feed, unread] = await Promise.all([getActivityFeed(), getUnreadActivityCount()]);
    setItems(feed);
    setUnreadCount(unread);
  }

  useEffect(() => {
    void loadFeed();
    const unsubscribe = subscribeActivityFeed(() => {
      void loadFeed();
    });
    return unsubscribe;
  }, []);

  const pendingInsightIds = useMemo(
    () =>
      items
        .filter((item) => !item.dismissedAt && (!item.aiInsight || item.aiInsight.model === "seeded-mobile-analysis" || item.aiInsight.model === "deterministic-fallback"))
        .slice(0, 6)
        .map((item) => item.id)
        .join("|"),
    [items],
  );

  useEffect(() => {
    if (!pendingInsightIds || isAnalyzingInsights) return;
    setIsAnalyzingInsights(true);
    analyzeActivities(items)
      .catch(() => undefined)
      .finally(() => setIsAnalyzingInsights(false));
  }, [analyzeActivities, isAnalyzingInsights, items, pendingInsightIds]);

  async function handleRefresh() {
    await refresh();
    await loadFeed();
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
      await recordActivityAction(item.id, item.action.label);
      await markActivityRead(item.id);
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
          <Text className="mt-2 text-xs text-white/80">{isAnalyzingInsights ? "AI is refreshing summaries and priority order for visible alerts." : "AI summaries and priority ranking stay aligned with recent inbox behavior."}</Text>
          <Link href={"/notifications-preferences" as never} asChild>
            <Pressable style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}> 
              <View className="mt-4 rounded-2xl bg-white/10 px-4 py-3">
                <Text className="text-center font-semibold text-white">Open notification preferences</Text>
              </View>
            </Pressable>
          </Link>
          <Pressable onPress={() => void markAllActivitiesRead()} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}> 
            <View className="mt-3 rounded-2xl border border-white/20 bg-white/5 px-4 py-3">
              <Text className="text-center font-semibold text-white">Mark all as read</Text>
            </View>
          </Pressable>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-4">
          <Text className="text-sm font-semibold text-foreground">Find parcel-specific events</Text>
          <TextInput
            value={searchTerm}
            onChangeText={setSearchTerm}
            placeholder="Search parcel number, event, workflow, or AI summary"
            placeholderTextColor="#98A2B3"
            className="mt-3 rounded-2xl border border-border bg-background px-4 py-3 text-foreground"
            returnKeyType="search"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 12 }}>
            {filters.map((filter) => {
              const selected = activeFilter === filter.key;
              return (
                <Pressable key={filter.key} onPress={() => setActiveFilter(filter.key)} style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}> 
                  <View className={`rounded-full border px-4 py-2 ${selected ? "border-primary bg-primary/10" : "border-border bg-background"}`}>
                    <Text className={`text-sm font-semibold ${selected ? "text-primary" : "text-foreground"}`}>{filter.label}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View className="gap-3">
          {visibleItems.map((item) => (
            <SwipeActivityCard
              key={item.id}
              item={item}
              busy={busyActionId === item.id}
              onInlineAction={(selected) => void handleInlineAction(selected)}
              onDismiss={(id) => void dismissActivity(id)}
              onMarkRead={(id) => void markActivityRead(id)}
            />
          ))}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
