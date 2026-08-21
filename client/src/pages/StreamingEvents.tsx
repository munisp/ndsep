import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useNdsepSocket } from "@/hooks/useNdsepSocket";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Waves, Activity, Zap, Database, Shield, Network, DollarSign } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
type StreamEvent = {
  id: string;
  topic: string;
  key: string;
  partition: number;
  offset: number;
  timestamp: string;
  payload: string;
  latency: number;
};

const TOPIC_COLORS: Record<string, string> = {
  "ndsep.assets.events": "#2563eb",
  "ndsep.compliance.alerts": "#ef4444",
  "ndsep.network.events": "#10b981",
  "ndsep.enforcement.actions": "#8b5cf6",
  "ndsep.audit.trail": "#f59e0b",
  "ndsep.financial.penalties": "#ec4899",
  "ndsep.ml.predictions": "#06b6d4",
};

const TOPIC_ICONS: Record<string, React.ComponentType<any>> = {
  "ndsep.assets.events": Database,
  "ndsep.compliance.alerts": Shield,
  "ndsep.network.events": Network,
  "ndsep.enforcement.actions": Zap,
  "ndsep.audit.trail": Activity,
  "ndsep.financial.penalties": DollarSign,
  "ndsep.ml.predictions": Activity,
};

const kafkaTopics = [
  { name: "ndsep.assets.events", partitions: 12, replication: 3, msgRate: "2.4K/s", lag: 0 },
  { name: "ndsep.compliance.alerts", partitions: 6, replication: 3, msgRate: "890/s", lag: 2 },
  { name: "ndsep.network.events", partitions: 24, replication: 3, msgRate: "18.2K/s", lag: 0 },
  { name: "ndsep.enforcement.actions", partitions: 6, replication: 3, msgRate: "124/s", lag: 0 },
  { name: "ndsep.audit.trail", partitions: 12, replication: 3, msgRate: "5.1K/s", lag: 1 },
  { name: "ndsep.financial.penalties", partitions: 3, replication: 3, msgRate: "45/s", lag: 0 },
  { name: "ndsep.ml.predictions", partitions: 6, replication: 3, msgRate: "320/s", lag: 0 },
];

function generateEvent(): StreamEvent {
  const topics = Object.keys(TOPIC_COLORS);
  const topic = topics[Math.floor(Math.random() * topics.length)];
  const orgId = Math.floor(Math.random() * 20) + 1;
  const payloads: Record<string, object> = {
    "ndsep.assets.events": { orgId, assetId: Math.floor(Math.random() * 500), event: "scan_complete", isWithinBorders: Math.random() > 0.15 },
    "ndsep.compliance.alerts": { orgId, violationId: Math.floor(Math.random() * 200), severity: ["critical", "high", "medium"][Math.floor(Math.random() * 3)], policy: "data-residency-v2" },
    "ndsep.network.events": { orgId, sourceIp: `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`, action: Math.random() > 0.2 ? "allowed" : "blocked", protocol: ["TCP", "UDP", "HTTPS"][Math.floor(Math.random() * 3)] },
    "ndsep.enforcement.actions": { orgId, workflowId: `WF-${Date.now()}`, actionType: ["notify", "restrict", "fine"][Math.floor(Math.random() * 3)], status: "initiated" },
    "ndsep.audit.trail": { actorId: `user-${Math.floor(Math.random() * 50)}`, action: ["read", "write", "delete", "export"][Math.floor(Math.random() * 4)], resource: "data_catalog", result: "success" },
    "ndsep.financial.penalties": { orgId, amount: Math.floor(Math.random() * 500000) + 10000, currency: "USD", status: "issued" },
    "ndsep.ml.predictions": { orgId, predictedRisk: (Math.random() * 100).toFixed(2), model: "risk-v3", confidence: (Math.random() * 0.4 + 0.6).toFixed(3) },
  };
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    topic,
    key: `org-${orgId}`,
    partition: Math.floor(Math.random() * 12),
    offset: Math.floor(Math.random() * 1000000),
    timestamp: new Date().toISOString(),
    payload: JSON.stringify(payloads[topic] ?? {}),
    latency: Math.floor(Math.random() * 50) + 1,
  };
}

