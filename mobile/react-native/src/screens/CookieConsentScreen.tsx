import React from 'react';
import { View, Text, ScrollView, StyleSheet, Switch } from 'react-native';
import { trpc } from '../api/trpc';

export default function CookieConsentScreen() {
  const cookiesQuery = trpc.cookieConsent?.list?.useQuery?.({ page: 1, limit: 20 }) ?? { data: null };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Cookie Consent Management</Text>
      <Text style={styles.subtitle}>Track and manage cookie consent across domains</Text>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{cookiesQuery.data?.total ?? 12}</Text>
          <Text style={styles.statLabel}>Total Domains</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: '#22c55e' }]}>8</Text>
          <Text style={styles.statLabel}>Compliant</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: '#f59e0b' }]}>3</Text>
          <Text style={styles.statLabel}>Pending</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Cookie Categories</Text>
      {['Essential', 'Analytics', 'Marketing', 'Preferences', 'Social Media'].map(cat => (
        <View key={cat} style={styles.categoryRow}>
          <View>
            <Text style={styles.catName}>{cat}</Text>
            <Text style={styles.catDesc}>{cat === 'Essential' ? 'Required for site functionality' : `${cat} cookies for enhanced experience`}</Text>
          </View>
          <Switch value={cat === 'Essential'} disabled={cat === 'Essential'} />
        </View>
      ))}

      <Text style={styles.sectionTitle}>Recent Consent Records</Text>
      {[
        { domain: 'portal.ndsep.gov.ng', status: 'accepted', date: '2025-12-15' },
        { domain: 'dpco.ndsep.gov.ng', status: 'accepted', date: '2025-12-14' },
        { domain: 'api.ndsep.gov.ng', status: 'pending', date: '2025-12-13' },
        { domain: 'banking.ndsep.gov.ng', status: 'accepted', date: '2025-12-12' },
      ].map(record => (
        <View key={record.domain} style={styles.recordCard}>
          <Text style={styles.recordDomain}>{record.domain}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
            <Text style={styles.recordDate}>{record.date}</Text>
            <View style={[styles.badge, record.status === 'accepted' ? styles.badgeGreen : styles.badgeYellow]}>
              <Text style={styles.badgeText}>{record.status}</Text>
            </View>
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
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#1e293b', marginBottom: 12, marginTop: 16 },
  categoryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8 },
  catName: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  catDesc: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  recordCard: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8 },
  recordDomain: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  recordDate: { fontSize: 12, color: '#94a3b8' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeGreen: { backgroundColor: '#dcfce7' },
  badgeYellow: { backgroundColor: '#fef3c7' },
  badgeText: { fontSize: 11, fontWeight: '600' },
});
