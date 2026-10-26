/**
 * NDSEP Mobile — Public Complaints Screen
 * Staff triage queue over the publicComplaints router:
 *   publicComplaints.list / .get (status timeline) / .stats
 */
import React, { useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, ScrollView,
} from "react-native";
import { trpc } from "../api/trpc";

const STATUS_COLORS: Record<string, string> = {
  received: "#3b82f6", acknowledged: "#06b6d4", under_review: "#f59e0b",
  linked_to_case: "#a78bfa", resolved: "#22c55e", closed: "#64748b",
};
const SLA_COLORS: Record<string, string> = {
  breached: "#ef4444", within_sla: "#f59e0b", met: "#22c55e",
};
const STATUSES = ["received", "acknowledged", "under_review", "linked_to_case", "resolved", "closed"];

export default function ComplaintsScreen() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [slaBreachedOnly, setSlaBreachedOnly] = useState(false);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const listQuery = trpc.publicComplaints.list.useQuery({
    status: statusFilter as any,
    slaBreachedOnly,
    unassignedOnly,
    page: 1,
    limit: 50,
  });
  const statsQuery = trpc.publicComplaints.stats.useQuery();

  const stats = statsQuery.data as any;
  const rows: any[] = (listQuery.data as any)?.data ?? [];
  const total = (listQuery.data as any)?.total ?? rows.length;

  return (
    <View style={styles.container}>
      {/* Stats row */}
      {stats && (
        <View style={styles.statsRow}>
          <StatCell label="Total" value={stats.total} color="#f1f5f9" />
          <StatCell label="New 7d" value={stats.received_last_7d} color="#3b82f6" />
          <StatCell label="In review" value={stats.under_review} color="#f59e0b" />
          <StatCell label="SLA breach" value={stats.ack_sla_breached} color="#ef4444" />
          <StatCell label="Resolved" value={stats.resolved} color="#22c55e" />
        </View>
      )}

      {/* Filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={{ paddingHorizontal: 12 }}>
        <FilterChip label="All" active={!statusFilter && !slaBreachedOnly && !unassignedOnly}
          onPress={() => { setStatusFilter(undefined); setSlaBreachedOnly(false); setUnassignedOnly(false); }} />
        <FilterChip label="SLA breached" active={slaBreachedOnly} color="#ef4444" onPress={() => setSlaBreachedOnly(v => !v)} />
        <FilterChip label="Unassigned" active={unassignedOnly} onPress={() => setUnassignedOnly(v => !v)} />
        {STATUSES.map(s => (
          <FilterChip key={s} label={s.replaceAll("_", " ")} active={statusFilter === s}
            color={STATUS_COLORS[s]} onPress={() => setStatusFilter(statusFilter === s ? undefined : s)} />
        ))}
      </ScrollView>

      {listQuery.isLoading ? (
        <ActivityIndicator color="#00d4ff" style={{ marginTop: 40 }} />
      ) : listQuery.error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Error: {listQuery.error.message}</Text>
          <TouchableOpacity onPress={() => listQuery.refetch()}><Text style={styles.retry}>Retry</Text></TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.id)}
          refreshing={listQuery.isRefetching}
          onRefresh={() => listQuery.refetch()}
          contentContainerStyle={{ padding: 12 }}
          ListHeaderComponent={<Text style={styles.countText}>{total} complaint{total === 1 ? "" : "s"}</Text>}
          ListEmptyComponent={<Text style={styles.emptyText}>No complaints match the current filters.</Text>}
          renderItem={({ item }) => {
            const sc = STATUS_COLORS[item.status] ?? "#64748b";
            const slaColor = SLA_COLORS[item.ack_sla_state] ?? "#64748b";
            return (
              <TouchableOpacity style={styles.card} onPress={() => setDetailId(item.id)}>
                <View style={styles.cardHeader}>
                  <Text style={styles.refCode}>{item.reference_code}</Text>
                  <View style={[styles.badge, { backgroundColor: sc + "25" }]}>
                    <Text style={[styles.badgeText, { color: sc }]}>{item.status?.replaceAll("_", " ").toUpperCase()}</Text>
                  </View>
                </View>
                <Text style={styles.cardTitle} numberOfLines={2}>{item.subject}</Text>
                <Text style={styles.cardMeta}>
                  {item.category?.replaceAll("_", " ")} · {item.controller_name ?? "unknown controller"}{item.state ? ` · ${item.state}` : ""}
                </Text>
                {item.ack_sla_state && (
                  <Text style={[styles.slaText, { color: slaColor }]}>
                    {item.ack_sla_state === "within_sla" && item.ack_sla_hours_remaining != null
                      ? `SLA ${item.ack_sla_hours_remaining}h left`
                      : `SLA ${String(item.ack_sla_state).replaceAll("_", " ")}`}
                  </Text>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Detail + timeline modal */}
      <Modal visible={detailId != null} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {detailId != null && <ComplaintDetail id={detailId} onClose={() => setDetailId(null)} />}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ComplaintDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const query = trpc.publicComplaints.get.useQuery({ id });
  if (query.isLoading) return <ActivityIndicator color="#00d4ff" style={{ marginTop: 40 }} />;
  if (query.error) return (
    <View style={{ padding: 16 }}>
      <Text style={styles.errorText}>Error: {query.error.message}</Text>
      <TouchableOpacity onPress={onClose}><Text style={styles.retry}>Close</Text></TouchableOpacity>
    </View>
  );
  const c = query.data as any;
  const events: any[] = c?.events ?? [];
  const attachments: any[] = c?.attachments ?? [];
  const sc = STATUS_COLORS[c?.status] ?? "#64748b";
  return (
    <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.cardHeader}>
        <Text style={styles.refCode}>{c.reference_code}</Text>
        <View style={[styles.badge, { backgroundColor: sc + "25" }]}>
          <Text style={[styles.badgeText, { color: sc }]}>{c.status?.replaceAll("_", " ").toUpperCase()}</Text>
        </View>
      </View>
      <Text style={styles.detailTitle}>{c.subject}</Text>
      <DetailRow label="Category" value={c.category} />
      <DetailRow label="Controller" value={c.controller_name ?? c.controller_registration_ref ?? "—"} />
      <DetailRow label="Location" value={[c.state, c.lga].filter(Boolean).join(" · ") || "—"} />
      <DetailRow label="Received" value={c.received_at?.substring(0, 16)} />
      <DetailRow label="Ack SLA" value={`${c.ack_sla_state ?? "—"} (due ${c.ack_sla_due_at?.substring(0, 16) ?? "—"})`} />
      <DetailRow label="Officer" value={c.assigned_officer_id ? `#${c.assigned_officer_id}` : "Unassigned"} />
      <DetailRow label="Complainant" value={c.is_anonymous ? "Anonymous" : (c.complainant_name ?? "—")} />
      {c.enforcement_case_id != null && <DetailRow label="Linked case" value={`#${c.enforcement_case_id}`} />}
      <Text style={styles.detailDesc}>{c.description}</Text>
      {attachments.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Attachments ({attachments.length})</Text>
          {attachments.map((a: any) => (
            <Text key={a.id} style={styles.attachmentText}>📎 {a.filename} — vault: {a.vault_status ?? "n/a"}</Text>
          ))}
        </>
      )}
      <Text style={styles.sectionTitle}>Status timeline</Text>
      {events.length === 0 ? (
        <Text style={styles.emptyText}>No timeline events recorded yet.</Text>
      ) : events.map((e: any) => (
        <View key={e.id} style={styles.timelineRow}>
          <View style={[styles.timelineDot, { backgroundColor: STATUS_COLORS[e.to_status] ?? "#64748b" }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.timelineTitle}>
              {e.event_type}{e.from_status != null || e.to_status != null ? ` — ${e.from_status ?? "∅"} → ${e.to_status ?? "∅"}` : ""}
            </Text>
            <Text style={styles.timelineMeta}>{e.actor} · {e.created_at?.substring(0, 16)}</Text>
          </View>
        </View>
      ))}
      <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
        <Text style={styles.closeBtnText}>Close</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function StatCell({ label, value, color }: { label: string; value: any; color: string }) {
  return (
    <View style={{ alignItems: "center", flex: 1 }}>
      <Text style={{ color, fontSize: 16, fontWeight: "800" }}>{String(value ?? 0)}</Text>
      <Text style={{ color: "#64748b", fontSize: 9, textAlign: "center" }}>{label}</Text>
    </View>
  );
}

function FilterChip({ label, active, onPress, color = "#00d4ff" }: { label: string; active: boolean; onPress: () => void; color?: string }) {
  return (
    <TouchableOpacity onPress={onPress}
      style={[styles.chip, active && { backgroundColor: color + "35", borderColor: color }]}>
      <Text style={[styles.chipText, active && { color: "#fff" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value ?? "—"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0e1a" },
  center: { alignItems: "center", marginTop: 40 },
  errorText: { color: "#ef4444", fontSize: 13 },
  retry: { color: "#00d4ff", marginTop: 12 },
  statsRow: { flexDirection: "row", backgroundColor: "#0f172a", margin: 12, marginBottom: 0, borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: "#1e293b" },
  filters: { flexGrow: 0, marginTop: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: "#1e293b", backgroundColor: "#0f172a", marginRight: 8 },
  chipText: { color: "#94a3b8", fontSize: 11 },
  countText: { color: "#64748b", fontSize: 11, marginBottom: 8 },
  card: { backgroundColor: "#0f172a", borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#1e293b" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  refCode: { color: "#64748b", fontSize: 11, fontFamily: "monospace" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  badgeText: { fontSize: 9, fontWeight: "700" },
  cardTitle: { color: "#f1f5f9", fontSize: 14, fontWeight: "700" },
  cardMeta: { color: "#64748b", fontSize: 11, marginTop: 4 },
  slaText: { fontSize: 10, fontWeight: "600", marginTop: 4 },
  emptyText: { color: "#64748b", fontSize: 13, textAlign: "center", marginTop: 24 },
  modalOverlay: { flex: 1, backgroundColor: "#000000aa", justifyContent: "flex-end" },
  modalCard: { backgroundColor: "#0f172a", borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "88%" },
  detailTitle: { color: "#f1f5f9", fontSize: 17, fontWeight: "800", marginBottom: 10 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  detailLabel: { color: "#64748b", fontSize: 12 },
  detailValue: { color: "#f1f5f9", fontSize: 12, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  detailDesc: { color: "#94a3b8", fontSize: 12, marginTop: 8, lineHeight: 18 },
  sectionTitle: { color: "#f1f5f9", fontSize: 13, fontWeight: "700", marginTop: 14, marginBottom: 6 },
  attachmentText: { color: "#94a3b8", fontSize: 11, marginBottom: 4 },
  timelineRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  timelineDot: { width: 9, height: 9, borderRadius: 5, marginTop: 3, marginRight: 8 },
  timelineTitle: { color: "#f1f5f9", fontSize: 12, fontWeight: "600" },
  timelineMeta: { color: "#64748b", fontSize: 10 },
  closeBtn: { marginTop: 16, backgroundColor: "#1e293b", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  closeBtnText: { color: "#00d4ff", fontWeight: "700" },
});
