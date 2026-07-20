import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { type ActivityRecord, getActivityById, markActivityRead, recordActivityAction, recordActivityOpened, subscribeActivityFeed } from "@/lib/mobile-activity";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";

function AuditRow({ label, detail, timestamp, actor }: { label: string; detail: string; timestamp: string; actor: string }) {
  return (
    <View className="rounded-2xl border border-border bg-background p-4">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-sm font-semibold text-foreground">{label}</Text>
        <Text className="text-xs uppercase tracking-wide text-muted">{actor}</Text>
      </View>
      <Text className="mt-2 text-sm leading-5 text-muted">{detail}</Text>
      <Text className="mt-3 text-xs text-muted">{new Date(timestamp).toLocaleString()}</Text>
    </View>
  );
}

export default function NotificationDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { approveIdentityDocument, approveLegalWorkflow } = useMobilePlatformBundle();
  const [item, setItem] = useState<ActivityRecord | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      const selected = await getActivityById(id);
      setItem(selected);
      if (selected) {
        await recordActivityOpened(selected.id);
        if (selected.unread) {
          await markActivityRead(selected.id);
        }
        const refreshed = await getActivityById(selected.id);
        setItem(refreshed);
      }
    };

    void load();
    const unsubscribe = subscribeActivityFeed(() => {
      if (!id) return;
      void getActivityById(id).then((selected) => setItem(selected));
    });
    return unsubscribe;
  }, [id]);

  const relatedHref = useMemo(() => {
    if (!item?.route) return null;
    return item.routeParams ? ({ pathname: item.route, params: item.routeParams } as never) : (item.route as never);
  }, [item]);

  async function handleInlineAction() {
    if (!item?.action) return;
    setBusy(true);
    try {
      if (item.action.kind === "approve_kyc" && item.action.onboardingDocumentId) {
        await approveIdentityDocument(item.action.onboardingDocumentId);
      }
      if (item.action.kind === "approve_legal" && item.action.legalWorkflowId) {
        await approveLegalWorkflow(item.action.legalWorkflowId);
      }
      await recordActivityAction(item.id, item.action.label);
      const refreshed = await getActivityById(item.id);
      setItem(refreshed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ presentation: "transparentModal", animation: "slide_from_bottom", headerShown: false }} />
      <ScreenContainer
        edges={["top", "bottom", "left", "right"]}
        containerClassName="bg-black/30"
        safeAreaClassName="justify-end"
        className="justify-end"
      >
        <View className="rounded-t-[32px] bg-surface px-5 pb-6 pt-4">
          <View className="mb-4 flex-row items-center justify-between gap-3">
            <View>
              <Text className="text-xs uppercase tracking-[2px] text-muted">Alert detail</Text>
              <Text className="mt-1 text-2xl font-bold text-foreground">Notification sheet</Text>
            </View>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.65 : 1 }]}> 
              <View className="rounded-full border border-border bg-background px-4 py-2">
                <Text className="font-semibold text-foreground">Close</Text>
              </View>
            </Pressable>
          </View>

          {!item ? (
            <View className="rounded-3xl border border-border bg-background p-5">
              <Text className="text-lg font-semibold text-foreground">Alert unavailable</Text>
              <Text className="mt-2 text-sm leading-5 text-muted">This alert was not found in the current device inbox. Return to notifications and refresh the feed.</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 12 }}>
              <View className="rounded-3xl bg-primary p-5">
                <Text className="text-sm text-white/80">{item.category.toUpperCase()}</Text>
                <Text className="mt-2 text-2xl font-bold text-white">{item.title}</Text>
                <Text className="mt-2 text-sm leading-5 text-white/85">{item.aiInsight?.summary ?? item.description}</Text>
                <Text className="mt-3 text-xs text-white/80">
                  Priority {item.aiInsight?.priorityLevel ?? "pending"}
                  {item.aiInsight ? ` · Score ${item.aiInsight.priorityScore}` : " · AI analysis pending"}
                </Text>
              </View>

              <View className="rounded-3xl border border-border bg-background p-5">
                <Text className="text-lg font-semibold text-foreground">Alert context</Text>
                <Text className="mt-3 text-sm leading-5 text-muted">{item.description}</Text>
                <Text className="mt-3 text-sm text-muted">Parcel: {item.parcelNumber ?? "Not parcel-bound"}</Text>
                <Text className="mt-2 text-sm text-muted">Received: {new Date(item.timestamp).toLocaleString()}</Text>
                <Text className="mt-2 text-sm text-muted">Status: {item.dismissedAt ? "Dismissed from inbox" : item.unread ? "Unread" : "Reviewed"}</Text>
                {item.aiInsight ? <Text className="mt-2 text-sm text-muted">AI rationale: {item.aiInsight.rationale}</Text> : null}
                {item.geofenceContext ? (
                  <Text className="mt-2 text-sm text-muted">
                    Geofence: {item.geofenceContext.transition} within {item.geofenceContext.radiusMeters}m at {new Date(item.geofenceContext.triggeredAt).toLocaleString()}
                  </Text>
                ) : null}
              </View>

              {relatedHref ? (
                <Link href={relatedHref} asChild>
                  <Pressable style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}> 
                    <View className="rounded-2xl border border-border bg-background px-4 py-4">
                      <Text className="text-center font-semibold text-foreground">Open related task</Text>
                    </View>
                  </Pressable>
                </Link>
              ) : null}

              {item.action ? (
                <Pressable onPress={() => void handleInlineAction()} disabled={busy} style={({ pressed }) => [{ opacity: pressed || busy ? 0.7 : 1 }]}> 
                  <View className="rounded-2xl bg-foreground px-4 py-4">
                    <Text className="text-center font-semibold text-background">{busy ? "Processing…" : item.action.label}</Text>
                  </View>
                </Pressable>
              ) : null}

              <View className="rounded-3xl border border-border bg-surface p-5">
                <Text className="text-lg font-semibold text-foreground">Comprehensive audit history</Text>
                <Text className="mt-2 text-sm leading-5 text-muted">Each audit event records when the alert was created, delivered, reviewed, prioritized, dismissed, or acted upon.</Text>
                <View className="mt-4 gap-3">
                  {item.auditHistory.map((entry) => (
                    <AuditRow key={entry.id} label={entry.label} detail={entry.detail} timestamp={entry.timestamp} actor={entry.actor} />
                  ))}
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </ScreenContainer>
    </>
  );
}
