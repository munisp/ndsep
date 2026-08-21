import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Link } from "wouter";

function RangerMetricsPanel() {
  const { data: metrics } = trpc.workers.metrics.useQuery({ workerId: "ranger-policy" }, { refetchInterval: 8000 });
  const m = (metrics as any) ?? {};
  const rows = [
    { label: "Policies Active", value: m.policies_active ?? 0, color: "text-cyan-400" },
    { label: "Access Requests", value: m.access_requests ?? 0, color: "text-foreground" },
    { label: "Access Denied", value: m.access_denied ?? 0, color: "text-red-400" },
    { label: "Column Masks Applied", value: m.column_masks_applied ?? 0, color: "text-yellow-400" },
    { label: "Row Filters Applied", value: m.row_filters_applied ?? 0, color: "text-purple-400" },
    { label: "HDFS Policies", value: m.hdfs_policies ?? 0, color: "text-muted-foreground" },
    { label: "Kafka ACL Entries", value: m.kafka_policies ?? 0, color: "text-muted-foreground" },
    { label: "Audit Events", value: m.audit_events ?? 0, color: "text-green-400" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {rows.map(r => (
        <div key={r.label} className="bg-muted/30 rounded p-2 border border-border/40">
          <p className="data-label text-[9px]">{r.label}</p>
          <p className={`mono text-sm font-bold mt-0.5 ${r.color}`}>{Number(r.value).toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}

function KyvernoMetricsPanel() {
  const { data: metrics } = trpc.workers.metrics.useQuery({ workerId: "kyverno-policy" }, { refetchInterval: 8000 });
  const m = (metrics as any) ?? {};
  const rows = [
    { label: "Policies Active", value: m.kyverno_policies_active ?? 0, color: "text-cyan-400" },
    { label: "Admission Requests", value: m.admission_requests ?? 0, color: "text-foreground" },
    { label: "Admissions Blocked", value: m.admission_blocked ?? 0, color: "text-red-400" },
    { label: "Admissions Mutated", value: m.admission_mutated ?? 0, color: "text-yellow-400" },
    { label: "PII Records Masked", value: m.pii_masked ?? 0, color: "text-purple-400" },
    { label: "Privacera Policies", value: m.privacera_policies ?? 0, color: "text-muted-foreground" },
    { label: "Consent Checks", value: m.consent_checks ?? 0, color: "text-muted-foreground" },
    { label: "Consent Violations", value: m.consent_violations ?? 0, color: "text-red-400" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {rows.map(r => (
        <div key={r.label} className="bg-muted/30 rounded p-2 border border-border/40">
          <p className="data-label text-[9px]">{r.label}</p>
          <p className={`mono text-sm font-bold mt-0.5 ${r.color}`}>{Number(r.value).toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Scale, CheckCircle2, XCircle, Clock, AlertTriangle, Workflow, Play, RefreshCw, ChevronLeft, ChevronRight, Trash2, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const SEV_COLORS: Record<string, string> = {
  critical: "#ef4444", high: "#f97316", medium: "#f59e0b", low: "#10b981"
};

const STATUS_COLORS: Record<string, string> = {
  compliant: "#10b981", non_compliant: "#ef4444", under_review: "#f59e0b", remediated: "#2563eb"
};

const opaRuleExample = `# OPA Rego — Data Residency Policy
package ndsep.residency

default allow = false

allow {
  input.asset.is_within_borders == true
  input.asset.classification != "top_secret"
}

allow {
  input.asset.classification == "public"
}

deny[msg] {
  input.asset.is_within_borders == false
  input.asset.classification in ["top_secret", "secret"]
  msg := sprintf("VIOLATION: %v classified data outside borders",
    [input.asset.classification])
}`;

export default function ComplianceEngine() {
  const utils = trpc.useUtils();
  const { data: policies } = trpc.compliance.policies.useQuery();
  const { data: expiringCerts } = trpc.certificates.expiring.useQuery({ withinDays: 90 }, { refetchInterval: 120_000 });
  const { data: violations } = trpc.compliance.violations.useQuery({ limit: 50 });
  const { data: enforcementActions, refetch: refetchActions } = trpc.compliance.enforcementActions.useQuery({ limit: 15 });

  // Enforcement action modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedViolation, setSelectedViolation] = useState<any>(null);
  const [actionType, setActionType] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [workflowStep, setWorkflowStep] = useState<"form" | "processing" | "success">("form");
  const [violationPage, setViolationPage] = useState(0);
  const VIOLATION_PAGE_SIZE = 15;

  const createAction = trpc.compliance.createAction.useMutation({
    onSuccess: () => {
      setWorkflowStep("success");
      utils.compliance.enforcementActions.invalidate();
      utils.dashboard.stats.invalidate();
      setTimeout(() => {
        setModalOpen(false);
        setWorkflowStep("form");
        setSelectedViolation(null);
        setActionType("");
        setNotes("");
        toast.success("Enforcement workflow initiated", {
          description: `Temporal workflow created for ${selectedViolation?.title}`,
        });
      }, 2000);
    },
    onError: (err) => {
      setWorkflowStep("form");
      toast.error("Failed to create enforcement action", { description: err.message });
    },
  });

  const updateStatus = trpc.compliance.updateStatus.useMutation({
    onSuccess: () => {
      utils.compliance.enforcementActions.invalidate();
      toast.success("Workflow status updated");
    },
  });

  const [deletePolicyId, setDeletePolicyId] = useState<number | null>(null);
  const deletePolicy = trpc.compliance.deletePolicy.useMutation({
    onSuccess: () => { utils.compliance.policies.invalidate(); toast.success("Policy deleted"); setDeletePolicyId(null); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const createViolation = trpc.compliance.createViolation.useMutation({
    onSuccess: () => { utils.compliance.violations.invalidate(); utils.dashboard.stats.invalidate(); setShowCreateViolation(false); setViolationForm({ organizationId: "", title: "", description: "", severity: "medium" }); toast.success("Violation logged"); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const resolveViolation = trpc.compliance.resolveViolation.useMutation({
    onSuccess: () => { utils.compliance.violations.invalidate(); utils.dashboard.stats.invalidate(); toast.success("Violation resolved"); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const [showCreateViolation, setShowCreateViolation] = useState(false);
  const [violationForm, setViolationForm] = useState({ organizationId: "", title: "", description: "", severity: "medium" });
  const { data: orgsForSelect } = trpc.financial.orgsForSelect.useQuery();

  function openEnforcementModal(violation: any) {
    setSelectedViolation(violation);
    setActionType("");
    setNotes("");
    setWorkflowStep("form");
    setModalOpen(true);
  }

  function handleSubmitAction() {
    if (!selectedViolation || !actionType) return;
    setWorkflowStep("processing");
    createAction.mutate({
      organizationId: selectedViolation.organizationId,
      violationId: selectedViolation.id,
      actionType: actionType as any,
      notes: notes || undefined,
    });
  }

  const violBySeverity = (violations ?? []).reduce((acc: any, v: any) => {
    acc[v.severity] = (acc[v.severity] ?? 0) + 1;
    return acc;
  }, {});

  const sevChartData = Object.entries(violBySeverity).map(([k, v]) => ({
    name: k.toUpperCase(), count: v as number, color: SEV_COLORS[k] ?? "#6b7280"
  }));

  const policyCompliance = (policies ?? []).map((p: any) => ({
    name: p.name?.substring(0, 25) + (p.name?.length > 25 ? "…" : ""),
    weight: Number(p.weight ?? 0),
    active: p.isActive,
  }));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Compliance Engine" }]} className="mb-4" />
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="layer-badge">LAYER 3</span>
            <span className="data-label">OPA · Temporal · Policy Engine · Decision Hub</span>
          </div>
          <h1 className="text-2xl font-bold">Compliance Engine</h1>
          <p className="text-muted-foreground mono text-sm mt-0.5">Policy enforcement · Residency checks · Cross-border detection · Automated remediation</p>
        </div>
        <Button size="sm" className="gap-1" onClick={() => setShowCreateViolation(true)}><Plus className="h-3.5 w-3.5" /> Log Violation</Button>
      </div>

      {/* Certificate Expiry Warning */}
      {expiringCerts && (expiringCerts as any[]).length > 0 && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-950/20 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-yellow-400" />
            <span className="text-xs font-bold text-yellow-400 mono">COMPLIANCE CERTIFICATES EXPIRING WITHIN 90 DAYS</span>
            <span className="text-xs text-yellow-400/70 mono">&middot; {(expiringCerts as any[]).length} org{(expiringCerts as any[]).length !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {(expiringCerts as any[]).map((c: any) => (
              <div key={c.id} className="flex items-center gap-2 bg-yellow-950/30 border border-yellow-500/20 rounded px-3 py-1.5">
                <span className={`h-2 w-2 rounded-full ${Number(c.days_remaining) <= 30 ? 'bg-red-500 animate-pulse' : 'bg-yellow-500'}`} />
                <span className="text-xs font-semibold text-yellow-200">{c.org_name}</span>
                <Badge variant="outline" className={`text-xs h-4 px-1 ${
                  Number(c.days_remaining) <= 30 ? 'border-red-500/40 text-red-400' : 'border-yellow-500/40 text-yellow-400'
                }`}>
                  {Number(c.days_remaining)}d remaining
                </Badge>
                <span className="text-xs text-muted-foreground mono capitalize">{c.org_sector}</span>
                <Link
                  href={`/portal-review?org=${encodeURIComponent(c.org_name ?? '')}&submissionId=${c.id}`}
                  className="ml-1 text-xs text-yellow-400 hover:text-yellow-300 mono underline whitespace-nowrap"
                >
                  Renew &rarr;
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Active Policies", value: (policies ?? []).filter((p: any) => p.isActive).length, icon: Scale, color: "#2563eb" },
          { label: "Total Violations", value: violations?.length ?? 0, icon: XCircle, color: "#ef4444" },
          { label: "Critical Violations", value: violBySeverity["critical"] ?? 0, icon: AlertTriangle, color: "#ef4444" },
          { label: "Enforcement Actions", value: enforcementActions?.length ?? 0, icon: Workflow, color: "#8b5cf6" },
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Violations by Severity */}
        <Card className="border border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Violations by Severity</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={sevChartData} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }} />
                <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                <Tooltip contentStyle={{ fontSize: 11, fontFamily: "JetBrains Mono", background: "var(--card)", border: "1px solid var(--border)" }} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {sevChartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* OPA Rule Editor */}
        <Card className="lg:col-span-2 border border-border/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">OPA Rego Policy Editor</CardTitle>
              <Badge variant="outline" className="mono text-[9px] text-green-600 border-green-600/40">ACTIVE</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted/40 rounded-lg p-3 text-[10px] mono overflow-x-auto border border-border/40 leading-relaxed text-foreground/80 max-h-[180px] overflow-y-auto">
              {opaRuleExample}
            </pre>
          </CardContent>
        </Card>
      </div>

      {/* Policy List */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Active Compliance Policies</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  {["Policy Name", "Category", "Severity", "Weight", "Status", "Enforcement", ""].map(h => (
                    <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(policies ?? []).map((policy: any) => (
                  <tr key={policy.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-medium">{policy.name}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="mono text-[9px] capitalize">{policy.category?.replace("_", " ")}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="mono text-[10px] font-semibold capitalize" style={{ color: SEV_COLORS[policy.severity] }}>{policy.severity}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Progress value={Number(policy.weight ?? 0)} className="h-1.5 w-16" />
                        <span className="mono text-[10px]">{Number(policy.weight ?? 0).toFixed(0)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {policy.isActive ? (
                        <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-600" /><span className="mono text-[10px] text-green-600">Active</span></div>
                      ) : (
                        <div className="flex items-center gap-1"><XCircle className="h-3 w-3 text-muted-foreground" /><span className="mono text-[10px] text-muted-foreground">Inactive</span></div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="mono text-[9px] capitalize">{policy.enforcementMode?.replace("_", " ")}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300 h-7 w-7 p-0" onClick={() => setDeletePolicyId(policy.id)} disabled={deletePolicy.isPending} aria-label="Delete policy">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Violations Table */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Compliance Violations</CardTitle>
            <span className="data-label">{violations?.length ?? 0} records</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  {["Severity", "Title", "Organization", "Policy", "Status", "Detected", "Remediation", "Action"].map(h => (
                    <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(violations ?? []).slice(violationPage * VIOLATION_PAGE_SIZE, (violationPage + 1) * VIOLATION_PAGE_SIZE).map((v: any) => (
                  <tr key={v.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={`mono text-[9px] capitalize severity-${v.severity}`}>{v.severity}</Badge>
                    </td>
                    <td className="px-4 py-2.5 font-medium truncate max-w-[180px]">{v.title}</td>
                    <td className="px-4 py-2.5 mono text-muted-foreground">{(v as any).organizationName ?? `Org #${v.organizationId}`}</td>
                    <td className="px-4 py-2.5 mono text-muted-foreground">{v.policyId ? `Policy #${v.policyId}` : "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className="mono text-[10px] capitalize" style={{ color: STATUS_COLORS[v.status] }}>{v.status?.replace("_", " ")}</span>
                    </td>
                    <td className="px-4 py-2.5 mono text-muted-foreground">{v.detectedAt ? new Date(v.detectedAt).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="mono text-[9px] capitalize">{v.remediationAction?.replace("_", " ") ?? "pending"}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] mono border-primary/40 text-primary hover:bg-primary/10" onClick={() => openEnforcementModal(v)}>
                          <Play className="h-2.5 w-2.5 mr-1" />Enforce
                        </Button>
                        {v.status !== "compliant" && (
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] mono text-green-400 hover:text-green-300" onClick={() => { if (confirm(`Mark "${v.title}" as resolved?`)) resolveViolation.mutate({ id: v.id }); }}>
                            ✓
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
               </tbody>
            </table>
          </div>
          {(violations ?? []).length > VIOLATION_PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
              <span className="data-label">Showing {violationPage * VIOLATION_PAGE_SIZE + 1}–{Math.min((violationPage + 1) * VIOLATION_PAGE_SIZE, (violations ?? []).length)} of {(violations ?? []).length}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setViolationPage(p => Math.max(0, p - 1))} disabled={violationPage === 0}><ChevronLeft className="h-3 w-3" /></Button>
                <span className="mono text-xs">{violationPage + 1} / {Math.ceil((violations ?? []).length / VIOLATION_PAGE_SIZE)}</span>
                <Button variant="outline" size="sm" onClick={() => setViolationPage(p => Math.min(Math.ceil((violations ?? []).length / VIOLATION_PAGE_SIZE) - 1, p + 1))} disabled={violationPage >= Math.ceil((violations ?? []).length / VIOLATION_PAGE_SIZE) - 1}><ChevronRight className="h-3 w-3" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      {/* Temporal Workflow Enforcement Actions */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Temporal Enforcement Workflows</CardTitle>
            <span className="layer-badge">TEMPORAL · DAPR</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  {["Workflow ID", "Action Type", "Organization", "Status", "Initiated", "Completed"].map(h => (
                    <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(enforcementActions ?? []).map((action: any) => (
                  <tr key={action.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 mono text-muted-foreground">{action.workflowId?.substring(0, 16) ?? `WF-${action.id}`}…</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="mono text-[9px] capitalize">{action.actionType?.replace("_", " ")}</Badge>
                    </td>
                    <td className="px-4 py-2.5 mono text-muted-foreground">Org #{action.organizationId}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        {action.status === "completed" ? <CheckCircle2 className="h-3 w-3 text-green-600" /> : action.status === "failed" ? <XCircle className="h-3 w-3 text-red-500" /> : <Clock className="h-3 w-3 text-yellow-500" />}
                        <span className="mono text-[10px] capitalize">{action.status}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 mono text-muted-foreground">{action.createdAt ? new Date(action.createdAt).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-2.5 mono text-muted-foreground">{action.completedAt ? new Date(action.completedAt).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Apache Ranger + Kyverno Live Worker Panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Apache Ranger Panel */}
        <Card className="border border-border/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                Apache Ranger — Policy Enforcement
              </CardTitle>
              <span className="layer-badge">L3 · GO</span>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            <RangerMetricsPanel />
          </CardContent>
        </Card>
        {/* Kyverno + Privacera Panel */}
        <Card className="border border-border/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                Kyverno + Privacera — Admission Control
              </CardTitle>
              <span className="layer-badge">L3 · GO</span>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            <KyvernoMetricsPanel />
          </CardContent>
        </Card>
      </div>

      {/* Enforcement Action Creation Modal */}
      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open && workflowStep !== "processing") setModalOpen(false); }}>
        <DialogContent className="max-w-lg font-mono">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold tracking-wide">
              <div className="flex items-center gap-2">
                <Workflow className="h-4 w-4 text-primary" />
                INITIATE TEMPORAL ENFORCEMENT WORKFLOW
              </div>
            </DialogTitle>
          </DialogHeader>

          {workflowStep === "form" && (
            <div className="space-y-4 py-2">
              {/* Violation Summary */}
              {selectedViolation && (
                <div className="bg-muted/40 border border-border/60 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="data-label">VIOLATION REFERENCE</span>
                    <Badge variant="outline" className={`mono text-[9px] capitalize severity-${selectedViolation.severity}`}>{selectedViolation.severity}</Badge>
                  </div>
                  <p className="text-sm font-semibold">{selectedViolation.title}</p>
                  <p className="text-xs text-muted-foreground">{selectedViolation.description?.substring(0, 120)}…</p>
                  <div className="flex gap-3 text-[10px] text-muted-foreground">
                    <span>ORG #{selectedViolation.organizationId}</span>
                    <span>·</span>
                    <span>POLICY #{selectedViolation.policyId}</span>
                    <span>·</span>
                    <span>{selectedViolation.detectedAt ? new Date(selectedViolation.detectedAt).toLocaleDateString() : "—"}</span>
                  </div>
                </div>
              )}

              {/* Workflow Steps Visualization */}
              <div className="space-y-1">
                <Label className="data-label text-[10px]">TEMPORAL WORKFLOW SEQUENCE</Label>
                <div className="flex items-center gap-1 py-2">
                  {["notice", "audit", "penalty", "suspension", "revocation"].map((step, i, arr) => (
                    <div key={step} className="flex items-center gap-1 flex-1">
                      <div className={`flex-1 text-center py-1 px-1 rounded text-[9px] font-semibold border transition-all ${
                        actionType === step
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/30 text-muted-foreground border-border/40"
                      }`}>
                        {step.toUpperCase()}
                      </div>
                      {i < arr.length - 1 && <span className="text-muted-foreground text-[10px]">→</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Type Select */}
              <div className="space-y-1.5">
                <Label className="data-label text-[10px]">ACTION TYPE *</Label>
                <Select value={actionType} onValueChange={setActionType}>
                  <SelectTrigger className="h-8 text-xs mono">
                    <SelectValue placeholder="Select enforcement action..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="notice" className="text-xs mono">Notice — Formal compliance notice issued</SelectItem>
                    <SelectItem value="audit" className="text-xs mono">Audit — Full data sovereignty audit triggered</SelectItem>
                    <SelectItem value="penalty" className="text-xs mono">Penalty — Financial penalty via TigerBeetle ledger</SelectItem>
                    <SelectItem value="suspension" className="text-xs mono">Suspension — Data processing suspended</SelectItem>
                    <SelectItem value="revocation" className="text-xs mono">Revocation — Operating licence revoked</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label className="data-label text-[10px]">ENFORCEMENT NOTES (OPTIONAL)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add enforcement rationale, evidence references, or instructions..."
                  className="text-xs mono h-20 resize-none"
                />
              </div>

              {/* Workflow metadata */}
              <div className="bg-muted/20 border border-border/40 rounded p-2 text-[10px] mono text-muted-foreground space-y-0.5">
                <p>⚙ Temporal workflow engine · Dapr sidecar · Go runtime</p>
                <p>⚙ Workflow ID will be auto-generated (UUID v4)</p>
                <p>⚙ Audit trail entry created in OpenSearch upon submission</p>
              </div>
            </div>
          )}

          {workflowStep === "processing" && (
            <div className="py-8 flex flex-col items-center gap-4">
              <RefreshCw className="h-10 w-10 text-primary animate-spin" />
              <div className="text-center">
                <p className="text-sm font-semibold">Initiating Temporal Workflow...</p>
                <p className="text-xs text-muted-foreground mono mt-1">Creating enforcement record · Notifying Dapr sidecar · Writing audit log</p>
              </div>
              <div className="w-full bg-muted/40 rounded-full h-1.5 overflow-hidden">
                <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: "70%" }} />
              </div>
            </div>
          )}

          {workflowStep === "success" && (
            <div className="py-8 flex flex-col items-center gap-4">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <div className="text-center">
                <p className="text-sm font-bold text-green-600">Workflow Initiated Successfully</p>
                <p className="text-xs text-muted-foreground mono mt-1">Temporal enforcement workflow is now running</p>
                <p className="text-xs text-muted-foreground mono">Audit trail entry written · Dashboard updated</p>
              </div>
            </div>
          )}

          <DialogFooter>
            {workflowStep === "form" && (
              <>
                <Button variant="outline" size="sm" className="mono text-xs" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button
                  size="sm"
                  className="mono text-xs"
                  disabled={!actionType || createAction.isPending}
                  onClick={handleSubmitAction}
                >
                  <Play className="h-3 w-3 mr-1.5" />
                  Initiate Workflow
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Violation Dialog */}
      <Dialog open={showCreateViolation} onOpenChange={setShowCreateViolation}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm font-semibold mono">Log Manual Violation</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="data-label text-[10px]">ORGANIZATION</Label>
              <Select value={violationForm.organizationId} onValueChange={(v) => setViolationForm(f => ({ ...f, organizationId: v }))}>
                <SelectTrigger className="text-xs mono h-8"><SelectValue placeholder="Select organization" /></SelectTrigger>
                <SelectContent>{(orgsForSelect ?? []).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-xs mono">{o.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="data-label text-[10px]">TITLE</Label>
              <Input className="text-xs mono h-8" placeholder="Violation title..." value={violationForm.title} onChange={(e) => setViolationForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="data-label text-[10px]">SEVERITY</Label>
              <Select value={violationForm.severity} onValueChange={(v) => setViolationForm(f => ({ ...f, severity: v }))}>
                <SelectTrigger className="text-xs mono h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["low","medium","high","critical"].map(s => <SelectItem key={s} value={s} className="text-xs mono capitalize">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="data-label text-[10px]">DESCRIPTION (OPTIONAL)</Label>
              <Textarea className="text-xs mono h-16 resize-none" placeholder="Describe the violation..." value={violationForm.description} onChange={(e) => setViolationForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="mono text-xs" onClick={() => setShowCreateViolation(false)}>Cancel</Button>
            <Button size="sm" className="mono text-xs" disabled={!violationForm.organizationId || !violationForm.title || createViolation.isPending}
              onClick={() => createViolation.mutate({ organizationId: Number(violationForm.organizationId), title: violationForm.title, description: violationForm.description || undefined, severity: violationForm.severity as any })}>
              Log Violation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Policy Confirmation */}
      <AlertDialog open={deletePolicyId !== null} onOpenChange={() => setDeletePolicyId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Policy</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this compliance policy. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deletePolicyId && deletePolicy.mutate({ id: deletePolicyId })} disabled={deletePolicy.isPending}>
              {deletePolicy.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
