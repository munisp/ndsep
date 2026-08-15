import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

function asIso(value: string) { if (!value.trim()) return null; const date = new Date(value.trim()); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }

export default function PaymentAuditScreen() {
  const [aggregateType, setAggregateType] = useState("");
  const [eventType, setEventType] = useState("");
  const [actorOpenId, setActorOpenId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const filter = useMemo(() => ({ aggregateType: aggregateType.trim() || null, eventType: eventType.trim() || null, actorOpenId: actorOpenId.trim() || null, from: asIso(fromDate), to: asIso(toDate), limit: 100 }), [aggregateType, eventType, actorOpenId, fromDate, toDate]);
  const events = trpc.paymentOperations.auditEvents.useQuery(filter, { retry: false });
  const exportEvents = trpc.paymentOperations.exportAuditEvents.useMutation({ onError: (error) => setMessage(error.message || "Audit export could not be generated.") });

  async function exportCsv() {
    const result = await exportEvents.mutateAsync({ aggregateType: filter.aggregateType, eventType: filter.eventType, actorOpenId: filter.actorOpenId, from: filter.from, to: filter.to });
    if (Platform.OS === "web") {
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = result.filename; anchor.click(); URL.revokeObjectURL(url);
    } else {
      const path = `${FileSystem.cacheDirectory}${result.filename}`;
      await FileSystem.writeAsStringAsync(path, result.csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Share.share({ url: path, title: "Payment audit events" });
    }
    setMessage(`Exported ${result.rowCount} append-only audit event${result.rowCount === 1 ? "" : "s"}. The export action itself is recorded in the audit trail.`);
  }

  return <ScreenContainer className="bg-background"><ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled"><View className="rounded-[28px] bg-surface p-5"><Text className="text-sm text-muted">Administrator financial audit</Text><Text className="mt-2 text-3xl font-bold text-foreground">Payment audit events</Text><Text className="mt-2 text-sm leading-5 text-muted">Events are append-only and hash-chained by aggregate. This view shows administrative evidence and gateway-match status; it does not independently confirm bank settlement.</Text></View><View className="rounded-3xl border border-border bg-surface p-5"><Text className="text-lg font-semibold text-foreground">Filter events</Text><TextInput value={aggregateType} onChangeText={setAggregateType} placeholder="Aggregate type: payment, gateway_webhook…" placeholderTextColor="#94A3B8" className="mt-4 rounded-xl border border-border bg-background px-3 py-3 text-foreground" /><TextInput value={eventType} onChangeText={setEventType} placeholder="Event type" placeholderTextColor="#94A3B8" className="mt-3 rounded-xl border border-border bg-background px-3 py-3 text-foreground" /><TextInput value={actorOpenId} onChangeText={setActorOpenId} placeholder="Administrator or applicant account ID" placeholderTextColor="#94A3B8" className="mt-3 rounded-xl border border-border bg-background px-3 py-3 text-foreground" /><View className="mt-3 flex-row gap-3"><TextInput value={fromDate} onChangeText={setFromDate} placeholder="From (YYYY-MM-DD)" placeholderTextColor="#94A3B8" className="flex-1 rounded-xl border border-border bg-background px-3 py-3 text-foreground" /><TextInput value={toDate} onChangeText={setToDate} placeholder="To (YYYY-MM-DD)" placeholderTextColor="#94A3B8" className="flex-1 rounded-xl border border-border bg-background px-3 py-3 text-foreground" /></View><Pressable onPress={() => void events.refetch()} style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}><View className="mt-3 rounded-xl border border-primary bg-background px-4 py-3"><Text className="text-center font-semibold text-primary">Refresh filtered events</Text></View></Pressable><Pressable onPress={() => void exportCsv()} disabled={exportEvents.isPending || events.isError} style={({ pressed }) => [{ opacity: pressed || exportEvents.isPending || events.isError ? 0.6 : 1 }]}><View className="mt-3 rounded-xl bg-primary px-4 py-4"><Text className="text-center font-semibold text-white">{exportEvents.isPending ? "Preparing export…" : "Export filtered CSV"}</Text></View></Pressable></View>{message ? <View className="rounded-2xl border border-primary bg-primary/5 p-4"><Text className="text-sm leading-5 text-foreground">{message}</Text></View> : null}{events.isError ? <View className="rounded-3xl border border-warning bg-warning/5 p-5"><Text className="font-semibold text-warning">Audit event access is restricted</Text><Text className="mt-2 text-sm leading-5 text-muted">Sign in as an administrator. Event payloads and cryptographic hashes are never exposed to applicants or unauthenticated sessions.</Text></View> : events.isLoading ? <Text className="text-sm text-muted">Loading append-only audit events…</Text> : events.data?.length ? <View className="gap-3">{events.data.map((event) => <View key={event.eventId} className="rounded-3xl border border-border bg-surface p-5"><View className="flex-row items-start justify-between gap-3"><View className="flex-1"><Text className="text-sm font-semibold text-foreground">{event.eventType}</Text><Text className="mt-1 text-xs text-muted">{event.aggregateType} · sequence {event.sequenceNumber}</Text></View><Text className="text-right text-[11px] text-muted">{new Date(event.occurredAt).toLocaleString()}</Text></View><Text className="mt-3 text-xs text-muted">Actor: {event.actorOpenId ?? "gateway/system"}</Text><Text className="mt-2 text-xs leading-4 text-muted">Hash: {event.eventHash}</Text><Text className="mt-2 text-xs leading-4 text-muted">Previous: {event.previousEventHash ?? "Aggregate origin"}</Text></View>)}</View> : <View className="rounded-3xl border border-border bg-surface p-5"><Text className="font-semibold text-foreground">No events match these filters</Text><Text className="mt-2 text-sm leading-5 text-muted">Change the filters or clear the date range. Gateway events appear only after a valid, configured provider webhook is received.</Text></View>}</ScrollView></ScreenContainer>;
}
