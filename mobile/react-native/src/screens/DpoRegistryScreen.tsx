import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = __DEV__ ? 'http://10.0.2.2:3000' : '';

export default function DpoRegistryScreen() {
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      // dpoAppointments.list requires an input object and returns {data, total}
      const token = await AsyncStorage.getItem('ndsep_session_token');
      const input = encodeURIComponent(JSON.stringify({ json: { page: 1, limit: 50 } }));
      const res = await fetch(`${API_BASE}/api/trpc/dpoAppointments.list?input=${input}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      setAppointments(json?.result?.data?.json?.data ?? []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <FlatList
      data={appointments}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(item.dpo_name ?? 'U')[0]}</Text></View>
          <View style={styles.content}>
            <Text style={styles.name}>{item.dpo_name}</Text>
            <Text style={styles.email}>{item.dpo_email}{item.org_name ? ` · ${item.org_name}` : ''}</Text>
          </View>
          <Text style={styles.status}>{item.credential_status}</Text>
        </View>
      )}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      ListEmptyComponent={!loading ? <Text style={styles.empty}>No DPO appointments</Text> : null}
      contentContainerStyle={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 12 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 8, elevation: 2, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#3b82f6', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  content: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: '#111' },
  email: { fontSize: 13, color: '#666', marginTop: 2 },
  status: { fontSize: 12, fontWeight: '600', color: '#3b82f6' },
  empty: { textAlign: 'center', padding: 40, color: '#999' },
});
