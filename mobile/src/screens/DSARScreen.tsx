import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator, TouchableOpacity, TextInput, Alert } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, borderRadius, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { MobileBadge, getBadgeVariant } from "../components/MobileBadge";
import { MobileEmptyState } from "../components/MobileEmptyState";

export function DSARScreen() {
  const queryClient = useQueryClient();
  const { data: dsars = [], isLoading, refetch } = useQuery({
    queryKey: ["dsar-list"],
    queryFn: () => api.getDSARList(),
    staleTime: 30_000,
  });
  const [refreshing, setRefreshing] = React.useState(false);
  const [showForm, setShowForm] = React.useState(false);
  const [subjectName, setSubjectName] = React.useState("");
  const [details, setDetails] = React.useState("");

  const onRefresh = React.useCallback(async () => { setRefreshing(true); await refetch(); setRefreshing(false); }, [refetch]);

  const submitMutation = useMutation({
    mutationFn: () => api.submitDSAR({ subjectName, requestType: "access", organizationId: "1", details }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["dsar-list"] }); setShowForm(false); setSubjectName(""); setDetails(""); Alert.alert("Success", "DSAR submitted"); },
  });

  if (isLoading) return <View style={s.container}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      <MobilePageHeader title="DSAR Requests" subtitle="Data Subject Access Requests — NDPA Art. 35" />
      <TouchableOpacity style={s.btn} onPress={() => setShowForm(!showForm)}><Text style={s.btnText}>{showForm ? "Cancel" : "New DSAR"}</Text></TouchableOpacity>
      {showForm && (
        <View style={s.form}>
          <TextInput style={s.input} placeholder="Subject Name" placeholderTextColor={colors.textMuted} value={subjectName} onChangeText={setSubjectName} />
          <TextInput style={[s.input, { height: 80 }]} placeholder="Details" placeholderTextColor={colors.textMuted} value={details} onChangeText={setDetails} multiline />
          <TouchableOpacity style={[s.btn, { backgroundColor: colors.primary }]} onPress={() => submitMutation.mutate()}><Text style={s.btnText}>Submit</Text></TouchableOpacity>
        </View>
      )}
      {(dsars as any[]).map((d: any) => (
        <MobileCard key={d.id}>
          <View style={s.row}>
            <Text style={s.cardTitle}>{d.citizen_name ?? d.citizenName ?? `Request #${d.id}`}</Text>
            <MobileBadge variant={getBadgeVariant(d.status)}>{d.status}</MobileBadge>
          </View>
          <Text style={s.meta}>Type: {d.request_type ?? d.requestType ?? "access"}</Text>
        </MobileCard>
      ))}
      {dsars.length === 0 && <MobileEmptyState title="No DSAR requests" description="Data subject access requests will appear here." />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  meta: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: spacing.sm },
  btn: { backgroundColor: colors.cardBorder, borderRadius: borderRadius.md, padding: spacing.md, alignItems: "center", marginBottom: spacing.lg },
  btnText: { color: colors.text, fontWeight: fontWeight.semibold },
  form: { marginBottom: spacing.lg },
  input: { backgroundColor: colors.card, color: colors.text, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.sm },
});
