import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import { trpc } from "../api/trpc";

const MEDAL = ["🥇", "🥈", "🥉"];

export default function ComplianceLeaderboardScreen() {
  const [sector, setSector] = useState<string | undefined>(undefined);
  const SECTORS = ["Fintech", "Telecom", "Healthcare", "E-Commerce", "Government", "Media", "Energy"];

  const { data: leaderboard = [], isLoading, refetch } = trpc.leaderboard.list.useQuery({
    sector,
    limit: 50,
  });

  const renderItem = ({ item, index }: { item: any; index: number }) => (
    <View style={[styles.card, index === 0 && styles.goldCard, index === 1 && styles.silverCard, index === 2 && styles.bronzeCard]}>
      <View style={styles.rankBadge}>
        <Text style={styles.rankText}>{index < 3 ? MEDAL[index] : `#${index + 1}`}</Text>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.orgName}>{item.organizationName ?? `Org #${item.organizationId}`}</Text>
        <Text style={styles.sector}>{item.sector ?? "General"}</Text>
        <View style={styles.scoreBar}>
          <View style={[styles.scoreBarFill, { width: `${item.score ?? 0}%`, backgroundColor: (item.score ?? 0) >= 80 ? "#22c55e" : (item.score ?? 0) >= 60 ? "#f59e0b" : "#ef4444" }]} />
        </View>
        <Text style={styles.scoreText}>{item.score ?? 0}% compliance</Text>
      </View>
      <View style={styles.cardRight}>
        <Text style={styles.violations}>{item.violations ?? 0}</Text>
        <Text style={styles.violationsLabel}>violations</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🏆 Compliance Leaderboard</Text>
      <Text style={styles.subtitle}>Organisation rankings by compliance score</Text>

      {/* Sector Filter */}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={[undefined, ...SECTORS]}
        keyExtractor={(item) => item ?? "all"}
        renderItem={({ item: s }) => (
          <TouchableOpacity
            style={[styles.filterChip, sector === s && styles.filterChipActive]}
            onPress={() => setSector(s)}
          >
            <Text style={[styles.filterChipText, sector === s && styles.filterChipTextActive]}>
              {s ?? "All Sectors"}
            </Text>
          </TouchableOpacity>
        )}
        style={styles.filterRow}
      />

      {isLoading ? (
        <ActivityIndicator color="#f59e0b" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={leaderboard as any[]}
          keyExtractor={(item: any) => String(item.organizationId)}
          renderItem={renderItem}
          ListEmptyComponent={<Text style={styles.emptyText}>No leaderboard data available</Text>}
          refreshing={isLoading}
          onRefresh={refetch}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111827", padding: 16 },
  title: { fontSize: 20, fontWeight: "bold", color: "#f9fafb", marginBottom: 4 },
  subtitle: { color: "#6b7280", fontSize: 13, marginBottom: 16 },
  filterRow: { marginBottom: 16 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#1f2937", marginRight: 8, borderWidth: 1, borderColor: "#374151" },
  filterChipActive: { backgroundColor: "#d97706", borderColor: "#f59e0b" },
  filterChipText: { color: "#9ca3af", fontSize: 12 },
  filterChipTextActive: { color: "#fff" },
  card: { backgroundColor: "#1f2937", borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#374151" },
  goldCard: { borderColor: "#f59e0b", backgroundColor: "#1c1a0f" },
  silverCard: { borderColor: "#9ca3af", backgroundColor: "#1a1c1e" },
  bronzeCard: { borderColor: "#b45309", backgroundColor: "#1c1510" },
  rankBadge: { width: 40, alignItems: "center" },
  rankText: { fontSize: 22 },
  cardBody: { flex: 1, marginHorizontal: 12 },
  orgName: { color: "#f9fafb", fontSize: 15, fontWeight: "600", marginBottom: 2 },
  sector: { color: "#6b7280", fontSize: 11, marginBottom: 6 },
  scoreBar: { height: 4, backgroundColor: "#374151", borderRadius: 2, marginBottom: 4 },
  scoreBarFill: { height: 4, borderRadius: 2 },
  scoreText: { color: "#9ca3af", fontSize: 12 },
  cardRight: { alignItems: "center" },
  violations: { color: "#ef4444", fontSize: 18, fontWeight: "bold" },
  violationsLabel: { color: "#6b7280", fontSize: 10 },
  emptyText: { color: "#6b7280", textAlign: "center", marginTop: 40, fontSize: 14 },
});
