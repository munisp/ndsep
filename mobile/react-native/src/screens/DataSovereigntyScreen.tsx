/**
 * NDSEP Mobile — Data Sovereignty Screen
 *   hostingVerification.listVerdicts / .declarationVerdict / .stats
 *   dataSovereignty.scoreRegister / .sectorHeatMap
 */
import React, { useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, ScrollView,
} from "react-native";
import { trpc } from "../api/trpc";

const VERDICT_COLORS: Record<string, string> = {
  compliant: "#22c55e", violation: "#ef4444", unverified: "#f59e0b",
};
const TIER_COLORS: Record<string, string> = {
  sovereign_ready: "#22c55e", on_track: "#06b6d4", at_risk: "#f59e0b",
  critical: "#ef4444", non_compliant: "#dc2626",
};

type TabKey = "verdicts" | "scores" | "sectors";

export default function DataSovereigntyScreen() {
  const [tab, setTab] = useState<TabKey>("verdicts");
  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        {(["verdicts", "scores", "sectors"] as const).map(t => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === "verdicts" ? "Hosting Verdicts" : t === "scores" ? "Score Register" : "Sector Heat Map"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab === "verdicts" ? <VerdictsTab /> : tab === "scores" ? <ScoresTab /> : <SectorsTab />}
    </View>
  );
}

