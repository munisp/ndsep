/**
 * NDSEP Mobile — Dashboard Screen
 * Full parity with web compliance dashboard.
 * Shows real-time compliance scores, alerts, and enforcement status.
 */
import React from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { api } from "../services/api";
import { ComplianceScoreCard } from "../components/ComplianceScoreCard";
import { AlertsList } from "../components/AlertsList";
import { QuickActions } from "../components/QuickActions";
import { MetricsGrid } from "../components/MetricsGrid";
import { colors, spacing, fontSize, fontWeight } from "../theme";
import { MobilePageHeader } from "../components/MobilePageHeader";

export function DashboardScreen() {
  const navigation = useNavigation();
  const [refreshing, setRefreshing] = React.useState(false);

  const { data: complianceData, refetch: refetchCompliance } = useQuery({
    queryKey: ["compliance-overview"],
    queryFn: () => api.getComplianceOverview(),
    staleTime: 30_000,
  });

  const { data: alerts, refetch: refetchAlerts } = useQuery({
    queryKey: ["active-alerts"],
    queryFn: () => api.getActiveAlerts(),
    staleTime: 10_000,
  });

  const { data: metrics } = useQuery({
    queryKey: ["platform-metrics"],
    queryFn: () => api.getPlatformMetrics(),
    staleTime: 60_000,
  });

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchCompliance(), refetchAlerts()]);
    setRefreshing(false);
  }, [refetchCompliance, refetchAlerts]);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.success} />}
    >
      <MobilePageHeader title="NDSEP Dashboard" subtitle="National Data Sovereignty Enforcement" />

      <ComplianceScoreCard
        score={complianceData?.overallScore ?? 0}
        trend={complianceData?.trend ?? "stable"}
        dimensions={complianceData?.dimensions ?? {}}
      />

      <QuickActions
        actions={[
          { label: "New Breach", icon: "alert-circle", onPress: () => navigation.navigate("BreachReport" as never) },
          { label: "DSAR", icon: "file-text", onPress: () => navigation.navigate("DSARSubmit" as never) },
          { label: "Audit", icon: "shield", onPress: () => navigation.navigate("AuditTrail" as never) },
          { label: "NOC", icon: "activity", onPress: () => navigation.navigate("NOCMonitor" as never) },
        ]}
      />

      <MetricsGrid
        metrics={[
          { label: "Organizations", value: metrics?.totalOrgs ?? 0, icon: "building" },
          { label: "Active Cases", value: metrics?.activeCases ?? 0, icon: "briefcase" },
          { label: "Breaches (30d)", value: metrics?.breaches30d ?? 0, icon: "alert-triangle" },
          { label: "Compliance Avg", value: `${metrics?.avgCompliance ?? 0}%`, icon: "bar-chart" },
        ]}
      />

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Active Alerts</Text>
          <TouchableOpacity onPress={() => navigation.navigate("Alerts" as never)}>
            <Text style={styles.viewAll}>View All</Text>
          </TouchableOpacity>
        </View>
        <AlertsList alerts={alerts?.slice(0, 5) ?? []} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  section: {
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xxl,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  viewAll: {
    fontSize: fontSize.base,
    color: colors.success,
  },
});
