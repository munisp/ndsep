import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";

interface MobileEmptyStateProps {
  title?: string;
  description?: string;
}

export function MobileEmptyState({ title = "No data found", description }: MobileEmptyStateProps) {
  return (
    <View style={s.container}>
      <View style={s.iconCircle}>
        <Text style={s.icon}>📋</Text>
      </View>
      <Text style={s.title}>{title}</Text>
      {description && <Text style={s.desc}>{description}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.lg,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: borderRadius.full,
    backgroundColor: colors.cardBorder,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  icon: { fontSize: 28 },
  title: {
    color: colors.text,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.xs,
  },
  desc: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: "center",
    maxWidth: 280,
  },
});
