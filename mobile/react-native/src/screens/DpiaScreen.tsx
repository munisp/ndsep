import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, StyleSheet } from 'react-native';

// dpia.list returns raw SQL rows (snake_case)
interface DpiaAssessment {
  id: number;
  title: string;
  dpia_risk_level: string;
  dpia_status: string;
}

const API_BASE = __DEV__ ? 'http://10.0.2.2:3000' : '';

export default function DpiaScreen() {
  const [assessments, setAssessments] = useState<DpiaAssessment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      // Real path: dpia.list (the dpiaAssessments.* namespace is not mounted).
      // Non-batch tRPC over HTTP returns {result: {data: {json: <payload>}}}.
      const res = await fetch(`${API_BASE}/api/trpc/dpia.list`);
      const json = await res.json();
      setAssessments(json?.result?.data?.json ?? []);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const riskColor = (level: string) => {
    switch (level?.toLowerCase()) {
      case 'high': return '#ef4444';
      case 'medium': return '#eab308';
      case 'low': return '#22c55e';
      default: return '#6b7280';
    }
  };

  return (
    <FlatList
      data={assessments}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.content}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.subtitle}>Risk: {item.dpia_risk_level} - {item.dpia_status}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: riskColor(item.dpia_risk_level) }]}>
            <Text style={styles.badgeText}>{item.dpia_risk_level}</Text>
          </View>
        </View>
      )}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      ListEmptyComponent={!loading ? <Text style={styles.empty}>No DPIA assessments</Text> : null}
      contentContainerStyle={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 12 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 8, elevation: 2, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  content: { flex: 1 },
  title: { fontSize: 15, fontWeight: '600', color: '#111' },
  subtitle: { fontSize: 13, color: '#666', marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  empty: { textAlign: 'center', padding: 40, color: '#999' },
});
