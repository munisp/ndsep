/**
 * NDSEP Mobile — Government Executive Dashboard
 * Mirrors the web GovDashboard page with real tRPC data.
 */
import React, { useCallback } from "react";
import {
  View, Text, ScrollView, RefreshControl,
  StyleSheet, TouchableOpacity, ActivityIndicator,
} from "react-native";
import { trpc } from "../api/trpc";

export default function DashboardScreen() {
  const { data: stats, isLoading, refetch, isRefetching } = trpc.dashboard.stats.useQuery();
  const { data: leaderboard } = trpc.leaderboard.list.useQuery({ limit: 5 });

  const onRefresh = useCallback(() => { refetch(); }, [refetch]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#00d4ff" />
        <Text style={styles.loadingText}>Loading dashboard…</Text>
      </View>
    );
  }

  const org = stats?.orgStats ?? {};
  const asset = stats?.assetStats ?? {};
  const violation = stats?.violationStats ?? {};
  const penalty = stats?.penaltyStats ?? {};
  const alert = stats?.alertStats ?? {};

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor="#00d4ff" />}
    >
      {/* National Risk Score */}
      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>NATIONAL RISK SCORE</Text>
        <Text style={[styles.heroValue, { color: Number(org.avgRisk ?? 0) > 70 ? "#ef4444" : Number(org.avgRisk ?? 0) > 40 ? "#f59e0b" : "#22c55e" }]}>
          {Number(org.avgRisk ?? 0).toFixed(1)}
        </Text>
        <Text style={styles.heroSub}>Average compliance: {Number(org.avgScore ?? 0).toFixed(1)}%</Text>
      </View>

      {/* KPI Grid */}
      <View style={styles.grid}>
        {[
          { label: "Organizations", value: org.total ?? 0, color: "#00d4ff" },
          { label: "Compliant", value: org.compliant ?? 0, color: "#22c55e" },
          { label: "Non-Compliant", value: org.nonCompliant ?? 0, color: "#ef4444" },
          { label: "Assets Tracked", value: asset.total ?? 0, color: "#a78bfa" },
          { label: "Outside Borders", value: asset.outsideBorders ?? 0, color: "#f59e0b" },
          { label: "Open Violations", value: violation.open ?? 0, color: "#f97316" },
          { label: "Critical Violations", value: violation.critical ?? 0, color: "#dc2626" },
          { label: "Pending Penalties", value: `$${Number(penalty.pendingAmount ?? 0).toLocaleString()}`, color: "#fbbf24" },
          { label: "Unresolved Alerts", value: alert.unresolved ?? 0, color: "#fb923c" },
        ].map(({ label, value, color }) => (
          <View key={label} style={styles.kpiCard}>
            <Text style={[styles.kpiValue, { color }]}>{value}</Text>
            <Text style={styles.kpiLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Compliance Leaderboard */}
      {leaderboard && leaderboard.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Compliant Organizations</Text>
          {leaderboard.slice(0, 5).map((org: any, i: number) => (
            <View key={org.id} style={styles.leaderRow}>
              <Text style={styles.leaderRank}>#{i + 1}</Text>
              <View style={styles.leaderInfo}>
                <Text style={styles.leaderName}>{org.name}</Text>
                <Text style={styles.leaderSector}>{org.sector}</Text>
              </View>
              <Text style={[styles.leaderScore, { color: Number(org.complianceScore) >= 80 ? "#22c55e" : "#f59e0b" }]}>
                {Number(org.complianceScore ?? 0).toFixed(1)}%
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0e1a" },
  center: { flex: 1, backgroundColor: "#0a0e1a", alignItems: "center", justifyContent: "center" },
  loadingText: { color: "#94a3b8", marginTop: 12, fontSize: 14 },
  heroCard: {
    margin: 16, padding: 24, backgroundColor: "#0f172a",
    borderRadius: 12, borderWidth: 1, borderColor: "#1e293b", alignItems: "center",
  },
  heroLabel: { color: "#64748b", fontSize: 11, letterSpacing: 2, fontWeight: "600" },
  heroValue: { fontSize: 64, fontWeight: "900", marginVertical: 4 },
  heroSub: { color: "#94a3b8", fontSize: 13 },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 8 },
  kpiCard: {
    width: "33.33%", padding: 8,
  },
  kpiCardInner: {
    backgroundColor: "#0f172a", borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: "#1e293b", alignItems: "center",
  },
  kpiValue: { fontSize: 22, fontWeight: "800" },
  kpiLabel: { color: "#64748b", fontSize: 10, marginTop: 2, textAlign: "center" },
  section: { margin: 16, backgroundColor: "#0f172a", borderRadius: 12, borderWidth: 1, borderColor: "#1e293b", padding: 16 },
  sectionTitle: { color: "#f1f5f9", fontSize: 15, fontWeight: "700", marginBottom: 12 },
  leaderRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  leaderRank: { color: "#64748b", fontSize: 13, width: 28, fontWeight: "600" },
  leaderInfo: { flex: 1 },
  leaderName: { color: "#f1f5f9", fontSize: 13, fontWeight: "600" },
  leaderSector: { color: "#64748b", fontSize: 11 },
  leaderScore: { fontSize: 15, fontWeight: "800" },
});
