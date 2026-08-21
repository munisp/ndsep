import React, { useState, useEffect } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useNdsepSocket } from "@/hooks/useNdsepSocket";
import { ComplianceHeatmap } from "@/components/ComplianceHeatmap";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadialBarChart, RadialBar
} from "recharts";
import {
  Shield, AlertTriangle, Building2, Database, Network,
  TrendingUp, TrendingDown, Activity, Globe, Zap, Server, CheckCircle2, XCircle, Clock, FileSearch, Gavel, Download
} from "lucide-react";

const COLORS = ["oklch(0.55 0.22 250)", "oklch(0.62 0.20 330)", "oklch(0.60 0.20 160)", "oklch(0.72 0.18 80)", "oklch(0.58 0.24 25)"];

const METRIC_GRADIENTS: Record<string, string> = {
  blue: "from-[oklch(0.55_0.22_250)] to-[oklch(0.58_0.20_290)]",
  green: "from-[oklch(0.60_0.20_160)] to-[oklch(0.55_0.18_180)]",
  red: "from-[oklch(0.58_0.24_25)] to-[oklch(0.60_0.22_350)]",
  amber: "from-[oklch(0.72_0.18_80)] to-[oklch(0.65_0.20_60)]",
  purple: "from-[oklch(0.58_0.20_290)] to-[oklch(0.55_0.22_320)]",
};

