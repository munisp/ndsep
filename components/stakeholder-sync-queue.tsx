import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { getPendingStakeholderSyncItems, replayQueuedStakeholderSyncItem, type PendingStakeholderSyncItem } from "@/lib/stakeholder-sync-queue";

const LABELS: Record<PendingStakeholderSyncItem["kind"], string> = { profile: "Stakeholder profile", identity_document: "Identity document", business_document: "Business document" };

export function StakeholderSyncQueue({ refreshKey = 0 }: { refreshKey?: number }) {
  const [items, setItems] = useState<PendingStakeholderSyncItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setItems(await getPendingStakeholderSyncItems()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh, refreshKey]);
  const retry = async (item: PendingStakeholderSyncItem) => {
    setRetryingId(item.id); setFeedback(null);
    try { await replayQueuedStakeholderSyncItem(item.id); setFeedback(`${item.label} synchronized successfully.`); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "The synchronization attempt failed."); }
    finally { setRetryingId(null); await refresh(); }
  };

  return (
    <View className="rounded-3xl border border-border bg-surface p-5">
      <View className="flex-row items-center justify-between gap-3"><View><Text className="text-lg font-semibold text-foreground">Offline synchronization queue</Text><Text className="mt-1 text-sm text-muted">Stakeholder profiles and documents awaiting secure transmission.</Text></View><Text className={`text-xs font-semibold ${items.length ? "text-warning" : "text-success"}`}>{items.length ? `${items.length} pending` : "Clear"}</Text></View>
      {loading ? <View className="mt-4 flex-row items-center gap-2"><ActivityIndicator size="small" /><Text className="text-sm text-muted">Checking this device…</Text></View> : items.length === 0 ? <Text className="mt-4 text-sm leading-5 text-muted">No stakeholder profile or document submissions are currently queued on this device.</Text> : <View className="mt-4 gap-3">{items.map((item) => <View key={item.id} className={`rounded-2xl border p-4 ${item.status === "dead_letter" ? "border-error bg-background" : "border-border bg-background"}`}><View className="flex-row items-start justify-between gap-3"><View className="flex-1"><Text className="font-semibold text-foreground">{item.label || LABELS[item.kind]}</Text><Text className="mt-1 text-sm text-muted">{LABELS[item.kind]} · {item.status.replace(/_/g, " ")} · attempt {item.retryCount + 1}</Text><Text className="mt-1 text-xs text-muted">Queued {new Date(item.queuedAt).toLocaleString()}</Text></View><Text className={`text-xs font-semibold ${item.status === "dead_letter" ? "text-error" : item.status === "failed" ? "text-warning" : "text-muted"}`}>{item.status === "dead_letter" ? "Inspection required" : item.status === "failed" ? "Retry available" : "Waiting"}</Text></View>{item.status === "dead_letter" ? <Text className="mt-3 text-xs leading-4 text-error">{item.lastErrorCode === "payload_decryption_failed" ? "Ciphertext integrity or local key access failed. The encrypted payload remains quarantined; do not recreate the submission until it has been reviewed." : "The server rejected the replay after bounded attempts. Review the record and retry only after the underlying issue is resolved."}</Text> : null}<Pressable disabled={retryingId === item.id || item.status === "retrying"} onPress={() => void retry(item)} style={{ marginTop: 12, opacity: retryingId === item.id || item.status === "retrying" ? 0.55 : 1 }}><Text className="font-semibold text-primary">{retryingId === item.id ? "Synchronizing…" : item.status === "dead_letter" ? "Retry quarantined item" : "Retry synchronization"}</Text></Pressable></View>)}</View>}
      {feedback ? <Text className="mt-4 text-sm leading-5 text-muted">{feedback}</Text> : null}
      <Pressable onPress={() => void refresh()} disabled={loading} style={{ marginTop: 14, opacity: loading ? 0.6 : 1 }}><Text className="font-semibold text-primary">Refresh queue status</Text></Pressable>
    </View>
  );
}
