/**
 * NDSEP Mobile — Organization Self-Service Portal Screen
 */
import React from "react";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Linking } from "react-native";
import { trpc } from "../api/trpc";

export default function PortalScreen() {
  const { data: portal, isLoading } = trpc.portal.myOrg.useQuery();

  if (isLoading) return <ActivityIndicator color="#00d4ff" style={{ marginTop: 80 }} />;
  if (!portal) return (
    <View style={styles.center}>
      <Text style={styles.emptyText}>No organization portal found for your account.</Text>
    </View>
  );

  const org = portal.organization;
  const score = Number(org?.complianceScore ?? 0);
  const scoreColor = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";

  return (
    <ScrollView style={styles.container}>
      {/* Org Header */}
      <View style={styles.orgCard}>
        <Text style={styles.orgName}>{org?.name}</Text>
        <Text style={styles.orgSector}>{org?.sector} · {org?.country}</Text>
        <View style={styles.scoreRow}>
          <Text style={[styles.score, { color: scoreColor }]}>{score.toFixed(1)}%</Text>
          <Text style={styles.scoreLabel}>Compliance Score</Text>
        </View>
      </View>

      {/* Portal Phase */}
      {portal.phase && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Onboarding Phase</Text>
          <Text style={styles.phaseText}>{portal.phase.phaseName}</Text>
          <Text style={styles.phaseStatus}>{portal.phase.status}</Text>
        </View>
      )}

      {/* Pending Penalties */}
      {portal.penalties && portal.penalties.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pending Penalties</Text>
          {portal.penalties.map((p: any) => (
            <View key={p.id} style={styles.penaltyRow}>
              <Text style={styles.penaltyAmount}>${Number(p.amountUsd).toLocaleString()}</Text>
              <Text style={styles.penaltyReason} numberOfLines={1}>{p.reason}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Open Violations */}
      {portal.violations && portal.violations.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Open Violations ({portal.violations.length})</Text>
          {portal.violations.slice(0, 5).map((v: any) => (
            <View key={v.id} style={styles.violationRow}>
              <View style={[styles.dot, { backgroundColor: v.severity === "critical" ? "#dc2626" : v.severity === "high" ? "#f97316" : "#f59e0b" }]} />
              <Text style={styles.violationTitle} numberOfLines={1}>{v.title}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Certificates */}
      {portal.certificates && portal.certificates.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Compliance Certificates</Text>
          {portal.certificates.map((c: any) => (
            <View key={c.id} style={styles.certRow}>
              <Text style={styles.certName}>{c.certificateType}</Text>
              <Text style={styles.certExpiry}>Expires: {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "N/A"}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0e1a" },
  center: { flex: 1, backgroundColor: "#0a0e1a", alignItems: "center", justifyContent: "center", padding: 24 },
  orgCard: { margin: 16, backgroundColor: "#0f172a", borderRadius: 12, padding: 20, borderWidth: 1, borderColor: "#1e293b" },
  orgName: { color: "#f1f5f9", fontSize: 18, fontWeight: "800", marginBottom: 4 },
  orgSector: { color: "#64748b", fontSize: 13, marginBottom: 16 },
  scoreRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  score: { fontSize: 42, fontWeight: "900" },
  scoreLabel: { color: "#94a3b8", fontSize: 13 },
  section: { marginHorizontal: 16, marginBottom: 16, backgroundColor: "#0f172a", borderRadius: 10, padding: 16, borderWidth: 1, borderColor: "#1e293b" },
  sectionTitle: { color: "#f1f5f9", fontSize: 14, fontWeight: "700", marginBottom: 12 },
  phaseText: { color: "#00d4ff", fontSize: 14, fontWeight: "600" },
  phaseStatus: { color: "#64748b", fontSize: 12, marginTop: 4 },
  penaltyRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  penaltyAmount: { color: "#ef4444", fontSize: 15, fontWeight: "800", width: 90 },
  penaltyReason: { color: "#94a3b8", fontSize: 12, flex: 1 },
  violationRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  violationTitle: { color: "#94a3b8", fontSize: 13, flex: 1 },
  certRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  certName: { color: "#22c55e", fontSize: 13, fontWeight: "600" },
  certExpiry: { color: "#64748b", fontSize: 12 },
  emptyText: { color: "#475569", fontSize: 14, textAlign: "center" },
});
