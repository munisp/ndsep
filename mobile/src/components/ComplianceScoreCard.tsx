import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";

interface Props {
  score: number;
  trend: string;
  dimensions: Record<string, number>;
}

export function ComplianceScoreCard({ score, trend, dimensions }: Props) {
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const color = score >= 80 ? colors.success : score >= 60 ? colors.warning : colors.danger;

  return (
    <View style={styles.card}>
      <View style={styles.scoreContainer}>
        <Svg width={140} height={140}>
          <Circle cx={70} cy={70} r={radius} stroke={colors.cardBorder} strokeWidth={8} fill="none" />
          <Circle
            cx={70} cy={70} r={radius}
            stroke={color} strokeWidth={8} fill="none"
            strokeDasharray={`${progress} ${circumference}`}
            strokeLinecap="round"
            transform="rotate(-90 70 70)"
          />
        </Svg>
        <View style={styles.scoreTextContainer}>
          <Text style={[styles.scoreValue, { color }]}>{Math.round(score)}</Text>
          <Text style={styles.scoreLabel}>/ 100</Text>
        </View>
      </View>
      <View style={styles.dimensionsContainer}>
        {Object.entries(dimensions).slice(0, 4).map(([key, value]) => (
          <View key={key} style={styles.dimension}>
            <Text style={styles.dimensionLabel}>{key.replace(/_/g, " ")}</Text>
            <View style={styles.dimensionBar}>
              <View style={[styles.dimensionFill, { width: `${value}%`, backgroundColor: value >= 70 ? colors.success : colors.warning }]} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: borderRadius.xl, padding: spacing.xl, marginHorizontal: spacing.xl, marginTop: spacing.lg },
  scoreContainer: { alignItems: "center", marginBottom: spacing.lg },
  scoreTextContainer: { position: "absolute", top: 45, alignItems: "center" },
  scoreValue: { fontSize: 36, fontWeight: fontWeight.bold },
  scoreLabel: { fontSize: fontSize.sm, color: colors.textMuted },
  dimensionsContainer: { gap: spacing.sm },
  dimension: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dimensionLabel: { fontSize: fontSize.xs, color: colors.textSecondary, width: 80, textTransform: "capitalize" },
  dimensionBar: { flex: 1, height: 4, backgroundColor: colors.cardBorder, borderRadius: 2 },
  dimensionFill: { height: 4, borderRadius: 2 },
});
