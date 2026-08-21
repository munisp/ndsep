/**
 * NDSEP Mobile — Enforcement & Penalties Screen
 * Lists enforcement cases and penalties with issue/dispute actions.
 */
import React, { useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, TextInput, ScrollView,
} from "react-native";
import { trpc } from "../api/trpc";

export default function EnforcementScreen() {
  const [tab, setTab] = useState<"cases" | "penalties">("cases");
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issueForm, setIssueForm] = useState({ orgId: "", amount: "", reason: "" });

  const utils = trpc.useUtils();

  const { data: cases, isLoading: casesLoading } = trpc.enforcementCases.list.useQuery({ limit: 50 });
  const { data: penalties, isLoading: penaltiesLoading } = trpc.financial.penalties.useQuery({ limit: 50 });

  const issuePenaltyMutation = trpc.financial.issuePenalty.useMutation({
    onSuccess: () => {
      setShowIssueModal(false);
      setIssueForm({ orgId: "", amount: "", reason: "" });
      utils.financial.penalties.invalidate();
    },
    onError: (e) => Alert.alert("Error", e.message),
  });

  const STATUS_COLORS: Record<string, string> = {
    open: "#f59e0b", closed: "#22c55e", pending: "#3b82f6",
    paid: "#22c55e", unpaid: "#ef4444", disputed: "#a78bfa",
  };

  return (
    <View style={styles.container}>
      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {(["cases", "penalties"] as const).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === "cases" ? "Enforcement Cases" : "Penalties"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === "cases" ? (
        casesLoading ? <ActivityIndicator color="#00d4ff" style={{ marginTop: 40 }} /> : (
          <FlatList
            data={cases ?? []}
            keyExtractor={(item: any) => String(item.id)}
            renderItem={({ item }: { item: any }) => (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={[styles.badge, { backgroundColor: (STATUS_COLORS[item.status] ?? "#64748b") + "25" }]}>
                    <Text style={[styles.badgeText, { color: STATUS_COLORS[item.status] ?? "#64748b" }]}>
                      {item.status?.toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.caseId}>#{item.id}</Text>
                </View>
                <Text style={styles.cardTitle}>{item.title ?? item.caseNumber}</Text>
                <Text style={styles.cardOrg}>{item.organizationName}</Text>
                <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
              </View>
            )}
            contentContainerStyle={{ padding: 12 }}
            ListEmptyComponent={<Text style={styles.emptyText}>No enforcement cases.</Text>}
          />
        )
      ) : (
        <>
          <TouchableOpacity style={styles.issueBtn} onPress={() => setShowIssueModal(true)}>
            <Text style={styles.issueBtnText}>+ Issue Penalty</Text>
          </TouchableOpacity>
          {penaltiesLoading ? <ActivityIndicator color="#00d4ff" style={{ marginTop: 40 }} /> : (
            <FlatList
              data={penalties ?? []}
              keyExtractor={(item: any) => String(item.id)}
              renderItem={({ item }: { item: any }) => (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.badge, { backgroundColor: (STATUS_COLORS[item.status] ?? "#64748b") + "25" }]}>
                      <Text style={[styles.badgeText, { color: STATUS_COLORS[item.status] ?? "#64748b" }]}>
                        {item.status?.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.penaltyAmount}>${Number(item.amountUsd ?? 0).toLocaleString()}</Text>
                  </View>
                  <Text style={styles.cardTitle}>{item.organizationName}</Text>
                  <Text style={styles.cardDesc} numberOfLines={2}>{item.reason}</Text>
                  <Text style={styles.cardDate}>{item.issuedAt ? new Date(item.issuedAt).toLocaleDateString() : ""}</Text>
                </View>
              )}
              contentContainerStyle={{ padding: 12 }}
              ListEmptyComponent={<Text style={styles.emptyText}>No penalties issued.</Text>}
            />
          )}
        </>
      )}

      {/* Issue Penalty Modal */}
      <Modal visible={showIssueModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Issue Penalty</Text>
            <TextInput
              style={styles.input}
              placeholder="Organization ID"
              placeholderTextColor="#475569"
              value={issueForm.orgId}
              onChangeText={v => setIssueForm(f => ({ ...f, orgId: v }))}
              keyboardType="numeric"
            />
            <TextInput
              style={styles.input}
              placeholder="Amount (USD)"
              placeholderTextColor="#475569"
              value={issueForm.amount}
              onChangeText={v => setIssueForm(f => ({ ...f, amount: v }))}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={[styles.input, { height: 80 }]}
              placeholder="Reason"
              placeholderTextColor="#475569"
              value={issueForm.reason}
              onChangeText={v => setIssueForm(f => ({ ...f, reason: v }))}
              multiline
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowIssueModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.submitBtn}
                onPress={() => issuePenaltyMutation.mutate({
                  organizationId: parseInt(issueForm.orgId),
                  amountUsd: parseFloat(issueForm.amount),
                  reason: issueForm.reason,
                  currency: "USD",
                })}
                disabled={issuePenaltyMutation.isPending}
              >
                <Text style={styles.submitBtnText}>
                  {issuePenaltyMutation.isPending ? "Issuing…" : "Issue Penalty"}
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
  container: { flex: 1, backgroundColor: "#0a0e1a" },
  tabBar: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  tab: { flex: 1, paddingVertical: 14, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: "#00d4ff" },
  tabText: { color: "#64748b", fontSize: 13, fontWeight: "600" },
  tabTextActive: { color: "#00d4ff" },
  card: { backgroundColor: "#0f172a", borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#1e293b" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  caseId: { color: "#64748b", fontSize: 11 },
  cardTitle: { color: "#f1f5f9", fontSize: 14, fontWeight: "700", marginBottom: 4 },
  cardOrg: { color: "#00d4ff", fontSize: 11, fontWeight: "600", marginBottom: 4 },
  cardDesc: { color: "#94a3b8", fontSize: 12 },
  cardDate: { color: "#475569", fontSize: 11, marginTop: 4 },
  penaltyAmount: { color: "#fbbf24", fontSize: 15, fontWeight: "800" },
  issueBtn: { margin: 12, backgroundColor: "#dc262620", borderWidth: 1, borderColor: "#dc2626", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  issueBtnText: { color: "#ef4444", fontSize: 13, fontWeight: "700" },
  emptyText: { color: "#475569", textAlign: "center", marginTop: 40, fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: "#00000080", justifyContent: "flex-end" },
  modalCard: { backgroundColor: "#0f172a", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, borderTopWidth: 1, borderTopColor: "#1e293b" },
  modalTitle: { color: "#f1f5f9", fontSize: 18, fontWeight: "800", marginBottom: 16 },
  input: { backgroundColor: "#0a0e1a", borderWidth: 1, borderColor: "#1e293b", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: "#f1f5f9", fontSize: 14, marginBottom: 12 },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 4 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: "#1e293b", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  cancelBtnText: { color: "#94a3b8", fontSize: 13, fontWeight: "600" },
  submitBtn: { flex: 1, backgroundColor: "#dc2626", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  submitBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});
