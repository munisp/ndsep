import React from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";

export function PenaltyCalculatorScreen() {
  const [severity, setSeverity] = React.useState("medium");
  const [records, setRecords] = React.useState("5000");
  const [turnover, setTurnover] = React.useState("100000000");
  const [repeat, setRepeat] = React.useState(false);

  const severities = ["low", "medium", "high", "critical"];
  const baseAmounts: Record<string, number> = { low: 500000, medium: 2000000, high: 5000000, critical: 10000000 };
  const recordsNum = Number(records) || 0;
  const turnoverNum = Number(turnover) || 0;

  let recordsMultiplier = 1.0;
  if (recordsNum >= 100000) recordsMultiplier = 2.0;
  else if (recordsNum >= 50000) recordsMultiplier = 1.5;
  else if (recordsNum >= 10000) recordsMultiplier = 1.2;

  const repeatMultiplier = repeat ? 1.5 : 1.0;
  let total = (baseAmounts[severity] ?? 2000000) * recordsMultiplier * repeatMultiplier;
  if (turnoverNum > 0) total = Math.min(total, turnoverNum * 0.02);
  if (severity !== "critical") total = Math.min(total, 10000000);

  const { data: metrics } = useQuery({ queryKey: ["platform-metrics"], queryFn: () => api.getPlatformMetrics(), staleTime: 60_000 });

  return (
    <ScrollView style={s.container}>
      <MobilePageHeader title="Penalty Calculator" subtitle="NDPA Article 47 — Penalty Estimation" />
      <MobileCard>
        <Text style={s.label}>Severity</Text>
        <View style={s.row}>{severities.map(sev => (
          <TouchableOpacity key={sev} style={[s.chip, severity === sev && s.chipActive]} onPress={() => setSeverity(sev)}>
            <Text style={[s.chipText, severity === sev && s.chipTextActive]}>{sev}</Text>
          </TouchableOpacity>
        ))}</View>
        <Text style={s.label}>Affected Records</Text>
        <TextInput style={s.input} value={records} onChangeText={setRecords} keyboardType="numeric" placeholderTextColor={colors.textMuted} />
        <Text style={s.label}>Annual Turnover (NGN)</Text>
        <TextInput style={s.input} value={turnover} onChangeText={setTurnover} keyboardType="numeric" placeholderTextColor={colors.textMuted} />
        <TouchableOpacity style={[s.chip, repeat && s.chipActive, { alignSelf: "flex-start", marginTop: spacing.sm }]} onPress={() => setRepeat(!repeat)}>
          <Text style={[s.chipText, repeat && s.chipTextActive]}>Repeat Offender (+50%)</Text>
        </TouchableOpacity>
      </MobileCard>
      <MobileCard style={{ alignItems: "center" }}>
        <Text style={s.resultLabel}>Estimated Penalty</Text>
        <Text style={s.resultAmount}>₦{total.toLocaleString()}</Text>
        <Text style={s.resultMeta}>Base: ₦{(baseAmounts[severity] ?? 0).toLocaleString()} × {recordsMultiplier} (records) × {repeatMultiplier} (repeat)</Text>
        {turnoverNum > 0 && <Text style={s.resultMeta}>Cap: 2% of turnover = ₦{(turnoverNum * 0.02).toLocaleString()}</Text>}
      </MobileCard>
      {metrics && <Text style={s.platformInfo}>Platform: {(metrics as any).activeCases ?? 0} active cases</Text>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  label: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  chip: { backgroundColor: colors.cardBorder, borderRadius: borderRadius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipActive: { backgroundColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: fontSize.md },
  chipTextActive: { color: colors.text },
  input: { backgroundColor: colors.cardBorder, color: colors.text, borderRadius: borderRadius.md, padding: spacing.md, fontSize: fontSize.lg },
  resultLabel: { color: colors.textSecondary, fontSize: fontSize.base },
  resultAmount: { color: colors.danger, fontSize: 36, fontWeight: fontWeight.bold, marginTop: spacing.xs },
  resultMeta: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: spacing.xs, textAlign: "center" },
  platformInfo: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: "center", marginTop: spacing.sm },
});
