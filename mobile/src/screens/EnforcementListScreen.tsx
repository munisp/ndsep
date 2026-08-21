import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { MobileBadge, getBadgeVariant } from "../components/MobileBadge";
import { MobileEmptyState } from "../components/MobileEmptyState";

export function EnforcementListScreen() {
  const [refreshing, setRefreshing] = React.useState(false);
  const { data, refetch } = useQuery({
    queryKey: ["enforcement-cases"],
    queryFn: () => api.getEnforcementCases(),
    staleTime: 30_000,
  });

  const onRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };
  const cases = data?.cases ?? [];

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.success} />}>
      <MobilePageHeader title="Enforcement Cases" subtitle={`${cases.length} active cases`} />
      {cases.map((c: { id: string; org_name: string; case_type: string; status: string; severity: string; created_at: string }, idx: number) => (
        <MobileCard key={idx} style={s.cardOuter}>
          <View style={s.cardHeader}>
            <Text style={s.caseName}>{c.org_name}</Text>
            <MobileBadge variant={getBadgeVariant(c.status)}>{c.status}</MobileBadge>
          </View>
          <Text style={s.caseType}>{c.case_type} — Severity: {c.severity}</Text>
          <Text style={s.caseDate}>{new Date(c.created_at).toLocaleDateString()}</Text>
        </MobileCard>
      ))}
      {cases.length === 0 && <MobileEmptyState title="No enforcement cases" description="Cases will appear here when created." />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  cardOuter: { marginHorizontal: spacing.lg },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  caseName: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold, flex: 1 },
  caseType: { color: colors.textSecondary, fontSize: fontSize.md, marginTop: spacing.xs },
  caseDate: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: spacing.xs },
});
