import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";

interface Metric {
  label: string;
  value: string | number;
  icon: string;
}

interface Props {
  metrics: Metric[];
}

export function MetricsGrid({ metrics }: Props) {
  return (
    <View style={styles.grid}>
      {metrics.map((metric) => (
        <View key={metric.label} style={styles.card}>
          <Feather name={metric.icon as any} size={16} color={colors.textMuted} />
          <Text style={styles.value}>{metric.value}</Text>
          <Text style={styles.label}>{metric.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: spacing.lg, marginTop: spacing.xl, gap: spacing.sm },
  card: { width: "47%", backgroundColor: colors.card, borderRadius: borderRadius.lg, padding: spacing.lg, gap: spacing.xs },
  value: { color: colors.text, fontSize: 22, fontWeight: fontWeight.bold },
  label: { color: colors.textMuted, fontSize: fontSize.xs },
});
