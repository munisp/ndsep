import { trpc } from "@/lib/trpc";
import { useNdsepSocket } from "@/hooks/useNdsepSocket";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts";
import { Shield, AlertTriangle, Eye, FileSearch, Activity, CheckCircle2, XCircle, Radio, Zap, ChevronLeft, ChevronRight, Download, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRef, useState } from "react";

const SEV_COLORS: Record<string, string> = {
  critical: "#ef4444", high: "#f97316", medium: "#f59e0b", low: "#10b981", info: "#2563eb"
};

const ALERT_TYPE_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#8b5cf6", "#ec4899", "#2563eb", "#10b981", "#06b6d4"];

export default function SIEMAudit() {
  const utils = trpc.useUtils();
  const { data: alerts } = trpc.siem.alerts.useQuery({ limit: 50 });
  const resolveAlertMutation = trpc.siem.resolveAlert.useMutation({
    onSuccess: () => utils.siem.alerts.invalidate(),
  });
  const { data: auditLogs } = trpc.siem.auditLogs.useQuery({ limit: 30 });
  const { data: threatIntel } = trpc.siem.threatIntel.useQuery({ limit: 20 });
  const { data: alertTrendRaw } = trpc.siem.alertTrend.useQuery();
  const { data: alertTypeRaw } = trpc.siem.alertTypeBreakdown.useQuery();
  const alertTrendData = (alertTrendRaw ?? []).map((r: any) => ({
    time: r.time,
    critical: Number(r.critical ?? 0),
    high: Number(r.high ?? 0),
    medium: Number(r.medium ?? 0),
    low: Number(r.low ?? 0),
  }));
  const threatIntelData = (alertTypeRaw ?? []).map((r: any, i: number) => ({
    category: r.category?.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
    count: Number(r.count ?? 0),
    color: ALERT_TYPE_COLORS[i % ALERT_TYPE_COLORS.length],
  }));

  const [liveAlerts, setLiveAlerts] = useState<any[]>([]);
  const liveAlertsRef = useRef<any[]>([]);
  const [alertPage, setAlertPage] = useState(0);
  const [logPage, setLogPage] = useState(0);
  const [alertSearch, setAlertSearch] = useState("");
  const [alertFilterSev, setAlertFilterSev] = useState("");
  const [alertFilterResolved, setAlertFilterResolved] = useState("");
  const [selectedAlertIds, setSelectedAlertIds] = useState<Set<number>>(new Set());

  const bulkResolveMutation = trpc.siem.bulkResolveAlerts.useMutation({
    onSuccess: (data) => {
      utils.siem.alerts.invalidate();
      setSelectedAlertIds(new Set());
    },
    onError: () => {},
  });

  const [showCreateAlert, setShowCreateAlert] = useState(false);
  const [alertForm, setAlertForm] = useState({ organizationId: "", severity: "medium", alertType: "", title: "", description: "" });
  const createAlertMutation = trpc.siem.createAlert.useMutation({
    onSuccess: () => { utils.siem.alerts.invalidate(); setShowCreateAlert(false); setAlertForm({ organizationId: "", severity: "medium", alertType: "", title: "", description: "" }); },
    onError: (e) => {},
  });

  const SIEM_PAGE_SIZE = 15;

  const { connected, recentAlerts, eventCount } = useNdsepSocket({
    rooms: ["siem"],
    onEvent: (event) => {
      if (event.type === "new_alert") {
        utils.siem.alerts.invalidate();
        const newAlert = {
          ...event.payload,
          liveId: `${Date.now()}-${Math.random()}`,
          receivedAt: new Date().toISOString(),
        };
        liveAlertsRef.current = [newAlert, ...liveAlertsRef.current].slice(0, 30);
        setLiveAlerts([...liveAlertsRef.current]);
      }
    },
  });

  const alertsBySev = (alerts ?? []).reduce((acc: any, a: any) => {
    acc[a.severity] = (acc[a.severity] ?? 0) + 1;
    return acc;
  }, {});

  const unresolvedCount = (alerts ?? []).filter((a: any) => !a.isResolved).length;
  const criticalCount = (alerts ?? []).filter((a: any) => a.severity === "critical" && !a.isResolved).length;

  return (
    <>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="layer-badge">LAYER 4</span>
            <span className="data-label">Wazuh · Elastic SIEM · OpenSearch · OpenCTI</span>
          </div>
          <h1 className="text-2xl font-bold">SIEM & Audit Trail</h1>
          <p className="text-muted-foreground mono text-sm mt-0.5">Continuous monitoring · Anomaly detection · Threat intelligence · 7-year audit log retention</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full inline-block ${connected ? "bg-green-500 animate-pulse" : "bg-yellow-500"}`} />
          <span className={`data-label ${connected ? "text-green-600" : "text-yellow-600"}`}>{connected ? "WS LIVE" : "CONNECTING"}</span>
          <span className="h-2 w-2 rounded-full bg-red-500 inline-block animate-pulse ml-2" />
          <span className="data-label text-red-500">{criticalCount} CRITICAL</span>
          {eventCount > 0 && <span className="data-label text-muted-foreground">· {eventCount} events</span>}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Alerts", value: alerts?.length ?? 0, icon: AlertTriangle, color: "#f59e0b" },
          { label: "Unresolved", value: unresolvedCount, icon: XCircle, color: "#ef4444" },
          { label: "Critical Active", value: criticalCount, icon: Shield, color: "#ef4444" },
          { label: "Audit Log Entries", value: auditLogs?.length ?? 0, icon: FileSearch, color: "#2563eb" },
        ].map((m) => (
          <Card key={m.label} className="border border-border/60 relative overflow-hidden">
            <div className="absolute inset-0 blueprint-grid opacity-20" />
            <CardContent className="relative p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="data-label">{m.label}</p>
                  <p className="metric-value text-2xl font-bold mt-1">{m.value.toLocaleString()}</p>
                </div>
                <m.icon className="h-6 w-6 opacity-60" style={{ color: m.color }} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Alert Trend + Threat Intel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Alert Volume (24h)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={alertTrendData}>
                <defs>
                  {["critical", "high", "medium", "low"].map((sev) => (
                    <linearGradient key={sev} id={`grad_${sev}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={SEV_COLORS[sev]} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={SEV_COLORS[sev]} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                <Tooltip contentStyle={{ fontSize: 11, fontFamily: "JetBrains Mono", background: "var(--card)", border: "1px solid var(--border)" }} />
                {["critical", "high", "medium", "low"].map((sev) => (
                  <Area key={sev} type="monotone" dataKey={sev} stroke={SEV_COLORS[sev]} fill={`url(#grad_${sev})`} strokeWidth={1.5} name={sev.toUpperCase()} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Threat Intelligence</CardTitle>
              <span className="layer-badge">OPENCTI</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {threatIntelData.map((item) => (
                <div key={item.category}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="data-label">{item.category}</span>
                    <span className="mono text-xs font-semibold">{item.count}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(item.count / 60) * 100}%`, background: item.color }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 p-2 bg-muted/40 rounded border border-border/40">
              <p className="data-label mb-1">OpenCTI Feeds</p>
              {["MITRE ATT&CK", "AlienVault OTX", "Abuse.ch", "CISA KEV"].map((feed) => (
                <div key={feed} className="flex items-center gap-1.5 mt-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  <span className="mono text-[10px] text-muted-foreground">{feed}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Security Alerts Table */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Security Alerts</CardTitle>
            <div className="flex items-center gap-2">
              <span className="layer-badge">WAZUH · OPENSEARCH</span>
              <span className="data-label">{alerts?.length ?? 0} alerts</span>
              <Button size="sm" className="gap-1 h-7 text-xs bg-red-600 hover:bg-red-700 text-foreground" onClick={() => setShowCreateAlert(true)}><Plus className="h-3 w-3" /> Create Alert</Button>
              <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => {
                const headers = ["ID","Severity","Title","Source","Organization","MITRE Tactic","Detected At","Resolved"];
                const rows = (alerts ?? []).map((a: any) => [a.id,a.severity,`"${(a.title ?? "").replace(/"/g, "'")}"`,a.source ?? "",a.organizationId ?? "",a.mitreTactic ?? "",a.detectedAt ? new Date(a.detectedAt).toISOString() : "",a.isResolved ? "yes" : "no"].join(","));
                const csv = [headers.join(","), ...rows].join("\n");
                const el = document.createElement("a"); el.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); el.download = "siem-alerts.csv"; el.click();
              }}><Download className="h-3 w-3" /> Export CSV</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Bulk Resolve bar */}
          {selectedAlertIds.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/30">
              <span className="mono text-xs text-yellow-600">{selectedAlertIds.size} alert{selectedAlertIds.size !== 1 ? "s" : ""} selected</span>
              <Button size="sm" variant="outline" className="h-6 text-xs gap-1 border-yellow-500/40 text-yellow-600 hover:bg-yellow-500/20" onClick={() => bulkResolveMutation.mutate({ alertIds: Array.from(selectedAlertIds) })} disabled={bulkResolveMutation.isPending}>
                <CheckCircle2 className="h-3 w-3" />{bulkResolveMutation.isPending ? "Resolving..." : "Bulk Resolve"}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-xs text-muted-foreground" onClick={() => setSelectedAlertIds(new Set())}>Clear selection</Button>
            </div>
          )}
          {/* Search + Filter bar */}
          <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-border/40">
            <div className="relative flex-1 min-w-[180px]">
              <Shield className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search title, source, MITRE tactic..." value={alertSearch} onChange={e => { setAlertSearch(e.target.value); setAlertPage(0); }} className="pl-8 h-7 text-xs" />
            </div>
            <Select value={alertFilterSev || "__all__"} onValueChange={v => { setAlertFilterSev(v === "__all__" ? "" : v); setAlertPage(0); }}>
              <SelectTrigger className="h-7 text-xs w-28"><SelectValue placeholder="Severity" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-xs">All severities</SelectItem>
                {["critical","high","medium","low","info"].map(s => <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={alertFilterResolved || "__all__"} onValueChange={v => { setAlertFilterResolved(v === "__all__" ? "" : v); setAlertPage(0); }}>
              <SelectTrigger className="h-7 text-xs w-28"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-xs">All statuses</SelectItem>
                <SelectItem value="open" className="text-xs">Open</SelectItem>
                <SelectItem value="resolved" className="text-xs">Resolved</SelectItem>
              </SelectContent>
            </Select>
            {(alertSearch || alertFilterSev || alertFilterResolved) && (
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => { setAlertSearch(""); setAlertFilterSev(""); setAlertFilterResolved(""); setAlertPage(0); }}>Clear</Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" className="h-3 w-3 accent-yellow-500" checked={selectedAlertIds.size > 0} onChange={(e) => {
                      const unresolved = (alerts ?? []).filter((a: any) => !a.isResolved);
                      setSelectedAlertIds(e.target.checked ? new Set(unresolved.map((a: any) => a.id)) : new Set());
                    }} />
                  </th>
                  {["Severity", "Title", "Source", "Organization", "MITRE ATT&CK", "Detected", "Status"].map(h => (
                    <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(alerts ?? []).filter((a: any) => {
                    const q = alertSearch.toLowerCase();
                    const matchSearch = !q || (a.title ?? "").toLowerCase().includes(q) || (a.source ?? "").toLowerCase().includes(q) || (a.mitreTactic ?? "").toLowerCase().includes(q);
                    const matchSev = !alertFilterSev || a.severity === alertFilterSev;
                    const matchResolved = !alertFilterResolved || (alertFilterResolved === "resolved" ? a.isResolved : !a.isResolved);
                    return matchSearch && matchSev && matchResolved;
                  }).slice(alertPage * SIEM_PAGE_SIZE, (alertPage + 1) * SIEM_PAGE_SIZE).map((alert: any) => (
                  <tr key={alert.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2.5">
                      {!alert.isResolved && (
                        <input type="checkbox" className="h-3 w-3 accent-yellow-500" checked={selectedAlertIds.has(alert.id)} onChange={(e) => {
                          setSelectedAlertIds(prev => { const next = new Set(prev); e.target.checked ? next.add(alert.id) : next.delete(alert.id); return next; });
                        }} />
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="mono text-[9px] capitalize" style={{ borderColor: SEV_COLORS[alert.severity] + "60", color: SEV_COLORS[alert.severity] }}>
                        {alert.severity}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 font-medium truncate max-w-[180px]">{alert.title}</td>
                    <td className="px-4 py-2.5 mono text-muted-foreground capitalize">{alert.source?.replace("_", " ")}</td>
                    <td className="px-4 py-2.5 mono text-muted-foreground">Org #{alert.organizationId}</td>
                    <td className="px-4 py-2.5 mono text-[10px] text-muted-foreground">{alert.mitreTactic ?? "—"}</td>
                    <td className="px-4 py-2.5 mono text-muted-foreground">{alert.detectedAt ? new Date(alert.detectedAt).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-2.5">
                      {alert.isResolved ? (
                        <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-600" /><span className="mono text-[10px] text-green-600">Resolved</span></div>
                      ) : (
                        <button
                          onClick={() => resolveAlertMutation.mutate({ alertId: alert.id })}
                          disabled={resolveAlertMutation.isPending}
                          className="flex items-center gap-1 px-2 py-0.5 rounded border border-yellow-500/40 bg-yellow-500/10 hover:bg-yellow-500/20 transition-colors"
                        >
                          <Activity className="h-3 w-3 text-yellow-500" />
                          <span className="mono text-[10px] text-yellow-500">Resolve</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(alerts ?? []).length > SIEM_PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
              <span className="data-label">Showing {alertPage * SIEM_PAGE_SIZE + 1}–{Math.min((alertPage + 1) * SIEM_PAGE_SIZE, (alerts ?? []).length)} of {(alerts ?? []).length}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setAlertPage(p => Math.max(0, p - 1))} disabled={alertPage === 0}><ChevronLeft className="h-3 w-3" /></Button>
                <span className="mono text-xs">{alertPage + 1} / {Math.ceil((alerts ?? []).length / SIEM_PAGE_SIZE)}</span>
                <Button variant="outline" size="sm" onClick={() => setAlertPage(p => Math.min(Math.ceil((alerts ?? []).length / SIEM_PAGE_SIZE) - 1, p + 1))} disabled={alertPage >= Math.ceil((alerts ?? []).length / SIEM_PAGE_SIZE) - 1}><ChevronRight className="h-3 w-3" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Live Alert Stream */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Radio className={`h-3.5 w-3.5 ${connected ? "text-green-500 animate-pulse" : "text-yellow-500"}`} />
              Live Alert Stream (WebSocket)
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full inline-block ${connected ? "bg-green-500 animate-pulse" : "bg-yellow-500"}`} />
              <span className={`data-label ${connected ? "text-green-600" : "text-yellow-600"}`}>
                {connected ? "LIVE" : "CONNECTING"}
              </span>
              <span className="data-label text-muted-foreground">{liveAlerts.length} buffered</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {liveAlerts.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Zap className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Waiting for live alerts from SIEM Correlator...</p>
              <p className="text-xs text-muted-foreground mt-1 mono">WebSocket room: siem · {connected ? "Connected" : "Connecting"}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30">
                    {["Time", "Severity", "Title", "Source", "MITRE"].map(h => (
                      <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {liveAlerts.map((alert: any) => (
                    <tr key={alert.liveId} className="border-b border-border/30 hover:bg-muted/20 transition-colors animate-in fade-in duration-300">
                      <td className="px-4 py-2.5 mono text-muted-foreground">
                        {new Date(alert.receivedAt).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className="mono text-[9px] capitalize" style={{ borderColor: SEV_COLORS[alert.severity] + "60", color: SEV_COLORS[alert.severity] }}>
                          {alert.severity}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 font-medium truncate max-w-[200px]">{alert.title}</td>
                      <td className="px-4 py-2.5 mono text-muted-foreground capitalize">{alert.source?.replace("_", " ") ?? "siem"}</td>
                      <td className="px-4 py-2.5 mono text-[10px] text-muted-foreground">{alert.mitreTactic ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audit Log */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Audit Trail (OpenSearch — 7-year retention)</CardTitle>
            <span className="data-label">{auditLogs?.length ?? 0} entries</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  {["Timestamp", "Actor", "Action", "Resource", "IP Address", "Result"].map(h => (
                    <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(auditLogs ?? []).slice(logPage * SIEM_PAGE_SIZE, (logPage + 1) * SIEM_PAGE_SIZE).map((log: any) => (
                  <tr key={log.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 mono text-muted-foreground">{log.timestamp ? new Date(log.timestamp).toLocaleString() : "—"}</td>
                    <td className="px-4 py-2.5 mono">{log.actorId ?? "system"}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="mono text-[9px] capitalize">{log.action?.replace("_", " ")}</Badge>
                    </td>
                    <td className="px-4 py-2.5 mono text-muted-foreground truncate max-w-[140px]">{log.resourceType} #{log.resourceId}</td>
                    <td className="px-4 py-2.5 mono text-muted-foreground">{log.ipAddress ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`mono text-[10px] font-semibold ${log.result === "success" ? "text-green-600" : log.result === "failure" ? "text-red-500" : "text-yellow-500"}`}>
                        {log.result?.toUpperCase() ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(auditLogs ?? []).length > SIEM_PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
              <span className="data-label">Showing {logPage * SIEM_PAGE_SIZE + 1}–{Math.min((logPage + 1) * SIEM_PAGE_SIZE, (auditLogs ?? []).length)} of {(auditLogs ?? []).length}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setLogPage(p => Math.max(0, p - 1))} disabled={logPage === 0}><ChevronLeft className="h-3 w-3" /></Button>
                <span className="mono text-xs">{logPage + 1} / {Math.ceil((auditLogs ?? []).length / SIEM_PAGE_SIZE)}</span>
                <Button variant="outline" size="sm" onClick={() => setLogPage(p => Math.min(Math.ceil((auditLogs ?? []).length / SIEM_PAGE_SIZE) - 1, p + 1))} disabled={logPage >= Math.ceil((auditLogs ?? []).length / SIEM_PAGE_SIZE) - 1}><ChevronRight className="h-3 w-3" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

    {/* Create Alert Dialog */}
    <Dialog open={showCreateAlert} onOpenChange={setShowCreateAlert}>
      <DialogContent className="bg-background border-border text-foreground">
        <DialogHeader><DialogTitle>Create Security Alert</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-muted-foreground text-xs">Organization ID</Label><Input type="number" value={alertForm.organizationId} onChange={e => setAlertForm(p => ({ ...p, organizationId: e.target.value }))} className="bg-card border-border mt-1" placeholder="e.g. 1" /></div>
          <div><Label className="text-muted-foreground text-xs">Alert Title</Label><Input value={alertForm.title} onChange={e => setAlertForm(p => ({ ...p, title: e.target.value }))} className="bg-card border-border mt-1" placeholder="e.g. Suspicious data exfiltration detected" /></div>
          <div><Label className="text-muted-foreground text-xs">Alert Type</Label><Input value={alertForm.alertType} onChange={e => setAlertForm(p => ({ ...p, alertType: e.target.value }))} className="bg-card border-border mt-1" placeholder="e.g. data_exfiltration" /></div>
          <div><Label className="text-muted-foreground text-xs">Severity</Label>
            <Select value={alertForm.severity} onValueChange={v => setAlertForm(p => ({ ...p, severity: v }))}>
              <SelectTrigger className="bg-card border-border mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{["low","medium","high","critical"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-muted-foreground text-xs">Description (optional)</Label><Textarea value={alertForm.description} onChange={e => setAlertForm(p => ({ ...p, description: e.target.value }))} className="bg-card border-border mt-1" rows={3} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowCreateAlert(false)}>Cancel</Button>
          <Button className="bg-red-600 hover:bg-red-700" onClick={() => createAlertMutation.mutate({ organizationId: Number(alertForm.organizationId), severity: alertForm.severity as any, alertType: alertForm.alertType, title: alertForm.title, description: alertForm.description || undefined })} disabled={!alertForm.organizationId || !alertForm.title || !alertForm.alertType || createAlertMutation.isPending}>{createAlertMutation.isPending ? "Creating..." : "Create Alert"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
