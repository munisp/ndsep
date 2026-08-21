import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { MobileEmptyState } from "../components/MobileEmptyState";

export function NOCMonitorScreen() {
  const [refreshing, setRefreshing] = React.useState(false);
  const { data: noc, refetch } = useQuery({
    queryKey: ["noc-status"],
    queryFn: () => api.getNOCStatus(),
    staleTime: 10_000,
  });
  const onRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };

  const services = noc?.services ?? [];
  const statusIcon = (s: string) => s === "healthy" ? "🟢" : s === "degraded" ? "🟡" : "🔴";

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.success} />}>
      <MobilePageHeader title="NOC Monitor" subtitle="Network Operations Center — Real-time" />
      <MobileCard style={s.cardOuter}>
        <Text style={s.cardLabel}>Platform Status</Text>
        <Text style={[s.overallStatus, { color: noc?.overall === "healthy" ? colors.success : colors.warning }]}>
          {noc?.overall === "healthy" ? "All Systems Operational" : "Degraded Performance"}
        </Text>
      </MobileCard>
      {services.map((svc: { name: string; status: string; latency_ms: number; uptime: number }, idx: number) => (
        <MobileCard key={idx} style={s.cardOuter}>
          <View style={s.svcRow}>
            <Text style={s.svcStatus}>{statusIcon(svc.status)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.svcName}>{svc.name}</Text>
              <Text style={s.svcMeta}>{svc.latency_ms}ms • {(svc.uptime * 100).toFixed(2)}% uptime</Text>
            </View>
          </View>
        </MobileCard>
      ))}
      {services.length === 0 && <MobileEmptyState title="Connecting to NOC…" description="Service status will appear here." />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  cardOuter: { marginHorizontal: spacing.lg },
  cardLabel: { color: colors.textSecondary, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  overallStatus: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, marginTop: spacing.xs },
  svcRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  svcStatus: { fontSize: fontSize.lg },
  svcName: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  svcMeta: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: 2 },
});
