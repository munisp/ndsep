/**
 * NDSEP Mobile — Organization Detail Screen
 */
import React from "react";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from "react-native";
import { trpc } from "../api/trpc";

export default function OrganizationDetailScreen({ route, navigation }: any) {
  const { orgId } = route.params;
  const { data: org, isLoading } = trpc.organizations.get.useQuery({ id: orgId });
  const { data: violations } = trpc.compliance.violations.useQuery({ organizationId: orgId, limit: 10 });
  const { data: penalties } = trpc.financial.penalties.useQuery({ organizationId: orgId, limit: 10 });
  const { data: assets } = trpc.assets.list.useQuery({ organizationId: orgId, limit: 20 });

  if (isLoading) return <ActivityIndicator color="#00d4ff" style={{ marginTop: 80 }} />;
  if (!org) return <View style={styles.center}><Text style={styles.notFound}>Organization not found.</Text></View>;

  const score = Number(org.complianceScore ?? 0);
  const scoreColor = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";

  return (
    <ScrollView style={styles.container}>
      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.orgName}>{org.name}</Text>
        <Text style={styles.orgMeta}>{org.sector} · {org.country} · {org.registrationNumber}</Text>
        <View style={styles.scoreRow}>
          <Text style={[styles.score, { color: scoreColor }]}>{score.toFixed(1)}%</Text>
          <View>
            <Text style={styles.scoreLabel}>Compliance Score</Text>
            <Text style={[styles.status, { color: org.complianceStatus === "compliant" ? "#22c55e" : "#ef4444" }]}>
              {org.complianceStatus?.toUpperCase()}
            </Text>
          </View>
        </View>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        {[
          { label: "Risk Score", value: Number(org.riskScore ?? 0).toFixed(1), color: "#f97316" },
          { label: "Violations", value: violations?.length ?? 0, color: "#ef4444" },
          { label: "Penalties", value: penalties?.length ?? 0, color: "#fbbf24" },
          { label: "Assets", value: assets?.length ?? 0, color: "#a78bfa" },
        ].map(({ label, value, color }) => (
          <View key={label} style={styles.statCard}>
            <Text style={[styles.statValue, { color }]}>{value}</Text>
            <Text style={styles.statLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Recent Violations */}
      {violations && violations.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Violations</Text>
          {violations.slice(0, 5).map((v: any) => (
            <View key={v.id} style={styles.listRow}>
              <View style={[styles.dot, { backgroundColor: v.severity === "critical" ? "#dc2626" : v.severity === "high" ? "#f97316" : "#f59e0b" }]} />
              <Text style={styles.listText} numberOfLines={1}>{v.title}</Text>
              <Text style={styles.listStatus}>{v.status}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Recent Penalties */}
      {penalties && penalties.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Penalties</Text>
          {penalties.slice(0, 5).map((p: any) => (
            <View key={p.id} style={styles.listRow}>
              <Text style={styles.penaltyAmt}>${Number(p.amountUsd).toLocaleString()}</Text>
              <Text style={styles.listText} numberOfLines={1}>{p.reason}</Text>
              <Text style={[styles.listStatus, { color: p.status === "paid" ? "#22c55e" : "#ef4444" }]}>{p.status}</Text>
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
  notFound: { color: "#475569", fontSize: 14 },
  backBtn: { padding: 16, paddingBottom: 0 },
  backText: { color: "#00d4ff", fontSize: 14 },
  header: { margin: 16, backgroundColor: "#0f172a", borderRadius: 12, padding: 20, borderWidth: 1, borderColor: "#1e293b" },
  orgName: { color: "#f1f5f9", fontSize: 18, fontWeight: "800", marginBottom: 4 },
  orgMeta: { color: "#64748b", fontSize: 12, marginBottom: 16 },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  score: { fontSize: 48, fontWeight: "900" },
  scoreLabel: { color: "#94a3b8", fontSize: 12 },
  status: { fontSize: 12, fontWeight: "700", marginTop: 2 },
  statsRow: { flexDirection: "row", paddingHorizontal: 12, gap: 8, marginBottom: 8 },
  statCard: { flex: 1, backgroundColor: "#0f172a", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#1e293b", alignItems: "center" },
  statValue: { fontSize: 20, fontWeight: "800" },
  statLabel: { color: "#64748b", fontSize: 10, marginTop: 2, textAlign: "center" },
  section: { marginHorizontal: 16, marginBottom: 12, backgroundColor: "#0f172a", borderRadius: 10, padding: 14, borderWidth: 1, borderColor: "#1e293b" },
  sectionTitle: { color: "#f1f5f9", fontSize: 14, fontWeight: "700", marginBottom: 10 },
  listRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  listText: { flex: 1, color: "#94a3b8", fontSize: 12 },
  listStatus: { color: "#64748b", fontSize: 11 },
  penaltyAmt: { color: "#fbbf24", fontSize: 13, fontWeight: "700", width: 70 },
});
