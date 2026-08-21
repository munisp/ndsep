import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, StyleSheet, TouchableOpacity } from 'react-native';

interface ConsentRecord {
  id: number;
  dataSubject: string;
  purpose: string;
  status: string;
  expiresAt?: string;
}

const API_BASE = __DEV__ ? 'http://10.0.2.2:3000' : '';

export default function ConsentManagementScreen() {
  const [records, setRecords] = useState<ConsentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/trpc/consentRecords.list`);
      const json = await res.json();
      setRecords(json?.result?.data ?? []);
    } catch {
      // Error handling
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const renderItem = ({ item }: { item: ConsentRecord }) => (
    <View style={styles.card}>
      <View style={[styles.statusDot, { backgroundColor: item.status === 'active' ? '#22c55e' : '#ef4444' }]} />
      <View style={styles.content}>
        <Text style={styles.purpose}>{item.purpose}</Text>
        <Text style={styles.subject}>{item.dataSubject}</Text>
        {item.expiresAt && <Text style={styles.expires}>Expires: {item.expiresAt.substring(0, 10)}</Text>}
      </View>
      <Text style={[styles.status, { color: item.status === 'active' ? '#22c55e' : '#ef4444' }]}>
        {item.status}
      </Text>
    </View>
  );

  return (
    <FlatList
      data={records}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderItem}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      ListEmptyComponent={!loading ? <Text style={styles.empty}>No consent records</Text> : null}
      contentContainerStyle={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 12 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 8, elevation: 2, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  content: { flex: 1 },
  purpose: { fontSize: 15, fontWeight: '600', color: '#111' },
  subject: { fontSize: 13, color: '#666', marginTop: 2 },
  expires: { fontSize: 11, color: '#999', marginTop: 2 },
  status: { fontSize: 12, fontWeight: '600' },
  empty: { textAlign: 'center', padding: 40, color: '#999' },
});
