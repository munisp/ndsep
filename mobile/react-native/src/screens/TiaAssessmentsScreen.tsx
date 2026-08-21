import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Modal, TextInput, Alert, ScrollView } from "react-native";
import { trpc } from "../api/trpc";

const RISK_COLORS: Record<string, string> = {
  low: "#22c55e", medium: "#f59e0b", high: "#f97316", critical: "#ef4444",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#6b7280", in_progress: "#3b82f6", completed: "#22c55e", approved: "#10b981", rejected: "#ef4444",
};

export default function TiaAssessmentsScreen() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState({ organizationId: "", transferDestination: "", dataCategories: "", legalBasis: "", riskLevel: "medium" });

  const utils = trpc.useUtils();
  const { data: assessments = [], isLoading, refetch } = trpc.tia.list.useQuery({ limit: 50 });

  const createMutation = trpc.tia.create.useMutation({
    onSuccess: () => {
      utils.tia.list.invalidate();
      setShowCreateModal(false);
      setForm({ organizationId: "", transferDestination: "", dataCategories: "", legalBasis: "", riskLevel: "medium" });
      Alert.alert("Success", "TIA assessment created");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const renderItem = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardId}>TIA-{item.id}</Text>
        <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.status] ?? "#6b7280" }]}>
          <Text style={styles.badgeText}>{item.status ?? "pending"}</Text>
        </View>
      </View>
      <Text style={styles.destination}>→ {item.transferDestination ?? "Unknown"}</Text>
      <Text style={styles.categories}>{item.dataCategories ?? "N/A"}</Text>
      <View style={styles.cardFooter}>
        <View style={[styles.riskBadge, { backgroundColor: `${RISK_COLORS[item.riskLevel] ?? "#6b7280"}22` }]}>
          <Text style={[styles.riskText, { color: RISK_COLORS[item.riskLevel] ?? "#6b7280" }]}>
            {item.riskLevel ?? "medium"} risk
          </Text>
        </View>
        <Text style={styles.meta}>Org #{item.organizationId}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>TIA Assessments</Text>
          <Text style={styles.subtitle}>Transfer Impact Assessments</Text>
        </View>
        <TouchableOpacity style={styles.addButton} onPress={() => setShowCreateModal(true)}>
          <Text style={styles.addButtonText}>+ New TIA</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#3b82f6" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={assessments as any[]}
          keyExtractor={(item: any) => String(item.id)}
          renderItem={renderItem}
          ListEmptyComponent={<Text style={styles.emptyText}>No TIA assessments found</Text>}
          refreshing={isLoading}
          onRefresh={refetch}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}

      <Modal visible={showCreateModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalTitle}>New TIA Assessment</Text>
            <TextInput style={styles.input} placeholder="Organization ID" placeholderTextColor="#6b7280" keyboardType="numeric" value={form.organizationId} onChangeText={v => setForm(p => ({ ...p, organizationId: v }))} />
            <TextInput style={styles.input} placeholder="Transfer Destination (e.g. US, EU)" placeholderTextColor="#6b7280" value={form.transferDestination} onChangeText={v => setForm(p => ({ ...p, transferDestination: v }))} />
            <TextInput style={[styles.input, { height: 70 }]} placeholder="Data Categories (comma-separated)" placeholderTextColor="#6b7280" multiline value={form.dataCategories} onChangeText={v => setForm(p => ({ ...p, dataCategories: v }))} />
            <TextInput style={styles.input} placeholder="Legal Basis (e.g. SCCs, adequacy decision)" placeholderTextColor="#6b7280" value={form.legalBasis} onChangeText={v => setForm(p => ({ ...p, legalBasis: v }))} />
            <Text style={styles.inputLabel}>Risk Level</Text>
            <View style={styles.riskRow}>
              {["low", "medium", "high", "critical"].map(r => (
                <TouchableOpacity key={r} style={[styles.riskChip, form.riskLevel === r && { backgroundColor: RISK_COLORS[r] }]} onPress={() => setForm(p => ({ ...p, riskLevel: r }))}>
                  <Text style={[styles.riskChipText, form.riskLevel === r && { color: "#fff" }]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setShowCreateModal(false)}><Text style={styles.cancelButtonText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.submitButton, createMutation.isPending && { opacity: 0.6 }]} onPress={() => {
                if (!form.organizationId || !form.transferDestination) { Alert.alert("Validation", "Organization ID and Transfer Destination are required"); return; }
                createMutation.mutate({ organizationId: Number(form.organizationId), transferDestination: form.transferDestination, dataCategories: form.dataCategories, legalBasis: form.legalBasis, riskLevel: form.riskLevel as any });
              }} disabled={createMutation.isPending}>
                <Text style={styles.submitButtonText}>{createMutation.isPending ? "Creating..." : "Create TIA"}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111827", padding: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  title: { fontSize: 20, fontWeight: "bold", color: "#f9fafb" },
  subtitle: { color: "#6b7280", fontSize: 12, marginTop: 2 },
  addButton: { backgroundColor: "#7c3aed", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  addButtonText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  card: { backgroundColor: "#1f2937", borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#374151" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  cardId: { color: "#9ca3af", fontSize: 12, fontFamily: "monospace" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  destination: { color: "#f9fafb", fontSize: 15, fontWeight: "600", marginBottom: 4 },
  categories: { color: "#9ca3af", fontSize: 12, marginBottom: 8 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  riskBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  riskText: { fontSize: 12, fontWeight: "600" },
  meta: { color: "#6b7280", fontSize: 11 },
  emptyText: { color: "#6b7280", textAlign: "center", marginTop: 40, fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: "#1f2937", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, maxHeight: "85%" },
  modalTitle: { fontSize: 18, fontWeight: "bold", color: "#f9fafb", marginBottom: 16 },
  input: { backgroundColor: "#111827", borderRadius: 8, padding: 12, color: "#f9fafb", fontSize: 14, marginBottom: 12, borderWidth: 1, borderColor: "#374151" },
  inputLabel: { color: "#9ca3af", fontSize: 12, marginBottom: 8 },
  riskRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  riskChip: { flex: 1, padding: 8, borderRadius: 6, backgroundColor: "#111827", alignItems: "center", borderWidth: 1, borderColor: "#374151" },
  riskChipText: { color: "#9ca3af", fontSize: 12 },
  modalButtons: { flexDirection: "row", gap: 12, marginTop: 8, marginBottom: 24 },
  cancelButton: { flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: "#374151", alignItems: "center" },
  cancelButtonText: { color: "#9ca3af", fontWeight: "600" },
  submitButton: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: "#7c3aed", alignItems: "center" },
  submitButtonText: { color: "#fff", fontWeight: "600" },
});
