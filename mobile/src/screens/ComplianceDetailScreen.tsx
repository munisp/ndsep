import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";

export function ComplianceDetailScreen() {
  const [refreshing, setRefreshing] = React.useState(false);
  const { data: score, refetch: refetchScore } = useQuery({
    queryKey: ["compliance-score"],
    queryFn: () => api.getComplianceScore(),
    staleTime: 30_000,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetchScore();
    setRefreshing(false);
  };

  const scoreColor = (v: number) => v >= 80 ? colors.success : v >= 60 ? colors.warning : colors.danger;

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.success} />}>
      <MobilePageHeader title="Compliance Overview" subtitle="NDPA/NDPR Compliance Status" />

      <MobileCard>
        <Text style={s.cardTitle}>Overall Score</Text>
        <Text style={[s.scoreText, { color: colors.success }]}>{score?.overall_score ?? "—"}/100</Text>
        <Text style={s.gradeText}>Grade: {score?.grade ?? "N/A"}</Text>
      </MobileCard>

      {(score?.dimensions ?? []).map((dim: { name: string; score: number; status: string }, idx: number) => (
        <MobileCard key={idx}>
          <View style={s.dimRow}>
            <Text style={s.dimName}>{dim.name}</Text>
            <Text style={[s.dimScore, { color: scoreColor(dim.score) }]}>{dim.score}%</Text>
          </View>
          <View style={s.progressBar}>
            <View style={[s.progressFill, { width: `${dim.score}%`, backgroundColor: scoreColor(dim.score) }]} />
          </View>
          <Text style={s.dimStatus}>{dim.status}</Text>
        </MobileCard>
      ))}

      <MobileCard title="Quick Actions">
        {["Run Compliance Audit", "Generate DPIA", "Submit Annual Report", "View Violations"].map((action, i) => (
          <TouchableOpacity key={i} style={s.actionBtn}>
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
  dimStatus: { color: colors.textMuted, fontSize: fontSize.sm },
  actionBtn: { backgroundColor: colors.cardBorder, borderRadius: borderRadius.md, padding: spacing.md, marginTop: spacing.sm },
  actionText: { color: colors.success, fontSize: fontSize.base, fontWeight: fontWeight.semibold, textAlign: "center" },
});
