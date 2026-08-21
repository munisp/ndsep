import React from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";

export function ProfileScreen() {
  const { data: authData } = useQuery({
    queryKey: ["auth-verify"],
    queryFn: async () => { try { const r = await fetch(`${process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000"}/api/v2/auth/verify`, { headers: { Authorization: `Bearer ${await (api as any).token}` } }); return r.ok ? r.json() : null; } catch { return null; } },
    staleTime: 60_000,
  });
  const logoutMutation = useMutation({ mutationFn: () => api.logout(), onSuccess: () => Alert.alert("Logged Out") });
  const user = (authData as any)?.user;

  return (
    <ScrollView style={s.container}>
      <MobilePageHeader title="Profile" />
      <MobileCard style={s.profileCard}>
        <View style={s.avatar}><Text style={s.avatarText}>{(user?.email ?? "U")[0].toUpperCase()}</Text></View>
        <Text style={s.name}>{user?.displayName ?? user?.email ?? "NDSEP User"}</Text>
        <Text style={s.role}>{user?.role ?? "user"}</Text>
      </MobileCard>
      <MobileCard>
        <Text style={s.label}>Email</Text><Text style={s.value}>{user?.email ?? "—"}</Text>
        <Text style={s.label}>Role</Text><Text style={s.value}>{user?.role ?? "—"}</Text>
        <Text style={s.label}>User ID</Text><Text style={s.value}>{user?.id ?? "—"}</Text>
      </MobileCard>
      <TouchableOpacity style={s.logoutBtn} onPress={() => logoutMutation.mutate()}>
        <Text style={s.logoutText}>Log Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  profileCard: { alignItems: "center" },
  avatar: { width: 64, height: 64, borderRadius: borderRadius.full, backgroundColor: colors.primary, justifyContent: "center", alignItems: "center", marginBottom: spacing.md },
  avatarText: { color: colors.text, fontSize: 28, fontWeight: fontWeight.bold },
  name: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.semibold },
  role: { color: colors.textSecondary, fontSize: fontSize.base, textTransform: "capitalize" },
  label: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: spacing.md, alignSelf: "flex-start" },
  value: { color: colors.text, fontSize: fontSize.lg, alignSelf: "flex-start" },
  logoutBtn: { backgroundColor: colors.danger, borderRadius: borderRadius.md, padding: spacing.lg, alignItems: "center", marginTop: spacing.lg },
  logoutText: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
});
