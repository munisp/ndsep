import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";

export function ComplianceDetailScreen() {
  const [refreshing, setRefreshing] = React.useState(false);
  const { data: overview, refetch } = useQuery({
    queryKey: ["compliance-overview"],
    queryFn: () => api.getComplianceOverview(),
    staleTime: 30_000,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };
  const scoreColor = (value: number) => value >= 80 ? colors.success : value >= 60 ? colors.warning : colors.danger;
  const dimensions = Object.entries(overview?.dimensions ?? {});

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.success} />}>
      <MobilePageHeader title="Compliance Overview" subtitle="Current aggregate NDPA/NDPR compliance status" />
      <MobileCard>
        <Text style={s.cardTitle}>Overall Score</Text>
        <Text style={[s.scoreText, { color: scoreColor(overview?.overallScore ?? 0) }]}>{overview?.overallScore ?? "—"}/100</Text>
        <Text style={s.gradeText}>Trend: {overview?.trend ?? "not reported"}</Text>
      </MobileCard>
      {dimensions.map(([name, score]) => (
        <MobileCard key={name}>
          <View style={s.dimRow}>
            <Text style={s.dimName}>{name}</Text>
            <Text style={[s.dimScore, { color: scoreColor(score) }]}>{Math.round(score)}%</Text>
          </View>
          <View style={s.progressBar}>
            <View style={[s.progressFill, { width: `${Math.min(100, Math.max(0, score))}%`, backgroundColor: scoreColor(score) }]} />
          </View>
        </MobileCard>
      ))}
      <MobileCard title="Quick Actions">
        {['Run Compliance Audit', 'Generate DPIA', 'Submit Annual Report', 'View Violations'].map((action) => (
          <TouchableOpacity key={action} style={s.actionBtn} accessibilityRole="button">
            <Text style={s.actionText}>{action}</Text>
          </TouchableOpacity>
        ))}
      </MobileCard>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  cardTitle: { color: colors.textSecondary, fontSize: fontSize.base, fontWeight: fontWeight.semibold, marginBottom: spacing.sm },
  scoreText: { fontSize: 48, fontWeight: "800", textAlign: "center" },
  gradeText: { color: colors.textSecondary, fontSize: fontSize.lg, textAlign: "center", marginTop: spacing.xs },
  dimRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  dimName: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.medium },
  dimScore: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  progressBar: { height: 6, backgroundColor: colors.input, borderRadius: 3, marginTop: spacing.sm, marginBottom: spacing.xs },
  progressFill: { height: 6, borderRadius: 3 },
  actionBtn: { backgroundColor: colors.cardBorder, borderRadius: borderRadius.md, padding: spacing.md, marginTop: spacing.sm },
  actionText: { color: colors.success, fontSize: fontSize.base, fontWeight: fontWeight.semibold, textAlign: "center" },
});
