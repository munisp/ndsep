import React, { type ReactNode } from "react";
import { View, Text, StyleSheet, type ViewStyle } from "react-native";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";

interface MobileCardProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  style?: ViewStyle;
  headerRight?: ReactNode;
}

export function MobileCard({ children, title, subtitle, style, headerRight }: MobileCardProps) {
  return (
    <View style={[s.card, style]}>
      {(title || headerRight) && (
        <View style={s.header}>
          <View style={s.headerText}>
            {title && <Text style={s.title}>{title}</Text>}
            {subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
          </View>
          {headerRight}
        </View>
      )}
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },
  headerText: { flex: 1 },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
});
