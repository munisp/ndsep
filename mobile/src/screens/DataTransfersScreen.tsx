import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { MobileBadge, getBadgeVariant } from "../components/MobileBadge";
import { MobileEmptyState } from "../components/MobileEmptyState";

export function DataTransfersScreen() {
  const { data: transfers = [], isLoading, refetch } = useQuery({
    queryKey: ["data-transfers"],
    queryFn: () => api.getDataTransfers(),
    staleTime: 30_000,
  });
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => { setRefreshing(true); await refetch(); setRefreshing(false); }, [refetch]);

  if (isLoading) return <View style={s.container}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      <MobilePageHeader title="Cross-Border Transfers" subtitle="NDPA Art. 44 — International Data Transfers" />
      {(transfers as any[]).map((t: any) => (
        <MobileCard key={t.id}>
          <Text style={s.route}>{t.source_country ?? t.sourceCountry ?? "NG"} → {t.destination_country ?? t.destinationCountry ?? "—"}</Text>
          <Text style={s.mechanism}>{t.transfer_mechanism ?? t.transferMechanism ?? "Adequacy"}</Text>
          <MobileBadge variant={getBadgeVariant(t.status)}>{t.status}</MobileBadge>
        </MobileCard>
      ))}
      {transfers.length === 0 && <MobileEmptyState title="No cross-border transfers" description="Transfer records will appear here." />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  route: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  mechanism: { color: colors.textSecondary, fontSize: fontSize.md, marginTop: spacing.xs, marginBottom: spacing.sm },
});
