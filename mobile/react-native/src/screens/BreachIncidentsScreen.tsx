import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet, Alert } from 'react-native';

interface BreachIncident {
  id: number;
  title: string;
  severity: string;
  status: string;
  affectedRecords: number;
  createdAt: string;
  description?: string;
}

const API_BASE = __DEV__ ? 'http://10.0.2.2:3000' : '';

export default function BreachIncidentsScreen() {
  const [incidents, setIncidents] = useState<BreachIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadIncidents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE}/api/trpc/breachIncidents.list`);
      const json = await res.json();
      setIncidents(json?.result?.data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadIncidents(); }, [loadIncidents]);

  const severityColor = (severity: string) => {
    switch (severity?.toLowerCase()) {
      case 'critical': return '#ef4444';
      case 'high': return '#f97316';
      case 'medium': return '#eab308';
      case 'low': return '#22c55e';
      default: return '#6b7280';
    }
  };

  const renderItem = ({ item }: { item: BreachIncident }) => (
    <TouchableOpacity style={styles.card} onPress={() => Alert.alert(item.title, item.description ?? 'No details')}>
      <View style={[styles.severityDot, { backgroundColor: severityColor(item.severity) }]} />
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle}>{item.title}</Text>
        <Text style={styles.cardSubtitle}>{item.status} - {item.createdAt?.substring(0, 10)}</Text>
        <Text style={styles.affectedText}>Affected: {item.affectedRecords ?? 0} records</Text>
      </View>
    </TouchableOpacity>
  );

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Error: {error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={loadIncidents}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      data={incidents}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderItem}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={loadIncidents} />}
      ListEmptyComponent={!loading ? <Text style={styles.empty}>No breach incidents found</Text> : null}
      contentContainerStyle={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 12 },
  card: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 8, elevation: 2, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  severityDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4, marginRight: 12 },
  cardContent: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#111' },
  cardSubtitle: { fontSize: 13, color: '#666', marginTop: 2 },
  affectedText: { fontSize: 12, color: '#888', marginTop: 4 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  errorText: { color: '#ef4444', fontSize: 14, marginBottom: 12 },
  retryBtn: { backgroundColor: '#3b82f6', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 6 },
  retryText: { color: '#fff', fontWeight: '600' },
  empty: { textAlign: 'center', padding: 40, color: '#999' },
});
