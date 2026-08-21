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
  const orgs = data?.organizations ?? [];

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.success} />}>
      <MobilePageHeader title="Organizations" subtitle={`${orgs.length} registered data controllers`} />
      {orgs.length === 0 ? (
        <MobileEmptyState title="No organizations loaded" description="Registered organizations will appear here." />
      ) : (
        orgs.map((org: { id: number; name: string; sector: string; compliance_score?: number }, idx: number) => (
          <MobileCard key={idx}>
            <Text style={s.orgName}>{org.name}</Text>
            <Text style={s.orgSector}>{org.sector}</Text>
            <Text style={[s.orgScore, { color: (org.compliance_score ?? 0) >= 80 ? colors.success : colors.warning }]}>
              Score: {org.compliance_score ?? "N/A"}%
            </Text>
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
