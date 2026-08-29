import React from "react";
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert } from "react-native";
import { api } from "../services/api";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";

export function BreachReportScreen({ navigation }: { navigation: { goBack: () => void } }) {
  const [form, setForm] = React.useState({ organizationId: "", description: "", severity: "high", affectedSubjects: "", dataCategories: "" });
  const [submitting, setSubmitting] = React.useState(false);

  const submit = async () => {
    const organizationId = form.organizationId.trim();
    const description = form.description.trim();
    if (!organizationId || !description || description.length < 10) {
      Alert.alert("Incomplete report", "Enter an organization ID and a description of at least 10 characters.");
      return;
    }

    setSubmitting(true);
    try {
      await api.reportBreach({
        organizationId,
        description,
        severity: form.severity,
        affectedSubjects: Number.parseInt(form.affectedSubjects, 10) || 0,
        dataCategories: form.dataCategories.split(",").map((value) => value.trim()).filter(Boolean),
      });
      Alert.alert("Report submitted", "The platform accepted the breach report.", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } catch {
      Alert.alert("Submission failed", "The platform did not confirm receipt. Check your connection and retry.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={s.container}>
      <MobilePageHeader title="Report Data Breach" subtitle="Submit verified incident details to the NDSEP platform" />
      <MobileCard>
        <Text style={s.label}>Organization ID *</Text>
        <TextInput style={s.input} value={form.organizationId} onChangeText={(organizationId) => setForm((current) => ({ ...current, organizationId }))} placeholder="Registered organization ID" placeholderTextColor={colors.textMuted} keyboardType="numeric" />
        <Text style={s.label}>Incident description *</Text>
        <TextInput style={[s.input, { height: 100 }]} value={form.description} onChangeText={(description) => setForm((current) => ({ ...current, description }))} placeholder="Describe the incident (minimum 10 characters)" placeholderTextColor={colors.textMuted} multiline />
        <Text style={s.label}>Affected data categories</Text>
        <TextInput style={s.input} value={form.dataCategories} onChangeText={(dataCategories) => setForm((current) => ({ ...current, dataCategories }))} placeholder="e.g., contact data, identifiers" placeholderTextColor={colors.textMuted} />
        <Text style={s.label}>Severity</Text>
        <View style={s.row}>
          {["low", "medium", "high", "critical"].map((severity) => (
            <TouchableOpacity key={severity} onPress={() => setForm((current) => ({ ...current, severity }))} style={[s.sevBtn, form.severity === severity && s.sevActive]}>
              <Text style={[s.sevText, form.severity === severity && s.sevTextActive]}>{severity}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.label}>Affected data subjects</Text>
        <TextInput style={s.input} value={form.affectedSubjects} onChangeText={(affectedSubjects) => setForm((current) => ({ ...current, affectedSubjects }))} keyboardType="numeric" placeholder="Number of people affected" placeholderTextColor={colors.textMuted} />
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
