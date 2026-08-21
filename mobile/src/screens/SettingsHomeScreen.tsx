import React from "react";
import { View, Text, ScrollView, StyleSheet, Switch, Alert } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";

export function SettingsHomeScreen() {
  const [pushEnabled, setPushEnabled] = React.useState(true);
  const [biometricEnabled, setBiometricEnabled] = React.useState(false);
  const [offlineMode, setOfflineMode] = React.useState(true);

  const pushMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (enabled) {
        await api.init();
        Alert.alert("Push Notifications", "Enabled");
      } else {
        Alert.alert("Push Notifications", "Disabled");
      }
    },
  });

  return (
    <ScrollView style={s.container}>
      <MobilePageHeader title="Settings" />
      <MobileCard title="Notifications">
        <View style={s.settingRow}>
          <View style={s.settingTextWrap}><Text style={s.settingLabel}>Push Notifications</Text><Text style={s.settingDesc}>Receive alerts for breaches and SLA deadlines</Text></View>
          <Switch value={pushEnabled} onValueChange={(v) => { setPushEnabled(v); pushMutation.mutate(v); }} trackColor={{ true: colors.primary }} />
        </View>
      </MobileCard>
      <MobileCard title="Security">
        <View style={s.settingRow}>
          <View style={s.settingTextWrap}><Text style={s.settingLabel}>Biometric Login</Text><Text style={s.settingDesc}>Use Face ID / fingerprint to authenticate</Text></View>
          <Switch value={biometricEnabled} onValueChange={setBiometricEnabled} trackColor={{ true: colors.primary }} />
        </View>
      </MobileCard>
      <MobileCard title="Data">
        <View style={s.settingRow}>
          <View style={s.settingTextWrap}><Text style={s.settingLabel}>Offline Mode</Text><Text style={s.settingDesc}>Queue actions when offline, sync when connected</Text></View>
          <Switch value={offlineMode} onValueChange={setOfflineMode} trackColor={{ true: colors.primary }} />
        </View>
        <Text style={s.queueInfo}>Offline queue: {api.getOfflineQueueSize()} items</Text>
      </MobileCard>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.sm },
  settingTextWrap: { flex: 1, marginRight: spacing.md },
  settingLabel: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  settingDesc: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  queueInfo: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: spacing.sm },
});
