import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { MobileBadge, getBadgeVariant } from "../components/MobileBadge";
import { MobileStatsRow } from "../components/MobileStatCard";
import { MobileEmptyState } from "../components/MobileEmptyState";

interface AISystem {
  id: number;
  model_name?: string;
  modelName?: string;
  risk_level?: string;
  riskLevel?: string;
  compliance_status?: string;
  complianceStatus?: string;
  last_audit_date?: string;
}

export function AIGovernanceScreen() {
  const { data: systems = [], isLoading, refetch } = useQuery({
    queryKey: ["ai-models"],
    queryFn: () => api.getAIModels(),
    staleTime: 30_000,
  });
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const items = systems.map((s: AISystem) => ({
    id: s.id,
    name: s.model_name ?? s.modelName ?? `Model #${s.id}`,
    riskLevel: s.risk_level ?? s.riskLevel ?? "medium",
    status: s.compliance_status ?? s.complianceStatus ?? "pending",
    lastAudit: s.last_audit_date ?? "—",
  }));

  if (isLoading) return <View style={s.container}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      <MobilePageHeader title="AI Governance" subtitle="NDPA Art. 37 — Automated Decision-Making Registry" />

      <MobileStatsRow stats={[
        { label: "Systems", value: items.length, color: colors.primary },
        { label: "High Risk", value: items.filter(i => i.riskLevel === "critical" || i.riskLevel === "high").length, color: colors.danger },
      ]} />

      {items.map(sys => (
        <MobileCard key={sys.id}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>{sys.name}</Text>
            <MobileBadge variant={getBadgeVariant(sys.riskLevel)}>{sys.riskLevel}</MobileBadge>
          </View>
          <Text style={s.cardMeta}>Status: {sys.status}</Text>
          <Text style={s.cardMeta}>Last audit: {sys.lastAudit}</Text>
        </MobileCard>
      ))}
      {items.length === 0 && <MobileEmptyState title="No AI models registered" description="Registered AI systems will appear here." />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  cardTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  cardMeta: { color: colors.textSecondary, fontSize: fontSize.md, marginTop: spacing.xs },
});
