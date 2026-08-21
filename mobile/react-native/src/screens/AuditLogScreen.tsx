/**
 * NDSEP Mobile — Audit Log Screen
 */
import React, { useState } from "react";
import { View, Text, FlatList, TextInput, StyleSheet, ActivityIndicator } from "react-native";
import { trpc } from "../api/trpc";

export default function AuditLogScreen() {
  const [search, setSearch] = useState("");
  const { data: logs, isLoading } = trpc.auditLogs.list.useQuery({ limit: 100 });

  const filtered = (logs ?? []).filter((l: any) =>
    !search || l.action?.toLowerCase().includes(search.toLowerCase()) ||
    l.actorEmail?.toLowerCase().includes(search.toLowerCase()) ||
    l.resourceType?.toLowerCase().includes(search.toLowerCase())
  );

  const ACTION_COLORS: Record<string, string> = {
    create: "#22c55e", update: "#3b82f6", delete: "#ef4444",
    login: "#a78bfa", export: "#f59e0b", approve: "#00d4ff",
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.searchInput}
        placeholder="Search audit logs…"
        placeholderTextColor="#475569"
        value={search}
        onChangeText={setSearch}
      />
      {isLoading ? (
        <ActivityIndicator color="#00d4ff" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item: any) => String(item.id)}
          renderItem={({ item }: { item: any }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.badge, { backgroundColor: (ACTION_COLORS[item.action] ?? "#64748b") + "25" }]}>
                  <Text style={[styles.badgeText, { color: ACTION_COLORS[item.action] ?? "#64748b" }]}>
                    {item.action?.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.date}>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}</Text>
              </View>
              <Text style={styles.resource}>{item.resourceType} #{item.resourceId}</Text>
              <Text style={styles.actor}>{item.actorEmail}</Text>
              {item.details && <Text style={styles.details} numberOfLines={2}>{JSON.stringify(item.details)}</Text>}
            </View>
          )}
          contentContainerStyle={{ padding: 12 }}
          ListEmptyComponent={<Text style={styles.emptyText}>No audit logs found.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0e1a" },
  searchInput: { margin: 12, backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#1e293b", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: "#f1f5f9", fontSize: 14 },
  card: { backgroundColor: "#0f172a", borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#1e293b" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  date: { color: "#475569", fontSize: 10 },
  resource: { color: "#f1f5f9", fontSize: 13, fontWeight: "600", marginBottom: 2 },
  actor: { color: "#64748b", fontSize: 12, marginBottom: 4 },
  details: { color: "#475569", fontSize: 10, fontFamily: "monospace" },
  emptyText: { color: "#475569", textAlign: "center", marginTop: 40, fontSize: 14 },
});
