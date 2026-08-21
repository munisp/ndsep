import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { MobileEmptyState } from "../components/MobileEmptyState";

export function NotificationsScreen() {
  const { data: alerts = [], isLoading, refetch } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.getActiveAlerts(),
    staleTime: 15_000,
  });
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => { setRefreshing(true); await refetch(); setRefreshing(false); }, [refetch]);

  const getSeverityColor = (sev: string) => {
    switch (sev) { case "critical": return colors.danger; case "high": return colors.warning; case "medium": return colors.primary; default: return colors.success; }
  };

  if (isLoading) return <View style={s.container}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      <MobilePageHeader title="Notifications" subtitle={`${alerts.length} active alert${alerts.length !== 1 ? "s" : ""}`} />
      {(alerts as any[]).map((a: any) => (
        <MobileCard key={a.id} style={{ borderLeftWidth: 3, borderLeftColor: getSeverityColor(a.severity) }}>
          <Text style={s.cardTitle}>{a.title ?? `Alert #${a.id}`}</Text>
          <Text style={s.meta}>{a.type ?? "system"} | {a.timestamp ? new Date(a.timestamp).toLocaleString() : "—"}</Text>
        </MobileCard>
      ))}
      {alerts.length === 0 && <MobileEmptyState title="No notifications" description="You're all caught up." />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  cardTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  meta: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: spacing.sm },
});
