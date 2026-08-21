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

  const netMetrics = [
    { label: "Ingress Traffic", value: metrics?.ingress_mbps ?? "—", unit: "Mbps" },
    { label: "Active Connections", value: metrics?.active_connections ?? "—", unit: "" },
    { label: "Blocked IPs (24h)", value: metrics?.blocked_ips_24h ?? "—", unit: "" },
    { label: "WAF Events (24h)", value: metrics?.waf_events_24h ?? "—", unit: "" },
    { label: "DNS Queries/s", value: metrics?.dns_qps ?? "—", unit: "/s" },
    { label: "SSL Certificate Expiry", value: metrics?.ssl_days_remaining ?? "—", unit: "days" },
  ];

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      <MobilePageHeader title="Network Intelligence" subtitle="Real-time network & threat monitoring" />
      {netMetrics.map((m, idx) => (
        <MobileCard key={idx}>
          <Text style={s.metricLabel}>{m.label}</Text>
          <Text style={s.metricValue}>{m.value}{m.unit ? ` ${m.unit}` : ""}</Text>
        </MobileCard>
      ))}
      <MobileCard title="Threat Map">
        <Text style={s.placeholder}>Geographic threat visualization requires full-screen mode</Text>
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
