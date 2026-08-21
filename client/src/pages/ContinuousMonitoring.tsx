import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, TrendingDown, TrendingUp,
  RefreshCw, Shield, Database, Cpu, Globe, BarChart3, Zap, Bell,
  ChevronDown, ChevronUp, Eye, Target, Timer, AlertCircle
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const SNAPSHOT_TYPES = [
  { value: "all", label: "All Snapshots" },
  { value: "compliance_score", label: "Compliance Score" },
  { value: "asset_scan", label: "Asset Scan" },
  { value: "data_residency", label: "Data Residency" },
  { value: "network_dpi", label: "Network DPI" },
  { value: "threat_intel", label: "Threat Intel" },
  { value: "financial_audit", label: "Financial Audit" },
];

const scoreColor = (score: number) => {
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  if (score >= 40) return "text-orange-400";
  return "text-red-400";
};

const scoreBarColor = (score: number) => {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-amber-500";
  if (score >= 40) return "bg-orange-500";
  return "bg-red-500";
};

const driftSeverityConfig: Record<string, { color: string; label: string }> = {
  critical: { color: "bg-red-500/20 text-red-400 border-red-500/30", label: "Critical" },
  high: { color: "bg-orange-500/20 text-orange-400 border-orange-500/30", label: "High" },
  medium: { color: "bg-amber-500/20 text-amber-400 border-amber-500/30", label: "Medium" },
  low: { color: "bg-blue-500/20 text-blue-400 border-blue-500/30", label: "Low" },
};

