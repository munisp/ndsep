/**
 * NDSEP Mobile — Security Alerts Screen
 */
import React, { useState } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { trpc } from "../api/trpc";

export default function SecurityAlertsScreen() {
  const [showResolved, setShowResolved] = useState(false);
  const utils = trpc.useUtils();

  const { data: alerts, isLoading } = trpc.siem.alerts.useQuery({
    limit: 50,
    resolved: showResolved,
  });

  const resolveMutation = trpc.siem.resolveAlert.useMutation({
    onSuccess: () => utils.siem.alerts.invalidate(),
    onError: (e) => Alert.alert("Error", e.message),
  });

  const SEVERITY_COLORS: Record<string, string> = {
    critical: "#dc2626", high: "#f97316", medium: "#f59e0b", low: "#22c55e", info: "#3b82f6",
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Security Alerts</Text>
        <TouchableOpacity
          style={[styles.toggle, showResolved && styles.toggleActive]}
          onPress={() => setShowResolved(v => !v)}
        >
          <Text style={[styles.toggleText, showResolved && styles.toggleTextActive]}>
            {showResolved ? "Showing Resolved" : "Show Resolved"}
          </Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#00d4ff" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={alerts ?? []}
          keyExtractor={(item: any) => String(item.id)}
          renderItem={({ item }: { item: any }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.badge, { backgroundColor: (SEVERITY_COLORS[item.severity] ?? "#64748b") + "25" }]}>
                  <Text style={[styles.badgeText, { color: SEVERITY_COLORS[item.severity] ?? "#64748b" }]}>
                    {item.severity?.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.source}>{item.source}</Text>
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
              <Text style={styles.cardDate}>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}</Text>
              {!item.resolved && (
                <TouchableOpacity
                  style={styles.resolveBtn}
                  onPress={() => resolveMutation.mutate({ id: item.id })}
                  disabled={resolveMutation.isPending}
                >
                  <Text style={styles.resolveBtnText}>Mark Resolved</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          contentContainerStyle={{ padding: 12 }}
          ListEmptyComponent={<Text style={styles.emptyText}>No alerts found.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0e1a" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16 },
  title: { color: "#f1f5f9", fontSize: 18, fontWeight: "800" },
  toggle: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: "#1e293b" },
  toggleActive: { borderColor: "#00d4ff", backgroundColor: "#00d4ff15" },
  toggleText: { color: "#64748b", fontSize: 11, fontWeight: "600" },
  toggleTextActive: { color: "#00d4ff" },
  card: { backgroundColor: "#0f172a", borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#1e293b" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  source: { color: "#64748b", fontSize: 11 },
  cardTitle: { color: "#f1f5f9", fontSize: 14, fontWeight: "700", marginBottom: 4 },
  cardDesc: { color: "#94a3b8", fontSize: 12, marginBottom: 4 },
  cardDate: { color: "#475569", fontSize: 11 },
  resolveBtn: { marginTop: 10, backgroundColor: "#22c55e20", borderWidth: 1, borderColor: "#22c55e50", borderRadius: 6, paddingVertical: 7, alignItems: "center" },
  resolveBtnText: { color: "#22c55e", fontSize: 12, fontWeight: "700" },
  emptyText: { color: "#475569", textAlign: "center", marginTop: 40, fontSize: 14 },
});
