import React from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";

export function OfflineDataScreen() {
  const queueSize = api.getOfflineQueueSize();
  const syncMutation = useMutation({
    mutationFn: () => api.syncOfflineQueue(),
    onSuccess: (results) => { const synced = results.filter((r: any) => r.success).length; Alert.alert("Sync Complete", `${synced}/${results.length} items synced`); },
    onError: () => Alert.alert("Sync Failed", "Could not reach the server"),
  });

  return (
    <ScrollView style={s.container}>
      <MobilePageHeader title="Offline Data" subtitle="Queued actions waiting to sync" />
      <MobileCard style={s.statCard}>
        <Text style={s.statNum}>{queueSize}</Text>
        <Text style={s.statLabel}>Items in offline queue</Text>
      </MobileCard>
      <TouchableOpacity style={[s.btn, queueSize === 0 && s.btnDisabled]} onPress={() => queueSize > 0 && syncMutation.mutate()} disabled={queueSize === 0}>
        <Text style={s.btnText}>{syncMutation.isPending ? "Syncing..." : "Sync Now"}</Text>
      </TouchableOpacity>
      <MobileCard title="How it works">
        <Text style={s.infoText}>When you submit breach reports or DSARs offline, they are saved locally and synced when connectivity is restored.</Text>
      </MobileCard>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  statCard: { alignItems: "center", paddingVertical: spacing.xxl },
  statNum: { color: colors.primary, fontSize: 48, fontWeight: fontWeight.bold },
  statLabel: { color: colors.textSecondary, fontSize: fontSize.base, marginTop: spacing.xs },
  btn: { backgroundColor: colors.primary, borderRadius: borderRadius.md, padding: spacing.lg, alignItems: "center", marginBottom: spacing.lg },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  infoText: { color: colors.textSecondary, fontSize: fontSize.md, lineHeight: 20 },
});