function MetricCard({
  label, value, sub, icon: Icon, trend, color = "blue"
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ComponentType<any>; trend?: "up" | "down" | "neutral"; color?: string;
}) {
  return (
    <div className="metric-card group">
      <div className="relative p-5">
        <div className="absolute top-0 right-0 w-24 h-24 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity">
          <Icon className="w-full h-full" />
        </div>
        <div className="flex items-start justify-between relative">
          <div className="flex-1 min-w-0">
            <p className="data-label mb-2">{label}</p>
            <p className="metric-value text-3xl text-foreground">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1.5 mono tracking-tight">{sub}</p>}
          </div>
          <div className={`p-2.5 rounded-xl bg-gradient-to-br ${METRIC_GRADIENTS[color] || METRIC_GRADIENTS.blue} shadow-lg group-hover:shadow-xl group-hover:scale-105 transition-all duration-300 shrink-0`}>
            <Icon className="h-5 w-5 text-white" />
          </div>
        </div>
        {trend && (
          <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-border/30">
            {trend === "up" ? <TrendingUp className="h-3.5 w-3.5 text-green-500" /> : trend === "down" ? <TrendingDown className="h-3.5 w-3.5 text-red-500" /> : <Activity className="h-3.5 w-3.5 text-muted-foreground" />}
            <span className={`text-xs font-medium ${trend === "up" ? "text-green-500" : trend === "down" ? "text-red-500" : "text-muted-foreground"}`}>
              {trend === "up" ? "Improving" : trend === "down" ? "Degrading" : "Stable"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}



export default function Dashboard() {
  const utils = trpc.useUtils();
  const { data: stats, isLoading } = trpc.dashboard.stats.useQuery();
  const { data: ndpaIndex } = trpc.ndpaStats.index.useQuery(undefined, { refetchInterval: 120_000 });
  const { data: breachTimelineData } = trpc.ndpaStats.breachTimeline.useQuery({ limit: 8 }, { refetchInterval: 60_000 });
  const { data: ndpaTrend } = trpc.ndpaStats.complianceTrend.useQuery({ days: 180 }, { refetchInterval: 300_000 });
  const { data: mlPredictions } = trpc.dashboard.mlPredictions.useQuery();
  const { data: violationTrendRaw } = trpc.dashboard.violationTrend.useQuery();
  const { data: networkTrafficRaw } = trpc.network.trafficByHour.useQuery();
  const riskTrendData = (violationTrendRaw ?? []).map((r: any) => ({
    month: r.period,
    risk: Number(r.critical ?? 0),
    compliance: Number(r.violations ?? 0),
  }));
  const networkFlowData = (networkTrafficRaw ?? []).map((r: any) => ({
    hour: r.time?.slice(0, 2) ?? "00",
    inbound: Number(r.inbound ?? 0),
    outbound: Number(r.outbound ?? 0),
    blocked: Number(r.blocked ?? 0),
  }));
  // BGP strip dismiss state — persisted in localStorage with 24h TTL
  const BGP_DISMISS_KEY = "ndsep_bgp_dismissed_until";
  const [bgpDismissed, setBgpDismissedState] = useState(() => {
    try {
      const until = localStorage.getItem(BGP_DISMISS_KEY);
      return until ? Date.now() < Number(until) : false;
    } catch { return false; }
  });
  const setBgpDismissed = (val: boolean) => {
    setBgpDismissedState(val);
    try {
      if (val) localStorage.setItem(BGP_DISMISS_KEY, String(Date.now() + 24 * 60 * 60 * 1000));
      else localStorage.removeItem(BGP_DISMISS_KEY);
    } catch {}
  };

  // Real-time live counters — updated via WebSocket without full refetch
  const [liveAlerts, setLiveAlerts] = useState<number | null>(null);
  const [liveViolations, setLiveViolations] = useState<number | null>(null);
  const [liveCrossBorder, setLiveCrossBorder] = useState<number | null>(null);
  const [flashAlert, setFlashAlert] = useState(false);
  // Banking live counters
  const [liveNipCount, setLiveNipCount] = useState(0);
  const [liveFraudCount, setLiveFraudCount] = useState(0);
  const [liveNipFailed, setLiveNipFailed] = useState(0);
  const [sectorRates, setSectorRates] = useState<Record<string, number>>({});

  const { connected, recentAlerts, recentViolations, eventCount } = useNdsepSocket({
    rooms: ["dashboard"],
    onEvent: (event) => {
      if (event.type === "dashboard_update") {
        utils.dashboard.stats.invalidate();
      }
      if (event.type === "new_alert") {
        setLiveAlerts(prev => (prev ?? Number(stats?.alertStats?.unresolved ?? 0)) + 1);
        setFlashAlert(true);
        setTimeout(() => setFlashAlert(false), 1200);
      }
      if (event.type === "new_violation") {
        setLiveViolations(prev => (prev ?? Number(stats?.violationStats?.open ?? 0)) + 1);
      }
      if (event.type === "new_network_event" && event.payload?.isCrossBorder) {
        setLiveCrossBorder(prev => (prev ?? Number(stats?.networkStats?.crossBorder ?? 0)) + 1);
      }
      if ((event as any).type === "nip_settlement") {
        setLiveNipCount(prev => prev + 1);
        if ((event as any).payload?.status === "failed") setLiveNipFailed(prev => prev + 1);
      }
      if ((event as any).type === "fraud_alert_new") {
        setLiveFraudCount(prev => prev + 1);
      }
      if ((event as any).type === "sector_compliance_update") {
        const p = (event as any).payload;
        setSectorRates(prev => ({ ...prev, [p.sector]: p.complianceRate }));
      }
    },
  });

  // Reset live counters when DB stats refresh
  useEffect(() => {
    if (stats) {
      setLiveAlerts(null);
      setLiveViolations(null);
      setLiveCrossBorder(null);
    }
  }, [stats]);

  const nationalRiskScore = stats ? Math.round(Number(stats.orgStats?.avgRisk ?? 0)) : 0;
  const complianceRate = stats ? Math.round(Number(stats.orgStats?.avgScore ?? 0)) : 0;

  const riskColor = nationalRiskScore >= 70 ? "#ef4444" : nationalRiskScore >= 50 ? "#f59e0b" : "#10b981";

  const complianceBreakdown = stats ? [
    { name: "Compliant", value: Number(stats.orgStats?.compliant ?? 0), color: "#10b981" },
    { name: "Non-Compliant", value: Number(stats.orgStats?.nonCompliant ?? 0), color: "#ef4444" },
    { name: "Under Review", value: Number(stats.orgStats?.underReview ?? 0), color: "#f59e0b" },
  ] : [];

  const topRiskOrgs = mlPredictions?.slice(0, 5) ?? [];
  // ── Intel Aggregator — Cross-platform threat intelligence feed ──────────────
  const { data: intelSummary } = trpc.intelAggregator.summary.useQuery(undefined, { refetchInterval: 60_000 });
  const { data: orchStatus } = trpc.orchestration.status.useQuery(undefined, { refetchInterval: 30000 });
  const orchServices: Array<{ name: string; status: string; latencyMs?: number }> = (orchStatus as any)?.services ?? [];
  const orchHealthy = orchServices.filter(s => s.status === "healthy").length;
  const { data: recentAuditLogs } = trpc.siem.auditLogs.useQuery({ limit: 5 }, { refetchInterval: 60_000 });
  const { data: hijackedRoutes } = trpc.bgp.hijacked.useQuery({ limit: 3 }, { refetchInterval: 30_000 });
  const { data: bgpStats } = trpc.bgp.stats.useQuery(undefined, { refetchInterval: 30_000 });
  const bgpAnomalies = (bgpStats as any) ? Number((bgpStats as any).hijacked ?? 0) + Number((bgpStats as any).invalid ?? 0) + Number((bgpStats as any).leaked ?? 0) : 0;
  const { data: enfCases } = trpc.enforcementCases.list.useQuery({ limit: 100 }, { refetchInterval: 60_000 });
  const { data: leaderboardData } = trpc.leaderboard.list.useQuery({ limit: 10 }, { refetchInterval: 120_000 });
  const leaderboardList = (leaderboardData as any[]) ?? [];
  const top5 = leaderboardList.slice(0, 5);
  const bottom5 = [...leaderboardList].sort((a: any, b: any) => (a.complianceScore ?? 0) - (b.complianceScore ?? 0)).slice(0, 5);
  const enfCasesList = (enfCases as any[]) ?? [];
  const enfOpen = enfCasesList.filter((c: any) => c.status === "open").length;
  const enfNitda = enfCasesList.filter((c: any) => c.status === "escalated_to_nitda").length;
  const enfSettled = enfCasesList.filter((c: any) => c.status === "settled" || c.status === "closed").length;

  return (
    <div className="space-y-6 p-6 overflow-y-auto h-full stagger-children">
      {/* Orchestration Health Bar — hidden for demo presentation */}
      {false && orchServices.length > 0 && (
        <div className={`rounded-lg border px-4 py-2.5 flex items-center gap-4 flex-wrap ${
          orchHealthy === orchServices.length
            ? "border-green-500/30 bg-green-950/10"
            : orchHealthy >= orchServices.length * 0.75
            ? "border-border/40 bg-card/50"
            : orchHealthy >= orchServices.length * 0.5
            ? "border-yellow-500/40 bg-yellow-950/10"
            : orchHealthy >= orchServices.length * 0.25
            ? "border-orange-500/40 bg-orange-950/10"
            : "border-red-500/40 bg-red-950/10"
        }`}>
          <div className="flex items-center gap-1.5 shrink-0">
            <Server className={`h-3.5 w-3.5 ${
              orchHealthy === orchServices.length ? "text-green-500" :
              orchHealthy >= orchServices.length * 0.5 ? "text-yellow-500" : "text-red-500"
            }`} />
            <span className="text-xs font-semibold text-foreground mono">ORCHESTRATION</span>
            <span className={`text-xs font-bold mono ml-1 ${
              orchHealthy === orchServices.length ? "text-green-500" :
              orchHealthy > orchServices.length / 2 ? "text-yellow-500" : "text-red-500"
            }`}>{orchHealthy}/{orchServices.length} HEALTHY</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {orchServices.map(svc => (
              <div key={svc.name} className="flex items-center gap-1">
                {svc.status === "healthy" ? <CheckCircle2 className="h-3 w-3 text-green-500" /> :
                 svc.status === "degraded" ? <Clock className="h-3 w-3 text-yellow-500" /> :
                 <XCircle className="h-3 w-3 text-red-500" />}
                <span className="text-xs text-muted-foreground mono">{svc.name}</span>
                {svc.latencyMs !== undefined && <span className="text-xs text-muted-foreground/50 mono">{svc.latencyMs}ms</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="layer-badge">LAYER 6</span>
            <span className="data-label">Government Executive Dashboard</span>
          </div>
          <h1 className="heading-display text-2xl text-foreground">National Data Sovereignty</h1>
          <p className="caption mt-1">Real-time situational awareness &middot; National risk assessment &middot; Enforcement overview</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { const a = document.createElement("a"); a.href = "/api/national-report.pdf"; a.download = `NDSEP-National-Report-${new Date().toISOString().slice(0, 10)}.pdf`; a.click(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-primary/40 text-primary text-xs mono hover:bg-primary/10 transition-colors"
            title="Download National Enforcement Report PDF"
          >
            <Download className="h-3.5 w-3.5" />
            National Report
          </button>
          <div className="flex items-center gap-2">
            {/* Re-show BGP badge when strip is dismissed but anomalies exist */}
            {bgpDismissed && hijackedRoutes && hijackedRoutes.length > 0 && (
              <button
                onClick={() => setBgpDismissed(false)}
                className="flex items-center gap-1 px-2 py-0.5 rounded border border-red-500/40 text-red-400 text-xs mono hover:bg-red-950/20 transition-colors"
                title="Show BGP anomaly alerts"
              >
                <Network className="h-3 w-3" />
                &#9888; {hijackedRoutes.length} BGP
              </button>
            )}
            <span className={`h-2 w-2 rounded-full inline-block ${connected ? "bg-green-500 animate-pulse" : "bg-yellow-500"}`} />
            <span className={`data-label ${connected ? "text-green-600" : "text-yellow-600"}`}>{connected ? "LIVE" : "CONNECTING"}</span>
            {eventCount > 0 && <span className="data-label text-muted-foreground">· {eventCount} events</span>}
          </div>
        </div>
      </div>

      {/* BGP Hijack Alert Strip — hidden for demo presentation */}
      {false && !bgpDismissed && hijackedRoutes && (hijackedRoutes?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-red-500/40 bg-red-950/20 px-4 py-2.5">
          <div className="flex items-center gap-2 mb-2">
            <Network className="h-4 w-4 text-red-400" />
            <span className="text-xs font-bold text-red-400 mono">BGP ROUTE ANOMALIES DETECTED</span>
            <span className="text-xs text-red-400/70 mono">&middot; {hijackedRoutes?.length ?? 0} active</span>
            <Link href="/bgp-routes" className="text-xs text-red-400 hover:text-red-300 mono underline">View all &rarr;</Link>
            <button
              onClick={() => setBgpDismissed(true)}
              className="ml-auto flex items-center gap-1 text-xs text-red-400/60 hover:text-red-300 mono px-2 py-0.5 rounded border border-red-500/20 hover:border-red-400/40 transition-colors"
              title="Acknowledge and dismiss this alert"
            >
              <XCircle className="h-3 w-3" />
              Acknowledge
            </button>
          </div>
          <div className="flex flex-wrap gap-3">
            {(hijackedRoutes as any[]).map((r: any) => (
              <div key={r.id} className="flex items-center gap-2 bg-red-950/30 border border-red-500/20 rounded px-3 py-1.5">
                <span className={`h-2 w-2 rounded-full ${r.is_hijacked ? 'bg-red-500 animate-pulse' : 'bg-yellow-500'}`} />
                <span className="text-xs font-mono text-red-300 font-semibold">{r.prefix}</span>
                <span className="text-xs text-red-400/70 mono">AS{r.origin_asn}</span>
                <Badge variant="outline" className="text-xs border-red-500/40 text-red-400 h-4 px-1">
                  {r.is_hijacked ? 'HIJACKED' : (r.rpki_status ?? '').toUpperCase()}
                </Badge>
                <span className="text-xs text-muted-foreground mono">{r.ixp_site}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* National Risk Score — Hero */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card className="lg:col-span-1 relative overflow-hidden border modern-card" style={{ borderColor: riskColor + "40" }}>
          <div className="absolute inset-0 blueprint-grid opacity-20" />
          <CardContent className="relative p-6 flex flex-col items-center justify-center text-center">
            <p className="data-label mb-3">National Risk Score</p>
            <div className="relative">
              <svg viewBox="0 0 120 120" className="w-32 h-32">
                <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" strokeWidth="2" className="text-border" />
                <circle cx="60" cy="60" r="50" fill="none" stroke={riskColor} strokeWidth="8"
                  strokeDasharray={`${(nationalRiskScore / 100) * 314} 314`}
                  strokeLinecap="round" transform="rotate(-90 60 60)" />
                <text x="60" y="55" textAnchor="middle" className="font-bold" fill={riskColor} fontSize="24" fontFamily="JetBrains Mono">{nationalRiskScore}</text>
                <text x="60" y="72" textAnchor="middle" fill="currentColor" fontSize="9" fontFamily="JetBrains Mono" opacity="0.6">/ 100</text>
              </svg>
            </div>
            <Badge variant="outline" className="mt-2 mono text-xs" style={{ borderColor: riskColor, color: riskColor }}>
              {nationalRiskScore >= 70 ? "HIGH RISK" : nationalRiskScore >= 50 ? "MEDIUM RISK" : "CONTROLLED"}
            </Badge>
          </CardContent>
        </Card>

        <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
          <MetricCard label="Organizations" value={Number(stats?.orgStats?.total ?? 0).toLocaleString()} sub="Under surveillance" icon={Building2} trend="neutral" />
          <MetricCard label="Total Assets" value={Number(stats?.assetStats?.total ?? 0).toLocaleString()} sub={`${stats?.assetStats?.outsideBorders ?? 0} outside borders`} icon={Database} trend="neutral" />
          <MetricCard label="Compliance Rate" value={`${complianceRate}%`} sub="National average" icon={Shield} trend="up" />
          <MetricCard label="Open Violations" value={(liveViolations ?? Number(stats?.violationStats?.open ?? 0)).toLocaleString()} sub={`${stats?.violationStats?.critical ?? 0} critical`} icon={AlertTriangle} trend="down" />
          <MetricCard label="Active Alerts" value={(liveAlerts ?? Number(stats?.alertStats?.unresolved ?? 0)).toLocaleString()} sub={flashAlert ? "⚡ NEW ALERT" : "Unresolved SIEM"} icon={Zap} trend="neutral" />
          <MetricCard label="Cross-Border Events" value={(liveCrossBorder ?? Number(stats?.networkStats?.crossBorder ?? 0)).toLocaleString()} sub={`${stats?.networkStats?.blocked ?? 0} blocked`} icon={Globe} trend="neutral" />
          <MetricCard label="BGP Anomalies (24h)" value={bgpAnomalies.toLocaleString()} sub={`${(bgpStats as any)?.hijacked ?? 0} hijacked · ${(bgpStats as any)?.leaked ?? 0} leaked`} icon={Network} trend={bgpAnomalies > 0 ? "down" : "neutral"} color="red" />
          <MetricCard label="NIP Settlements (live)" value={liveNipCount.toLocaleString()} sub={liveNipFailed > 0 ? `${liveNipFailed} failed` : "All settled"} icon={Activity} trend="neutral" />
          <MetricCard label="Fraud Alerts (live)" value={liveFraudCount.toLocaleString()} sub="ML-flagged transactions" icon={AlertTriangle} trend={liveFraudCount > 0 ? "down" : "neutral"} />
        </div>
      </div>

      {/* ── Intelligence Platform Status — Cross-platform data flow ── */}
      {intelSummary && (
        <Card className="modern-card border-primary/20">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm font-semibold">Intelligence Platform Status</CardTitle>
                <Badge variant="outline" className="text-xs mono">{intelSummary.totalThreats} threats</Badge>
                {intelSummary.criticalThreats > 0 && (
                  <Badge variant="destructive" className="text-xs mono">{intelSummary.criticalThreats} critical</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="data-label">{intelSummary.activeInvestigations} active investigations</span>
                <Link href="/threat-intelligence" className="text-xs text-primary hover:underline mono">View All →</Link>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {intelSummary.platforms.map((p: any) => (
                <div key={p.name} className="flex items-center gap-2 p-2 rounded-lg border border-border/50 bg-card/50">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${p.status === "online" ? "bg-green-500" : p.status === "degraded" ? "bg-yellow-500" : "bg-red-500"}`} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground mono">{p.alertCount} alerts{p.criticalCount > 0 ? ` · ${p.criticalCount} crit` : ""}</p>
                  </div>
                </div>
              ))}
            </div>
            {/* Recent cross-platform alerts */}
            {intelSummary.recentAlerts.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border/30">
                <div className="flex items-center gap-2 mb-2">
                  <span className="data-label">Recent Intelligence Alerts</span>
                </div>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {intelSummary.recentAlerts.slice(0, 5).map((alert: any) => (
                    <div key={alert.id} className="flex items-center gap-2 text-xs">
                      <Badge variant={alert.severity === "critical" ? "destructive" : "outline"} className="text-xs shrink-0 w-14 justify-center">{alert.severity}</Badge>
                      <span className="text-muted-foreground mono shrink-0">[{alert.source}]</span>
                      <span className="text-foreground truncate">{alert.title}</span>
                      {alert.affectsCompliance && <Badge variant="outline" className="text-xs border-yellow-500/40 text-yellow-500 shrink-0">COMPLIANCE</Badge>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Risk & Compliance Trend */}
        <Card className="lg:col-span-2 modern-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">National Risk & Compliance Trend</CardTitle>
              <span className="data-label">6-month rolling</span>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={riskTrendData}>
                <defs>
                  <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="compGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} domain={[0, 100]} />
                <Tooltip contentStyle={{ fontSize: 11, fontFamily: "JetBrains Mono", background: "var(--card)", border: "1px solid var(--border)" }} />
                <Area type="monotone" dataKey="risk" stroke="#ef4444" fill="url(#riskGrad)" strokeWidth={2} name="Risk Score" />
                <Area type="monotone" dataKey="compliance" stroke="#2563eb" fill="url(#compGrad)" strokeWidth={2} name="Compliance" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Compliance Breakdown */}
        <Card className="modern-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Compliance Status</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={complianceBreakdown} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                  {complianceBreakdown.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11, fontFamily: "JetBrains Mono", background: "var(--card)", border: "1px solid var(--border)" }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1 mt-2">
              {complianceBreakdown.map((item) => (
                <div key={item.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                    <span className="data-label">{item.name}</span>
                  </div>
                  <span className="mono text-xs font-semibold">{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Network Traffic + ML Predictions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Network Traffic */}
        <Card className="modern-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Network Traffic (24h)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={networkFlowData} barSize={12}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                <Tooltip contentStyle={{ fontSize: 11, fontFamily: "JetBrains Mono", background: "var(--card)", border: "1px solid var(--border)" }} />
                <Bar dataKey="inbound" fill="#2563eb" name="Inbound" radius={[2, 2, 0, 0]} />
                <Bar dataKey="outbound" fill="#ec4899" name="Outbound" radius={[2, 2, 0, 0]} />
                <Bar dataKey="blocked" fill="#ef4444" name="Blocked" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ML Risk Predictions */}
        <Card className="modern-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">ML Risk Predictions</CardTitle>
              <span className="layer-badge">AI/ML</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topRiskOrgs.length === 0 ? (
                <p className="data-label text-center py-4">Loading predictions...</p>
              ) : (
                topRiskOrgs.map((pred: any, i: number) => (
                  <div key={pred.id} className="flex items-center gap-3">
                    <span className="mono text-xs text-muted-foreground w-4">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium truncate">Org #{pred.organizationId}</span>
                        <span className="mono text-xs font-bold" style={{ color: pred.predictedRiskScore > 70 ? "#ef4444" : pred.predictedRiskScore > 50 ? "#f59e0b" : "#10b981" }}>
                          {Number(pred.predictedRiskScore).toFixed(0)}
                        </span>
                      </div>
                      <Progress value={Number(pred.predictedRiskScore)} className="h-1.5" />
                    </div>
                    <Badge variant="outline" className="mono text-[9px] shrink-0">
                      {pred.modelVersion ?? "v1"}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Financial Summary */}
      <Card className="modern-card">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Financial Enforcement Summary</CardTitle>
            <span className="layer-badge">TIGERBEETLE · MOJALOOP</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total Penalties Issued", value: `$${Number(stats?.penaltyStats?.totalAmount ?? 0).toLocaleString()}`, color: "text-foreground" },
              { label: "Pending Collection", value: `$${Number((stats?.penaltyStats as any)?.pendingAmount ?? 0).toLocaleString()}`, color: "text-yellow-600" },
              { label: "Overdue Payments", value: `$${Number((stats?.penaltyStats as any)?.overdueAmount ?? 0).toLocaleString()}`, color: "text-red-500" },
              { label: "Penalty Cases", value: Number(stats?.penaltyStats?.total ?? 0).toLocaleString(), color: "text-foreground" },
            ].map((item) => (
              <div key={item.label} className="text-center p-3 rounded-lg bg-muted/40 border border-border/40">
                <p className="data-label mb-1">{item.label}</p>
                <p className={`metric-value text-lg font-bold ${item.color}`}>{item.value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Enforcement Cases Summary */}
      <Card className="modern-card">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gavel className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-semibold">Enforcement Cases Summary</CardTitle>
            </div>
            <Link href="/enforcement-cases" className="text-xs text-primary hover:underline mono">Manage cases →</Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total Cases",        value: enfCasesList.length, color: "text-foreground" },
              { label: "Open / Active",       value: enfOpen,            color: "text-red-400" },
              { label: "Escalated to NITDA", value: enfNitda,           color: "text-yellow-400" },
              { label: "Settled / Closed",   value: enfSettled,         color: "text-green-400" },
            ].map((item) => (
              <div key={item.label} className="text-center p-3 rounded-lg bg-muted/40 border border-border/40">
                <p className="data-label mb-1">{item.label}</p>
                <p className={`metric-value text-lg font-bold ${item.color}`}>{item.value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      {/* Compliance Leaderboard */}
      <Card className="modern-card">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-semibold">Compliance Leaderboard</CardTitle>
            </div>
            <Link href="/leaderboard" className="text-xs text-primary hover:underline mono">Full leaderboard →</Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="data-label mb-2 flex items-center gap-1"><TrendingUp className="h-3 w-3 text-green-400" /> Top 5 Most Compliant</p>
              <div className="space-y-1.5">
                {top5.map((org: any, i: number) => (
                  <div key={org.id} className="flex items-center gap-2">
                    <span className="mono text-[10px] w-4 text-muted-foreground">{i + 1}.</span>
                    <span className="text-xs text-foreground flex-1 truncate">{org.name}</span>
                    <span className="mono text-xs font-bold text-green-400">{org.complianceScore}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="data-label mb-2 flex items-center gap-1"><TrendingDown className="h-3 w-3 text-red-400" /> Bottom 5 — Needs Intervention</p>
              <div className="space-y-1.5">
                {bottom5.map((org: any, i: number) => (
                  <div key={org.id} className="flex items-center gap-2">
                    <span className="mono text-[10px] w-4 text-muted-foreground">{i + 1}.</span>
                    <span className="text-xs text-foreground flex-1 truncate">{org.name}</span>
                    <span className="mono text-xs font-bold text-red-400">{org.complianceScore}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent Audit Activity */}
      <Card className="modern-card">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileSearch className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-semibold">Recent Audit Activity</CardTitle>
            </div>
            <Link href="/audit-log" className="text-xs text-primary hover:underline mono">View all →</Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border/30">
            {(recentAuditLogs ?? []).length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">No audit entries yet.</p>
            ) : (recentAuditLogs ?? []).map((log: any) => {
              const actionColor: Record<string, string> = { create: "#10b981", update: "#2563eb", delete: "#ef4444", resolve: "#f59e0b" };
              const base = (log.action ?? "").split(".")[0];
              const color = actionColor[base] ?? "#6b7280";
              return (
                <div key={log.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors">
                  <span className="mono text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0" style={{ color, background: color + "20" }}>{log.action ?? "—"}</span>
                  <span className="text-xs text-muted-foreground capitalize flex-1 truncate">{(log.resourceType ?? "—").replace(/_/g, " ")} {log.resourceId ? `#${log.resourceId}` : ""}</span>
                  <span className="text-[10px] mono text-muted-foreground shrink-0">{log.createdAt ? new Date(log.createdAt).toLocaleTimeString() : "—"}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* NDPA Compliance Index */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border border-border/60 relative overflow-hidden">
          <div className="absolute inset-0 blueprint-grid opacity-10" />
          <CardHeader className="pb-2 relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="layer-badge">CPL</span>
                <CardTitle className="text-sm font-semibold">NDPA Compliance Index</CardTitle>
              </div>
              <span className="mono text-[10px] text-muted-foreground">NDPC · 2023</span>
            </div>
          </CardHeader>
          <CardContent className="relative">
            {ndpaIndex ? (
              <>
                <div className="flex flex-col items-center mb-4">
                  <svg viewBox="0 0 120 120" className="w-28 h-28">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" strokeWidth="2" className="text-border" />
                    <circle cx="60" cy="60" r="50" fill="none"
                      stroke={ndpaIndex.ndpaIndex >= 80 ? '#10b981' : ndpaIndex.ndpaIndex >= 60 ? '#f59e0b' : '#ef4444'}
                      strokeWidth="8"
                      strokeDasharray={`${(ndpaIndex.ndpaIndex / 100) * 314} 314`}
                      strokeLinecap="round" transform="rotate(-90 60 60)" />
                    <text x="60" y="55" textAnchor="middle" className="font-bold"
                      fill={ndpaIndex.ndpaIndex >= 80 ? '#10b981' : ndpaIndex.ndpaIndex >= 60 ? '#f59e0b' : '#ef4444'}
                      fontSize="24" fontFamily="JetBrains Mono">{ndpaIndex.ndpaIndex}</text>
                    <text x="60" y="72" textAnchor="middle" fill="currentColor" fontSize="9" fontFamily="JetBrains Mono" opacity="0.6">/ 100</text>
                  </svg>
                  <Badge variant="outline" className="mono text-xs mt-1" style={{
                    borderColor: ndpaIndex.ndpaIndex >= 80 ? '#10b981' : ndpaIndex.ndpaIndex >= 60 ? '#f59e0b' : '#ef4444',
                    color: ndpaIndex.ndpaIndex >= 80 ? '#10b981' : ndpaIndex.ndpaIndex >= 60 ? '#f59e0b' : '#ef4444'
                  }}>
                    {ndpaIndex.ndpaIndex >= 80 ? 'COMPLIANT' : ndpaIndex.ndpaIndex >= 60 ? 'PARTIAL' : 'NON-COMPLIANT'}
                  </Badge>
                </div>
                <div className="space-y-1.5">
                  {Object.entries(ndpaIndex.metrics).map(([key, val]) => {
                    const labels: Record<string, string> = {
                      breachResolutionRate: 'Breach Resolution', breachNotificationRate: '72h Notification',
                      dpoAppointmentRate: 'DPO Appointment', dpiaCompletionRate: 'DPIA Completion',
                      consentComplianceRate: 'Consent Compliance', trainingCompletionRate: 'Staff Training',
                      auditReturnRate: 'Audit Returns', privacyNoticeRate: 'Privacy Notices'
                    };
                    const v = Number(val);
                    return (
                      <div key={key} className="flex items-center gap-2">
                        <span className="data-label flex-1 truncate">{labels[key] ?? key}</span>
                        <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${v}%`, background: v >= 80 ? '#10b981' : v >= 60 ? '#f59e0b' : '#ef4444' }} />
                        </div>
                        <span className="mono text-[10px] w-8 text-right" style={{ color: v >= 80 ? '#10b981' : v >= 60 ? '#f59e0b' : '#ef4444' }}>{v}%</span>
                      </div>
                    );
                  })}
                </div>
                {/* Trend Chart */}
                {ndpaTrend && ndpaTrend.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border/40">
                    <p className="data-label mb-2">6-Month Trend</p>
                    <ResponsiveContainer width="100%" height={120}>
                      <LineChart data={ndpaTrend.slice(-180).filter((_, i) => i % 7 === 0)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }} tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }} />
                        <Tooltip contentStyle={{ fontSize: 10, fontFamily: "JetBrains Mono", background: "var(--card)", border: "1px solid var(--border)" }} labelFormatter={(d) => new Date(d).toLocaleDateString()} />
                        <Line type="monotone" dataKey="ndpaIndex" stroke="#2563eb" strokeWidth={2} dot={false} name="NDPA Index" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center h-40"><span className="data-label">Loading NDPA metrics...</span></div>
            )}
          </CardContent>
        </Card>

        {/* Breach Incident Timeline */}
        <Card className="lg:col-span-1 border border-border/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="layer-badge">CPL</span>
                <CardTitle className="text-sm font-semibold">Breach Incident Timeline (72h SLA)</CardTitle>
              </div>
              <Link href="/breach-notification" className="text-xs text-primary hover:underline mono">View all →</Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/30">
              {(breachTimelineData ?? []).length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground">No breach incidents recorded.</p>
              ) : (breachTimelineData ?? []).map((b: any) => {
                const detected = b.detectedAt ? new Date(b.detectedAt) : null;
                const deadline = b.ndpcDeadline ? new Date(b.ndpcDeadline) : null;
                const notified = b.ndpcNotifiedAt ? new Date(b.ndpcNotifiedAt) : null;
                const slaOk = notified && deadline ? notified <= deadline : false;
                const slaBreached = !notified && deadline ? new Date() > deadline : false;
                const sevColor: Record<string, string> = { critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#10b981' };
                const statColor: Record<string, string> = { resolved: '#10b981', contained: '#3b82f6', assessing: '#f59e0b', detected: '#ef4444', notified: '#8b5cf6' };
                return (
                  <div key={b.id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors">
                    <div className="flex flex-col items-center gap-0.5 pt-0.5 shrink-0">
                      <div className="h-2 w-2 rounded-full" style={{ background: sevColor[b.severity] ?? '#6b7280' }} />
                      <div className="w-px flex-1 bg-border/40" style={{ minHeight: 16 }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-foreground truncate">{b.title}</span>
                        <Badge variant="outline" className="mono text-[9px] shrink-0" style={{ borderColor: sevColor[b.severity], color: sevColor[b.severity] }}>{(b.severity ?? '').toUpperCase()}</Badge>
                        <Badge variant="outline" className="mono text-[9px] shrink-0" style={{ borderColor: statColor[b.status], color: statColor[b.status] }}>{(b.status ?? '').toUpperCase()}</Badge>
                        {slaOk && <Badge variant="outline" className="mono text-[9px] shrink-0 border-green-500/40 text-green-400">SLA ✓</Badge>}
                        {slaBreached && <Badge variant="outline" className="mono text-[9px] shrink-0 border-red-500/40 text-red-400">SLA BREACHED</Badge>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <span className="data-label">{b.orgName ?? 'Unknown org'} · {b.sector ?? ''}</span>
                        {detected && <span className="mono text-[10px] text-muted-foreground">Detected: {detected.toLocaleDateString()}</span>}
                        {b.affectedCount > 0 && <span className="mono text-[10px] text-muted-foreground">{b.affectedCount.toLocaleString()} affected</span>}
                        {b.ndpcRef && <span className="mono text-[10px] text-primary">Ref: {b.ndpcRef}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Geospatial Compliance Heatmap */}
      <Card className="modern-card">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="layer-badge">LAYER 6</span>
                <span className="data-label">GEOSPATIAL COMPLIANCE HEATMAP</span>
              </div>
              <CardTitle className="text-sm font-semibold">National Data Residency &amp; Cross-Border Flow Map</CardTitle>
            </div>
            <span className="mono text-[10px] text-muted-foreground">REAL-TIME · NATIONAL COVERAGE</span>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-hidden rounded-b-lg">
          <ComplianceHeatmap showFlows={true} height="h-[460px]" />
        </CardContent>
      </Card>
    </div>
  );
}
