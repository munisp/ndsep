/**
 * NDSEP Mobile — Enforcement Case Detail Screen
 * enforcementCases.list (row lookup — no by-id procedure exists) +
 * enforcementCases.timeline for the status history.
 */
import React from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { trpc } from "../api/trpc";

const STATUS_COLORS: Record<string, string> = {
  open: "#ef4444", under_investigation: "#f59e0b", notice_issued: "#3b82f6",
  escalated_to_ndpc: "#a78bfa", escalated_to_nitda: "#a78bfa",
  settled: "#22c55e", closed: "#64748b",
};

export default function EnforcementCaseDetailScreen({ route, navigation }: any) {
  const { caseId } = route.params;
  const casesQuery = trpc.enforcementCases.list.useQuery({ limit: 200 });
  const timelineQuery = trpc.enforcementCases.timeline.useQuery({ caseId });

  if (casesQuery.isLoading || timelineQuery.isLoading) {
    return <ActivityIndicator color="#00d4ff" style={{ marginTop: 80 }} />;
  }
  const row = ((casesQuery.data as any[]) ?? []).find((c: any) => c.id === caseId);
  if (!row) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFound}>Enforcement case #{caseId} not found.</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.backLink}>← Back</Text></TouchableOpacity>
      </View>
    );
  }
  const timeline: any[] = (timelineQuery.data as any[]) ?? [];
  const sc = STATUS_COLORS[row.status] ?? "#64748b";

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.backLink}>← Back</Text>
      </TouchableOpacity>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.refCode}>{row.case_reference}</Text>
          <View style={[styles.badge, { backgroundColor: sc + "25" }]}>
            <Text style={[styles.badgeText, { color: sc }]}>{String(row.status ?? "").replaceAll("_", " ").toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.org}>{row.org_name}</Text>
        <Text style={styles.reason}>{row.escalation_reason ?? "Penalty escalation"}</Text>
        <View style={styles.divider} />
        <Row label="Penalty" value={`#${row.penalty_id ?? "—"} · ${row.currency ?? "NGN"} ${row.amount ?? "—"} (${row.payment_status ?? "—"})`} />
        <Row label="Assigned officer" value={row.officer_name ?? "Unassigned"} />
        <Row label="Overdue days" value={String(row.overdue_days ?? 0)} />
        <Row label="NDPC ref" value={row.nitda_reference_number ?? "—"} />
        <Row label="Opened" value={row.opened_at?.substring(0, 16) ?? "—"} />
        {row.resolved_at && <Row label="Resolved" value={row.resolved_at.substring(0, 16)} />}
        {row.resolution_notes && <Row label="Resolution" value={row.resolution_notes} />}
      </View>

      <Text style={styles.sectionTitle}>Status timeline</Text>
      {timeline.length === 0 ? (
        <Text style={styles.emptyText}>No timeline entries recorded yet.</Text>
      ) : timeline.map((e: any) => (
        <View key={e.id} style={styles.timelineRow}>
          <View style={[styles.dot, { backgroundColor: STATUS_COLORS[e.to_status] ?? "#64748b" }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.timelineTitle}>{e.from_status ?? "∅"} → {e.to_status ?? "∅"}</Text>
            {e.note ? <Text style={styles.timelineNote}>{e.note}</Text> : null}
            <Text style={styles.timelineMeta}>{e.changed_by_name ?? e.user_name ?? ""} · {e.created_at?.substring(0, 16)}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0e1a" },
  center: { flex: 1, backgroundColor: "#0a0e1a", alignItems: "center", justifyContent: "center" },
  notFound: { color: "#475569", fontSize: 14 },
  backLink: { color: "#00d4ff", fontSize: 14, marginBottom: 12 },
  card: { backgroundColor: "#0f172a", borderRadius: 12, padding: 20, borderWidth: 1, borderColor: "#1e293b" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  refCode: { color: "#64748b", fontSize: 13, fontFamily: "monospace", flexShrink: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  org: { color: "#00d4ff", fontSize: 15, fontWeight: "700", marginBottom: 6 },
  reason: { color: "#94a3b8", fontSize: 13, lineHeight: 20 },
  divider: { height: 1, backgroundColor: "#1e293b", marginVertical: 14 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  metaLabel: { color: "#64748b", fontSize: 13 },
  metaValue: { color: "#f1f5f9", fontSize: 13, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  sectionTitle: { color: "#f1f5f9", fontSize: 14, fontWeight: "700", marginTop: 18, marginBottom: 8 },
  timelineRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 3, marginRight: 10 },
  timelineTitle: { color: "#f1f5f9", fontSize: 12, fontWeight: "600" },
  timelineNote: { color: "#94a3b8", fontSize: 11 },
  timelineMeta: { color: "#64748b", fontSize: 10 },
  emptyText: { color: "#64748b", fontSize: 12 },
});
