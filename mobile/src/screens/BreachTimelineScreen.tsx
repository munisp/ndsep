import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { MobileBadge, getBadgeVariant } from "../components/MobileBadge";
import { MobileEmptyState } from "../components/MobileEmptyState";

export function BreachTimelineScreen() {
  const { data: breaches = [], isLoading, refetch } = useQuery({
    queryKey: ["breach-timeline"],
    queryFn: () => api.getBreachList(),
    staleTime: 30_000,
  });
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => { setRefreshing(true); await refetch(); setRefreshing(false); }, [refetch]);

  const getSeverityColor = (sev: string) => {
    switch (sev) { case "critical": return colors.danger; case "high": return colors.warning; case "medium": return colors.primary; default: return colors.success; }
  };

  if (isLoading) return <View style={s.container}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      <MobilePageHeader title="Breach Timeline" subtitle="72-Hour NDPA Notification Tracking" />
      {(breaches as any[]).map((b: any) => (
        <MobileCard key={b.id} style={{ borderLeftWidth: 3, borderLeftColor: getSeverityColor(b.severity) }}>
          <View style={s.row}>
            <Text style={s.cardTitle}>Breach #{b.id}</Text>
            <MobileBadge variant={getBadgeVariant(b.severity)}>{b.severity}</MobileBadge>
          </View>
          <Text style={s.desc}>{b.description ?? "No description"}</Text>
          <Text style={s.meta}>Status: {b.status} | Subjects: {b.affected_data_subjects ?? "—"}</Text>
          <Text style={s.meta}>Reported: {b.reported_at ? new Date(b.reported_at).toLocaleDateString() : "—"}</Text>
        </MobileCard>
      ))}
      {breaches.length === 0 && <MobileEmptyState title="No breaches recorded" description="Breach timeline entries will appear here." />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  desc: { color: colors.textSecondary, fontSize: fontSize.md, marginTop: spacing.sm },
  meta: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: spacing.xs },
});
