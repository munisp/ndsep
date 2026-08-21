import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { MobileBadge, getBadgeVariant } from "../components/MobileBadge";
import { MobileEmptyState } from "../components/MobileEmptyState";

export function DPIAScreen() {
  const { data: dpias = [], isLoading, refetch } = useQuery({
    queryKey: ["dpia-list"],
    queryFn: () => api.getDPIAList(),
    staleTime: 30_000,
  });
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => { setRefreshing(true); await refetch(); setRefreshing(false); }, [refetch]);

  if (isLoading) return <View style={s.container}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      <MobilePageHeader title="DPIA Assessments" subtitle="Data Protection Impact Assessments — NDPA Art. 27" />
      {(dpias as any[]).map((d: any) => (
        <MobileCard key={d.id}>
          <View style={s.row}>
            <Text style={s.cardTitle}>{d.title ?? `DPIA #${d.id}`}</Text>
            <MobileBadge variant={getBadgeVariant(d.risk_level ?? d.riskLevel ?? "medium")}>{d.risk_level ?? d.riskLevel ?? "medium"}</MobileBadge>
          </View>
          <Text style={s.meta}>Status: {d.status ?? "draft"}</Text>
        </MobileCard>
      ))}
      {dpias.length === 0 && <MobileEmptyState title="No DPIAs found" description="Data protection impact assessments will appear here." />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold, flex: 1 },
  meta: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: spacing.sm },
});
