import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";

interface Alert {
  id: string;
  type: string;
  severity: string;
  title: string;
  timestamp: string;
}

interface Props {
  alerts: Alert[];
}

export function AlertsList({ alerts }: Props) {
  if (alerts.length === 0) {
    return (
      <View style={styles.empty}>
        <Feather name="check-circle" size={24} color={colors.success} />
        <Text style={styles.emptyText}>No active alerts</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {alerts.map((alert) => (
        <TouchableOpacity key={alert.id} style={styles.alertItem}>
          <View style={[styles.severityDot, { backgroundColor: severityColor(alert.severity) }]} />
          <View style={styles.alertContent}>
            <Text style={styles.alertTitle} numberOfLines={1}>{alert.title}</Text>
            <Text style={styles.alertMeta}>{alert.type} · {formatTime(alert.timestamp)}</Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

function severityColor(severity: string): string {
  switch (severity) {
    case "critical": return colors.danger;
    case "high": return colors.warning;
    case "medium": return colors.warningLight;
    default: return colors.textMuted;
  }
}

function formatTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  empty: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyText: { color: colors.textMuted, fontSize: fontSize.base },
  alertItem: { flexDirection: "row", alignItems: "center", backgroundColor: colors.cardBorder, borderRadius: borderRadius.lg, padding: spacing.lg, gap: spacing.md },
  severityDot: { width: 8, height: 8, borderRadius: 4 },
  alertContent: { flex: 1 },
  alertTitle: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.medium },
  alertMeta: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: 2 },
});
