import React from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { api } from "../services/api";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";

export function AlertDetailScreen({ route, navigation }: { route: { params?: { alertId?: string } }; navigation: { goBack: () => void } }) {
  const alertId = route.params?.alertId ?? "—";
  const [acknowledged, setAcknowledged] = React.useState(false);

  const handleAcknowledge = async () => {
    try {
      await api.acknowledgeAlert(alertId);
      setAcknowledged(true);
      Alert.alert("Alert Acknowledged", "This alert has been acknowledged and assigned to you.");
    } catch {
      Alert.alert("Error", "Failed to acknowledge alert. Will retry when online.");
    }
  };

  return (
    <ScrollView style={s.container}>
      <MobilePageHeader title={`Alert #${alertId}`} />
      <MobileCard>
        <Text style={s.label}>Type</Text><Text style={s.value}>Security Alert</Text>
        <Text style={s.label}>Severity</Text><Text style={[s.value, { color: colors.danger }]}>Critical</Text>
        <Text style={s.label}>Source</Text><Text style={s.value}>WAF / OpenAppSec</Text>
        <Text style={s.label}>Detected At</Text><Text style={s.value}>{new Date().toLocaleString()}</Text>
        <Text style={s.label}>Description</Text>
        <Text style={s.desc}>Anomalous traffic pattern detected from IP range. Potential DDoS or data exfiltration attempt. WAF rules triggered on /api/v2/compliance/* endpoints.</Text>
      </MobileCard>
      <TouchableOpacity style={[s.ackBtn, acknowledged && s.ackBtnDone]} onPress={handleAcknowledge} disabled={acknowledged}>
        <Text style={s.ackText}>{acknowledged ? "Acknowledged" : "Acknowledge Alert"}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  label: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: spacing.md },
  value: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  desc: { color: colors.textSecondary, fontSize: fontSize.base, lineHeight: 20, marginTop: spacing.xs },
  ackBtn: { backgroundColor: colors.warning, borderRadius: borderRadius.md, padding: spacing.lg, marginHorizontal: spacing.lg, alignItems: "center" },
  ackBtnDone: { backgroundColor: colors.success },
  ackText: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
});
