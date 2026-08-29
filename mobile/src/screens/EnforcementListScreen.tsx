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
  const cases = data ?? [];

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.success} />}>
      <MobilePageHeader title="Enforcement Cases" subtitle={`${cases.length} cases returned by the platform`} />
      {cases.map((enforcementCase) => (
        <MobileCard key={enforcementCase.id} style={s.cardOuter}>
          <View style={s.cardHeader}>
            <Text style={s.caseName}>{enforcementCase.case_number ?? `Case ${enforcementCase.id}`}</Text>
            <MobileBadge variant={getBadgeVariant(enforcementCase.status)}>{enforcementCase.status}</MobileBadge>
          </View>
          <Text style={s.caseType}>Sector: {enforcementCase.sector ?? "not reported"}</Text>
          <Text style={s.caseDate}>{enforcementCase.created_at ? new Date(enforcementCase.created_at).toLocaleDateString() : "Creation date not reported"}</Text>
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
