import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { getPendingStakeholderSyncItems, type PendingStakeholderSyncItem } from "@/lib/stakeholder-sync-queue";

const LABELS: Record<PendingStakeholderSyncItem["kind"], string> = { profile: "Stakeholder profile", identity_document: "Identity document", business_document: "Business document" };

export function StakeholderSyncQueue() {
  const [items, setItems] = useState<PendingStakeholderSyncItem[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setItems(await getPendingStakeholderSyncItems()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <View className="rounded-3xl border border-border bg-surface p-5">
      <View className="flex-row items-center justify-between gap-3"><View><Text className="text-lg font-semibold text-foreground">Offline synchronization queue</Text><Text className="mt-1 text-sm text-muted">Stakeholder profiles and documents awaiting secure transmission.</Text></View><Text className={`text-xs font-semibold ${items.length ? "text-warning" : "text-success"}`}>{items.length ? `${items.length} pending` : "Clear"}</Text></View>
      {loading ? <View className="mt-4 flex-row items-center gap-2"><ActivityIndicator size="small" /><Text className="text-sm text-muted">Checking this device…</Text></View> : items.length === 0 ? <Text className="mt-4 text-sm leading-5 text-muted">No stakeholder profile or document submissions are currently queued on this device.</Text> : <View className="mt-4 gap-3">{items.map((item) => <View key={item.id} className="rounded-2xl border border-border bg-background p-4"><Text className="font-semibold text-foreground">{item.label || LABELS[item.kind]}</Text><Text className="mt-1 text-sm text-muted">{LABELS[item.kind]} · {item.status.replace(/_/g, " ")}</Text><Text className="mt-1 text-xs text-muted">Queued {new Date(item.queuedAt).toLocaleString()}</Text></View>)}</View>}
      <Pressable onPress={() => void refresh()} disabled={loading} style={{ marginTop: 14, opacity: loading ? 0.6 : 1 }}><Text className="font-semibold text-primary">Refresh queue status</Text></Pressable>
    </View>
  );
}
