import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { PageSkeleton } from "@/components/SkeletonLoaders";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ClipboardList, Plus, Search, CheckCircle, AlertTriangle, FileText, Download, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const STATUS_COLORS: Record<string, string> = { draft: "bg-muted/400/20 text-muted-foreground border-border/30", submitted: "bg-blue-500/20 text-primary border-blue-500/30", under_review: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", accepted: "bg-green-500/20 text-green-400 border-green-500/30", rejected: "bg-red-500/20 text-red-400 border-red-500/30", requires_remediation: "bg-orange-500/20 text-primary border-orange-500/30" };

export default function ComplianceAuditReturns() {
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [form, setForm] = useState({ organizationId: "", auditPeriodStart: "", auditPeriodEnd: "", dpcoId: "", dpcoName: "", complianceScore: "", findingsSummary: "", dataProtectionPoliciesReview: "", securityMeasuresAssessment: "", staffTrainingAssessment: "" });

  const { data: returns = [], refetch, isLoading } = trpc.auditReturns.list.useQuery({ status: statusFilter === "all" ? undefined : statusFilter });
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const createMutation = trpc.auditReturns.create.useMutation({ onSuccess: () => { toast.success("CAR filed successfully"); setShowCreate(false); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });
  const utils = trpc.useUtils();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const updateMutation = trpc.auditReturns.update.useMutation({ onSuccess: () => { toast.success("CAR updated"); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });
  const deleteMutation = trpc.auditReturns.delete.useMutation({ onSuccess: () => { toast.success("Audit return deleted"); setDeleteId(null); utils.auditReturns.list.invalidate().catch(() => {}); }, onError: (err) => toast.error(err.message || "Failed to delete") });

  const filtered = (returns as any[]).filter((r: any) => !searchQuery || r.org_name?.toLowerCase().includes(searchQuery.toLowerCase()) || r.dpco_name?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Compliance Audit Returns" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-sky-600/20 border border-sky-500/30 flex items-center justify-center"><ClipboardList className="w-5 h-5 text-sky-400" /></div>
            <div><div className="text-xs text-sky-400 font-mono uppercase tracking-widest">GAID Art. 15</div><h1 className="text-2xl font-bold text-foreground">Compliance Audit Returns (CAR)</h1></div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">File and manage Compliance Audit Returns from DPCOs with scoring, findings, and remediation tracking.</p>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total CARs", value: (returns as any[]).length, icon: ClipboardList, color: "text-sky-400" },
            { label: "Submitted", value: (returns as any[]).filter((r: any) => r.car_status === "submitted").length, icon: FileText, color: "text-primary" },
            { label: "Accepted", value: (returns as any[]).filter((r: any) => r.car_status === "accepted").length, icon: CheckCircle, color: "text-green-400" },
            { label: "Needs Remediation", value: (returns as any[]).filter((r: any) => r.car_status === "requires_remediation").length, icon: AlertTriangle, color: "text-primary" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-muted-foreground">{s.label}</span></div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" /><Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search CARs..." className="pl-9 bg-background border-border text-foreground" /></div>
          <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-44 bg-background border-border text-foreground"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-background border-border"><SelectItem value="all" className="text-foreground">All Status</SelectItem>{Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s} className="text-foreground capitalize">{s.replace(/_/g," ")}</SelectItem>)}</SelectContent></Select>
          <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
            <SelectTrigger className="w-32 bg-background border-border text-foreground"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-background border-border">
              {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - i).map(y => (
                <SelectItem key={y} value={String(y)} className="text-foreground">{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => {
              const url = `/api/audit-return/${selectedYear}/report.pdf`;
              window.open(url, "_blank");
              toast.success(`Generating Annual Audit Return for ${selectedYear}...`);
            }}
            className="bg-primary hover:bg-primary/90 text-foreground"
          >
            <Download className="w-4 h-4 mr-2" />Generate Annual Return
          </Button>
          <Button onClick={() => setShowCreate(true)} className="bg-sky-600 hover:bg-sky-700 text-foreground"><Plus className="w-4 h-4 mr-2" />File CAR</Button>
        </div>
        <div className="space-y-3">
          {isLoading ? <PageSkeleton />
          : filtered.length === 0 ? <div className="text-center py-8 text-muted-foreground/70">No CARs found</div>
          : filtered.map((r: any) => (
            <div key={r.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div><div className="font-medium text-foreground">{r.org_name ?? `Org #${r.organization_id}`}</div><div className="text-xs text-muted-foreground/70 mt-1">Period: {r.audit_period_start instanceof Date ? r.audit_period_start.toLocaleDateString() : String(r.audit_period_start ?? "")} to {r.audit_period_end instanceof Date ? r.audit_period_end.toLocaleDateString() : String(r.audit_period_end ?? "")} &middot; DPCO: {r.dpco_name || "N/A"}</div></div>
                <div className="flex gap-2">
                  {r.compliance_score != null && <Badge className={`text-xs ${r.compliance_score >= 80 ? "bg-green-500/20 text-green-400" : r.compliance_score >= 60 ? "bg-yellow-500/20 text-yellow-400" : "bg-red-500/20 text-red-400"}`}>{r.compliance_score}%</Badge>}
                  <Badge className={`text-xs border ${STATUS_COLORS[r.car_status] ?? ""}`}>{r.car_status?.replace(/_/g," ")}</Badge>
                </div>
              </div>
              {r.findings_summary && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.findings_summary}</p>}
              <div className="flex gap-2 mt-3">
                {r.car_status === "draft" && <Button size="sm" variant="outline" className="text-xs" onClick={() => updateMutation.mutate({ id: r.id, status: "submitted" })}>Submit</Button>}
                {r.car_status === "submitted" && <Button size="sm" className="text-xs bg-green-600 hover:bg-green-700" onClick={() => updateMutation.mutate({ id: r.id, status: "accepted" })}>Accept</Button>}
                {r.car_status === "submitted" && <Button size="sm" className="text-xs bg-primary hover:bg-primary/90" onClick={() => updateMutation.mutate({ id: r.id, status: "requires_remediation" })}>Requires Remediation</Button>}
                <Button size="sm" variant="outline" className="text-xs border-red-800 text-red-400 hover:bg-red-900/30 ml-auto" onClick={() => setDeleteId(r.id)}><Trash2 className="w-3 h-3" /></Button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>File Compliance Audit Return</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-muted-foreground text-sm">Organization *</Label><Select value={form.organizationId} onValueChange={v => setForm(p => ({...p, organizationId: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent className="bg-background border-border">{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Audit Period Start *</Label><Input type="date" value={form.auditPeriodStart} onChange={e => setForm(p => ({...p, auditPeriodStart: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
              <div><Label className="text-muted-foreground text-sm">Audit Period End *</Label><Input type="date" value={form.auditPeriodEnd} onChange={e => setForm(p => ({...p, auditPeriodEnd: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">DPCO ID</Label><Input value={form.dpcoId} onChange={e => setForm(p => ({...p, dpcoId: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
              <div><Label className="text-muted-foreground text-sm">DPCO Name</Label><Input value={form.dpcoName} onChange={e => setForm(p => ({...p, dpcoName: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Compliance Score (0-100)</Label><Input type="number" min="0" max="100" value={form.complianceScore} onChange={e => setForm(p => ({...p, complianceScore: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            <div><Label className="text-muted-foreground text-sm">Findings Summary</Label><Textarea value={form.findingsSummary} onChange={e => setForm(p => ({...p, findingsSummary: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button onClick={() => createMutation.mutate({ organizationId: Number(form.organizationId), auditPeriodStart: form.auditPeriodStart, auditPeriodEnd: form.auditPeriodEnd, dpcoId: form.dpcoId || undefined, dpcoName: form.dpcoName || undefined, complianceScore: form.complianceScore ? Number(form.complianceScore) : undefined, findingsSummary: form.findingsSummary || undefined })}
              disabled={!form.organizationId || !form.auditPeriodStart || !form.auditPeriodEnd || createMutation.isPending} className="bg-sky-600 hover:bg-sky-700 text-foreground">
              {createMutation.isPending ? "Filing..." : "File CAR"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent className="bg-background border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Audit Return</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">This will permanently delete this compliance audit return. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteId && deleteMutation.mutate({ id: deleteId })} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
