import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, Modal, ScrollView, Alert } from "react-native";
import { trpc } from "../api/trpc";

const STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b",
  processing: "#3b82f6",
  completed: "#22c55e",
  failed: "#ef4444",
  overdue: "#dc2626",
  cancelled: "#6b7280",
};

export default function FinancialEnforcementScreen() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPenalty, setNewPenalty] = useState({
    organizationId: "",
    amount: "",
    currency: "NGN",
    reason: "",
    violationType: "data_breach",
  });

  const utils = trpc.useUtils();

  const { data: penalties = [], isLoading, refetch } = trpc.financial.penalties.useQuery({
    paymentStatus: statusFilter,
    limit: 100,
  });

  const createMutation = trpc.financial.issuePenalty.useMutation({
    onSuccess: () => {
      utils.financial.penalties.invalidate();
      setShowCreateModal(false);
      setNewPenalty({ organizationId: "", amount: "", currency: "NGN", reason: "", violationType: "data_breach" });
      Alert.alert("Success", "Penalty issued successfully");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const filtered = (penalties as any[]).filter((p: any) => {
    const matchSearch = !search || 
      String(p.id).includes(search) || 
      (p.reason ?? "").toLowerCase().includes(search.toLowerCase());
    return matchSearch;
  });

  const totalAmount = filtered.reduce((sum: number, p: any) => sum + Number(p.amount ?? 0), 0);
  const pendingCount = filtered.filter((p: any) => p.paymentStatus === "pending").length;
  const overdueCount = filtered.filter((p: any) => p.paymentStatus === "overdue").length;

  const renderPenalty = ({ item }: { item: any }) => (
    <View style={styles.penaltyCard}>
      <View style={styles.penaltyHeader}>
        <Text style={styles.penaltyId}>#{item.id}</Text>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.paymentStatus] ?? "#6b7280" }]}>
          <Text style={styles.statusText}>{item.paymentStatus ?? "pending"}</Text>
        </View>
      </View>
      <Text style={styles.penaltyAmount}>
        {item.currency ?? "NGN"} {Number(item.amount ?? 0).toLocaleString()}
      </Text>
      <Text style={styles.penaltyReason} numberOfLines={2}>{item.reason ?? "Compliance violation"}</Text>
      <Text style={styles.penaltyMeta}>
        Org #{item.organizationId} · Due: {item.dueDate ? new Date(item.dueDate).toLocaleDateString() : "N/A"}
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Financial Enforcement</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => setShowCreateModal(true)}>
          <Text style={styles.addButtonText}>+ Issue Penalty</Text>
        </TouchableOpacity>
      </View>

      {/* Summary Cards */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>₦{(totalAmount / 1000000).toFixed(1)}M</Text>
          <Text style={styles.summaryLabel}>Total Value</Text>
        </View>
        <View style={[styles.summaryCard, { borderColor: "#f59e0b" }]}>
          <Text style={[styles.summaryValue, { color: "#f59e0b" }]}>{pendingCount}</Text>
          <Text style={styles.summaryLabel}>Pending</Text>
        </View>
        <View style={[styles.summaryCard, { borderColor: "#ef4444" }]}>
          <Text style={[styles.summaryValue, { color: "#ef4444" }]}>{overdueCount}</Text>
          <Text style={styles.summaryLabel}>Overdue</Text>
        </View>
      </View>

      {/* Search */}
      <TextInput
        style={styles.searchInput}
        placeholder="Search penalties..."
        placeholderTextColor="#6b7280"
        value={search}
        onChangeText={setSearch}
      />

      {/* Status Filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        {[undefined, "pending", "processing", "completed", "overdue", "failed"].map(s => (
          <TouchableOpacity
            key={s ?? "all"}
            style={[styles.filterChip, statusFilter === s && styles.filterChipActive]}
            onPress={() => setStatusFilter(s)}
          >
            <Text style={[styles.filterChipText, statusFilter === s && styles.filterChipTextActive]}>
              {s ?? "All"}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* List */}
      {isLoading ? (
        <ActivityIndicator color="#3b82f6" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item: any) => String(item.id)}
          renderItem={renderPenalty}
          ListEmptyComponent={<Text style={styles.emptyText}>No penalties found</Text>}
          refreshing={isLoading}
          onRefresh={refetch}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}

      {/* Create Modal */}
      <Modal visible={showCreateModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Issue New Penalty</Text>
            <TextInput
              style={styles.input}
              placeholder="Organization ID"
              placeholderTextColor="#6b7280"
              keyboardType="numeric"
              value={newPenalty.organizationId}
              onChangeText={v => setNewPenalty(p => ({ ...p, organizationId: v }))}
            />
            <TextInput
              style={styles.input}
              placeholder="Amount (NGN)"
              placeholderTextColor="#6b7280"
              keyboardType="numeric"
              value={newPenalty.amount}
              onChangeText={v => setNewPenalty(p => ({ ...p, amount: v }))}
            />
            <TextInput
              style={[styles.input, { height: 80 }]}
              placeholder="Reason for penalty..."
              placeholderTextColor="#6b7280"
              multiline
              value={newPenalty.reason}
              onChangeText={v => setNewPenalty(p => ({ ...p, reason: v }))}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setShowCreateModal(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitButton, createMutation.isPending && { opacity: 0.6 }]}
                onPress={() => {
                  if (!newPenalty.organizationId || !newPenalty.amount || !newPenalty.reason) {
                    Alert.alert("Validation", "All fields are required");
                    return;
                  }
                  createMutation.mutate({
                    organizationId: Number(newPenalty.organizationId),
                    amount: newPenalty.amount,
                    currency: newPenalty.currency,
                    reason: newPenalty.reason,
                    violationType: newPenalty.violationType,
                  });
                }}
                disabled={createMutation.isPending}
              >
                <Text style={styles.submitButtonText}>
                  {createMutation.isPending ? "Issuing..." : "Issue Penalty"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111827", padding: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 20, fontWeight: "bold", color: "#f9fafb" },
  addButton: { backgroundColor: "#3b82f6", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  addButtonText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  summaryRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  summaryCard: { flex: 1, backgroundColor: "#1f2937", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#374151", alignItems: "center" },
  summaryValue: { fontSize: 18, fontWeight: "bold", color: "#f9fafb" },
  summaryLabel: { fontSize: 11, color: "#9ca3af", marginTop: 2 },
  searchInput: { backgroundColor: "#1f2937", borderRadius: 8, padding: 10, color: "#f9fafb", fontSize: 14, marginBottom: 10, borderWidth: 1, borderColor: "#374151" },
  filterRow: { marginBottom: 12 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#1f2937", marginRight: 8, borderWidth: 1, borderColor: "#374151" },
  filterChipActive: { backgroundColor: "#3b82f6", borderColor: "#3b82f6" },
  filterChipText: { color: "#9ca3af", fontSize: 12 },
  filterChipTextActive: { color: "#fff" },
  penaltyCard: { backgroundColor: "#1f2937", borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#374151" },
  penaltyHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  penaltyId: { color: "#9ca3af", fontSize: 12, fontFamily: "monospace" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  statusText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  penaltyAmount: { fontSize: 18, fontWeight: "bold", color: "#f9fafb", marginBottom: 4 },
  penaltyReason: { color: "#d1d5db", fontSize: 13, marginBottom: 6 },
  penaltyMeta: { color: "#6b7280", fontSize: 11 },
  emptyText: { color: "#6b7280", textAlign: "center", marginTop: 40, fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: "#1f2937", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: "bold", color: "#f9fafb", marginBottom: 16 },
  input: { backgroundColor: "#111827", borderRadius: 8, padding: 12, color: "#f9fafb", fontSize: 14, marginBottom: 12, borderWidth: 1, borderColor: "#374151" },
  modalButtons: { flexDirection: "row", gap: 12, marginTop: 8 },
  cancelButton: { flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: "#374151", alignItems: "center" },
  cancelButtonText: { color: "#9ca3af", fontWeight: "600" },
  submitButton: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: "#3b82f6", alignItems: "center" },
  submitButtonText: { color: "#fff", fontWeight: "600" },
});
