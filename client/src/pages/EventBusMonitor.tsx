/**
 * Event Bus Monitor
 * ─────────────────────────────────────────────────────────────────────────────
 * Live dashboard for the NDSEP Event Bus (Kafka + Fluvio).
 * Shows topic throughput, allows manual event publishing, and displays the
 * last 50 events received by the streaming pipeline.
 */

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Zap, RefreshCw, Send, Activity, Radio, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
// ── Topic registry ─────────────────────────────────────────────────────────────
const KNOWN_TOPICS = [
  { id: "ndsep.penalty.issued", label: "Penalty Issued", layer: "FIN", description: "Fired when a financial penalty is created" },
  { id: "ndsep.violation.detected", label: "Violation Detected", layer: "L3", description: "Fired when a compliance violation is recorded" },
  { id: "ndsep.enforcement.case.opened", label: "Enforcement Case Opened", layer: "ENF", description: "Fired when an enforcement case is created" },
  { id: "ndsep.citizen.rights.request", label: "Citizen Rights Request", layer: "CIT", description: "Fired when a citizen submits a rights request" },
  { id: "ndsep.bgp.anomaly", label: "BGP Anomaly", layer: "L1", description: "Fired when a BGP route anomaly is detected" },
  { id: "ndsep.siem.alert", label: "SIEM Alert", layer: "L4", description: "Fired when a SIEM alert is triggered" },
  { id: "ndsep.orchestration.workflow", label: "Workflow Triggered", layer: "WF", description: "Fired when a Temporal workflow is started" },
  { id: "ndsep.audit.log", label: "Audit Log Entry", layer: "LOG", description: "Fired for every auditable action on the platform" },
  { id: "ndsep.canary", label: "Canary / Smoke Test", layer: "SYS", description: "Used for connectivity smoke-tests" },
];

const LAYER_COLORS: Record<string, string> = {
  FIN: "bg-emerald-500/20 text-emerald-400",
  L3: "bg-blue-500/20 text-blue-400",
  ENF: "bg-orange-500/20 text-orange-400",
  CIT: "bg-purple-500/20 text-purple-400",
  L1: "bg-red-500/20 text-red-400",
  L4: "bg-yellow-500/20 text-yellow-400",
  WF: "bg-cyan-500/20 text-cyan-400",
  LOG: "bg-muted0/20 text-muted-foreground",
  SYS: "bg-muted0/20 text-muted-foreground",
};