const slaStatusConfig: Record<string, { color: string; icon: any }> = {
  breached: { color: "bg-red-500/20 text-red-400 border-red-500/30", icon: AlertTriangle },
  at_risk: { color: "bg-amber-500/20 text-amber-400 border-amber-500/30", icon: AlertCircle },
  resolved: { color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
};

export default function ContinuousMonitoring() {
  const [snapshotType, setSnapshotType] = useState("all");
  const [expandedSnapshot, setExpandedSnapshot] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const resolveSla = trpc.monitoring.resolveSla.useMutation({
    onSuccess: () => { toast.success("SLA breach resolved"); utils.monitoring.slaBreaches.invalidate(); utils.monitoring.stats.invalidate(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const resolveDrift = trpc.monitoring.resolveDrift.useMutation({
    onSuccess: () => { toast.success("Drift alert resolved"); utils.monitoring.driftAlerts.invalidate(); utils.monitoring.stats.invalidate(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const { data: stats, isLoading: statsLoading } = trpc.monitoring.stats.useQuery(undefined, { refetchInterval: 30000 });
  const { data: snapshots, isLoading: snapshotsLoading } = trpc.monitoring.snapshots.useQuery(
    { limit: 50, snapshotType: snapshotType === "all" ? undefined : snapshotType },
    { refetchInterval: 20000 }
  );
  const { data: slaBreaches, isLoading: slaLoading } = trpc.monitoring.slaBreaches.useQuery(
    { limit: 20, status: "breached" },
    { refetchInterval: 30000 }
  );
  const { data: driftAlerts, isLoading: driftLoading } = trpc.monitoring.driftAlerts.useQuery(
    { limit: 20, status: "open" },
    { refetchInterval: 30000 }
  );

  const monitoringCycle = [
    { step: 1, name: "Asset Re-Scan", tool: "Nmap/ZMap + NetBox", interval: "Every 6 hours", icon: Cpu, color: "text-blue-400" },
    { step: 2, name: "Compliance Re-Score", tool: "OPA + Apache Ranger", interval: "Every 4 hours", icon: Shield, color: "text-emerald-400" },
    { step: 3, name: "Data Residency Check", tool: "Rust Residency Enforcer", interval: "Every 2 hours", icon: Globe, color: "text-purple-400" },
    { step: 4, name: "Network DPI Sweep", tool: "Go DPI Engine + Arkime", interval: "Continuous", icon: Activity, color: "text-cyan-400" },
    { step: 5, name: "Threat Intel Update", tool: "SIEM Correlator + Falco", interval: "Every 15 minutes", icon: AlertTriangle, color: "text-orange-400" },
    { step: 6, name: "Financial Audit", tool: "Rust Financial Ledger", interval: "Every 24 hours", icon: BarChart3, color: "text-amber-400" },
    { step: 7, name: "SLA Evaluation", tool: "Rust SLA Tracker", interval: "Every 1 hour", icon: Timer, color: "text-red-400" },
    { step: 8, name: "Drift Detection", tool: "Python ML + Egeria", interval: "Every 30 minutes", icon: TrendingDown, color: "text-pink-400" },
  ];

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Continuous Monitoring" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />
            Continuous Monitoring
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Post-audit automated surveillance — compliance drift detection, SLA tracking, and re-scoring across all registered organizations
          </p>
        </div>
        <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 bg-emerald-500/10 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          Live Monitoring Active
        </Badge>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Orgs Under Monitoring", value: stats?.orgs_monitored ?? "—", icon: Shield, color: "text-blue-400", trend: null },
          { label: "Avg Compliance Score", value: stats?.avg_score ? `${Math.round(Number(stats.avg_score))}%` : "—", icon: Target, color: "text-emerald-400", trend: null },
          { label: "Active SLA Breaches", value: stats?.active_sla_breaches ?? "—", icon: AlertTriangle, color: "text-red-400", trend: "up" },
          { label: "Drift Alerts (Open)", value: stats?.open_drift_alerts ?? "—", icon: TrendingDown, color: "text-amber-400", trend: null },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="bg-card/80 border-border">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
                  </div>
                  <Icon className={`w-5 h-5 ${s.color} opacity-60`} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Monitoring Cycle */}
      <Card className="bg-card/80 border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-primary" />
            Automated Monitoring Cycle
          </CardTitle>
          <CardDescription>8-stage continuous surveillance pipeline running across all 18 microservices</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {monitoringCycle.map((stage) => {
              const Icon = stage.icon;
              return (
                <div key={stage.step} className="flex items-start gap-3 p-3 bg-muted/20 rounded-lg border border-border">
                  <div className={`w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-xs font-bold ${stage.color}`}>
                    {stage.step}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">{stage.name}</p>
                    <p className="text-xs text-muted-foreground">{stage.tool}</p>
                    <Badge variant="outline" className="text-xs mt-1 px-1.5 py-0 border-border text-muted-foreground">
                      <Clock className="w-2.5 h-2.5 mr-1" />{stage.interval}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SLA Breaches */}
        <Card className="bg-card/80 border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              Active SLA Breaches
            </CardTitle>
            <CardDescription>Organizations that have violated their compliance SLA commitments</CardDescription>
          </CardHeader>
          <CardContent>
            {slaLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading...
              </div>
            ) : !slaBreaches?.length ? (
              <div className="text-center py-8">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No active SLA breaches</p>
              </div>
            ) : (
              <div className="space-y-2">
                {slaBreaches.map((b: any) => {
                  const statusCfg = slaStatusConfig[b.status] ?? slaStatusConfig.breached;
                  const StatusIcon = statusCfg.icon;
                  return (
                    <div key={b.id} className="flex items-start gap-3 p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
                      <StatusIcon className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{b.org_name ?? `Org #${b.organization_id}`}</p>
                        <p className="text-xs text-muted-foreground">{b.sla_type?.replace(/_/g, " ")} · Threshold: {b.threshold_value}% · Actual: {b.actual_value}%</p>
                        <p className="text-xs text-red-400 mt-0.5">Breached: {new Date(b.breach_detected_at).toLocaleString()}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge className={`text-xs ${statusCfg.color}`}>{b.status}</Badge>
                        {b.status !== "resolved" && (
                          <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => resolveSla.mutate({ id: b.id })} disabled={resolveSla.isPending}>
                            Resolve
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Drift Alerts */}
        <Card className="bg-card/80 border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-amber-400" />
              Compliance Drift Alerts
            </CardTitle>
            <CardDescription>Organizations showing significant compliance score degradation</CardDescription>
          </CardHeader>
          <CardContent>
            {driftLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading...
              </div>
            ) : !driftAlerts?.length ? (
              <div className="text-center py-8">
                <TrendingUp className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No drift alerts — all scores stable</p>
              </div>
            ) : (
              <div className="space-y-2">
                {driftAlerts.map((d: any) => {
                  const sev = driftSeverityConfig[d.severity] ?? driftSeverityConfig.medium;
                  return (
                    <div key={d.id} className="flex items-start gap-3 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                      <TrendingDown className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{d.org_name ?? `Org #${d.organization_id}`}</p>
                        <p className="text-xs text-muted-foreground">{d.drift_type?.replace(/_/g, " ")} · Score: {d.previous_score}% → {d.current_score}% ({d.drift_percentage > 0 ? "+" : ""}{d.drift_percentage}%)</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Detected: {new Date(d.detected_at).toLocaleString()}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge className={`text-xs ${sev.color}`}>{sev.label}</Badge>
                        {d.status !== "resolved" && (
                          <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => resolveDrift.mutate({ id: d.id })} disabled={resolveDrift.isPending}>
                            Resolve
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Monitoring Snapshots */}
      <Card className="bg-card/80 border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Eye className="w-4 h-4 text-primary" />
                Monitoring Snapshots
              </CardTitle>
              <CardDescription>Point-in-time compliance snapshots captured by all 18 workers</CardDescription>
            </div>
            <div className="flex gap-2 flex-wrap">
              {SNAPSHOT_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setSnapshotType(t.value)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${snapshotType === t.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {snapshotsLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading snapshots...
            </div>
          ) : !snapshots?.length ? (
            <div className="text-center py-8">
              <Activity className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No snapshots yet — workers are generating data</p>
              <p className="text-xs text-muted-foreground mt-1">Snapshots appear as workers complete their monitoring cycles</p>
            </div>
          ) : (
            <div className="space-y-2">
              {snapshots.map((s: any) => {
                const isExpanded = expandedSnapshot === s.id;
                const score = s.compliance_score ?? 0;
                return (
                  <div key={s.id} className="border border-border rounded-lg overflow-hidden">
                    <div
                      className="flex items-center gap-4 p-3 cursor-pointer hover:bg-muted/20 transition-colors"
                      onClick={() => setExpandedSnapshot(isExpanded ? null : s.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-foreground">{s.org_name ?? `Org #${s.organization_id}`}</p>
                          <Badge variant="outline" className="text-xs border-border text-muted-foreground">
                            {s.snapshot_type?.replace(/_/g, " ")}
                          </Badge>
                          {s.worker_name && (
                            <Badge variant="outline" className="text-xs border-border text-muted-foreground">
                              {s.worker_name}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{new Date(s.captured_at).toLocaleString()}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        {s.compliance_score !== null && (
                          <div className="text-right">
                            <p className={`text-lg font-bold ${scoreColor(score)}`}>{score}%</p>
                            <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${scoreBarColor(score)}`} style={{ width: `${score}%` }} />
                            </div>
                          </div>
                        )}
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                      </div>
                    </div>
                    {isExpanded && s.snapshot_data && (
                      <div className="border-t border-border bg-muted/10 p-3">
                        <p className="text-xs text-muted-foreground mb-2 font-medium">Snapshot Data</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {Object.entries(s.snapshot_data as Record<string, unknown>).slice(0, 12).map(([key, val]) => (
                            <div key={key} className="text-xs">
                              <span className="text-muted-foreground">{key.replace(/_/g, " ")}: </span>
                              <span className="text-foreground font-medium">{String(val)}</span>
                            </div>
                          ))}
                        </div>
                        {s.issues_found > 0 && (
                          <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-400">
                            <AlertTriangle className="w-3 h-3" />
                            {s.issues_found} issue{s.issues_found !== 1 ? "s" : ""} found
                            {s.critical_issues > 0 && ` · ${s.critical_issues} critical`}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
