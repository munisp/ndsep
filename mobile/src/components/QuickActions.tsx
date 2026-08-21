import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors, borderRadius, spacing, fontSize } from "../theme";

interface Action {
  label: string;
  icon: string;
  onPress: () => void;
}

interface Props {
  actions: Action[];
}

export function QuickActions({ actions }: Props) {
  return (
    <View style={styles.container}>
      {actions.map((action) => (
        <TouchableOpacity key={action.label} style={styles.action} onPress={action.onPress}>
          <View style={styles.iconContainer}>
            <Feather name={action.icon as any} size={20} color={colors.success} />
          </View>
          <Text style={styles.label}>{action.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing.xl, marginTop: spacing.xl },
  action: { alignItems: "center", gap: spacing.sm },
  iconContainer: { width: 48, height: 48, borderRadius: borderRadius.lg, backgroundColor: colors.successBg, justifyContent: "center", alignItems: "center" },
  label: { color: colors.textSecondary, fontSize: fontSize.xs },
});
