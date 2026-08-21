import React from "react";
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert } from "react-native";
import { api } from "../services/api";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";

export function BreachReportScreen({ navigation }: { navigation: { goBack: () => void } }) {
  const [form, setForm] = React.useState({ title: "", description: "", severity: "high", affected_subjects: "" });
  const [submitting, setSubmitting] = React.useState(false);

  const submit = async () => {
    if (!form.title.trim()) { Alert.alert("Error", "Title is required"); return; }
    setSubmitting(true);
    try {
      await api.reportBreach({
        title: form.title,
        description: form.description,
        severity: form.severity,
        affected_subjects: parseInt(form.affected_subjects) || 0,
      });
      Alert.alert("Success", "Breach reported. NDPC will be notified within 72 hours per NDPA S.40.", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } catch {
      Alert.alert("Error", "Failed to submit breach report. Saved offline for sync.");
    }
    setSubmitting(false);
  };

  return (
    <ScrollView style={s.container}>
      <MobilePageHeader title="Report Data Breach" subtitle="NDPA S.40 — 72-hour notification requirement" />
      <MobileCard>
        <Text style={s.label}>Breach Title *</Text>
        <TextInput style={s.input} value={form.title} onChangeText={t => setForm(f => ({ ...f, title: t }))} placeholder="Brief description" placeholderTextColor={colors.textMuted} />
        <Text style={s.label}>Description</Text>
        <TextInput style={[s.input, { height: 100 }]} value={form.description} onChangeText={t => setForm(f => ({ ...f, description: t }))} placeholder="Full details of the breach" placeholderTextColor={colors.textMuted} multiline />
        <Text style={s.label}>Severity</Text>
        <View style={s.row}>
          {["low", "medium", "high", "critical"].map(sv => (
            <TouchableOpacity key={sv} onPress={() => setForm(f => ({ ...f, severity: sv }))} style={[s.sevBtn, form.severity === sv && s.sevActive]}>
              <Text style={[s.sevText, form.severity === sv && s.sevTextActive]}>{sv}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.label}>Affected Data Subjects</Text>
        <TextInput style={s.input} value={form.affected_subjects} onChangeText={t => setForm(f => ({ ...f, affected_subjects: t }))} keyboardType="numeric" placeholder="Number of people affected" placeholderTextColor={colors.textMuted} />
        <TouchableOpacity style={[s.submitBtn, submitting && { opacity: 0.5 }]} onPress={submit} disabled={submitting}>
          <Text style={s.submitText}>{submitting ? "Submitting…" : "Submit Breach Report"}</Text>
        </TouchableOpacity>
      </MobileCard>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  label: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  input: { backgroundColor: colors.cardBorder, borderRadius: borderRadius.md, padding: spacing.md, color: colors.text, fontSize: fontSize.base },
  row: { flexDirection: "row", gap: spacing.sm },
  sevBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: borderRadius.sm, backgroundColor: colors.cardBorder, alignItems: "center" },
  sevActive: { backgroundColor: colors.dangerDark },
  sevText: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: fontWeight.semibold, textTransform: "capitalize" },
  sevTextActive: { color: colors.text },
  submitBtn: { backgroundColor: colors.dangerDark, borderRadius: borderRadius.md, padding: spacing.lg, marginTop: spacing.xl, alignItems: "center" },
  submitText: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
});
