import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import {
  Activity, CheckCircle2, Clock, AlertTriangle, XCircle,
  RefreshCw, GitBranch, Zap, Shield, DollarSign, Search, Database
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const WORKFLOW_TYPES = [
  {
    id: "enforcement-pipeline",
    name: "Enforcement Pipeline",
    description: "Violation detected → Notice issued → Audit → Penalty → Settlement",
    icon: Shield,
    color: "text-red-400",
    steps: ["detect_violation", "issue_notice", "schedule_audit", "impose_penalty", "collect_payment", "close_case"],
    avgDurationMin: 2880,
  },
  {
    id: "asset-discovery-scan",
    name: "Asset Discovery Scan",
    description: "Nmap scan → Fingerprint → CVE check → NetBox update → Report",
    icon: Search,
    color: "text-blue-400",
    steps: ["initiate_scan", "port_scan", "fingerprint", "cve_lookup", "update_netbox", "notify"],
    avgDurationMin: 15,
  },
  {
    id: "compliance-assessment",
    name: "Compliance Assessment",
    description: "OPA evaluation → Ranger policy check → Score calculation → Report",
    icon: CheckCircle2,
    color: "text-green-400",
    steps: ["fetch_policies", "evaluate_opa", "check_ranger", "calculate_score", "generate_report", "notify_org"],
    avgDurationMin: 5,
  },
  {
    id: "data-residency-check",
    name: "Data Residency Check",
    description: "Catalog scan → Geospatial check → Violation flag → Remediation",
    icon: Database,
    color: "text-purple-400",
    steps: ["scan_catalog", "check_geofence", "flag_violations", "notify_dpo", "track_remediation"],
    avgDurationMin: 30,
  },
  {
    id: "financial-penalty-collection",
    name: "Penalty Collection",
    description: "Penalty issued → TigerBeetle ledger → Mojaloop transfer → Receipt",
    icon: DollarSign,
    color: "text-yellow-400",
    steps: ["create_ledger_entry", "send_notice", "await_payment", "process_transfer", "issue_receipt", "update_status"],
    avgDurationMin: 10080,
  },
  {
    id: "bgp-hijack-response",
    name: "BGP Hijack Response",
    description: "Hijack detected → RPKI invalidate → Blackhole route → Alert NOC",
    icon: Zap,
    color: "text-orange-400",
    steps: ["detect_hijack", "validate_rpki", "issue_blackhole", "alert_noc", "monitor_recovery", "close_incident"],
    avgDurationMin: 60,
  },
  {
    id: "remediation",
    name: "Remediation Workflow",
    description: "Detect → Assign → Remediate → Verify → Close",
    icon: Shield,
    color: "text-teal-400",
    steps: ["detect", "assign", "remediate", "verify", "close"],
    avgDurationMin: 1440,
  },
];

const STATUS_COLORS: Record<string, string> = {
  RUNNING: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  COMPLETED: "bg-green-500/20 text-green-400 border-green-500/30",
  FAILED: "bg-red-500/20 text-red-400 border-red-500/30",
  TIMED_OUT: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  CANCELLED: "bg-muted0/20 text-muted-foreground border-border/30",
};

const STATUS_ICONS: Record<string, React.ElementType> = {
  RUNNING: Activity,
  COMPLETED: CheckCircle2,
  FAILED: XCircle,
  TIMED_OUT: Clock,
  CANCELLED: AlertTriangle,
};

export default function TemporalWorkflows() {
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [triggerType, setTriggerType] = useState(WORKFLOW_TYPES[0].id);
  const [triggerOrgId, setTriggerOrgId] = useState("1");
  const [localRuns, setLocalRuns] = useState<any[]>([]);

  const utils = trpc.useUtils();
  const { data: workflowData, refetch } = trpc.orchestration.listWorkflows.useQuery(
    { limit: 50 },
    { refetchInterval: 30000 }
  );
  const { data: complianceViolations } = trpc.compliance.violations.useQuery({ limit: 5, severity: "critical" });

  // Merge live DB/worker runs with any locally-triggered runs
  const runs = useMemo(() => {
    const liveRuns = (workflowData?.runs ?? []).map((r: any) => {
      const wfType = WORKFLOW_TYPES.find(w => w.id === r.type?.id) ?? WORKFLOW_TYPES.find(w => w.id === "remediation")!;
      return {
        ...r,
        type: wfType,
        stepsCompleted: r.currentStep ?? 0,
        totalSteps: wfType.steps.length,
        currentStep: wfType.steps[Math.min(r.currentStep ?? 0, wfType.steps.length - 1)] ?? "unknown",
      };
    });
    return [...localRuns, ...liveRuns];
  }, [workflowData, localRuns]);

  const triggerWorkflowMutation = trpc.orchestration.triggerWorkflow.useMutation({
    onSuccess: (result: any) => {
      const wfType = WORKFLOW_TYPES.find(w => w.id === triggerType) ?? WORKFLOW_TYPES[0];
      const newRun = {
        workflowId: result?.workflowId ?? `${triggerType}-${Date.now().toString(36)}`,
        type: wfType,
        status: "RUNNING" as const,
        stepsCompleted: 0,
        totalSteps: wfType.steps.length,
        currentStep: wfType.steps[0],
        startedAt: new Date().toISOString(),
        orgName: `Org #${triggerOrgId}`,
      };
      setLocalRuns(prev => [newRun, ...prev]);
      setLastRefresh(new Date());
      utils.orchestration.listWorkflows.invalidate();
    },
  });

  const refresh = () => {
    refetch();
    setLastRefresh(new Date());
  };

  useEffect(() => {
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, []);

  const runningCount = runs.filter((r: any) => r.status === "RUNNING").length;
  const completedCount = runs.filter((r: any) => r.status === "COMPLETED").length;
  const failedCount = runs.filter((r: any) => r.status === "FAILED" || r.status === "TIMED_OUT").length;
  const successRate = runs.length > 0 ? Math.round((completedCount / runs.length) * 100) : 0;

  const typeSummary = WORKFLOW_TYPES.map(wt => ({
    ...wt,
    running: runs.filter((r: any) => r.type?.id === wt.id && r.status === "RUNNING").length,
    completed: runs.filter((r: any) => r.type?.id === wt.id && r.status === "COMPLETED").length,
    failed: runs.filter((r: any) => r.type?.id === wt.id && (r.status === "FAILED" || r.status === "TIMED_OUT")).length,
  }));

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Temporal Workflows" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <GitBranch className="w-6 h-6 text-purple-400" />
            Temporal Workflow Engine
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Durable execution engine for enforcement, discovery, and compliance workflows
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-muted-foreground">
            Last refresh: {lastRefresh.toLocaleTimeString()}
          </span>
          <select
            value={triggerType}
            onChange={e => setTriggerType(e.target.value)}
            className="text-xs bg-card border border-border rounded px-2 py-1 text-muted-foreground"
          >
            {WORKFLOW_TYPES.map(wt => (
              <option key={wt.id} value={wt.id}>{wt.name}</option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            value={triggerOrgId}
            onChange={e => setTriggerOrgId(e.target.value)}
            placeholder="Org ID"
            className="text-xs bg-card border border-border rounded px-2 py-1 text-muted-foreground w-20"
          />
          <Button
            size="sm"
            onClick={() => triggerWorkflowMutation.mutate({
              workflowType: triggerType,
              workflowId: `${triggerType}-${Date.now().toString(36)}`,
              input: { organizationId: Number(triggerOrgId) },
            })}
            disabled={triggerWorkflowMutation.isPending}
            className="gap-2 bg-purple-600 hover:bg-purple-700 text-foreground"
          >
            <Zap className="w-3 h-3" />
            {triggerWorkflowMutation.isPending ? "Triggering..." : "Trigger"}
          </Button>
          <Button variant="outline" size="sm" onClick={refresh} className="gap-2">
            <RefreshCw className="w-3 h-3" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Running", value: runningCount, color: "text-blue-400", icon: Activity },
          { label: "Completed", value: completedCount, color: "text-green-400", icon: CheckCircle2 },
          { label: "Failed / Timed Out", value: failedCount, color: "text-red-400", icon: XCircle },
          { label: "Success Rate", value: `${successRate}%`, color: "text-yellow-400", icon: Zap },
        ].map(({ label, value, color, icon: Icon }) => (
          <Card key={label} className="bg-card/50 border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={`w-8 h-8 ${color}`} />
              <div>
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Workflow Type Summary */}
      <Card className="bg-card/50 border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-foreground text-base">Workflow Types</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {typeSummary.map(wt => {
              const Icon = wt.icon;
              return (
                <div key={wt.id} className="bg-background/50 rounded-lg p-3 border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-4 h-4 ${wt.color}`} />
                    <span className="text-sm font-medium text-foreground">{wt.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">{wt.description}</p>
                  <div className="flex gap-2 text-xs">
                    <span className="text-blue-400">{wt.running} running</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-green-400">{wt.completed} done</span>
                    {wt.failed > 0 && (
                      <>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-red-400">{wt.failed} failed</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Active Workflow Runs */}
      <Card className="bg-card/50 border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-foreground text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-400" />
            Workflow Execution Log
            <Badge className="ml-2 bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
              {runs.length} executions
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {runs.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground text-sm">
              No workflow runs found. Trigger a workflow above to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground text-xs">
                    <th className="text-left px-4 py-2">Workflow ID</th>
                    <th className="text-left px-4 py-2">Type</th>
                    <th className="text-left px-4 py-2">Organization</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-left px-4 py-2">Progress</th>
                    <th className="text-left px-4 py-2">Current Step</th>
                    <th className="text-left px-4 py-2">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run: any, idx: number) => {
                    const StatusIcon = STATUS_ICONS[run.status] ?? Activity;
                    const progress = run.totalSteps > 0
                      ? Math.round((run.stepsCompleted / run.totalSteps) * 100)
                      : 0;
                    return (
                      <tr key={run.workflowId ?? idx} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                          {String(run.workflowId ?? "").substring(0, 20)}...
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1">
                            {run.type?.icon && <run.type.icon className={`w-3 h-3 ${run.type.color}`} />}
                            <span className="text-foreground text-xs">{run.type?.name ?? "Workflow"}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{run.orgName ?? "—"}</td>
                        <td className="px-4 py-2">
                          <Badge className={`text-xs border ${STATUS_COLORS[run.status] ?? STATUS_COLORS.RUNNING} gap-1`}>
                            <StatusIcon className="w-3 h-3" />
                            {run.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <Progress value={progress} className="w-16 h-1.5" />
                            <span className="text-xs text-muted-foreground">{run.stepsCompleted}/{run.totalSteps}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{run.currentStep ?? "—"}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Enforcement Workflows */}
      {complianceViolations && complianceViolations.length > 0 && (
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-foreground text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              Critical Violations Awaiting Enforcement Workflow
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {complianceViolations.map((v: any) => (
                <div key={v.id} className="flex items-center justify-between bg-red-500/5 border border-red-500/20 rounded p-3">
                  <div>
                    <div className="text-sm text-foreground font-medium">{v.title}</div>
                    <div className="text-xs text-muted-foreground">{v.description?.substring(0, 100)}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                    onClick={() => triggerWorkflowMutation.mutate({
                      workflowType: "enforcement-pipeline",
                      workflowId: `enforcement-${v.id}-${Date.now().toString(36)}`,
                      input: { violationId: v.id, organizationId: v.organizationId },
                    })}
                    disabled={triggerWorkflowMutation.isPending}
                  >
                    Trigger Enforcement
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
