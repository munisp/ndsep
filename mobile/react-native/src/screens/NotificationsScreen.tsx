/**
 * NDSEP Mobile — Notifications Screen
 */
import React from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { trpc } from "../api/trpc";

export default function NotificationsScreen() {
  const utils = trpc.useUtils();
  const { data: notifications, isLoading } = trpc.notifications.list.useQuery({ limit: 50 });
  const markReadMutation = trpc.notifications.markRead.useMutation({
    onSuccess: () => utils.notifications.list.invalidate(),
  });

  const TYPE_COLORS: Record<string, string> = {
    penalty: "#ef4444", alert: "#f97316", compliance: "#22c55e",
    certificate: "#00d4ff", appeal: "#a78bfa", info: "#3b82f6",
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Notifications</Text>
        {(notifications ?? []).some((n: any) => !n.readAt) && (
          <TouchableOpacity onPress={() => markReadMutation.mutate({ all: true })}>
            <Text style={styles.markAll}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>
      {isLoading ? (
        <ActivityIndicator color="#00d4ff" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={notifications ?? []}
          keyExtractor={(item: any) => String(item.id)}
          renderItem={({ item }: { item: any }) => (
            <TouchableOpacity
              style={[styles.card, !item.readAt && styles.cardUnread]}
              onPress={() => !item.readAt && markReadMutation.mutate({ id: item.id })}
            >
              <View style={styles.cardHeader}>
                <View style={[styles.dot, { backgroundColor: TYPE_COLORS[item.type] ?? "#64748b" }]} />
                <Text style={styles.cardType}>{item.type?.toUpperCase()}</Text>
                <Text style={styles.cardDate}>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}</Text>
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardBody} numberOfLines={2}>{item.body}</Text>
            </TouchableOpacity>
          )}
          contentContainerStyle={{ padding: 12 }}
          ListEmptyComponent={<Text style={styles.emptyText}>No notifications.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0e1a" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16 },
  title: { color: "#f1f5f9", fontSize: 18, fontWeight: "800" },
  markAll: { color: "#00d4ff", fontSize: 12 },
  card: { backgroundColor: "#0f172a", borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#1e293b" },
  cardUnread: { borderColor: "#00d4ff40", backgroundColor: "#00d4ff08" },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 6, gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cardType: { color: "#64748b", fontSize: 10, fontWeight: "700", flex: 1 },
  cardDate: { color: "#475569", fontSize: 10 },
  cardTitle: { color: "#f1f5f9", fontSize: 13, fontWeight: "700", marginBottom: 4 },
  cardBody: { color: "#94a3b8", fontSize: 12 },
  emptyText: { color: "#475569", textAlign: "center", marginTop: 40, fontSize: 14 },
});
