import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '../api/trpc';

interface Institution {
  id: number;
  name: string;
  short_name: string;
  license_type: string;
  status: string;
  compliance_score: number;
  capital_adequacy_ratio: number;
}

export default function BankingDashboardScreen({ navigation }: any) {
  const statsQuery = trpc.bankingServices.institutionStats.useQuery();
  const institutionsQuery = trpc.bankingServices.listInstitutions.useQuery({ page: 1, limit: 10 });

  const stats = statsQuery.data ?? { total: 0, licensed: 0, suspended: 0, avgCompliance: 0 };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Banking Services</Text>
      <Text style={styles.subtitle}>CBN-Regulated Institution Monitoring</Text>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.total ?? 0}</Text>
          <Text style={styles.statLabel}>Institutions</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: '#22c55e' }]}>{stats.licensed ?? 0}</Text>
          <Text style={styles.statLabel}>Licensed</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: '#ef4444' }]}>{stats.suspended ?? 0}</Text>
          <Text style={styles.statLabel}>Suspended</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: '#3b82f6' }]}>{(stats.avgCompliance ?? 0).toFixed(0)}%</Text>
          <Text style={styles.statLabel}>Avg Compliance</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Institutions</Text>
      {institutionsQuery.data?.rows?.map((inst: Institution) => (
        <View key={inst.id} style={styles.listItem}>
          <View style={styles.listItemLeft}>
            <Text style={styles.itemName}>{inst.name}</Text>
            <Text style={styles.itemSub}>{inst.license_type} • {inst.short_name}</Text>
          </View>
          <View style={[styles.badge, inst.status === 'licensed' ? styles.badgeGreen : styles.badgeRed]}>
            <Text style={styles.badgeText}>{inst.status}</Text>
          </View>
        </View>
      ))}

      <View style={styles.quickActions}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        {['KYC Records', 'AML Cases', 'SWIFT Transactions', 'Fraud Alerts', 'CBN Reports', 'Watchlist'].map(action => (
          <TouchableOpacity key={action} style={styles.actionButton}>
            <Text style={styles.actionText}>{action}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#64748b', marginBottom: 16 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  statCard: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 12, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  statValue: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  statLabel: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#1e293b', marginBottom: 12, marginTop: 8 },
  listItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8 },
  listItemLeft: { flex: 1 },
  itemName: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  itemSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeGreen: { backgroundColor: '#dcfce7' },
  badgeRed: { backgroundColor: '#fee2e2' },
  badgeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  quickActions: { marginTop: 12 },
  actionButton: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  actionText: { fontSize: 14, fontWeight: '500', color: '#3b82f6' },
});
