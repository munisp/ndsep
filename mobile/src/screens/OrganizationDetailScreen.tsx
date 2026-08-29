import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { MobileEmptyState } from "../components/MobileEmptyState";

export function OrganizationDetailScreen() {
  const [refreshing, setRefreshing] = React.useState(false);
  const { data, refetch } = useQuery({
    queryKey: ["compliance-overview"],
    queryFn: () => api.getComplianceOverview(),
    staleTime: 30_000,
  });

  const onRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };
  const dimensions = Object.entries(data?.dimensions ?? {});

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.success} />}>
      <MobilePageHeader title="Compliance Overview" subtitle="Authenticated platform compliance summary" />
      <MobileCard>
        <Text style={s.orgName}>Overall compliance score</Text>
        <Text style={[s.orgScore, { color: (data?.overallScore ?? 0) >= 80 ? colors.success : colors.warning }]}>
          {data?.overallScore ?? "—"}%
        </Text>
        <Text style={s.orgSector}>Trend: {data?.trend ?? "not reported"}</Text>
      </MobileCard>
      {dimensions.length === 0 ? (
        <MobileEmptyState title="No compliance dimensions reported" description="The platform did not return a current breakdown." />
      ) : (
        dimensions.map(([dimension, score]) => (
          <MobileCard key={dimension}>
            <Text style={s.orgName}>{dimension}</Text>
            <Text style={[s.orgScore, { color: score >= 80 ? colors.success : colors.warning }]}>Score: {Math.round(score)}%</Text>
          </MobileCard>
        ))
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  orgName: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  orgSector: { color: colors.textSecondary, fontSize: fontSize.md, marginTop: 2 },
  orgScore: { fontSize: fontSize.base, fontWeight: fontWeight.bold, marginTop: spacing.sm },
});
