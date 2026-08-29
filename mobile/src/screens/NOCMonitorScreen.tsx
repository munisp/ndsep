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
  const statusIcon = (status: string) => status === "healthy" ? "●" : status === "recovering" ? "●" : "●";

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.success} />}>
      <MobilePageHeader title="NOC Monitor" subtitle="Circuit-breaker health from the authenticated platform API" />
      <MobileCard style={s.cardOuter}>
        <Text style={s.cardLabel}>Platform Status</Text>
        <Text style={[s.overallStatus, { color: noc?.status === "operational" ? colors.success : colors.warning }]}>
          {noc?.status === "operational" ? "Operational" : "Degraded"}
        </Text>
      </MobileCard>
      {services.map((svc, idx) => (
        <MobileCard key={idx} style={s.cardOuter}>
          <View style={s.svcRow}>
            <Text style={s.svcStatus}>{statusIcon(svc.status)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.svcName}>{svc.serviceName}</Text>
              <Text style={s.svcMeta}>{svc.failures} recorded circuit-breaker failure{svc.failures === 1 ? "" : "s"}{svc.lastOpenedAt ? ` • last opened ${new Date(svc.lastOpenedAt).toLocaleString()}` : ""}</Text>
            </View>
          </View>
        </MobileCard>
      ))}
      {services.length === 0 && <MobileEmptyState title="No circuit-breaker data reported" description="The platform did not return observed service status." />}
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
