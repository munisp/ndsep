import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

const EVENT_LABELS: Record<string, string> = {
  recovery_requested: "Recovery requested",
  recovery_approval_verified: "Approval verified",
  recovery_quorum_authorized: "Quorum authorized",
  kms_rewrap_started: "KMS rewrap started",
  kms_rewrap_failed: "KMS rewrap failed",
  recovery_replay_started: "Replay started",
  recovery_replay_failed: "Replay failed",
  recovery_replay_consumed: "Replay consumed",
};

const EVENT_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  recovery_requested: { bg: "bg-primary/10", text: "text-primary", dot: "bg-primary" },
  recovery_approval_verified: { bg: "bg-success/10", text: "text-success", dot: "bg-success" },
  recovery_quorum_authorized: { bg: "bg-success/15", text: "text-success", dot: "bg-success" },
  kms_rewrap_started: { bg: "bg-warning/10", text: "text-warning", dot: "bg-warning" },
  kms_rewrap_failed: { bg: "bg-error/10", text: "text-error", dot: "bg-error" },
  recovery_replay_started: { bg: "bg-warning/10", text: "text-warning", dot: "bg-warning" },
  recovery_replay_failed: { bg: "bg-error/10", text: "text-error", dot: "bg-error" },
  recovery_replay_consumed: { bg: "bg-success/15", text: "text-success", dot: "bg-success" },
};

const DEFAULT_COLORS = { bg: "bg-surface", text: "text-foreground", dot: "bg-muted" };

export default function RecoveryAuditTimelineScreen() {
  const [authorizationId, setAuthorizationId] = useState("");
  const validId = /^[0-9a-f-]{36}$/i.test(authorizationId.trim());

  const timeline = trpc.recovery.auditTimeline.useQuery(
    { authorizationId: authorizationId.trim() },
    { enabled: validId, retry: false },
  );

  const events = timeline.data?.events ?? [];
  const integrity = timeline.data?.integrity;

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
        <Link href={"/recovery-approval" as never} asChild><Pressable><Text className="text-sm font-semibold text-primary">‹ Recovery status</Text></Pressable></Link>

        <View className="rounded-[28px] bg-surface p-5">
          <Text className="text-sm font-semibold text-primary">Recovery evidence</Text>
          <Text className="mt-2 text-3xl font-bold text-foreground">Audit timeline</Text>
          <Text className="mt-3 text-sm leading-6 text-muted">View the hash-chained audit events for a recovery authorization. Each event is cryptographically linked to its predecessor; any modification breaks the chain.</Text>
        </View>

        <View className="rounded-3xl border border-border bg-surface p-5">
          <Text className="text-sm font-semibold text-foreground">Authorization ID</Text>
          <TextInput
            value={authorizationId}
            onChangeText={setAuthorizationId}
            placeholder="Enter recovery authorization UUID"
            placeholderTextColor="#687076"
            autoCapitalize="none"
            autoCorrect={false}
            className="mt-3 rounded-xl border border-border px-3 py-3 text-sm text-foreground"
          />
        </View>

        {timeline.isLoading ? (
          <View className="items-center py-8"><ActivityIndicator size="small" color="#0A7EA4" /><Text className="mt-2 text-sm text-muted">Loading audit timeline…</Text></View>
        ) : timeline.isError ? (
          <View className="rounded-2xl border border-error bg-error/10 p-4">
            <Text className="text-sm text-error">Could not load audit timeline: {timeline.error.message}</Text>
            <Pressable onPress={() => timeline.refetch()} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}><Text className="mt-2 text-sm font-semibold text-primary">Retry</Text></Pressable>
          </View>
        ) : null}

        {integrity ? (
          <View className={`rounded-3xl border p-5 ${integrity.valid ? "border-success bg-success/10" : "border-error bg-error/10"}`}>
            <View className="flex-row items-center gap-3">
              <View className={`h-8 w-8 items-center justify-center rounded-full ${integrity.valid ? "bg-success/20" : "bg-error/20"}`}>
                <Text className={`text-sm font-bold ${integrity.valid ? "text-success" : "text-error"}`}>{integrity.valid ? "✓" : "✗"}</Text>
              </View>
              <View className="flex-1">
                <Text className={`text-base font-semibold ${integrity.valid ? "text-success" : "text-error"}`}>{integrity.valid ? "Chain integrity verified" : "Chain integrity broken"}</Text>
                <Text className="mt-1 text-xs text-muted">{integrity.reason}</Text>
              </View>
            </View>
            {integrity.firstInvalidSequence !== null ? (
              <Text className="mt-3 text-xs text-error">First invalid event at sequence {integrity.firstInvalidSequence}. Events before this point may still be trustworthy.</Text>
            ) : null}
          </View>
        ) : null}

        {events.length > 0 ? (
          <View className="rounded-3xl border border-border bg-surface p-5">
            <Text className="text-lg font-semibold text-foreground">Event chain ({events.length})</Text>
            <FlatList
              scrollEnabled={false}
              data={events}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ gap: 0, marginTop: 16 }}
              renderItem={({ item, index }) => {
                const colors = EVENT_COLORS[item.eventType] ?? DEFAULT_COLORS;
                const isLast = index === events.length - 1;
                return (
                  <View className="flex-row">
                    <View className="mr-4 items-center" style={{ width: 20 }}>
                      <View className={`h-3 w-3 rounded-full ${colors.dot}`} style={{ marginTop: 6 }} />
                      {!isLast ? <View className="flex-1 bg-border" style={{ width: 2, marginTop: 4, marginBottom: 4 }} /> : null}
                    </View>
                    <View className={`mb-3 flex-1 rounded-2xl border border-border p-4 ${colors.bg}`}>
                      <View className="flex-row items-center justify-between">
                        <Text className={`text-sm font-semibold ${colors.text}`}>{EVENT_LABELS[item.eventType] ?? item.eventType}</Text>
                        <Text className="text-[10px] text-muted">#{item.sequenceNumber}</Text>
                      </View>
                      {item.actorSubject ? <Text className="mt-1 text-xs text-muted">Actor: {item.actorSubject}</Text> : null}
                      <Text className="mt-1 text-xs text-muted">{new Date(item.occurredAt).toLocaleString()}</Text>
                      {item.payload && Object.keys(item.payload).length > 0 ? (
                        <View className="mt-2 rounded-xl border border-border bg-background p-3">
                          {Object.entries(item.payload).map(([key, value]) => (
                            <Text key={key} className="text-[11px] text-muted"><Text className="font-semibold text-foreground">{key}:</Text> {typeof value === "string" ? (value.length > 32 ? `${value.slice(0, 32)}…` : value) : JSON.stringify(value)}</Text>
                          ))}
                        </View>
                      ) : null}
                      <View className="mt-2 rounded-lg bg-background/50 px-2 py-1">
                        <Text className="text-[9px] font-mono text-muted" numberOfLines={1}>Hash: {item.eventHash.slice(0, 24)}…</Text>
                        {item.previousEventHash ? <Text className="text-[9px] font-mono text-muted" numberOfLines={1}>Prev: {item.previousEventHash.slice(0, 24)}…</Text> : <Text className="text-[9px] font-mono text-muted">Genesis event</Text>}
                      </View>
                    </View>
                  </View>
                );
              }}
            />
          </View>
        ) : validId && !timeline.isLoading && !timeline.isError ? (
          <View className="items-center rounded-3xl border border-border bg-surface py-8">
            <Text className="text-base font-semibold text-muted">No audit events</Text>
            <Text className="mt-2 text-sm text-muted">This authorization has no recorded events yet.</Text>
          </View>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}