export default function StreamingEvents() {
  // Real DB data
  const { data: dbEvents } = trpc.streaming.events.useQuery({ limit: 30 }, { refetchInterval: 10000 });
  const { data: dbTopicStats } = trpc.streaming.topicStats.useQuery(undefined, { refetchInterval: 10000 });

  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [throughputData, setThroughputData] = useState<{ t: number; kafka: number; fluvio: number }[]>([]);
  const [isLive, setIsLive] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Seed initial events from DB when loaded
  useEffect(() => {
    if (!dbEvents || dbEvents.length === 0) return;
    const mapped: StreamEvent[] = dbEvents.map((e: any) => ({
      id: `db-${e.id}`,
      topic: e.topic ?? "ndsep.assets.events",
      key: e.partitionKey ?? `org-${e.organizationId ?? 0}`,
      partition: e.partition ?? 0,
      offset: e.offset ?? 0,
      timestamp: e.createdAt ? new Date(e.createdAt).toISOString() : new Date().toISOString(),
      payload: typeof e.payload === "string" ? e.payload : JSON.stringify(e.payload ?? {}),
      latency: e.latencyMs ?? 1,
    }));
    setEvents(mapped);
  }, [dbEvents]);

  // Seed throughput chart from real topic stats
  useEffect(() => {
    if (!dbTopicStats || dbTopicStats.length === 0) return;
    const kafkaTotal = dbTopicStats.reduce((s: number, t: any) => s + Number(t.count ?? 0), 0);
    const fluvioTotal = Math.round(kafkaTotal * 0.18); // Fluvio ~18% of Kafka volume
    const seed = Array.from({ length: 20 }, (_, i) => ({
      t: i,
      kafka: Math.max(100, kafkaTotal + Math.round((Math.sin(i * 0.5) * kafkaTotal * 0.05))),
      fluvio: Math.max(50, fluvioTotal + Math.round((Math.cos(i * 0.5) * fluvioTotal * 0.08))),
    }));
    setThroughputData(seed);
  }, [dbTopicStats]);

  // WebSocket real-time push
  const { connected, streamingTicks, eventCount } = useNdsepSocket({
    rooms: ["streaming"],
  });

  // Consume WebSocket ticks when connected and live
  useEffect(() => {
    if (!isLive || !connected || streamingTicks.length === 0) return;
    const tick = streamingTicks[0];
    if (!tick) return;
    const topicMap: Record<string, string> = {
      assets: "ndsep.assets.events",
      compliance: "ndsep.compliance.alerts",
      network: "ndsep.network.events",
      enforcement: "ndsep.enforcement.actions",
      audit: "ndsep.audit.trail",
      financial: "ndsep.financial.penalties",
      ml: "ndsep.ml.predictions",
    };
    const topicKey = Object.keys(topicMap).find(k => tick.topic.toLowerCase().includes(k));
    const mappedTopic = topicKey ? topicMap[topicKey] : "ndsep.assets.events";
    const newEvent: StreamEvent = {
      id: `ws-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      topic: mappedTopic,
      key: tick.key,
      partition: tick.partition,
      offset: tick.offset,
      timestamp: new Date().toISOString(),
      payload: tick.payloadJson,
      latency: tick.latency,
    };
    setEvents(prev => [newEvent, ...prev.slice(0, 49)]);
    setThroughputData(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1]!;
      const delta = Math.round(Math.sin(last.t * 0.3) * last.kafka * 0.03);
      return [...prev.slice(1), { t: last.t + 1, kafka: Math.max(100, last.kafka + delta), fluvio: Math.max(50, Math.round(last.kafka * 0.18)) }];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamingTicks]);

  // Fallback interval when WebSocket not yet connected
  useEffect(() => {
    if (isLive && !connected) {
      intervalRef.current = setInterval(() => {
        setEvents(prev => [generateEvent(), ...prev.slice(0, 49)]);
        setThroughputData(prev => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1]!;
          const delta = Math.round(Math.sin(last.t * 0.3) * last.kafka * 0.03);
          return [...prev.slice(1), { t: last.t + 1, kafka: Math.max(100, last.kafka + delta), fluvio: Math.max(50, Math.round(last.kafka * 0.18)) }];
        });
      }, 800);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isLive, connected]);

  const topicCounts = events.reduce((acc: any, e) => {
    acc[e.topic] = (acc[e.topic] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "NOC", href: "/noc" }, { label: "Streaming Events" }]} className="mb-4" />
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="layer-badge">STREAMING</span>
            <span className="data-label">Apache Kafka · Fluvio · Dapr · Redis Streams</span>
          </div>
          <h1 className="text-2xl font-bold">Real-Time Event Streaming</h1>
          <p className="text-muted-foreground mono text-sm mt-0.5">Kafka topics · Fluvio edge streams · Event visualization · Consumer group monitoring</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`mono text-[10px] ${connected ? "text-green-600" : "text-yellow-600"}`}>{connected ? "WS CONNECTED" : "WS CONNECTING"}</span>
          {eventCount > 0 && <span className="mono text-[10px] text-muted-foreground">· {eventCount} ws events</span>}
          <button
            onClick={() => setIsLive(v => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs mono font-semibold transition-colors ${isLive ? "border-green-500/40 bg-green-500/10 text-green-600" : "border-border text-muted-foreground"}`}
          >
            <span className={`h-2 w-2 rounded-full ${isLive ? "bg-green-500 animate-pulse" : "bg-muted-foreground"}`} />
            {isLive ? "LIVE" : "PAUSED"}
          </button>
        </div>
      </div>

      {/* Throughput Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border border-border/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Throughput (msg/s)</CardTitle>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-full bg-blue-500" /><span className="data-label">Kafka</span></div>
                <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-full bg-pink-500" /><span className="data-label">Fluvio</span></div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={throughputData}>
                <defs>
                  <linearGradient id="kafkaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="fluvioGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ec4899" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="t" tick={false} />
                <YAxis tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }} />
                <Tooltip contentStyle={{ fontSize: 11, fontFamily: "JetBrains Mono", background: "var(--card)", border: "1px solid var(--border)" }} />
                <Area type="monotone" dataKey="kafka" stroke="#2563eb" fill="url(#kafkaGrad)" strokeWidth={2} name="Kafka" />
                <Area type="monotone" dataKey="fluvio" stroke="#ec4899" fill="url(#fluvioGrad)" strokeWidth={2} name="Fluvio" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Topic Activity */}
        <Card className="border border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Topic Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(topicCounts).map(([topic, count]) => {
                const shortName = topic.split(".").slice(-1)[0].replace("_", " ");
                const Icon = TOPIC_ICONS[topic] ?? Activity;
                return (
                  <div key={topic} className="flex items-center gap-2">
                    <Icon className="h-3 w-3 shrink-0" style={{ color: TOPIC_COLORS[topic] }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="mono text-[10px] capitalize truncate">{shortName}</span>
                        <span className="mono text-[10px] font-semibold">{count as number}</span>
                      </div>
                      <div className="h-1 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${((count as number) / events.length) * 100}%`, background: TOPIC_COLORS[topic] }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Kafka Topics */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Kafka Topic Registry</CardTitle>
            <span className="layer-badge">KAFKA · 7-YEAR RETENTION</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  {["Topic", "Partitions", "Replication", "Msg Rate", "Consumer Lag", "Status"].map(h => (
                    <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kafkaTopics.map((topic) => (
                  <tr key={topic.name} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ background: TOPIC_COLORS[topic.name] }} />
                        <span className="mono font-medium">{topic.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 mono">{topic.partitions}</td>
                    <td className="px-4 py-2.5 mono">{topic.replication}x</td>
                    <td className="px-4 py-2.5 mono font-semibold text-green-600">{topic.msgRate}</td>
                    <td className="px-4 py-2.5">
                      <span className={`mono text-[10px] font-semibold ${topic.lag === 0 ? "text-green-600" : "text-yellow-500"}`}>{topic.lag === 0 ? "0 (healthy)" : `${topic.lag} msgs`}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        <span className="mono text-[10px] text-green-600">ACTIVE</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Live Event Feed */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Live Event Feed</CardTitle>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${isLive ? "bg-green-500 animate-pulse" : "bg-muted-foreground"}`} />
              <span className="data-label">{events.length} events</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border/60 bg-card">
                  {["Timestamp", "Topic", "Key", "Part", "Offset", "Latency", "Payload"].map(h => (
                    <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((event, i) => (
                  <tr key={event.id} className={`border-b border-border/20 hover:bg-muted/20 transition-colors ${i === 0 && isLive ? "bg-primary/5" : ""}`}>
                    <td className="px-4 py-1.5 mono text-muted-foreground">{new Date(event.timestamp).toLocaleTimeString()}</td>
                    <td className="px-4 py-1.5">
                      <span className="mono text-[9px] font-semibold" style={{ color: TOPIC_COLORS[event.topic] }}>
                        {event.topic.split(".").slice(-1)[0].toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-1.5 mono text-muted-foreground">{event.key}</td>
                    <td className="px-4 py-1.5 mono">{event.partition}</td>
                    <td className="px-4 py-1.5 mono text-muted-foreground">{event.offset.toLocaleString()}</td>
                    <td className="px-4 py-1.5">
                      <span className={`mono text-[10px] ${event.latency < 10 ? "text-green-600" : event.latency < 30 ? "text-yellow-500" : "text-red-500"}`}>{event.latency}ms</span>
                    </td>
                    <td className="px-4 py-1.5 mono text-muted-foreground truncate max-w-[240px]">{event.payload}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
