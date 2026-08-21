import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { colors, spacing, fontSize, fontWeight } from "../theme";
import { MobileCard } from "../components/MobileCard";
import { MobilePageHeader } from "../components/MobilePageHeader";
import { MobileBadge, getBadgeVariant } from "../components/MobileBadge";
import { MobileStatsRow } from "../components/MobileStatCard";
import { MobileEmptyState } from "../components/MobileEmptyState";

export function BankingScreen() {
  const { data: transactions = [], isLoading, refetch } = useQuery({
    queryKey: ["banking-transactions"],
    queryFn: () => api.getBankingTransactions(),
    staleTime: 30_000,
  });
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const formatAmount = (n: number, currency?: string) => `${currency === "USD" ? "$" : "₦"}${(n || 0).toLocaleString()}`;

  if (isLoading) return <View style={s.container}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      <MobilePageHeader title="Banking & Payments" subtitle="NIP/RTGS Monitoring — CBN AML Compliance" />

      <MobileStatsRow stats={[
        { label: "Transactions", value: transactions.length, color: colors.primary },
        { label: "Completed", value: transactions.filter((t: any) => t.status === "completed").length, color: colors.success },
      ]} />

      {transactions.map((tx: any) => (
        <MobileCard key={tx.id}>
          <View style={s.cardHeader}>
            <View>
              <Text style={s.cardTitle}>{tx.transaction_type ?? tx.transactionType ?? "TX"} #{tx.id}</Text>
              <Text style={s.cardAmount}>{formatAmount(tx.amount, tx.currency)}</Text>
            </View>
            <MobileBadge variant={getBadgeVariant(tx.status ?? "unknown")}>{(tx.status ?? "unknown").replace(/_/g, " ")}</MobileBadge>
          </View>
        </MobileCard>
      ))}
      {transactions.length === 0 && <MobileEmptyState title="No transactions found" description="Banking transactions will appear here." />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  cardAmount: { color: colors.success, fontSize: fontSize.xl, fontWeight: fontWeight.bold, marginTop: 2 },
});
