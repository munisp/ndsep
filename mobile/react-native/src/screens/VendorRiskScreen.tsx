import React from 'react';
import { View, Text, ScrollView, StyleSheet, FlatList } from 'react-native';
import { trpc } from '../api/trpc';

export default function VendorRiskScreen() {
  const vendorsQuery = trpc.phase12?.vendorRisk?.list?.useQuery?.({ page: 1, limit: 20 }) ?? { data: null };

  const riskLevelColor = (level: string) => {
    switch (level?.toLowerCase()) {
      case 'critical': return '#dc2626';
      case 'high': return '#f59e0b';
      case 'medium': return '#3b82f6';
      case 'low': return '#22c55e';
      default: return '#94a3b8';
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Vendor Risk Assessment</Text>
      <Text style={styles.subtitle}>Third-party data processor risk monitoring</Text>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>8</Text>
          <Text style={styles.statLabel}>Total Vendors</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: '#dc2626' }]}>2</Text>
          <Text style={styles.statLabel}>High/Critical</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: '#22c55e' }]}>6</Text>
          <Text style={styles.statLabel}>DPA Signed</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>52</Text>
          <Text style={styles.statLabel}>Avg Score</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Risk Profiles</Text>
      {[
        { name: 'CloudNG Storage', risk: 'high', score: 35, dpa: true },
        { name: 'PayStack Payments', risk: 'medium', score: 62, dpa: true },
        { name: 'Flutterwave Pay', risk: 'medium', score: 58, dpa: true },
        { name: 'AWS Nigeria', risk: 'low', score: 85, dpa: true },
        { name: 'Interswitch', risk: 'low', score: 78, dpa: true },
        { name: 'Kobo Analytics', risk: 'critical', score: 22, dpa: false },
        { name: 'NCC Data Services', risk: 'medium', score: 55, dpa: true },
        { name: 'Remita Pay', risk: 'high', score: 38, dpa: false },
      ].map(vendor => (
        <View key={vendor.name} style={styles.vendorCard}>
          <View style={styles.vendorHeader}>
            <Text style={styles.vendorName}>{vendor.name}</Text>
            <View style={[styles.badge, { backgroundColor: riskLevelColor(vendor.risk) + '20' }]}>
              <Text style={[styles.badgeText, { color: riskLevelColor(vendor.risk) }]}>{vendor.risk}</Text>
            </View>
          </View>
          <View style={styles.vendorMeta}>
            <Text style={styles.vendorScore}>Score: {vendor.score}/100</Text>
            <Text style={[styles.vendorDpa, { color: vendor.dpa ? '#22c55e' : '#ef4444' }]}>
              DPA: {vendor.dpa ? 'Signed' : 'Missing'}
            </Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${vendor.score}%`, backgroundColor: riskLevelColor(vendor.risk) }]} />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#64748b', marginBottom: 16 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  statCard: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 12, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  statLabel: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#1e293b', marginBottom: 12, marginTop: 8 },
  vendorCard: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10 },
  vendorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  vendorName: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  vendorMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  vendorScore: { fontSize: 12, color: '#64748b' },
  vendorDpa: { fontSize: 12, fontWeight: '600' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  progressBar: { height: 4, backgroundColor: '#e2e8f0', borderRadius: 2, marginTop: 8 },
  progressFill: { height: 4, borderRadius: 2 },
});
