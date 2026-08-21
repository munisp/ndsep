import React, { type ReactNode } from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, spacing, fontSize, fontWeight } from "../theme";

interface MobilePageHeaderProps {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}

export function MobilePageHeader({ title, subtitle, right }: MobilePageHeaderProps) {
  return (
    <View style={s.container}>
      <View style={s.textWrap}>
        <Text style={s.title}>{title}</Text>
        {subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  textWrap: { flex: 1 },
  title: {
    color: colors.text,
    fontSize: fontSize.heading,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    marginTop: spacing.xs,
  },
});
