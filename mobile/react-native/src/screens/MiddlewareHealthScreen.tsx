import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, StyleSheet } from 'react-native';

const API_BASE = __DEV__ ? 'http://10.0.2.2:3000' : '';

interface ServiceHealth {
  name: string;
  status: string;
  latencyMs: number;
}

export default function MiddlewareHealthScreen() {
  const [health, setHealth] = useState<{ overall: string; services: ServiceHealth[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/middleware/health`);
      const json = await res.json();
      setHealth(json);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const statusColor = (status: string) => {
    switch (status) {
      case 'healthy': return '#22c55e';
      case 'degraded': return '#f97316';
      case 'unhealthy': return '#ef4444';
      default: return '#9ca3af';
    }
  };

  return (
    <View style={styles.container}>
      {health && (
        <View style={[styles.overallCard, { borderColor: statusColor(health.overall) }]}>
          <Text style={styles.overallLabel}>Overall Status</Text>
          <Text style={[styles.overallStatus, { color: statusColor(health.overall) }]}>
            {health.overall.toUpperCase()}
          </Text>
        </View>
      )}
      <FlatList
        data={health?.services ?? []}
        keyExtractor={(item) => item.name}
        renderItem={({ item }) => (
          <View style={styles.serviceCard}>
            <View style={[styles.dot, { backgroundColor: statusColor(item.status) }]} />
            <View style={styles.serviceContent}>
              <Text style={styles.serviceName}>{item.name}</Text>
              <Text style={styles.serviceLatency}>{item.latencyMs}ms</Text>
            </View>
            <Text style={[styles.serviceStatus, { color: statusColor(item.status) }]}>{item.status}</Text>
          </View>
        )}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  overallCard: { borderWidth: 2, borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 16, backgroundColor: '#fff' },
  overallLabel: { fontSize: 14, color: '#666' },
  overallStatus: { fontSize: 24, fontWeight: '700', marginTop: 4 },
  serviceCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 8, elevation: 1 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  serviceContent: { flex: 1 },
  serviceName: { fontSize: 15, fontWeight: '600', color: '#111' },
  serviceLatency: { fontSize: 12, color: '#999', marginTop: 2 },
  serviceStatus: { fontSize: 12, fontWeight: '600' },
});
