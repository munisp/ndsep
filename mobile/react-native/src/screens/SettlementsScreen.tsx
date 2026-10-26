/**
 * NDSEP Mobile — Settlement Workflows Screen
 *   settlementWorkflow.listSettlements + settlementWorkflow.getSettlement
 */
import React, { useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, ScrollView,
} from "react-native";
import { trpc } from "../api/trpc";

const STATUS_COLORS: Record<string, string> = {
  proposal: "#3b82f6", counter: "#a78bfa", agreement: "#06b6d4", approval: "#f59e0b",
  active: "#22c55e", fulfilled: "#10b981", defaulted: "#ef4444", void: "#64748b",
};
const STATUSES = ["proposal", "counter", "agreement", "approval", "active", "fulfilled", "defaulted", "void"];

export default function SettlementsScreen() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [detailId, setDetailId] = useState<number | null>(null);
  const query = trpc.settlementWorkflow.listSettlements.useQuery({ status: statusFilter as any, limit: 50 });
  const rows: any[] = (query.data as any)?.rows ?? [];

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={{ paddingHorizontal: 12 }}>
        <Chip label="All" active={!statusFilter} color="#00d4ff" onPress={() => setStatusFilter(undefined)} />
        {STATUSES.map(s => (
          <Chip key={s} label={s} active={statusFilter === s} color={STATUS_COLORS[s]} onPress={() => setStatusFilter(statusFilter === s ? undefined : s)} />
        ))}
      </ScrollView>
      {query.isLoading ? <ActivityIndicator color="#00d4ff" style={{ marginTop: 40 }} /> : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.id)}
          refreshing={query.isRefetching}
          onRefresh={() => query.refetch()}
          contentContainerStyle={{ padding: 12 }}
          ListEmptyComponent={<Text style={styles.emptyText}>No settlements match the current filter.</Text>}
          renderItem={({ item }) => {
            const color = STATUS_COLORS[item.status] ?? "#64748b";
            return (
              <TouchableOpacity style={styles.card} onPress={() => setDetailId(item.id)}>
                <View style={styles.cardHeader}>
                  <Text style={styles.refCode}>{item.settlement_ref}</Text>
                  <View style={[styles.badge, { backgroundColor: color + "25" }]}>
                    <Text style={[styles.badgeText, { color }]}>{item.status?.toUpperCase()}</Text>
                  </View>
                </View>
                <Text style={styles.cardMeta}>
                  Case {item.case_ref ?? "—"} · fine {item.fine_reference ?? "—"} · org #{item.org_id ?? "?"}
                </Text>
                <Text style={styles.amountText}>
                  NGN {Number(item.original_amount ?? 0).toLocaleString()}
                  {Number(item.reduction_amount ?? 0) > 0 ? ` (−${Number(item.reduction_amount).toLocaleString()})` : ""}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      )}
      <Modal visible={detailId != null} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {detailId != null && <SettlementDetail id={detailId} onClose={() => setDetailId(null)} />}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SettlementDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const query = trpc.settlementWorkflow.getSettlement.useQuery({ settlementId: id });
  if (query.isLoading) return <ActivityIndicator color="#00d4ff" style={{ marginTop: 40 }} />;
  if (query.error) return <View style={{ padding: 16 }}><Text style={styles.errorText}>Error: {query.error.message}</Text></View>;
  const data = query.data as any;
  const settlement = data?.settlement ?? {};
  const terms: any[] = data?.terms ?? [];
  const approvals: any[] = data?.approvals ?? [];
  const instalments: any[] = data?.instalments ?? [];
  const sc = STATUS_COLORS[settlement.status] ?? "#64748b";
  const latest = terms[0];
  return (
    <ScrollView style={{ maxHeight: 540 }} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.cardHeader}>
        <Text style={styles.detailTitle}>{settlement.settlement_ref ?? `Settlement #${id}`}</Text>
        <View style={[styles.badge, { backgroundColor: sc + "25" }]}>
          <Text style={[styles.badgeText, { color: sc }]}>{settlement.status?.toUpperCase()}</Text>
        </View>
      </View>
      {latest && (
        <>
          <Text style={styles.sectionTitle}>Latest terms</Text>
          <View style={styles.innerCard}>
            <Text style={styles.amountText}>{latest.currency ?? "NGN"} {Number(latest.monetary_amount ?? 0).toLocaleString()}{latest.is_counter ? " (counter-proposal)" : ""}</Text>
            <Text style={styles.cardMeta}>v{latest.version} · proposed by {latest.proposed_by ?? "—"} · {latest.proposed_at?.substring(0, 16) ?? ""}</Text>
            {(latest.non_monetary_obligations ?? []).map((o: string, i: number) => (
              <Text key={i} style={styles.obligationText}>• {o}</Text>
            ))}
            {latest.confidentiality_flag ? <Text style={styles.noteText}>Confidential — see transparency rationale</Text> : null}
          </View>
        </>
      )}
      {approvals.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Approvals</Text>
          {approvals.map((a: any, i: number) => {
            const dc = a.decision === "approved" ? "#22c55e" : a.decision === "rejected" ? "#ef4444" : "#f59e0b";
            return (
              <View key={i} style={styles.hostRow}>
                <View style={[styles.dot, { backgroundColor: dc }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.hostName}>{a.approver ?? "—"} (level {a.approval_level ?? "?"})</Text>
                  <Text style={styles.cardMeta}>{a.decision ?? "pending"} · {a.decided_at?.substring(0, 16) ?? "—"}</Text>
                </View>
              </View>
            );
          })}
        </>
      )}
      {instalments.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Instalments</Text>
          {instalments.map((inst: any) => {
            const ic = inst.status === "paid" ? "#22c55e" : inst.status === "defaulted" ? "#ef4444" : "#f59e0b";
            return (
              <View key={inst.seq} style={styles.innerCard}>
                <View style={styles.cardHeader}>
                  <Text style={styles.hostName}>#{inst.seq} · {inst.currency ?? "NGN"} {Number(inst.amount ?? 0).toLocaleString()}</Text>
                  <View style={[styles.badge, { backgroundColor: ic + "25" }]}>
                    <Text style={[styles.badgeText, { color: ic }]}>{inst.status?.toUpperCase()}</Text>
                  </View>
                </View>
                <Text style={styles.cardMeta}>due {inst.due_date?.substring(0, 10) ?? "—"} · ledger: {inst.ledger_post_status ?? "unposted"}</Text>
              </View>
            );
          })}
        </>
      )}
      {terms.length === 0 && approvals.length === 0 && instalments.length === 0 && (
        <Text style={styles.emptyText}>No terms, approvals or instalments recorded yet.</Text>
      )}
      <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
        <Text style={styles.closeBtnText}>Close</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Chip({ label, active, onPress, color }: { label: string; active: boolean; onPress: () => void; color: string }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active && { backgroundColor: color + "35", borderColor: color }]}>
      <Text style={[styles.chipText, active && { color: "#fff" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0e1a" },
  chipsRow: { flexGrow: 0, marginTop: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: "#1e293b", backgroundColor: "#0f172a", marginRight: 8 },
  chipText: { color: "#94a3b8", fontSize: 11 },
  card: { backgroundColor: "#0f172a", borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#1e293b" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  refCode: { color: "#f1f5f9", fontSize: 13, fontWeight: "700", fontFamily: "monospace", flexShrink: 1 },
  cardMeta: { color: "#64748b", fontSize: 11, marginTop: 2 },
  amountText: { color: "#fbbf24", fontSize: 14, fontWeight: "800", marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  badgeText: { fontSize: 9, fontWeight: "700" },
  emptyText: { color: "#64748b", fontSize: 13, textAlign: "center", marginTop: 24 },
  errorText: { color: "#ef4444", fontSize: 13 },
  detailTitle: { color: "#f1f5f9", fontSize: 15, fontWeight: "800", fontFamily: "monospace", flexShrink: 1 },
  sectionTitle: { color: "#f1f5f9", fontSize: 13, fontWeight: "700", marginTop: 14, marginBottom: 6 },
  innerCard: { backgroundColor: "#0a0e1a", borderRadius: 8, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: "#1e293b" },
  obligationText: { color: "#94a3b8", fontSize: 12, marginTop: 4 },
  noteText: { color: "#f59e0b", fontSize: 11, marginTop: 6 },
  hostRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  hostName: { color: "#f1f5f9", fontSize: 12, fontWeight: "600" },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 3, marginRight: 8 },
  modalOverlay: { flex: 1, backgroundColor: "#000000aa", justifyContent: "flex-end" },
  modalCard: { backgroundColor: "#0f172a", borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "85%" },
  closeBtn: { marginTop: 16, backgroundColor: "#1e293b", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  closeBtnText: { color: "#00d4ff", fontWeight: "700" },
});
