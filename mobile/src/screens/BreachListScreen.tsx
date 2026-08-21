import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { MobileBadge, getBadgeVariant } from "../components/MobileBadge";
import { MobileEmptyState } from "../components/MobileEmptyState";

export function BreachListScreen({ navigation }: { navigation: { navigate: (screen: string) => void } }) {
  const [refreshing, setRefreshing] = React.useState(false);
  const { data, refetch } = useQuery({
    queryKey: ["active-alerts"],
    queryFn: () => api.getActiveAlerts(),
    staleTime: 10_000,
  });
  const onRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };
  const breaches = (data?.alerts ?? []).filter((a: { type: string }) => a.type === "breach" || a.type === "incident");

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.danger} />}>
      <MobilePageHeader
        title="Breach Incidents"
        right={
          <TouchableOpacity style={s.reportBtn} onPress={() => navigation.navigate("BreachReport")}>
            <Text style={s.reportText}>+ Report</Text>
          </TouchableOpacity>
        }
      />
      {breaches.length === 0 && <MobileEmptyState title="No active breach incidents" description="Breach incidents will appear here when reported." />}
      {breaches.map((b: { id: string; title: string; severity: string; reported_at: string; status: string }, idx: number) => (
        <MobileCard key={idx} style={s.cardOuter}>
          <Text style={s.breachTitle}>{b.title}</Text>
          <View style={s.row}>
            <MobileBadge variant={getBadgeVariant(b.severity)}>{b.severity}</MobileBadge>
            <Text style={s.date}>{new Date(b.reported_at).toLocaleDateString()}</Text>
          </View>
          <Text style={s.status}>Status: {b.status}</Text>
        </MobileCard>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  reportBtn: { backgroundColor: colors.dangerDark, borderRadius: borderRadius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  reportText: { color: colors.text, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  cardOuter: { marginHorizontal: spacing.lg },
  breachTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  date: { color: colors.textMuted, fontSize: fontSize.sm },
  status: { color: colors.textSecondary, fontSize: fontSize.md, marginTop: spacing.sm },
});
