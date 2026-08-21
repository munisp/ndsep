import React from "react";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Gavel, AlertTriangle, Clock, CheckCircle2, XCircle,
  ChevronRight, Building2, FileText, RefreshCw, Download, CheckCheck, History,
  Trash2, Plus
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: React.ComponentType<any> }> = {
  open:                   { label: "Open",                  color: "text-red-400",    bg: "border-red-500/40 bg-red-950/20",    icon: AlertTriangle },
  under_investigation:    { label: "Under Investigation",   color: "text-yellow-400", bg: "border-yellow-500/40 bg-yellow-950/20", icon: Clock },
  notice_issued:          { label: "Notice Issued",         color: "text-orange-400", bg: "border-orange-500/40 bg-orange-950/20", icon: FileText },
  escalated_to_nitda:     { label: "Escalated to NITDA",    color: "text-purple-400", bg: "border-purple-500/40 bg-purple-950/20", icon: ChevronRight },
  settled:                { label: "Settled",               color: "text-green-400",  bg: "border-green-500/40 bg-green-950/20",  icon: CheckCircle2 },
  closed:                 { label: "Closed",                color: "text-muted-foreground", bg: "border-border/40 bg-muted/10", icon: XCircle },
};

const STATUS_ORDER = ["open", "under_investigation", "notice_issued", "escalated_to_nitda", "settled", "closed"];

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META["open"];
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-semibold mono ${m.color} ${m.bg}`}>
      <Icon className="h-3 w-3" />
      {m.label}
    </span>
  );
}

function StatusTimeline({ status }: { status: string }) {
  const idx = STATUS_ORDER.indexOf(status);
  const activeStatuses = ["open", "under_investigation", "notice_issued", "escalated_to_nitda"];
  const steps = activeStatuses.map((s, i) => ({
    s, label: STATUS_META[s].label, done: i < idx, active: i === idx && !["settled", "closed"].includes(status)
  }));
  if (["settled", "closed"].includes(status)) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {steps.map((step, i) => (
        <div key={step.s} className="flex items-center gap-1">
          <span className={`text-[10px] mono px-1.5 py-0.5 rounded ${
            step.active ? "bg-primary text-primary-foreground font-bold" :
            step.done ? "bg-green-900/40 text-green-400" : "bg-muted/30 text-muted-foreground"
          }`}>{step.label}</span>
          {i < steps.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
        </div>
      ))}
    </div>
  );
}

export default function EnforcementCases() {
  const utils = trpc.useUtils();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ penaltyId: "", organizationId: "", escalationReason: "", assignedOfficerId: "" });
  const createCase = trpc.enforcementCases.create.useMutation({
    onSuccess: () => { toast.success("Enforcement case created"); setShowCreate(false); setCreateForm({ penaltyId: "", organizationId: "", escalationReason: "", assignedOfficerId: "" }); utils.enforcementCases.list.invalidate(); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e)) || "Failed to create case"),
  });
  const { data: cases, isLoading } = trpc.enforcementCases.list.useQuery({ limit: 100 }, { refetchInterval: 30_000 });
  const updateCase = trpc.enforcementCases.update.useMutation({
    onSuccess: () => {
      utils.enforcementCases.list.invalidate();
      setModalOpen(false);
      toast.success("Enforcement case updated");
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const deleteMutation = trpc.enforcementCases.delete.useMutation({
    onSuccess: () => {
      toast.success("Enforcement case deleted");
      setDeleteId(null);
      utils.enforcementCases.list.invalidate().catch(() => {});
    },
    onError: (err) => toast.error(err.message || "Failed to delete enforcement case"),
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [newStatus, setNewStatus] = useState("");
  const [nitdaRef, setNitdaRef] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [settlingId, setSettlingId] = useState<number | null>(null);
  const [nitdaConfirmOpen, setNitdaConfirmOpen] = useState(false);
  const [nitdaConfirmRef, setNitdaConfirmRef] = useState("");
  const [nitdaConfirmSummary, setNitdaConfirmSummary] = useState("");
  const [nitdaTargetCase, setNitdaTargetCase] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"update" | "history">("update");
  const { data: timeline, isLoading: timelineLoading } = trpc.enforcementCases.timeline.useQuery(
    { caseId: selected?.id ?? 0 },
    { enabled: !!selected && activeTab === "history" }
  );

  function quickSettle(c: any) {
    if (!window.confirm(`Settle case ${c.case_reference}? This marks it as resolved.`)) return;
    setSettlingId(c.id);
    updateCase.mutate(
      { id: c.id, status: "settled", resolutionNotes: "Settled via quick-action." },
      { onSettled: () => setSettlingId(null) }
    );
  }

  function openModal(c: any) {
    setSelected(c);
    setNewStatus(c.status);
    setNitdaRef(c.nitda_reference_number ?? "");
    setResolutionNotes(c.resolution_notes ?? "");
    setActiveTab("update");
    setModalOpen(true);
  }

  function handleUpdate() {
    if (!selected) return;
    if (newStatus === "escalated_to_nitda" && selected.status !== "escalated_to_nitda") {
      setNitdaTargetCase(selected);
      setNitdaConfirmRef(nitdaRef || "");
      setNitdaConfirmSummary(resolutionNotes || "");
      setNitdaConfirmOpen(true);
      return;
    }
    updateCase.mutate({
      id: selected.id,
      status: newStatus as any,
      nitdaReferenceNumber: nitdaRef || undefined,
      resolutionNotes: resolutionNotes || undefined,
    });
  }

  function handleNitdaConfirm() {
    if (!nitdaTargetCase || !nitdaConfirmRef.trim()) {
      toast.error("NITDA Reference Number is required before escalating.");
      return;
    }
    updateCase.mutate(
      { id: nitdaTargetCase.id, status: "escalated_to_nitda", nitdaReferenceNumber: nitdaConfirmRef.trim(), resolutionNotes: nitdaConfirmSummary || undefined },
      { onSuccess: () => { setNitdaConfirmOpen(false); setNitdaConfirmRef(""); setNitdaConfirmSummary(""); setNitdaTargetCase(null); } }
    );
  }

  const allCases = (cases as any[]) ?? [];
  const filtered = statusFilter === "all" ? allCases : allCases.filter((c: any) => c.status === statusFilter);

  const stats = {
    open: allCases.filter((c: any) => c.status === "open").length,
    under_investigation: allCases.filter((c: any) => c.status === "under_investigation").length,
    escalated: allCases.filter((c: any) => c.status === "escalated_to_nitda").length,
    settled: allCases.filter((c: any) => c.status === "settled").length,
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Enforcement", href: "/enforcement" }, { label: "Enforcement Cases" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="layer-badge">ENF</span>
            <span className="data-label">NITDA · Penalty Escalation · Case Management</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Enforcement Cases</h1>
          <p className="text-muted-foreground mono text-sm mt-0.5">
            Escalated penalty cases · NITDA referrals · Resolution tracking
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="gap-1 bg-blue-600 hover:bg-blue-700" onClick={() => setShowCreate(true)}><Plus className="h-3.5 w-3.5" /> New Case</Button>
          <Button size="sm" variant="outline" onClick={() => utils.enforcementCases.list.invalidate()} className="gap-1">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Open Cases",           value: stats.open,               color: "#ef4444", icon: AlertTriangle },
          { label: "Under Investigation",  value: stats.under_investigation, color: "#f59e0b", icon: Clock },
          { label: "Escalated to NITDA",   value: stats.escalated,          color: "#8b5cf6", icon: ChevronRight },
          { label: "Settled / Closed",     value: stats.settled,            color: "#10b981", icon: CheckCircle2 },
        ].map(m => (
          <Card key={m.label} className="border border-border/60 relative overflow-hidden">
            <div className="absolute inset-0 blueprint-grid opacity-20" />
            <CardContent className="relative p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="data-label">{m.label}</p>
                  <p className="metric-value text-2xl font-bold mt-1">{m.value}</p>
                </div>
                <m.icon className="h-6 w-6 opacity-60" style={{ color: m.color }} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="data-label">Filter by status:</span>
        {["all", ...STATUS_ORDER].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`text-xs mono px-2.5 py-1 rounded border transition-colors ${
              statusFilter === s
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border/40 text-muted-foreground hover:border-border"
            }`}
          >
            {s === "all" ? "All" : STATUS_META[s]?.label ?? s}
          </button>
        ))}
      </div>

      {/* Cases Table */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Gavel className="h-4 w-4 text-primary" />
            {statusFilter === "all" ? `All Cases (${filtered.length})` : `${STATUS_META[statusFilter]?.label ?? statusFilter} (${filtered.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground mono text-sm">Loading enforcement cases…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground mono text-sm">No cases found for this filter.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    <th className="text-left px-4 py-2.5 data-label">Case Ref</th>
                    <th className="text-left px-4 py-2.5 data-label">Organisation</th>
                    <th className="text-left px-4 py-2.5 data-label">Penalty</th>
                    <th className="text-left px-4 py-2.5 data-label">Status</th>
                    <th className="text-left px-4 py-2.5 data-label">Overdue Days</th>
                    <th className="text-left px-4 py-2.5 data-label">NITDA Ref</th>
                    <th className="text-left px-4 py-2.5 data-label">Opened</th>
                    <th className="text-left px-4 py-2.5 data-label">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c: any) => (
                    <tr key={c.id} className="border-b border-border/20 hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-3">
                        <span className="mono text-xs font-semibold text-primary">{c.case_reference}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="font-medium text-foreground text-xs">{c.org_name ?? `Org #${c.organization_id}`}</span>
                        </div>
                        {c.org_sector && <span className="text-[10px] text-muted-foreground mono capitalize ml-5">{c.org_sector}</span>}
                      </td>
                      <td className="px-4 py-3">
                        {c.penalty_amount ? (
                          <span className="mono text-xs text-foreground">
                            ₦{Number(c.penalty_amount).toLocaleString()}
                          </span>
                        ) : (
                          <span className="mono text-xs text-muted-foreground">Penalty #{c.penalty_id}</span>
                        )}
                        {c.escalation_reason && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 max-w-[160px] truncate" title={c.escalation_reason}>
                            {c.escalation_reason}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1.5">
                          <StatusBadge status={c.status} />
                          <StatusTimeline status={c.status} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`mono text-xs font-bold ${
                          (c.overdue_days ?? 0) > 60 ? "text-red-400" :
                          (c.overdue_days ?? 0) > 30 ? "text-yellow-400" : "text-muted-foreground"
                        }`}>
                          {c.overdue_days ?? 0}d
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {c.nitda_reference_number ? (
                          <span className="mono text-xs text-purple-400 font-semibold">{c.nitda_reference_number}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50 mono">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground mono">
                          {c.opened_at ? new Date(c.opened_at).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            onClick={() => openModal(c)}
                            disabled={["settled", "closed"].includes(c.status)}
                          >
                            <FileText className="h-3 w-3" /> Update
                          </Button>
                          {!["settled", "closed"].includes(c.status) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1 border-green-500/40 text-green-400 hover:bg-green-950/30"
                              onClick={() => quickSettle(c)}
                              disabled={settlingId === c.id}
                            >
                              {settlingId === c.id
                                ? <RefreshCw className="h-3 w-3 animate-spin" />
                                : <CheckCheck className="h-3 w-3" />}
                              Settle
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* NITDA Escalation Confirmation Modal */}
      <Dialog open={nitdaConfirmOpen} onOpenChange={v => { if (!v) { setNitdaConfirmOpen(false); setNitdaConfirmRef(""); setNitdaConfirmSummary(""); setNitdaTargetCase(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-purple-400">
              <ChevronRight className="h-4 w-4" />
              Escalate to NITDA — Confirmation Required
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-purple-500/30 bg-purple-950/20 p-3">
              <p className="text-xs text-purple-300 font-semibold">⚠ This action will formally escalate the case to NITDA.</p>
              <p className="text-xs text-muted-foreground mt-1">A NITDA Reference Number is mandatory. Ensure the case has been formally filed with NITDA before entering the reference.</p>
            </div>
            {nitdaTargetCase && (
              <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-1">
                <p className="text-xs font-semibold text-foreground">{nitdaTargetCase.org_name ?? `Org #${nitdaTargetCase.organization_id}`}</p>
                <p className="mono text-xs text-primary">{nitdaTargetCase.case_reference}</p>
                {nitdaTargetCase.penalty_amount && <p className="mono text-xs text-muted-foreground">Penalty: ₦{Number(nitdaTargetCase.penalty_amount).toLocaleString()}</p>}
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="data-label">NITDA Reference Number <span className="text-red-400">*</span></Label>
              <Input value={nitdaConfirmRef} onChange={e => setNitdaConfirmRef(e.target.value)} placeholder="e.g. NITDA/ENF/2026/001" className="h-8 text-xs mono border-purple-500/40 focus:border-purple-500" />
            </div>
            <div className="space-y-1.5">
              <Label className="data-label">Escalation Summary</Label>
              <Textarea value={nitdaConfirmSummary} onChange={e => setNitdaConfirmSummary(e.target.value)} placeholder="Describe the grounds for NITDA escalation…" className="text-xs min-h-[80px] resize-none" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setNitdaConfirmOpen(false); setNitdaConfirmRef(""); setNitdaConfirmSummary(""); setNitdaTargetCase(null); }}>Cancel</Button>
            <Button size="sm" className="gap-1 bg-purple-600 hover:bg-purple-700 text-foreground" onClick={handleNitdaConfirm} disabled={!nitdaConfirmRef.trim() || updateCase.isPending}>
              {updateCase.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Confirm Escalation to NITDA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gavel className="h-4 w-4 text-primary" />
              Update Enforcement Case
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-1">
                <p className="text-xs font-semibold text-foreground">{selected.org_name ?? `Org #${selected.organization_id}`}</p>
                <p className="mono text-xs text-primary">{selected.case_reference}</p>
                {selected.escalation_reason && (
                  <p className="text-xs text-muted-foreground">{selected.escalation_reason}</p>
                )}
              </div>

              {/* Tabs */}
              <div className="flex gap-1 border-b border-border/40">
                {(["update", "history"] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-t transition-colors ${
                      activeTab === tab
                        ? "bg-primary/10 text-primary border-b-2 border-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab === "update"
                      ? <span className="flex items-center gap-1"><Gavel className="h-3 w-3" /> Update</span>
                      : <span className="flex items-center gap-1"><History className="h-3 w-3" /> Case History</span>}
                  </button>
                ))}
              </div>

              {activeTab === "history" && (
                <div className="space-y-3 min-h-[180px]">
                  {timelineLoading ? (
                    <div className="flex items-center justify-center h-24 text-muted-foreground text-xs"><RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading timeline…</div>
                  ) : !timeline || (timeline as any[]).length === 0 ? (
                    <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">No timeline entries yet.</div>
                  ) : (
                    <div className="relative pl-5">
                      <div className="absolute left-2 top-0 bottom-0 w-px bg-border/40" />
                      {(timeline as any[]).map((entry: any) => (
                        <div key={entry.id} className="relative mb-4 last:mb-0">
                          <div className="absolute -left-3 top-1 h-2.5 w-2.5 rounded-full border-2 border-primary bg-background" />
                          <div className="rounded-lg border border-border/40 bg-muted/10 p-2.5 space-y-1">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-1.5">
                                {entry.from_status && (
                                  <><span className="mono text-[10px] px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground">{STATUS_META[entry.from_status]?.label ?? entry.from_status}</span>
                                  <ChevronRight className="h-3 w-3 text-muted-foreground/50" /></>
                                )}
                                <span className={`mono text-[10px] px-1.5 py-0.5 rounded border ${STATUS_META[entry.to_status]?.bg ?? "bg-muted/20"} ${STATUS_META[entry.to_status]?.color ?? "text-foreground"}`}>{STATUS_META[entry.to_status]?.label ?? entry.to_status}</span>
                              </div>
                              <span className="mono text-[10px] text-muted-foreground">{new Date(entry.created_at).toLocaleString()}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              <span className="font-semibold text-foreground">{entry.changed_by_name ?? "System"}</span>
                              {entry.note && ` — ${entry.note}`}
                            </p>
                            {entry.nitda_ref && (
                              <p className="mono text-[10px] text-purple-400">NITDA Ref: {entry.nitda_ref}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "update" && <><div className="space-y-1.5">
                <Label className="data-label">Update Status</Label>
                <Select value={newStatus} onValueChange={setNewStatus}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_ORDER.map(s => (
                      <SelectItem key={s} value={s} className="text-xs">
                        {STATUS_META[s]?.label ?? s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="data-label">NITDA Reference Number</Label>
                <Input
                  value={nitdaRef}
                  onChange={e => setNitdaRef(e.target.value)}
                  placeholder="e.g. NITDA/ENF/2026/001"
                  className="h-8 text-xs mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="data-label">Resolution Notes</Label>
                <Textarea
                  value={resolutionNotes}
                  onChange={e => setResolutionNotes(e.target.value)}
                  placeholder="Add case notes, investigation findings, or settlement terms…"
                  className="text-xs min-h-[80px] resize-none"
                />
              </div></>
            }
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1 mr-auto"
              onClick={() => {
                if (!selected) return;
                const a = document.createElement("a");
                a.href = `/api/enforcement-cases/${selected.id}/report.pdf`;
                a.download = `NDSEP-Case-${selected.id}-Report.pdf`;
                a.click();
              }}
            >
              <Download className="h-3.5 w-3.5" /> Download PDF Report
            </Button>
            <Button variant="outline" size="sm" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleUpdate} disabled={updateCase.isPending} className="gap-1">
              {updateCase.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Save Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Case Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground">
          <DialogHeader><DialogTitle>Create Enforcement Case</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Penalty ID *</Label><Input type="number" className="bg-card border-border mt-1" value={createForm.penaltyId} onChange={e => setCreateForm(p => ({ ...p, penaltyId: e.target.value }))} placeholder="Financial penalty ID to escalate" /></div>
            <div><Label>Organization ID *</Label><Input type="number" className="bg-card border-border mt-1" value={createForm.organizationId} onChange={e => setCreateForm(p => ({ ...p, organizationId: e.target.value }))} placeholder="Organization ID" /></div>
            <div><Label>Escalation Reason</Label><Textarea className="bg-card border-border mt-1 text-sm" rows={2} value={createForm.escalationReason} onChange={e => setCreateForm(p => ({ ...p, escalationReason: e.target.value }))} placeholder="Reason for escalating to enforcement case..." /></div>
            <div><Label>Assigned Officer ID</Label><Input type="number" className="bg-card border-border mt-1" value={createForm.assignedOfficerId} onChange={e => setCreateForm(p => ({ ...p, assignedOfficerId: e.target.value }))} placeholder="Officer user ID (optional)" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button disabled={!createForm.penaltyId || !createForm.organizationId || createCase.isPending} onClick={() => createCase.mutate({ penaltyId: Number(createForm.penaltyId), organizationId: Number(createForm.organizationId), escalationReason: createForm.escalationReason || undefined, assignedOfficerId: createForm.assignedOfficerId ? Number(createForm.assignedOfficerId) : undefined })}>{createCase.isPending ? "Creating..." : "Create Case"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
