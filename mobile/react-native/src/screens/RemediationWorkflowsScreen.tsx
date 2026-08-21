import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Modal, TextInput, Alert, ScrollView } from "react-native";
import { trpc } from "../api/trpc";

const PRIORITY_COLORS: Record<string, string> = {
  low: "#22c55e", medium: "#f59e0b", high: "#f97316", critical: "#ef4444",
};

const STATUS_COLORS: Record<string, string> = {
  open: "#6b7280", in_progress: "#3b82f6", pending_review: "#f59e0b", completed: "#22c55e", failed: "#ef4444",
};

export default function RemediationWorkflowsScreen() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [form, setForm] = useState({ organizationId: "", title: "", description: "", priority: "medium", dueDate: "" });

  const utils = trpc.useUtils();
  const { data: workflows = [], isLoading, refetch } = trpc.remediation.list.useQuery({ status: statusFilter, limit: 100 });

  const createMutation = trpc.remediation.create.useMutation({
    onSuccess: () => {
      utils.remediation.list.invalidate();
      setShowCreateModal(false);
      setForm({ organizationId: "", title: "", description: "", priority: "medium", dueDate: "" });
      Alert.alert("Success", "Remediation workflow created");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const completeMutation = trpc.remediation.complete.useMutation({
    onSuccess: () => { utils.remediation.list.invalidate(); Alert.alert("Completed", "Remediation marked as complete"); },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const renderItem = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[item.priority] ?? "#6b7280" }]} />
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] ?? "#6b7280" }]}>
          <Text style={styles.statusText}>{(item.status ?? "open").replace("_", " ")}</Text>
        </View>
      </View>
      <Text style={styles.description} numberOfLines={2}>{item.description ?? "No description"}</Text>
      <View style={styles.cardFooter}>
        <Text style={styles.meta}>Org #{item.organizationId} · {item.priority} priority</Text>
        {item.dueDate && <Text style={styles.dueDate}>Due: {new Date(item.dueDate).toLocaleDateString()}</Text>}
      </View>
      {item.status !== "completed" && (
        <TouchableOpacity
          style={styles.completeButton}
          onPress={() => completeMutation.mutate({ id: item.id })}
          disabled={completeMutation.isPending}
        >
          <Text style={styles.completeButtonText}>✓ Mark Complete</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Remediation</Text>
          <Text style={styles.subtitle}>{(workflows as any[]).length} workflows</Text>
        </View>
        <TouchableOpacity style={styles.addButton} onPress={() => setShowCreateModal(true)}>
          <Text style={styles.addButtonText}>+ Create</Text>
        </TouchableOpacity>
      </View>

      {/* Status Filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        {[undefined, "open", "in_progress", "pending_review", "completed", "failed"].map(s => (
          <TouchableOpacity
            key={s ?? "all"}
            style={[styles.filterChip, statusFilter === s && styles.filterChipActive]}
            onPress={() => setStatusFilter(s)}
          >
            <Text style={[styles.filterChipText, statusFilter === s && styles.filterChipTextActive]}>
              {s ? s.replace("_", " ") : "All"}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {isLoading ? (
        <ActivityIndicator color="#3b82f6" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={workflows as any[]}
          keyExtractor={(item: any) => String(item.id)}
          renderItem={renderItem}
          ListEmptyComponent={<Text style={styles.emptyText}>No remediation workflows found</Text>}
          refreshing={isLoading}
          onRefresh={refetch}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}

      <Modal visible={showCreateModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create Remediation Workflow</Text>
            <TextInput style={styles.input} placeholder="Organization ID" placeholderTextColor="#6b7280" keyboardType="numeric" value={form.organizationId} onChangeText={v => setForm(p => ({ ...p, organizationId: v }))} />
            <TextInput style={styles.input} placeholder="Title" placeholderTextColor="#6b7280" value={form.title} onChangeText={v => setForm(p => ({ ...p, title: v }))} />
            <TextInput style={[styles.input, { height: 80 }]} placeholder="Description" placeholderTextColor="#6b7280" multiline value={form.description} onChangeText={v => setForm(p => ({ ...p, description: v }))} />
            <TextInput style={styles.input} placeholder="Due Date (YYYY-MM-DD)" placeholderTextColor="#6b7280" value={form.dueDate} onChangeText={v => setForm(p => ({ ...p, dueDate: v }))} />
            <Text style={styles.inputLabel}>Priority</Text>
            <View style={styles.priorityRow}>
              {["low", "medium", "high", "critical"].map(p => (
                <TouchableOpacity key={p} style={[styles.priorityChip, form.priority === p && { backgroundColor: PRIORITY_COLORS[p] }]} onPress={() => setForm(prev => ({ ...prev, priority: p }))}>
                  <Text style={[styles.priorityChipText, form.priority === p && { color: "#fff" }]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setShowCreateModal(false)}><Text style={styles.cancelButtonText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.submitButton, createMutation.isPending && { opacity: 0.6 }]} onPress={() => {
                if (!form.organizationId || !form.title) { Alert.alert("Validation", "Organization ID and Title are required"); return; }
                createMutation.mutate({ organizationId: Number(form.organizationId), title: form.title, description: form.description, priority: form.priority as any, dueDate: form.dueDate || undefined });
              }} disabled={createMutation.isPending}>
                <Text style={styles.submitButtonText}>{createMutation.isPending ? "Creating..." : "Create Workflow"}</Text>
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
  addButton: { backgroundColor: "#3b82f6", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  addButtonText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  filterRow: { marginBottom: 12 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#1f2937", marginRight: 8, borderWidth: 1, borderColor: "#374151" },
  filterChipActive: { backgroundColor: "#3b82f6", borderColor: "#3b82f6" },
  filterChipText: { color: "#9ca3af", fontSize: 12 },
  filterChipTextActive: { color: "#fff" },
  card: { backgroundColor: "#1f2937", borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#374151" },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 8 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  cardTitle: { flex: 1, color: "#f9fafb", fontSize: 15, fontWeight: "600" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  statusText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  description: { color: "#9ca3af", fontSize: 13, marginBottom: 8 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  meta: { color: "#6b7280", fontSize: 11 },
  dueDate: { color: "#f59e0b", fontSize: 11 },
  completeButton: { backgroundColor: "#064e3b", borderRadius: 6, padding: 8, alignItems: "center" },
  completeButtonText: { color: "#34d399", fontSize: 13, fontWeight: "600" },
  emptyText: { color: "#6b7280", textAlign: "center", marginTop: 40, fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: "#1f2937", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, maxHeight: "85%" },
  modalTitle: { fontSize: 18, fontWeight: "bold", color: "#f9fafb", marginBottom: 16 },
  input: { backgroundColor: "#111827", borderRadius: 8, padding: 12, color: "#f9fafb", fontSize: 14, marginBottom: 12, borderWidth: 1, borderColor: "#374151" },
  inputLabel: { color: "#9ca3af", fontSize: 12, marginBottom: 8 },
  priorityRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  priorityChip: { flex: 1, padding: 8, borderRadius: 6, backgroundColor: "#111827", alignItems: "center", borderWidth: 1, borderColor: "#374151" },
  priorityChipText: { color: "#9ca3af", fontSize: 12 },
  modalButtons: { flexDirection: "row", gap: 12, marginTop: 8, marginBottom: 24 },
  cancelButton: { flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: "#374151", alignItems: "center" },
  cancelButtonText: { color: "#9ca3af", fontWeight: "600" },
  submitButton: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: "#3b82f6", alignItems: "center" },
  submitButtonText: { color: "#fff", fontWeight: "600" },
});
