import React from "react";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { MobileEmptyState } from "../components/MobileEmptyState";

export function CaseDetailScreen({ route }: { route?: { params?: { caseId?: number } } }) {
  const caseId = route?.params?.caseId;
  const { data: cases = [], isLoading } = useQuery({
    queryKey: ["enforcement-cases"],
    queryFn: () => api.getEnforcementCases(),
    staleTime: 30_000,
  });
  const caseData = (cases as any[]).find((c: any) => c.id === caseId) ?? (cases as any[])[0];

  if (isLoading) return <View style={s.container}><ActivityIndicator size="large" color={colors.primary} /></View>;
  if (!caseData) return <View style={s.container}><MobileEmptyState title="No case found" /></View>;

  return (
    <ScrollView style={s.container}>
      <MobilePageHeader title={`Case #${caseData.case_number ?? caseData.id}`} />
      <MobileCard>
        <Text style={s.label}>Status</Text><Text style={s.value}>{caseData.status}</Text>
        <Text style={s.label}>Severity</Text><Text style={s.value}>{caseData.severity ?? "—"}</Text>
        <Text style={s.label}>Organisation</Text><Text style={s.value}>Org #{caseData.org_id ?? "—"}</Text>
        <Text style={s.label}>Created</Text><Text style={s.value}>{caseData.created_at ? new Date(caseData.created_at).toLocaleDateString() : "—"}</Text>
      </MobileCard>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  label: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: spacing.md },
  value: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
});
