/**
 * NDSEP Mobile — Organizations Screen
 */
import React, { useState } from "react";
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useLocation } from "wouter";
import { trpc } from "../api/trpc";

export default function OrganizationsScreen({ navigation }: any) {
  const [search, setSearch] = useState("");
  const { data: orgs, isLoading } = trpc.organizations.list.useQuery({ limit: 100 });

  const filtered = (orgs ?? []).filter((o: any) =>
    !search || o.name?.toLowerCase().includes(search.toLowerCase()) ||
    o.sector?.toLowerCase().includes(search.toLowerCase())
  );

  const COMPLIANCE_COLOR = (score: number) =>
    score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.searchInput}
        placeholder="Search organizations…"
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
            <TouchableOpacity
              style={styles.card}
              onPress={() => navigation.navigate("OrganizationDetail", { orgId: item.id })}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.orgName}>{item.name}</Text>
                <Text style={[styles.score, { color: COMPLIANCE_COLOR(Number(item.complianceScore ?? 0)) }]}>
                  {Number(item.complianceScore ?? 0).toFixed(0)}%
                </Text>
              </View>
              <Text style={styles.sector}>{item.sector} · {item.country}</Text>
              <View style={styles.statusRow}>
                <View style={[styles.badge, {
                  backgroundColor: item.complianceStatus === "compliant" ? "#22c55e20" : "#ef444420",
                }]}>
                  <Text style={[styles.badgeText, {
                    color: item.complianceStatus === "compliant" ? "#22c55e" : "#ef4444",
                  }]}>
                    {item.complianceStatus?.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.riskScore}>Risk: {Number(item.riskScore ?? 0).toFixed(1)}</Text>
              </View>
            </TouchableOpacity>
          )}
          contentContainerStyle={{ padding: 12 }}
          ListEmptyComponent={<Text style={styles.emptyText}>No organizations found.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0e1a" },
  searchInput: { margin: 12, backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#1e293b", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: "#f1f5f9", fontSize: 14 },
  card: { backgroundColor: "#0f172a", borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#1e293b" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  orgName: { color: "#f1f5f9", fontSize: 14, fontWeight: "700", flex: 1, marginRight: 8 },
  score: { fontSize: 18, fontWeight: "900" },
  sector: { color: "#64748b", fontSize: 12, marginBottom: 8 },
  statusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  riskScore: { color: "#94a3b8", fontSize: 11 },
  emptyText: { color: "#475569", textAlign: "center", marginTop: 40, fontSize: 14 },
});
