import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { trpc } from '../api/trpc';

export default function DpcoPortalScreen({ navigation }: any) {
  const statsQuery = trpc.dpco.dashboardStats.useQuery();
  const engagementsQuery = trpc.dpco.listEngagements.useQuery({ page: 1, limit: 5 });

  const stats = statsQuery.data ?? {};

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>DPCO Operations Portal</Text>
      <Text style={styles.subtitle}>Data Protection Compliance Organisation Management</Text>

      <View style={styles.statsRow}>
        {[
          { label: 'Licensed DPCOs', value: stats.totalDpcos ?? 0, color: '#3b82f6' },
          { label: 'Active Clients', value: stats.activeClients ?? 0, color: '#22c55e' },
          { label: 'Pending CARs', value: stats.pendingCars ?? 0, color: '#f59e0b' },
          { label: 'Training Sessions', value: stats.trainingSessions ?? 0, color: '#8b5cf6' },
        ].map(stat => (
          <View key={stat.label} style={styles.statCard}>
            <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>DPCO Functions</Text>
      {[
        { name: 'DPCO Registry', desc: 'Licensed organisations' },
        { name: 'Client Portfolio', desc: 'Engagement management' },
        { name: 'Audit Workspace', desc: 'Compliance auditing' },
        { name: 'Verification Statements', desc: 'Compliance verification' },
        { name: 'Evidence Vault', desc: 'Document management' },
        { name: 'Performance Scorecard', desc: 'DPCO performance metrics' },
        { name: 'Billing & Earnings', desc: 'Revenue tracking' },
        { name: 'AI Audit Tools', desc: 'AI-powered audit assistance' },
      ].map(item => (
        <TouchableOpacity key={item.name} style={styles.funcCard}>
          <Text style={styles.funcName}>{item.name}</Text>
          <Text style={styles.funcDesc}>{item.desc}</Text>
        </TouchableOpacity>
      ))}

      <Text style={styles.sectionTitle}>Recent Engagements</Text>
      {engagementsQuery.data?.rows?.map((eng: any) => (
        <View key={eng.id} style={styles.engCard}>
          <Text style={styles.engTitle}>{eng.organization_name ?? `Engagement #${eng.id}`}</Text>
          <Text style={styles.engSub}>{eng.current_stage} • {eng.engagement_type ?? 'audit'}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#64748b', marginBottom: 16 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  statCard: { width: '48%', backgroundColor: '#fff', borderRadius: 12, padding: 12, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  statValue: { fontSize: 22, fontWeight: '700' },
  statLabel: { fontSize: 11, color: '#94a3b8', marginTop: 2, textAlign: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#1e293b', marginBottom: 12, marginTop: 8 },
  funcCard: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#3b82f6' },
  funcName: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  funcDesc: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  engCard: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8 },
  engTitle: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  engSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
});
