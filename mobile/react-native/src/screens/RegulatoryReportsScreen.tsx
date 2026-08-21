import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from "react-native";
import { trpc } from "../api/trpc";

const REPORT_TYPES = [
  { key: "violations", label: "Violations", icon: "⚠️" },
  { key: "penalties", label: "Penalties", icon: "💰" },
  { key: "compliance_scores", label: "Compliance Scores", icon: "📊" },
  { key: "full_audit", label: "Full Audit", icon: "📋" },
  { key: "executive_summary", label: "Executive Summary", icon: "📌" },
] as const;

const FREQUENCIES = ["daily", "weekly", "monthly", "quarterly"] as const;

export default function RegulatoryReportsScreen() {
  const [selectedType, setSelectedType] = useState<typeof REPORT_TYPES[number]["key"]>("violations");
  const [selectedFreq, setSelectedFreq] = useState<typeof FREQUENCIES[number]>("monthly");
  const [generatedReports, setGeneratedReports] = useState<any[]>([]);

  const violationsQuery = trpc.reports.violations.useQuery({ limit: 50 }, { enabled: selectedType === "violations" });
  const penaltiesQuery = trpc.reports.penalties.useQuery({ limit: 50 }, { enabled: selectedType === "penalties" });
  const scoresQuery = trpc.reports.complianceScores.useQuery({ limit: 50 }, { enabled: selectedType === "compliance_scores" });

  const generateMutation = trpc.reports.generate.useMutation({
    onSuccess: (data) => {
      setGeneratedReports(prev => [data, ...prev]);
      Alert.alert("Report Generated", `Report ID: ${data.reportId}\nType: ${data.reportType}`);
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const scheduleMutation = trpc.reports.schedule.useMutation({
    onSuccess: (data) => {
      Alert.alert("Report Scheduled", `Schedule ID: ${data.scheduleId}\nFrequency: ${data.frequency}\nNext run: ${new Date(data.nextRunAt).toLocaleDateString()}`);
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const activeData = selectedType === "violations" ? violationsQuery.data :
    selectedType === "penalties" ? penaltiesQuery.data :
    selectedType === "compliance_scores" ? scoresQuery.data : [];

  const isLoading = violationsQuery.isLoading || penaltiesQuery.isLoading || scoresQuery.isLoading;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Regulatory Reports</Text>
      <Text style={styles.subtitle}>NITDA/NCC periodic compliance submissions</Text>

      {/* Report Type Selector */}
      <Text style={styles.sectionLabel}>Report Type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeRow}>
        {REPORT_TYPES.map(rt => (
          <TouchableOpacity
            key={rt.key}
            style={[styles.typeChip, selectedType === rt.key && styles.typeChipActive]}
            onPress={() => setSelectedType(rt.key)}
          >
            <Text style={styles.typeIcon}>{rt.icon}</Text>
            <Text style={[styles.typeLabel, selectedType === rt.key && styles.typeLabelActive]}>{rt.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Action Buttons */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.generateButton, generateMutation.isPending && { opacity: 0.6 }]}
          onPress={() => generateMutation.mutate({ reportType: selectedType, format: "json" })}
          disabled={generateMutation.isPending}
        >
          <Text style={styles.generateButtonText}>
            {generateMutation.isPending ? "Generating..." : "📊 Generate Report"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.scheduleButton, scheduleMutation.isPending && { opacity: 0.6 }]}
          onPress={() => scheduleMutation.mutate({ reportType: selectedType, frequency: selectedFreq, recipients: [] })}
          disabled={scheduleMutation.isPending}
        >
          <Text style={styles.scheduleButtonText}>
            {scheduleMutation.isPending ? "Scheduling..." : "🗓 Schedule"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Frequency Selector */}
      <View style={styles.freqRow}>
        {FREQUENCIES.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.freqChip, selectedFreq === f && styles.freqChipActive]}
            onPress={() => setSelectedFreq(f)}
          >
            <Text style={[styles.freqText, selectedFreq === f && styles.freqTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Generated Reports */}
      {generatedReports.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Generated Reports</Text>
          {generatedReports.map((r, i) => (
            <View key={i} style={styles.reportCard}>
              <Text style={styles.reportId}>{r.reportId}</Text>
              <Text style={styles.reportType}>{r.reportType} · {r.format}</Text>
              <Text style={styles.reportMeta}>Generated by {r.generatedBy} at {new Date(r.generatedAt).toLocaleString()}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Data Preview */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Data Preview ({(activeData as any[] ?? []).length} records)</Text>
        {isLoading ? (
          <ActivityIndicator color="#3b82f6" style={{ marginTop: 20 }} />
        ) : (activeData as any[] ?? []).length === 0 ? (
          <Text style={styles.emptyText}>No data. Tap "Generate Report" to load.</Text>
        ) : (
          (activeData as any[]).slice(0, 10).map((row: any, i: number) => (
            <View key={i} style={styles.dataRow}>
              <Text style={styles.dataText} numberOfLines={2}>
                {Object.entries(row).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(" · ")}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111827", padding: 16 },
  title: { fontSize: 20, fontWeight: "bold", color: "#f9fafb", marginBottom: 4 },
  subtitle: { color: "#6b7280", fontSize: 13, marginBottom: 20 },
  sectionLabel: { color: "#9ca3af", fontSize: 12, fontWeight: "600", marginBottom: 8, textTransform: "uppercase" },
  typeRow: { marginBottom: 16 },
  typeChip: { backgroundColor: "#1f2937", borderRadius: 10, padding: 12, marginRight: 10, alignItems: "center", borderWidth: 1, borderColor: "#374151", minWidth: 90 },
  typeChipActive: { backgroundColor: "#1e40af", borderColor: "#3b82f6" },
  typeIcon: { fontSize: 20, marginBottom: 4 },
  typeLabel: { color: "#9ca3af", fontSize: 11, textAlign: "center" },
  typeLabelActive: { color: "#93c5fd" },
  actionRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  generateButton: { flex: 2, backgroundColor: "#3b82f6", padding: 12, borderRadius: 8, alignItems: "center" },
  generateButtonText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  scheduleButton: { flex: 1, backgroundColor: "#7c3aed", padding: 12, borderRadius: 8, alignItems: "center" },
  scheduleButtonText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  freqRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  freqChip: { flex: 1, backgroundColor: "#1f2937", padding: 8, borderRadius: 6, alignItems: "center", borderWidth: 1, borderColor: "#374151" },
  freqChipActive: { backgroundColor: "#7c3aed", borderColor: "#7c3aed" },
  freqText: { color: "#9ca3af", fontSize: 12 },
  freqTextActive: { color: "#fff" },
  section: { marginBottom: 20 },
  reportCard: { backgroundColor: "#1f2937", borderRadius: 8, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#374151" },
  reportId: { color: "#60a5fa", fontSize: 13, fontFamily: "monospace", marginBottom: 4 },
  reportType: { color: "#f9fafb", fontSize: 14, fontWeight: "600", marginBottom: 4 },
  reportMeta: { color: "#6b7280", fontSize: 11 },
  dataRow: { backgroundColor: "#1f2937", borderRadius: 6, padding: 10, marginBottom: 6 },
  dataText: { color: "#d1d5db", fontSize: 12 },
  emptyText: { color: "#6b7280", textAlign: "center", marginTop: 20, fontSize: 13 },
});
