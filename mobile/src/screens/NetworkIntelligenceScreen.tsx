import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";

export function NetworkIntelligenceScreen() {
  const [refreshing, setRefreshing] = React.useState(false);
  const { data: metrics, refetch } = useQuery({
    queryKey: ["platform-metrics"],
    queryFn: () => api.getPlatformMetrics(),
    staleTime: 60_000,
  });
  const onRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };

  const platformMetrics = [
    { label: "Registered Organizations", value: metrics?.totalOrgs ?? "—", unit: "" },
    { label: "Active Enforcement Cases", value: metrics?.activeCases ?? "—", unit: "" },
    { label: "Reported Breaches (30 days)", value: metrics?.breaches30d ?? "—", unit: "" },
    { label: "Average Compliance", value: metrics?.avgCompliance ?? "—", unit: "%" },
  ];

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      <MobilePageHeader title="Platform Intelligence" subtitle="Current regulatory and compliance summary" />
      {platformMetrics.map((m, idx) => (
        <MobileCard key={idx}>
          <Text style={s.metricLabel}>{m.label}</Text>
          <Text style={s.metricValue}>{m.value}{m.unit ? ` ${m.unit}` : ""}</Text>
        </MobileCard>
      ))}
      <MobileCard title="Data provenance">
        <Text style={s.placeholder}>Metrics are supplied by the authenticated NDSEP platform API and reflect the current server response.</Text>
      </MobileCard>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  metricLabel: { color: colors.textMuted, fontSize: fontSize.sm },
  metricValue: { color: colors.primary, fontSize: 28, fontWeight: fontWeight.bold, marginTop: spacing.xs },
  placeholder: { color: colors.textMuted, fontSize: fontSize.md, textAlign: "center" },
});
