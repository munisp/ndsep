import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, Shield, Network, Radio,
  Server, Cpu, Clock, ArrowLeft, RefreshCw, Zap, Eye, Bell, GitBranch,
  Workflow, Globe, BarChart3, Timer, TrendingUp, Loader2,
} from "lucide-react";
import { Link } from "wouter";
import { Breadcrumbs } from "@/components/Breadcrumbs";

// ── Helper ───────────────────────────────────────────────────────────────────

function val<T>(data: unknown): T {
  return data as T;
}

const severityColor: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  info: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

const statusColor: Record<string, string> = {
  up: "bg-emerald-500/20 text-emerald-400",
  down: "bg-red-500/20 text-red-400",
  degraded: "bg-yellow-500/20 text-yellow-400",
  healthy: "bg-emerald-500/20 text-emerald-400",
  unhealthy: "bg-red-500/20 text-red-400",
  open: "bg-red-500/20 text-red-400",
  acknowledged: "bg-blue-500/20 text-blue-400",
  escalated: "bg-orange-500/20 text-orange-400",
  resolved: "bg-emerald-500/20 text-emerald-400",
};

// ── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data: dashboard } = trpc.noc.dashboard.useQuery();
  const { data: alertStats } = trpc.noc.alertStats.useQuery();
  const { data: intelFeed } = trpc.intelAggregator.nocFeed.useQuery(undefined, { refetchInterval: 60_000 });
  const stats = val<Record<string, number>>(alertStats);
  const dboard = val<Record<string, unknown>>(dashboard);

  return (
    <div className="space-y-6">
        <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "NOC Dashboard" }]} />
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-red-400" />
            <p className="text-3xl font-bold text-red-400">{stats?.critical_active ?? 0}</p>
            <p className="text-xs text-muted-foreground">Critical Alerts</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <Shield className="w-8 h-8 mx-auto mb-2 text-orange-400" />
            <p className="text-3xl font-bold text-orange-400">{stats?.high_active ?? 0}</p>
            <p className="text-xs text-muted-foreground">High Alerts</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
            <p className="text-3xl font-bold text-emerald-400">{stats?.resolved ?? 0}</p>
            <p className="text-xs text-muted-foreground">Resolved (24h)</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <GitBranch className="w-8 h-8 mx-auto mb-2 text-blue-400" />
            <p className="text-3xl font-bold text-blue-400">{stats?.correlated ?? 0}</p>
            <p className="text-xs text-muted-foreground">Correlated</p>
          </CardContent>
        </Card>
      </div>

      {/* Subsystem Health */}
      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-sm">NOC Subsystem Health</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {["collector", "escalation", "correlator", "uptime"].map((sub) => {
              const health = (dboard?.subsystems as Record<string, Record<string, unknown>> | undefined)?.[sub];
              const st = String(health?.status ?? "unknown");
              return (
                <div key={sub} className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                  <div className={`w-3 h-3 rounded-full ${st === "healthy" ? "bg-emerald-500" : "bg-red-500"}`} />
                  <div>
                    <p className="text-sm font-medium capitalize">{sub}</p>
                    <p className="text-xs text-muted-foreground">{st}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Middleware Health */}
      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-sm">Middleware Infrastructure</CardTitle></CardHeader>
        <CardContent>
          {dboard?.middleware ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(val<{ services: Array<{ name: string; status: string; latencyMs: number }> }>(dboard.middleware)).services?.map((svc) => (
                <div key={svc.name} className="flex items-center gap-2 p-2 rounded bg-muted/40">
                  <div className={`w-2 h-2 rounded-full ${svc.status === "healthy" ? "bg-emerald-500" : svc.status === "unconfigured" ? "bg-muted-foreground" : "bg-red-500"}`} />
                  <span className="text-xs">{svc.name}</span>
                  {svc.latencyMs > 0 && <span className="text-xs text-muted-foreground ml-auto">{svc.latencyMs}ms</span>}
                </div>
              ))}
            </div>
          ) : <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </CardContent>
      </Card>

      {/* Cross-Platform Threat Intelligence Feed */}
      {intelFeed && (
        <Card className="bg-card border-border border-l-4 border-l-primary/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                Cross-Platform Threat Feed
                <Badge variant="outline" className="text-xs mono ml-2">{intelFeed.totalAlerts} total</Badge>
              </CardTitle>
              <div className="flex items-center gap-2">
                {Object.entries(intelFeed.bySeverity).map(([sev, count]) => (
                  count > 0 ? <Badge key={sev} variant={sev === "critical" ? "destructive" : "outline"} className="text-xs mono">{count} {sev}</Badge> : null
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
              {Object.entries(intelFeed.bySource).map(([source, count]) => (
                <div key={source} className="flex items-center gap-1.5 p-2 rounded bg-muted/40 text-xs">
                  <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
                  <span className="text-foreground font-medium">{source.replace("_", " ")}</span>
                  <span className="text-muted-foreground ml-auto mono">{count as number}</span>
                </div>
              ))}
            </div>
            {/* Correlations */}
            {intelFeed.correlations.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border/30">
                <p className="text-xs font-medium text-foreground">Threat Correlations</p>
                {intelFeed.correlations.slice(0, 3).map((c: any) => (
                  <div key={c.id} className="flex items-start gap-2 p-2 rounded bg-destructive/5 border border-destructive/20">
                    <Badge variant="destructive" className="text-xs shrink-0 mt-0.5">{c.severity}</Badge>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">{c.title}</p>
                      <p className="text-xs text-muted-foreground">Sources: {c.sources.join(", ")} · Sectors: {c.affectedSectors.join(", ")}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Alerts Tab ───────────────────────────────────────────────────────────────

function AlertsTab() {
  const { data: alertsData } = trpc.noc.alerts.useQuery({ limit: 50 });
  const alerts = val<{ alerts: Array<Record<string, unknown>>; total: number }>(alertsData);

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> NOC Alerts ({alerts?.total ?? 0} total)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Severity</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Device</TableHead>
              <TableHead>First Seen</TableHead>
              <TableHead>Escalation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {alerts?.alerts?.slice(0, 30).map((a, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Badge className={severityColor[String(a.severity)] ?? ""}>{String(a.severity)}</Badge>
                </TableCell>
                <TableCell className="text-xs">{String(a.source)}</TableCell>
                <TableCell className="text-xs max-w-[200px] truncate">{String(a.title)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={statusColor[String(a.status)] ?? ""}>{String(a.status)}</Badge>
                </TableCell>
                <TableCell className="text-xs">{a.device_id ? String(a.device_id) : "—"}</TableCell>
                <TableCell className="text-xs">{a.first_seen ? new Date(String(a.first_seen)).toLocaleTimeString() : "—"}</TableCell>
                <TableCell className="text-xs">L{String(a.escalation_level ?? 0)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {(!alerts?.alerts || alerts.alerts.length === 0) && (
          <p className="text-center text-muted-foreground py-8 text-sm">No alerts in the last 24 hours</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Topology Tab ─────────────────────────────────────────────────────────────

function TopologyTab() {
  const { data: topology } = trpc.noc.topology.useQuery();
  const { data: devices } = trpc.noc.devices.useQuery({ limit: 50 });
  const topo = val<{ nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>>; nodeCount: number; edgeCount: number }>(topology);
  const devList = val<Array<Record<string, unknown>>>(devices);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <Server className="w-6 h-6 mx-auto mb-1 text-blue-400" />
            <p className="text-2xl font-bold">{topo?.nodeCount ?? devList?.length ?? 0}</p>
            <p className="text-xs text-muted-foreground">Devices</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <Network className="w-6 h-6 mx-auto mb-1 text-purple-400" />
            <p className="text-2xl font-bold">{topo?.edgeCount ?? 0}</p>
            <p className="text-xs text-muted-foreground">Links</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <Globe className="w-6 h-6 mx-auto mb-1 text-emerald-400" />
            <p className="text-2xl font-bold">
              {devList?.filter((d) => String(d.status) === "up").length ?? 0}
            </p>
            <p className="text-xs text-muted-foreground">Online</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-sm">Device Inventory</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hostname</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>CPU</TableHead>
                <TableHead>Memory</TableHead>
                <TableHead>Bandwidth In</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(devList ?? []).map((d, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{String(d.hostname)}</TableCell>
                  <TableCell className="font-mono text-xs">{String(d.ip_address)}</TableCell>
                  <TableCell className="text-xs">{String(d.device_type)}</TableCell>
                  <TableCell>
                    <Badge className={statusColor[String(d.status)] ?? ""}>{String(d.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{d.cpu_utilization ? `${Number(d.cpu_utilization).toFixed(1)}%` : "—"}</TableCell>
                  <TableCell className="text-xs">{d.memory_utilization ? `${Number(d.memory_utilization).toFixed(1)}%` : "—"}</TableCell>
                  <TableCell className="text-xs">{d.bandwidth_in_mbps ? `${Number(d.bandwidth_in_mbps).toFixed(0)} Mbps` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {(!devList || devList.length === 0) && (
            <p className="text-center text-muted-foreground py-8 text-sm">No devices registered — use SNMP discovery or register manually</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Uptime & SLA Tab ─────────────────────────────────────────────────────────

function UptimeTab() {
  const { data: uptimeData } = trpc.noc.uptimeLatest.useQuery();
  const { data: slaData } = trpc.noc.uptimeSla.useQuery();
  const uptime = val<{ total: number; up: number; down: number; services: Array<Record<string, unknown>> }>(uptimeData);
  const sla = val<{ total_services: number; sla_met: number; sla_breached: number; services: Array<Record<string, unknown>> }>(slaData);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <Activity className="w-6 h-6 mx-auto mb-1 text-emerald-400" />
            <p className="text-2xl font-bold text-emerald-400">{uptime?.up ?? 0}</p>
            <p className="text-xs text-muted-foreground">Services Up</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <XCircle className="w-6 h-6 mx-auto mb-1 text-red-400" />
            <p className="text-2xl font-bold text-red-400">{uptime?.down ?? 0}</p>
            <p className="text-xs text-muted-foreground">Services Down</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <CheckCircle2 className="w-6 h-6 mx-auto mb-1 text-emerald-400" />
            <p className="text-2xl font-bold text-emerald-400">{sla?.sla_met ?? 0}</p>
            <p className="text-xs text-muted-foreground">SLA Met</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <AlertTriangle className="w-6 h-6 mx-auto mb-1 text-orange-400" />
            <p className="text-2xl font-bold text-orange-400">{sla?.sla_breached ?? 0}</p>
            <p className="text-xs text-muted-foreground">SLA Breached</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-sm">Service Availability</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Response (ms)</TableHead>
                <TableHead>Port</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Language</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {uptime?.services?.map((s, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs font-medium">{String(s.service_name)}</TableCell>
                  <TableCell>
                    <Badge className={s.is_up ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}>
                      {s.is_up ? "UP" : "DOWN"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs font-mono">{Number(s.response_time_ms).toFixed(1)}</TableCell>
                  <TableCell className="text-xs">{String(s.port)}</TableCell>
                  <TableCell className="text-xs">{String(s.category)}</TableCell>
                  <TableCell className="text-xs">{String(s.language)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {(!uptime?.services || uptime.services.length === 0) && (
            <p className="text-center text-muted-foreground py-8 text-sm">Uptime tracker initializing — first probe cycle in progress</p>
          )}
        </CardContent>
      </Card>

      {sla?.services && sla.services.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader><CardTitle className="text-sm">SLA Compliance</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Availability %</TableHead>
                  <TableHead>Target %</TableHead>
                  <TableHead>SLA Met</TableHead>
                  <TableHead>Avg Response</TableHead>
                  <TableHead>P95</TableHead>
                  <TableHead>P99</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sla.services.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{String(s.service_name)}</TableCell>
                    <TableCell className="text-xs font-mono">{String(s.availability_pct)}%</TableCell>
                    <TableCell className="text-xs">{String(s.sla_target_pct)}%</TableCell>
                    <TableCell>
                      {s.sla_met ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-red-400" />}
                    </TableCell>
                    <TableCell className="text-xs font-mono">{String(s.avg_response_ms)}ms</TableCell>
                    <TableCell className="text-xs font-mono">{String(s.p95_response_ms)}ms</TableCell>
                    <TableCell className="text-xs font-mono">{String(s.p99_response_ms)}ms</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Escalation Tab ───────────────────────────────────────────────────────────

function EscalationTab() {
  const { data: policies } = trpc.noc.escalationPolicies.useQuery();
  const { data: schedules } = trpc.noc.onCallSchedules.useQuery();
  const { data: runbooksData } = trpc.noc.runbooks.useQuery();
  const { data: history } = trpc.noc.escalationHistory.useQuery();
  const { data: metrics } = trpc.noc.escalationMetrics.useQuery();
  const pols = val<Array<Record<string, unknown>>>(policies);
  const scheds = val<Array<Record<string, unknown>>>(schedules);
  const rbs = val<Array<Record<string, unknown>>>(runbooksData);
  const hist = val<{ count: number; history: Array<Record<string, unknown>> }>(history);
  const met = val<Record<string, unknown>>(metrics);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <Bell className="w-6 h-6 mx-auto mb-1 text-orange-400" />
            <p className="text-2xl font-bold">{Number(met?.alerts_escalated ?? 0)}</p>
            <p className="text-xs text-muted-foreground">Alerts Escalated</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <Workflow className="w-6 h-6 mx-auto mb-1 text-blue-400" />
            <p className="text-2xl font-bold">{Number(met?.runbooks_executed ?? 0)}</p>
            <p className="text-xs text-muted-foreground">Runbooks Executed</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <Zap className="w-6 h-6 mx-auto mb-1 text-purple-400" />
            <p className="text-2xl font-bold">{Number(met?.notifications_sent ?? 0)}</p>
            <p className="text-xs text-muted-foreground">Notifications Sent</p>
          </CardContent>
        </Card>
      </div>

      {/* Escalation Policies */}
      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-sm">Escalation Policies</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {(pols ?? []).map((p, i) => (
              <div key={i} className="p-3 rounded-lg bg-muted/50">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium text-sm">{String(p.policy_name)}</p>
                  <Badge variant="outline" className="text-xs">{String((p.severity_filter as string[])?.join(", "))}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{String(p.description)}</p>
                <div className="flex gap-2 mt-2">
                  {(p.escalation_levels as Array<Record<string, unknown>>)?.map((l, j) => (
                    <Badge key={j} variant="outline" className="text-xs">
                      L{String(l.level)} → {String(l.channel)} ({String(l.delay_minutes)}min)
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* On-Call Schedules */}
      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-sm">On-Call Schedules</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {(scheds ?? []).map((s, i) => (
              <div key={i} className="p-3 rounded-lg bg-muted/50">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium text-sm">{String(s.schedule_name)}</p>
                  <Badge className="bg-emerald-500/20 text-emerald-400">{String(s.rotation_type)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">Team: {String(s.team_name)} · Current: <span className="text-emerald-400 font-medium">{String(s.current_oncall)}</span></p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Runbooks */}
      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-sm">Runbooks</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Auto-Execute</TableHead>
                <TableHead>Steps</TableHead>
                <TableHead>Executions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rbs ?? []).map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{String(r.name)}</TableCell>
                  <TableCell>{r.auto_execute ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-muted-foreground" />}</TableCell>
                  <TableCell className="text-xs">{(r.steps as unknown[])?.length ?? 0}</TableCell>
                  <TableCell className="text-xs">{String(r.execution_count ?? 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Collectors Tab ───────────────────────────────────────────────────────────

function CollectorsTab() {
  const { data: collectorMetrics } = trpc.noc.collectorMetrics.useQuery();
  const { data: traps } = trpc.noc.snmpTraps.useQuery();
  const { data: syslog } = trpc.noc.syslogMessages.useQuery();
  const { data: bandwidth } = trpc.noc.bandwidthSummary.useQuery();
  const met = val<Record<string, Record<string, number>>>(collectorMetrics);
  const trapData = val<{ count: number; traps: Array<Record<string, unknown>> }>(traps);
  const syslogData = val<{ count: number; messages: Array<Record<string, unknown>> }>(syslog);
  const bw = val<Record<string, unknown>>(bandwidth);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <Radio className="w-6 h-6 mx-auto mb-1 text-blue-400" />
            <p className="text-2xl font-bold">{met?.snmp?.traps_received ?? 0}</p>
            <p className="text-xs text-muted-foreground">SNMP Traps</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <Eye className="w-6 h-6 mx-auto mb-1 text-purple-400" />
            <p className="text-2xl font-bold">{met?.syslog?.messages_received ?? 0}</p>
            <p className="text-xs text-muted-foreground">Syslog Messages</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <BarChart3 className="w-6 h-6 mx-auto mb-1 text-emerald-400" />
            <p className="text-2xl font-bold">{met?.netflow?.records_received ?? 0}</p>
            <p className="text-xs text-muted-foreground">NetFlow Records</p>
          </CardContent>
        </Card>
      </div>

      {/* Bandwidth Summary */}
      {bw && (
        <Card className="bg-card border-border">
          <CardHeader><CardTitle className="text-sm">Bandwidth Summary</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xl font-bold">{Number(bw.total_bytes ?? 0).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Total Bytes</p>
              </div>
              <div>
                <p className="text-xl font-bold">{Number(bw.total_packets ?? 0).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Total Packets</p>
              </div>
              <div>
                <p className="text-xl font-bold">{Number(bw.total_flows ?? 0)}</p>
                <p className="text-xs text-muted-foreground">Total Flows</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent SNMP Traps */}
      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-sm">Recent SNMP Traps ({trapData?.count ?? 0})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source IP</TableHead>
                <TableHead>OID Name</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trapData?.traps?.slice(0, 10).map((t, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{String(t.source_ip)}</TableCell>
                  <TableCell className="text-xs">{String(t.oid_name)}</TableCell>
                  <TableCell><Badge className={severityColor[String(t.severity)] ?? ""}>{String(t.severity)}</Badge></TableCell>
                  <TableCell className="text-xs max-w-[150px] truncate">{String(t.value)}</TableCell>
                  <TableCell className="text-xs">{t.timestamp ? new Date(String(t.timestamp)).toLocaleTimeString() : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Recent Syslog */}
      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-sm">Recent Syslog ({syslogData?.count ?? 0})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Hostname</TableHead>
                <TableHead>App</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {syslogData?.messages?.slice(0, 10).map((m, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{String(m.source_ip)}</TableCell>
                  <TableCell className="text-xs">{String(m.hostname)}</TableCell>
                  <TableCell className="text-xs">{String(m.app_name)}</TableCell>
                  <TableCell className="text-xs">{String(m.severity)}</TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate">{String(m.message)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Correlation Tab ──────────────────────────────────────────────────────────

function CorrelationTab() {
  const { data: patterns } = trpc.noc.correlationPatterns.useQuery();
  const { data: incidents } = trpc.noc.correlatedIncidents.useQuery();
  const { data: correlatorMet } = trpc.noc.correlatorMetrics.useQuery();
  const pats = val<{ count: number; patterns: Array<Record<string, unknown>> }>(patterns);
  const incs = val<{ count: number; incidents: Array<Record<string, unknown>> }>(incidents);
  const met = val<Record<string, number>>(correlatorMet);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <TrendingUp className="w-6 h-6 mx-auto mb-1 text-blue-400" />
            <p className="text-2xl font-bold">{met?.alerts_processed ?? 0}</p>
            <p className="text-xs text-muted-foreground">Alerts Processed</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <GitBranch className="w-6 h-6 mx-auto mb-1 text-purple-400" />
            <p className="text-2xl font-bold">{met?.correlations_created ?? 0}</p>
            <p className="text-xs text-muted-foreground">Correlations</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <AlertTriangle className="w-6 h-6 mx-auto mb-1 text-red-400" />
            <p className="text-2xl font-bold">{met?.incidents_created ?? 0}</p>
            <p className="text-xs text-muted-foreground">Incidents</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 text-center">
            <Timer className="w-6 h-6 mx-auto mb-1 text-emerald-400" />
            <p className="text-2xl font-bold">{met?.window_size ?? 0}</p>
            <p className="text-xs text-muted-foreground">Window Size</p>
          </CardContent>
        </Card>
      </div>

      {/* Causal Patterns */}
      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-sm">Causal Correlation Patterns ({pats?.count ?? 0})</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {pats?.patterns?.map((p, i) => (
              <div key={i} className="p-3 rounded-lg bg-muted/50">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium text-sm">{String(p.name)}</p>
                  <Badge className={severityColor[String(p.severity)] ?? ""}>{String(p.severity)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{String(p.root_cause)}</p>
                <p className="text-xs mt-1">Trigger: <code className="bg-muted px-1 rounded">{JSON.stringify(p.trigger)}</code> → {String(p.effects_count)} effects</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Correlated Incidents */}
      <Card className="bg-card border-border">
        <CardHeader><CardTitle className="text-sm">Correlated Incidents ({incs?.count ?? 0})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Correlation ID</TableHead>
                <TableHead>Alert Count</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Sources</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incs?.incidents?.map((inc, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{String(inc.correlation_id).slice(0, 16)}</TableCell>
                  <TableCell className="text-xs">{String(inc.alert_count)}</TableCell>
                  <TableCell><Badge className={severityColor[String(inc.max_severity)] ?? ""}>{String(inc.max_severity)}</Badge></TableCell>
                  <TableCell className="text-xs">{(inc.sources as string[])?.join(", ")}</TableCell>
                  <TableCell className="text-xs">{inc.started ? new Date(String(inc.started)).toLocaleString() : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {(!incs?.incidents || incs.incidents.length === 0) && (
            <p className="text-center text-muted-foreground py-8 text-sm">No correlated incidents — correlator is analyzing incoming alerts</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function NocDashboard() {
  const [tab, setTab] = useState("overview");

  return (
    <div className="p-6 space-y-6 min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Cpu className="w-6 h-6 text-blue-400" /> Network Operations Center
            </h1>
            <p className="text-muted-foreground text-sm">Unified NOC dashboard — real-time infrastructure monitoring, alerting, and incident management</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="topology">Topology & Devices</TabsTrigger>
          <TabsTrigger value="uptime">Uptime & SLA</TabsTrigger>
          <TabsTrigger value="escalation">Escalation</TabsTrigger>
          <TabsTrigger value="collectors">Collectors</TabsTrigger>
          <TabsTrigger value="correlation">Correlation</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="alerts"><AlertsTab /></TabsContent>
        <TabsContent value="topology"><TopologyTab /></TabsContent>
        <TabsContent value="uptime"><UptimeTab /></TabsContent>
        <TabsContent value="escalation"><EscalationTab /></TabsContent>
        <TabsContent value="collectors"><CollectorsTab /></TabsContent>
        <TabsContent value="correlation"><CorrelationTab /></TabsContent>
      </Tabs>
    </div>
  );
}
