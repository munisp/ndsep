/**
 * NDSEP Mobile — Asset Registry Screen
 */
import React, { useState } from "react";
import { View, Text, FlatList, TextInput, StyleSheet, ActivityIndicator } from "react-native";
import { trpc } from "../api/trpc";

export default function AssetRegistryScreen() {
  const [search, setSearch] = useState("");
  const { data: assets, isLoading } = trpc.assets.list.useQuery({ limit: 100 });

  const filtered = (assets ?? []).filter((a: any) =>
    !search || a.name?.toLowerCase().includes(search.toLowerCase()) ||
    a.assetType?.toLowerCase().includes(search.toLowerCase()) ||
    a.ipAddress?.includes(search)
  );

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.searchInput}
        placeholder="Search assets by name, type, or IP…"
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
                <Text style={styles.assetName}>{item.name}</Text>
                <View style={[styles.badge, { backgroundColor: item.isOutsideBorders ? "#ef444420" : "#22c55e20" }]}>
                  <Text style={[styles.badgeText, { color: item.isOutsideBorders ? "#ef4444" : "#22c55e" }]}>
                    {item.isOutsideBorders ? "OUTSIDE" : "IN-COUNTRY"}
                  </Text>
                </View>
              </View>
              <Text style={styles.assetType}>{item.assetType} · {item.dataClassification}</Text>
              {item.ipAddress && <Text style={styles.ip}>{item.ipAddress}</Text>}
              <Text style={styles.org}>{item.organizationName}</Text>
            </View>
          )}
          contentContainerStyle={{ padding: 12 }}
          ListEmptyComponent={<Text style={styles.emptyText}>No assets found.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0e1a" },
  searchInput: { margin: 12, backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#1e293b", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: "#f1f5f9", fontSize: 14 },
  card: { backgroundColor: "#0f172a", borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#1e293b" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  assetName: { color: "#f1f5f9", fontSize: 14, fontWeight: "700", flex: 1, marginRight: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  assetType: { color: "#64748b", fontSize: 12, marginBottom: 4 },
  ip: { color: "#00d4ff", fontSize: 11, fontFamily: "monospace", marginBottom: 4 },
  org: { color: "#94a3b8", fontSize: 11 },
  emptyText: { color: "#475569", textAlign: "center", marginTop: 40, fontSize: 14 },
});
