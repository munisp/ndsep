import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { MobileStatsRow } from "../components/MobileStatCard";
import { MobileEmptyState } from "../components/MobileEmptyState";

export function SecurityScreen() {
  const { data: nocData, isLoading, refetch } = useQuery({
    queryKey: ["security-noc"],
    queryFn: () => api.getNOCStatus(),
    staleTime: 30_000,
  });
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => { setRefreshing(true); await refetch(); setRefreshing(false); }, [refetch]);

  const noc = nocData as any;
  const services = noc?.services ?? [];
  const healthy = services.filter((s: any) => s.status === "healthy").length;

  if (isLoading) return <View style={s.container}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      <MobilePageHeader title="Security Overview" subtitle={`Platform Status: ${noc?.status ?? "unknown"}`} />

      <MobileStatsRow stats={[
        { label: "Healthy", value: healthy, color: colors.success },
        { label: "Degraded", value: services.length - healthy, color: colors.danger },
        { label: "Total", value: services.length, color: colors.primary },
      ]} />

      {services.map((svc: any, i: number) => (
        <MobileCard key={i}>
          <View style={s.row}>
            <Text style={s.svcName}>{svc.service_name ?? `Service ${i + 1}`}</Text>
            <View style={[s.dot, { backgroundColor: svc.status === "healthy" ? colors.success : colors.danger }]} />
          </View>
          <Text style={s.meta}>{svc.response_time_ms ? `${svc.response_time_ms}ms` : "—"}</Text>
        </MobileCard>
      ))}
      {services.length === 0 && <MobileEmptyState title="No service data available" />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  svcName: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  dot: { width: 10, height: 10, borderRadius: 5 },
  meta: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: spacing.xs },
});
