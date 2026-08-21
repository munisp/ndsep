/**
 * NDSEP Mobile — Penalty Detail Screen
 */
import React from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { trpc } from "../api/trpc";

export default function PenaltyDetailScreen({ route, navigation }: any) {
  const { penaltyId } = route.params;
  const utils = trpc.useUtils();
  const { data: receipt, isLoading } = trpc.financial.receipt.useQuery({ penaltyId });

  const disputeMutation = trpc.financial.disputePenalty.useMutation({
    onSuccess: () => {
      Alert.alert("Dispute Filed", "Your dispute has been submitted for review.");
      utils.financial.receipt.invalidate({ penaltyId });
    },
    onError: (e) => Alert.alert("Error", e.message),
  });

  if (isLoading) return <ActivityIndicator color="#00d4ff" style={{ marginTop: 80 }} />;
  if (!receipt) return <View style={styles.center}><Text style={styles.notFound}>Penalty not found.</Text></View>;

  const STATUS_COLORS: Record<string, string> = {
    paid: "#22c55e", unpaid: "#ef4444", disputed: "#a78bfa", waived: "#64748b",
  };

  return (
    <ScrollView style={styles.container}>
      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.penaltyId}>Penalty #{receipt.id}</Text>
          <View style={[styles.badge, { backgroundColor: (STATUS_COLORS[receipt.status] ?? "#64748b") + "25" }]}>
            <Text style={[styles.badgeText, { color: STATUS_COLORS[receipt.status] ?? "#64748b" }]}>
              {receipt.status?.toUpperCase()}
            </Text>
          </View>
        </View>
        <Text style={styles.amount}>${Number(receipt.amountUsd ?? 0).toLocaleString()}</Text>
        <Text style={styles.currency}>{receipt.currency}</Text>
        <Text style={styles.org}>{receipt.organizationName}</Text>
        <Text style={styles.reason}>{receipt.reason}</Text>
        <View style={styles.divider} />
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Issued</Text>
          <Text style={styles.metaValue}>{receipt.issuedAt ? new Date(receipt.issuedAt).toLocaleDateString() : "—"}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Due Date</Text>
          <Text style={styles.metaValue}>{receipt.dueDate ? new Date(receipt.dueDate).toLocaleDateString() : "—"}</Text>
        </View>
        {receipt.paidAt && (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Paid On</Text>
            <Text style={[styles.metaValue, { color: "#22c55e" }]}>{new Date(receipt.paidAt).toLocaleDateString()}</Text>
          </View>
        )}
        {receipt.status === "unpaid" && (
          <TouchableOpacity
            style={styles.disputeBtn}
            onPress={() => Alert.alert(
              "File Dispute",
              "Are you sure you want to dispute this penalty?",
              [
                { text: "Cancel", style: "cancel" },
                { text: "File Dispute", onPress: () => disputeMutation.mutate({ id: penaltyId, reason: "Disputed via mobile app" }) },
              ]
            )}
          >
            <Text style={styles.disputeBtnText}>File Dispute</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0e1a" },
  center: { flex: 1, backgroundColor: "#0a0e1a", alignItems: "center", justifyContent: "center" },
  notFound: { color: "#475569", fontSize: 14 },
  backBtn: { padding: 16, paddingBottom: 0 },
  backText: { color: "#00d4ff", fontSize: 14 },
  card: { margin: 16, backgroundColor: "#0f172a", borderRadius: 12, padding: 20, borderWidth: 1, borderColor: "#1e293b" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  penaltyId: { color: "#64748b", fontSize: 13 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  amount: { color: "#fbbf24", fontSize: 48, fontWeight: "900" },
  currency: { color: "#64748b", fontSize: 13, marginBottom: 12 },
  org: { color: "#00d4ff", fontSize: 15, fontWeight: "700", marginBottom: 6 },
  reason: { color: "#94a3b8", fontSize: 14, lineHeight: 22, marginBottom: 16 },
  divider: { height: 1, backgroundColor: "#1e293b", marginBottom: 16 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  metaLabel: { color: "#64748b", fontSize: 13 },
  metaValue: { color: "#f1f5f9", fontSize: 13, fontWeight: "600" },
  disputeBtn: { marginTop: 16, backgroundColor: "#a78bfa20", borderWidth: 1, borderColor: "#a78bfa50", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  disputeBtnText: { color: "#a78bfa", fontSize: 13, fontWeight: "700" },
});
