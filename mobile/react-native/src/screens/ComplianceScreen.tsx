/**
 * NDSEP Mobile — Compliance Engine Screen
 * Lists violations with filter, search, and resolve action.
 */
import React, { useState } from "react";
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
} from "react-native";
import { trpc } from "../api/trpc";

const SEVERITIES = ["all", "critical", "high", "medium", "low"] as const;

export default function ComplianceScreen() {
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<string>("all");

  const { data: violations, isLoading, refetch } = trpc.compliance.violations.useQuery({
    limit: 50,
    severity: severity === "all" ? undefined : severity,
  });

  const resolveMutation = trpc.compliance.resolveViolation.useMutation({
    onSuccess: () => refetch(),
    onError: (e) => Alert.alert("Error", e.message),
  });

  const filtered = (violations ?? []).filter((v: any) =>
    !search || v.title?.toLowerCase().includes(search.toLowerCase()) ||
    v.description?.toLowerCase().includes(search.toLowerCase())
  );

  const SEVERITY_COLORS: Record<string, string> = {
    critical: "#dc2626", high: "#f97316", medium: "#f59e0b", low: "#22c55e",
  };

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search violations…"
          placeholderTextColor="#475569"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Severity Filter */}
      <View style={styles.filterRow}>
        {SEVERITIES.map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.filterChip, severity === s && styles.filterChipActive]}
            onPress={() => setSeverity(s)}
          >
            <Text style={[styles.filterChipText, severity === s && styles.filterChipTextActive]}>
              {s.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator color="#00d4ff" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item: any) => String(item.id)}
          renderItem={({ item }: { item: any }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.severityBadge, { backgroundColor: (SEVERITY_COLORS[item.severity] ?? "#64748b") + "30" }]}>
                  <Text style={[styles.severityText, { color: SEVERITY_COLORS[item.severity] ?? "#64748b" }]}>
                    {item.severity?.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.cardStatus}>{item.status}</Text>
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
              <Text style={styles.cardOrg}>{item.organizationName}</Text>
              {item.status === "open" && (
                <TouchableOpacity
                  style={styles.resolveBtn}
                  onPress={() => Alert.alert(
                    "Resolve Violation",
                    `Mark "${item.title}" as resolved?`,
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Resolve", style: "destructive", onPress: () => resolveMutation.mutate({ id: item.id }) },
                    ]
                  )}
                >
                  <Text style={styles.resolveBtnText}>Resolve</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          contentContainerStyle={{ padding: 12 }}
          ListEmptyComponent={<Text style={styles.emptyText}>No violations found.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0e1a" },
  searchRow: { padding: 12 },
  searchInput: {
    backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#1e293b",
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    color: "#f1f5f9", fontSize: 14,
  },
  filterRow: { flexDirection: "row", paddingHorizontal: 12, gap: 6, marginBottom: 4 },
  filterChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
    backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#1e293b",
  },
  filterChipActive: { backgroundColor: "#00d4ff20", borderColor: "#00d4ff" },
  filterChipText: { color: "#64748b", fontSize: 10, fontWeight: "600" },
  filterChipTextActive: { color: "#00d4ff" },
  card: {
    backgroundColor: "#0f172a", borderRadius: 10, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: "#1e293b",
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  severityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  severityText: { fontSize: 10, fontWeight: "700" },
  cardStatus: { color: "#64748b", fontSize: 11 },
  cardTitle: { color: "#f1f5f9", fontSize: 14, fontWeight: "700", marginBottom: 4 },
  cardDesc: { color: "#94a3b8", fontSize: 12, marginBottom: 6 },
  cardOrg: { color: "#00d4ff", fontSize: 11, fontWeight: "600" },
  resolveBtn: {
    marginTop: 10, backgroundColor: "#22c55e20", borderWidth: 1, borderColor: "#22c55e50",
    borderRadius: 6, paddingVertical: 7, alignItems: "center",
  },
  resolveBtnText: { color: "#22c55e", fontSize: 12, fontWeight: "700" },
  emptyText: { color: "#475569", textAlign: "center", marginTop: 40, fontSize: 14 },
});
