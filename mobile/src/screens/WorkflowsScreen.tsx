import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { MobileBadge, getBadgeVariant } from "../components/MobileBadge";
import { MobileEmptyState } from "../components/MobileEmptyState";

export function WorkflowsScreen() {
  const { data: workflows = [], isLoading, refetch } = useQuery({
    queryKey: ["active-workflows"],
    queryFn: () => api.getActiveWorkflows(),
    staleTime: 30_000,
  });
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => { setRefreshing(true); await refetch(); setRefreshing(false); }, [refetch]);

  if (isLoading) return <View style={s.container}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      <MobilePageHeader title="Active Workflows" subtitle="Temporal Workflow Orchestration" />
      {(workflows as any[]).map((w: any) => (
        <MobileCard key={w.id}>
          <View style={s.row}>
            <Text style={s.cardTitle}>{w.workflow_type ?? w.workflowType ?? "Workflow"}</Text>
            <MobileBadge variant={getBadgeVariant(w.status)}>{w.status}</MobileBadge>
          </View>
          <Text style={s.meta}>Entity: {w.entity_id ?? w.entityId ?? "—"}</Text>
        </MobileCard>
      ))}
      {workflows.length === 0 && <MobileEmptyState title="No active workflows" description="Temporal workflows will appear here when running." />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  meta: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: spacing.sm },
});