function StatusDot({ healthy }: { healthy: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${healthy ? "bg-emerald-400" : "bg-red-400"}`}
    />
  );
}

function TopicRow({ topic, events }: { topic: typeof KNOWN_TOPICS[0]; events: any[] }) {
  const topicEvents = events.filter((e: any) => e.topic === topic.id || e.eventType?.includes(topic.id.split(".").pop() ?? ""));
  const lastEvent = topicEvents[0];
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/30 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${LAYER_COLORS[topic.layer] ?? "bg-muted text-muted-foreground"}`}>
            {topic.layer}
          </span>
          <span className="text-sm font-medium truncate">{topic.label}</span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{topic.id}</p>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-semibold tabular-nums">{topicEvents.length}</div>
        <div className="text-[10px] text-muted-foreground">events</div>
      </div>
      {lastEvent && (
        <div className="text-right shrink-0 hidden sm:block">
          <div className="text-[10px] text-muted-foreground">
            {new Date(lastEvent.createdAt ?? lastEvent.timestamp ?? Date.now()).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}

export default function EventBusMonitor() {
  // ── Data queries ─────────────────────────────────────────────────────────────
  const { data: kafkaStatus, refetch: refetchKafka, isFetching: kafkaFetching } =
    trpc.streaming.kafkaStatus.useQuery(undefined, { refetchInterval: 15_000 });

  const { data: eventBusStatus, refetch: refetchEventBus, isFetching: ebFetching } =
    trpc.orchestration.eventBusStatus.useQuery(undefined, { refetchInterval: 15_000 });

  const { data: topicStats, refetch: refetchTopics } =
    trpc.streaming.topicStats.useQuery(undefined, { refetchInterval: 15_000 });

  const { data: recentEvents, refetch: refetchEvents } =
    trpc.streaming.events.useQuery({ limit: 50 }, { refetchInterval: 10_000 });

  const { data: keycloakHealth } =
    trpc.orchestration.keycloakHealth.useQuery(undefined, { refetchInterval: 30_000 });

  // ── Publish form state ────────────────────────────────────────────────────────
  const [selectedTopic, setSelectedTopic] = useState(KNOWN_TOPICS[0].id);
  const [payload, setPayload] = useState(JSON.stringify({ test: true, source: "event-bus-monitor", ts: new Date().toISOString() }, null, 2));
  const [publishing, setPublishing] = useState(false);

  const publishMutation = trpc.orchestration.eventBusPublish.useMutation({
    onSuccess: (data: any) => {
      if (data?.success) {
        toast.success("Event published successfully", { description: `Topic: ${selectedTopic}` });
        refetchEvents();
        refetchTopics();
      } else {
        toast.error("Publish failed", { description: data?.error ?? "Unknown error" });
      }
      setPublishing(false);
    },
    onError: (err: any) => {
      toast.error("Publish failed", { description: err.message });
      setPublishing(false);
    },
  });

  const kafkaSmokeTestMutation = trpc.streaming.kafkaSmokeTest.useMutation({
    onSuccess: (data: any) => {
      if (data?.success) {
        toast.success("Kafka smoke test passed", { description: `Latency: ${data.latencyMs}ms` });
      } else {
        toast.error("Kafka smoke test failed", { description: data?.error ?? "Unreachable" });
      }
    },
    onError: (err: any) => toast.error("Smoke test error", { description: err.message }),
  });

  const handlePublish = useCallback(() => {
    try {
      const parsed = JSON.parse(payload);
      setPublishing(true);
      publishMutation.mutate({ topic: selectedTopic, event: parsed });
    } catch {
      toast.error("Invalid JSON payload");
    }
  }, [payload, selectedTopic, publishMutation]);

  const handleRefreshAll = useCallback(() => {
    refetchKafka();
    refetchEventBus();
    refetchTopics();
    refetchEvents();
  }, [refetchKafka, refetchEventBus, refetchTopics, refetchEvents]);

  const events = (recentEvents as any[]) ?? [];
  const stats = topicStats as any;
  const kafkaConnected = (kafkaStatus as any)?.connected ?? false;
  const ebConnected = (eventBusStatus as any)?.status === "healthy";

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Event Bus Monitor" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Zap className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Event Bus Monitor</h1>
            <p className="text-sm text-muted-foreground">Live Kafka + Fluvio event stream — NDSEP messaging backbone</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefreshAll} disabled={kafkaFetching || ebFetching}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${(kafkaFetching || ebFetching) ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <StatusDot healthy={kafkaConnected} />
              <span className="text-xs font-medium text-muted-foreground">Kafka Broker</span>
            </div>
            <p className="text-lg font-semibold">{kafkaConnected ? "Connected" : "Degraded"}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {(kafkaStatus as any)?.brokers ?? "N/A"} broker{(kafkaStatus as any)?.brokers !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <StatusDot healthy={ebConnected} />
              <span className="text-xs font-medium text-muted-foreground">Event Bus</span>
            </div>
            <p className="text-lg font-semibold">{ebConnected ? "Healthy" : "Unreachable"}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {(eventBusStatus as any)?.topicsRegistered ?? 0} topics registered
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Recent Events</span>
            </div>
            <p className="text-lg font-semibold">{events.length}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">last 50 in pipeline</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <StatusDot healthy={(keycloakHealth as any)?.healthy ?? false} />
              <span className="text-xs font-medium text-muted-foreground">Keycloak SSO</span>
            </div>
            <p className="text-lg font-semibold">{(keycloakHealth as any)?.healthy ? "Online" : "Offline"}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Realm: {(keycloakHealth as any)?.realm ?? "ndsep"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Topic Registry */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Radio className="h-4 w-4 text-muted-foreground" />
              Topic Registry
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {KNOWN_TOPICS.map(topic => (
              <TopicRow key={topic.id} topic={topic} events={events} />
            ))}
            {stats && (
              <div className="mt-3 pt-3 border-t border-border/30">
                <p className="text-[10px] text-muted-foreground">
                  Total messages in pipeline: <span className="font-semibold text-foreground">{stats.totalMessages ?? 0}</span>
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right column: Publish + Event Log */}
        <div className="lg:col-span-2 space-y-6">
          {/* Manual Publish Panel */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Send className="h-4 w-4 text-muted-foreground" />
                Publish Event
                <Badge variant="outline" className="ml-auto text-[9px]">Admin</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Topic</Label>
                  <Select value={selectedTopic} onValueChange={setSelectedTopic}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KNOWN_TOPICS.map(t => (
                        <SelectItem key={t.id} value={t.id} className="text-xs">
                          <span className={`text-[9px] font-bold mr-1.5 px-1 py-0.5 rounded ${LAYER_COLORS[t.layer] ?? ""}`}>{t.layer}</span>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    {KNOWN_TOPICS.find(t => t.id === selectedTopic)?.description}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Actions</Label>
                  <div className="flex flex-col gap-2">
                    <Button
                      size="sm"
                      className="w-full h-8 text-xs"
                      onClick={handlePublish}
                      disabled={publishing}
                    >
                      <Send className="h-3 w-3 mr-1.5" />
                      {publishing ? "Publishing…" : "Publish Event"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-8 text-xs"
                      onClick={() => kafkaSmokeTestMutation.mutate()}
                      disabled={kafkaSmokeTestMutation.isPending}
                    >
                      <Zap className="h-3 w-3 mr-1.5" />
                      {kafkaSmokeTestMutation.isPending ? "Testing…" : "Kafka Smoke Test"}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">JSON Payload</Label>
                <Textarea
                  className="font-mono text-xs h-28 resize-none"
                  value={payload}
                  onChange={e => setPayload(e.target.value)}
                  placeholder='{ "key": "value" }'
                />
              </div>
            </CardContent>
          </Card>

          {/* Event Log */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Recent Events
                <Badge variant="secondary" className="ml-auto text-[9px]">{events.length} events</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {events.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No events in the pipeline yet. Publish an event or wait for platform activity.
                </div>
              ) : (
                <div className="space-y-0 max-h-80 overflow-y-auto">
                  {events.map((event: any, idx: number) => (
                    <div key={event.id ?? idx} className="flex items-start gap-2 py-2 border-b border-border/20 last:border-0">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium truncate">{event.eventType ?? event.topic ?? "unknown"}</span>
                          {event.source && (
                            <span className="text-[9px] text-muted-foreground shrink-0">{event.source}</span>
                          )}
                        </div>
                        {event.payload && (
                          <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                            {typeof event.payload === "string" ? event.payload : JSON.stringify(event.payload)}
                          </p>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {new Date(event.createdAt ?? event.timestamp ?? Date.now()).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
