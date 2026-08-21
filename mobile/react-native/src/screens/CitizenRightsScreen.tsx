/**
 * NDSEP Mobile — Citizen Rights Screen
 * Lists data rights requests with status tracking and submit capability.
 */
import React, { useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, TextInput,
} from "react-native";
import { trpc } from "../api/trpc";

const REQUEST_TYPES = ["access", "deletion", "portability", "rectification", "objection"] as const;

export default function CitizenRightsScreen() {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ type: "access" as string, description: "", citizenName: "", citizenEmail: "" });
  const utils = trpc.useUtils();

  const { data: requests, isLoading } = trpc.citizenRights.list.useQuery({ limit: 50 });

  const createMutation = trpc.citizenRights.create.useMutation({
    onSuccess: () => {
      setShowModal(false);
      setForm({ type: "access", description: "", citizenName: "", citizenEmail: "" });
      utils.citizenRights.list.invalidate();
    },
    onError: (e) => Alert.alert("Error", e.message),
  });

  const STATUS_COLORS: Record<string, string> = {
    pending: "#f59e0b", in_review: "#3b82f6", completed: "#22c55e",
    rejected: "#ef4444", overdue: "#dc2626",
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Citizen Rights Requests</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowModal(true)}>
          <Text style={styles.addBtnText}>+ New Request</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#00d4ff" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={requests ?? []}
          keyExtractor={(item: any) => String(item.id)}
          renderItem={({ item }: { item: any }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.badge, { backgroundColor: (STATUS_COLORS[item.status] ?? "#64748b") + "25" }]}>
                  <Text style={[styles.badgeText, { color: STATUS_COLORS[item.status] ?? "#64748b" }]}>
                    {item.status?.replace("_", " ").toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.reqType}>{item.requestType?.toUpperCase()}</Text>
              </View>
              <Text style={styles.citizenName}>{item.citizenName}</Text>
              <Text style={styles.citizenEmail}>{item.citizenEmail}</Text>
              <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
              <Text style={styles.date}>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ""}</Text>
            </View>
          )}
          contentContainerStyle={{ padding: 12 }}
          ListEmptyComponent={<Text style={styles.emptyText}>No rights requests found.</Text>}
        />
      )}

      {/* New Request Modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Rights Request</Text>
            <Text style={styles.label}>Request Type</Text>
            <View style={styles.typeRow}>
              {REQUEST_TYPES.map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeChip, form.type === t && styles.typeChipActive]}
                  onPress={() => setForm(f => ({ ...f, type: t }))}
                >
                  <Text style={[styles.typeChipText, form.type === t && styles.typeChipTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={styles.input} placeholder="Citizen Name" placeholderTextColor="#475569" value={form.citizenName} onChangeText={v => setForm(f => ({ ...f, citizenName: v }))} />
            <TextInput style={styles.input} placeholder="Citizen Email" placeholderTextColor="#475569" value={form.citizenEmail} onChangeText={v => setForm(f => ({ ...f, citizenEmail: v }))} keyboardType="email-address" />
            <TextInput style={[styles.input, { height: 80 }]} placeholder="Description" placeholderTextColor="#475569" value={form.description} onChangeText={v => setForm(f => ({ ...f, description: v }))} multiline />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.submitBtn}
                onPress={() => createMutation.mutate({ requestType: form.type as any, description: form.description, citizenName: form.citizenName, citizenEmail: form.citizenEmail })}
                disabled={createMutation.isPending}
              >
                <Text style={styles.submitBtnText}>{createMutation.isPending ? "Submitting…" : "Submit"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0e1a" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16 },
  title: { color: "#f1f5f9", fontSize: 17, fontWeight: "800" },
  addBtn: { backgroundColor: "#00d4ff20", borderWidth: 1, borderColor: "#00d4ff50", borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  addBtnText: { color: "#00d4ff", fontSize: 12, fontWeight: "700" },
  card: { backgroundColor: "#0f172a", borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#1e293b" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  reqType: { color: "#a78bfa", fontSize: 11, fontWeight: "700" },
  citizenName: { color: "#f1f5f9", fontSize: 14, fontWeight: "700" },
  citizenEmail: { color: "#64748b", fontSize: 12, marginBottom: 4 },
  desc: { color: "#94a3b8", fontSize: 12, marginBottom: 4 },
  date: { color: "#475569", fontSize: 11 },
  emptyText: { color: "#475569", textAlign: "center", marginTop: 40, fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: "#00000080", justifyContent: "flex-end" },
  modalCard: { backgroundColor: "#0f172a", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, borderTopWidth: 1, borderTopColor: "#1e293b" },
  modalTitle: { color: "#f1f5f9", fontSize: 18, fontWeight: "800", marginBottom: 16 },
  label: { color: "#94a3b8", fontSize: 12, marginBottom: 8 },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 14 },
  typeChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: "#1e293b", backgroundColor: "#0a0e1a" },
  typeChipActive: { borderColor: "#a78bfa", backgroundColor: "#a78bfa20" },
  typeChipText: { color: "#64748b", fontSize: 11, fontWeight: "600" },
  typeChipTextActive: { color: "#a78bfa" },
  input: { backgroundColor: "#0a0e1a", borderWidth: 1, borderColor: "#1e293b", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: "#f1f5f9", fontSize: 14, marginBottom: 12 },
  modalActions: { flexDirection: "row", gap: 12 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: "#1e293b", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  cancelBtnText: { color: "#94a3b8", fontSize: 13, fontWeight: "600" },
  submitBtn: { flex: 1, backgroundColor: "#a78bfa", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  submitBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});
