import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";

interface MobileStatCardProps {
  label: string;
  value: string | number;
  color?: string;
}

export function MobileStatCard({ label, value, color }: MobileStatCardProps) {
  return (
    <View style={s.card}>
      <Text style={[s.value, color ? { color } : undefined]}>{value}</Text>
      <Text style={s.label}>{label}</Text>
    </View>
  );
}

interface MobileStatsRowProps {
  stats: MobileStatCardProps[];
}

export function MobileStatsRow({ stats }: MobileStatsRowProps) {
  return (
    <View style={s.row}>
      {stats.map((stat, i) => (
        <MobileStatCard key={i} {...stat} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  card: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  value: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  label: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
    textAlign: "center",
  },
});
