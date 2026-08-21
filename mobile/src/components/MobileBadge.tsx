import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, borderRadius, fontSize, fontWeight } from "../theme";

type BadgeVariant = "critical" | "high" | "medium" | "low" | "success" | "warning" | "info" | "neutral" | "pending";

const variantColors: Record<BadgeVariant, { bg: string; text: string }> = {
  critical: { bg: colors.criticalBg, text: colors.dangerLight },
  high: { bg: colors.highBg, text: colors.warningLight },
  medium: { bg: colors.mediumBg, text: colors.warning },
  low: { bg: colors.lowBg, text: colors.primaryLight },
  success: { bg: colors.successBg, text: colors.successLight },
  warning: { bg: colors.highBg, text: colors.warningLight },
  info: { bg: colors.lowBg, text: colors.info },
  neutral: { bg: colors.cardBorder, text: colors.textSecondary },
  pending: { bg: colors.pendingBg, text: colors.warningLight },
};

interface MobileBadgeProps {
  variant: BadgeVariant;
  children: string;
}

export function MobileBadge({ variant, children }: MobileBadgeProps) {
  const style = variantColors[variant] ?? variantColors.neutral;
  return (
    <View style={[s.badge, { backgroundColor: style.bg }]}>
      <Text style={[s.text, { color: style.text }]}>{children}</Text>
    </View>
  );
}

/** Map common status strings to badge variants */
export function getBadgeVariant(status: string): BadgeVariant {
  const normalized = status.toLowerCase().replace(/[_-]/g, "");
  const map: Record<string, BadgeVariant> = {
    critical: "critical", high: "high", medium: "medium", low: "low",
    success: "success", completed: "success", resolved: "success",
    active: "success", healthy: "success",
    pending: "pending", draft: "neutral", closed: "neutral", inactive: "neutral",
    warning: "warning", degraded: "warning",
    error: "critical", failed: "critical", unhealthy: "critical",
    open: "high", detected: "critical",
    inprogress: "info", processing: "info",
  };
  return map[normalized] ?? "neutral";
}

const s = StyleSheet.create({
  badge: {
    borderRadius: borderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    textTransform: "uppercase",
  },
});
