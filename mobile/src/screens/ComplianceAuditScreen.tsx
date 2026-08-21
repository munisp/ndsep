import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { MobileEmptyState } from "../components/MobileEmptyState";
import { MobileBadge, getBadgeVariant } from "../components/MobileBadge";

export function ComplianceAuditScreen() {
  const { data: audits = [], isLoading, refetch } = useQuery({
    queryKey: ["compliance-audits"],
    queryFn: () => api.getComplianceAudits(),
    staleTime: 30_000,
  });
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => { setRefreshing(true); await refetch(); setRefreshing(false); }, [refetch]);

  const getScoreColor = (score: number) => score >= 80 ? colors.success : score >= 60 ? colors.warning : colors.danger;

  if (isLoading) return <View style={s.container}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      <MobilePageHeader title="Compliance Audits" subtitle="CAR Submissions & Audit Returns" />
      {(audits as any[]).map((a: any) => (
        <MobileCard key={a.id} style={s.cardMargin}>
          <View style={s.row}>
            <Text style={s.cardTitle}>Audit #{a.id}</Text>
            <Text style={[s.score, { color: getScoreColor(a.score ?? 0) }]}>{a.score ?? "—"}%</Text>
          </View>
          <View style={s.metaRow}>
            <MobileBadge variant={getBadgeVariant(a.status ?? "pending")}>{a.status ?? "pending"}</MobileBadge>
            <Text style={s.meta}>Org: #{a.org_id ?? a.orgId ?? "—"}</Text>
          </View>
        </MobileCard>
      ))}
      {audits.length === 0 && <MobileEmptyState title="No audits found" description="Compliance audits will appear here when submitted." />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  cardMargin: { marginHorizontal: 0 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  score: { fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  meta: { color: colors.textSecondary, fontSize: fontSize.sm },
});