function VerdictsTab() {
  const [verdictFilter, setVerdictFilter] = useState<string | undefined>(undefined);
  const [detailId, setDetailId] = useState<number | null>(null);
  const listQuery = trpc.hostingVerification.listVerdicts.useQuery({ status: verdictFilter as any, limit: 200 });
  const statsQuery = trpc.hostingVerification.stats.useQuery();
  const stats = statsQuery.data as any;
  const rows: any[] = (listQuery.data as any)?.rows ?? [];

  return (
    <View style={{ flex: 1 }}>
      {stats && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={{ paddingHorizontal: 12 }}>
          <StatChip label="Verified" value={stats.declarations_verified} color="#00d4ff" />
          <StatChip label="Compliant" value={stats.compliant} color="#22c55e" active={verdictFilter === "compliant"} onPress={() => setVerdictFilter(verdictFilter === "compliant" ? undefined : "compliant")} />
          <StatChip label="Violations" value={stats.violation} color="#ef4444" active={verdictFilter === "violation"} onPress={() => setVerdictFilter(verdictFilter === "violation" ? undefined : "violation")} />
          <StatChip label="Unverified" value={stats.unverified} color="#f59e0b" active={verdictFilter === "unverified"} onPress={() => setVerdictFilter(verdictFilter === "unverified" ? undefined : "unverified")} />
          <StatChip label="Never verified" value={stats.never_verified} color="#64748b" />
          <StatChip label="Runs 24h" value={stats.runs_24h} color="#94a3b8" />
        </ScrollView>
      )}
      {listQuery.isLoading ? <ActivityIndicator color="#00d4ff" style={{ marginTop: 40 }} /> : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.run_id)}
          refreshing={listQuery.isRefetching}
          onRefresh={() => listQuery.refetch()}
          contentContainerStyle={{ padding: 12 }}
          ListEmptyComponent={<Text style={styles.emptyText}>No verification verdicts match the filter.</Text>}
          renderItem={({ item }) => {
            const color = VERDICT_COLORS[item.verdict] ?? "#64748b";
            return (
              <TouchableOpacity style={styles.card} onPress={() => setDetailId(item.declaration_id)}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.entity_name ?? item.entity_ref}</Text>
                  <View style={[styles.badge, { backgroundColor: color + "25" }]}>
                    <Text style={[styles.badgeText, { color }]}>{item.verdict?.toUpperCase()}</Text>
                  </View>
                </View>
                <Text style={styles.cardMeta}>
                  {item.entity_type} · hosts {item.host_count ?? 0} (NG {item.in_nigeria_count ?? 0} / out {item.outside_nigeria_count ?? 0}) · checked {item.checked_at?.substring(0, 16) ?? "never"}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      )}
      <Modal visible={detailId != null} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {detailId != null && <DeclarationVerdict id={detailId} onClose={() => setDetailId(null)} />}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function DeclarationVerdict({ id, onClose }: { id: number; onClose: () => void }) {
  const query = trpc.hostingVerification.declarationVerdict.useQuery({ declarationId: id });
  if (query.isLoading) return <ActivityIndicator color="#00d4ff" style={{ marginTop: 40 }} />;
  if (query.error) return <View style={{ padding: 16 }}><Text style={styles.errorText}>Error: {query.error.message}</Text></View>;
  const data = query.data as any;
  const run = data?.run;
  const hosts: any[] = data?.hosts ?? [];
  const verdict = run?.verdict ?? "unverified";
  const color = VERDICT_COLORS[verdict] ?? "#64748b";
  return (
    <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.cardHeader}>
        <Text style={styles.detailTitle}>Declaration #{id}</Text>
        <View style={[styles.badge, { backgroundColor: color + "25" }]}>
          <Text style={[styles.badgeText, { color }]}>{verdict.toUpperCase()}</Text>
        </View>
      </View>
      {data?.note && <Text style={styles.noteText}>{data.note}</Text>}
      {run && (
        <Text style={styles.cardMeta}>
          Trigger: {run.trigger} · by {run.checked_by ?? "scheduler"} · {run.checked_at?.substring(0, 16)}
        </Text>
      )}
      <Text style={styles.sectionTitle}>Per-host evidence</Text>
      {hosts.length === 0 ? (
        <Text style={styles.emptyText}>No host evidence recorded.</Text>
      ) : hosts.map((h: any) => {
        const hc = h.verdict === "in_nigeria" ? "#22c55e" : h.verdict === "outside_nigeria" ? "#ef4444" : "#f59e0b";
        return (
          <View key={h.id} style={styles.hostRow}>
            <View style={[styles.timelineDot, { backgroundColor: hc }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.hostName}>{h.host}</Text>
              <Text style={styles.cardMeta}>{h.host_kind} · {String(h.verdict ?? "unverified").replaceAll("_", " ")}</Text>
            </View>
          </View>
        );
      })}
      <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
        <Text style={styles.closeBtnText}>Close</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function ScoresTab() {
  const [tierFilter, setTierFilter] = useState<string | undefined>(undefined);
  const query = trpc.dataSovereignty.scoreRegister.useQuery({ tier: tierFilter as any, limit: 200 });
  const rows: any[] = (query.data as any)?.rows ?? [];
  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={{ paddingHorizontal: 12 }}>
        <StatChip label="All tiers" value="" color="#00d4ff" active={!tierFilter} onPress={() => setTierFilter(undefined)} />
        {Object.keys(TIER_COLORS).map(t => (
          <StatChip key={t} label={t.replaceAll("_", " ")} value="" color={TIER_COLORS[t]} active={tierFilter === t} onPress={() => setTierFilter(tierFilter === t ? undefined : t)} />
        ))}
      </ScrollView>
      {query.isLoading ? <ActivityIndicator color="#00d4ff" style={{ marginTop: 40 }} /> : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.entity_ref)}
          refreshing={query.isRefetching}
          onRefresh={() => query.refetch()}
          contentContainerStyle={{ padding: 12 }}
          ListEmptyComponent={<Text style={styles.emptyText}>No sovereignty scores computed yet.</Text>}
          renderItem={({ item }) => {
            const color = TIER_COLORS[item.readiness_tier] ?? "#64748b";
            const score = Number(item.score ?? 0);
            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.entity_ref}</Text>
                  <View style={[styles.badge, { backgroundColor: color + "25" }]}>
                    <Text style={[styles.badgeText, { color }]}>{String(item.readiness_tier ?? "").replaceAll("_", " ").toUpperCase()}</Text>
                  </View>
                </View>
                <View style={styles.scoreBarBg}>
                  <View style={[styles.scoreBar, { width: `${Math.min(100, Math.max(0, score))}%`, backgroundColor: color }]} />
                </View>
                <Text style={styles.cardMeta}>Score {score.toFixed(1)} / 100 · computed {item.computed_at?.substring(0, 16) ?? "—"}</Text>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

function SectorsTab() {
  const query = trpc.dataSovereignty.sectorHeatMap.useQuery();
  const rows: any[] = (query.data as any)?.rows ?? [];
  if (query.isLoading) return <ActivityIndicator color="#00d4ff" style={{ marginTop: 40 }} />;
  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => String(item.entity_type)}
      refreshing={query.isRefetching}
      onRefresh={() => query.refetch()}
      contentContainerStyle={{ padding: 12 }}
      ListEmptyComponent={<Text style={styles.emptyText}>No sector data available.</Text>}
      renderItem={({ item }) => {
        const avg = item.avg_score != null ? Number(item.avg_score) : null;
        const color = avg == null ? "#64748b" : avg >= 80 ? "#22c55e" : avg >= 60 ? "#06b6d4" : avg >= 40 ? "#f59e0b" : "#ef4444";
        return (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{String(item.entity_type ?? "").toUpperCase()}</Text>
              <Text style={{ color, fontSize: 18, fontWeight: "800" }}>{avg == null ? "—" : avg.toFixed(1)}</Text>
            </View>
            <Text style={styles.cardMeta}>
              {item.entities ?? 0} entities ({item.in_scope_entities ?? 0} in scope) · {item.open_violations ?? 0} open violations · {item.at_risk_or_worse ?? 0} at risk+
            </Text>
          </View>
        );
      }}
    />
  );
}

function StatChip({ label, value, color, active, onPress }: { label: string; value: any; color: string; active?: boolean; onPress?: () => void }) {
  return (
    <TouchableOpacity disabled={!onPress} onPress={onPress}
      style={[styles.chip, active && { backgroundColor: color + "35", borderColor: color }]}>
      <Text style={[styles.chipText, { color }]}>{value !== "" ? `${label}: ${value ?? 0}` : label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0e1a" },
  tabBar: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: "#00d4ff" },
  tabText: { color: "#64748b", fontSize: 12, fontWeight: "600" },
  tabTextActive: { color: "#00d4ff" },
  chipsRow: { flexGrow: 0, marginTop: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: "#1e293b", backgroundColor: "#0f172a", marginRight: 8 },
  chipText: { fontSize: 11, fontWeight: "600" },
  card: { backgroundColor: "#0f172a", borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#1e293b" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  cardTitle: { color: "#f1f5f9", fontSize: 13, fontWeight: "700", flexShrink: 1 },
  cardMeta: { color: "#64748b", fontSize: 11, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  badgeText: { fontSize: 9, fontWeight: "700" },
  emptyText: { color: "#64748b", fontSize: 13, textAlign: "center", marginTop: 24 },
  errorText: { color: "#ef4444", fontSize: 13 },
  noteText: { color: "#f59e0b", fontSize: 12, marginTop: 4 },
  detailTitle: { color: "#f1f5f9", fontSize: 16, fontWeight: "800" },
  sectionTitle: { color: "#f1f5f9", fontSize: 13, fontWeight: "700", marginTop: 14, marginBottom: 6 },
  hostRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  hostName: { color: "#f1f5f9", fontSize: 12, fontFamily: "monospace" },
  timelineDot: { width: 9, height: 9, borderRadius: 5, marginTop: 3, marginRight: 8 },
  scoreBarBg: { height: 6, borderRadius: 3, backgroundColor: "#1e293b", marginTop: 8, overflow: "hidden" },
  scoreBar: { height: 6, borderRadius: 3 },
  modalOverlay: { flex: 1, backgroundColor: "#000000aa", justifyContent: "flex-end" },
  modalCard: { backgroundColor: "#0f172a", borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "85%" },
  closeBtn: { marginTop: 16, backgroundColor: "#1e293b", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  closeBtnText: { color: "#00d4ff", fontWeight: "700" },
});
