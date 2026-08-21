import React from "react";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
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
import { ClipboardCheck, Plus, Search, AlertTriangle, Shield, FileText , Trash2 } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const STATUS_COLORS: Record<string, string> = { draft: "bg-muted/400/20 text-muted-foreground border-border/30", in_review: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", approved: "bg-green-500/20 text-green-400 border-green-500/30", rejected: "bg-red-500/20 text-red-400 border-red-500/30", requires_ndpc_consultation: "bg-purple-500/20 text-primary border-purple-500/30" };
const RISK_COLORS: Record<string, string> = { low: "bg-blue-500/20 text-primary", medium: "bg-yellow-500/20 text-yellow-400", high: "bg-orange-500/20 text-primary", critical: "bg-red-500/20 text-red-400" };

export default function DpiaAssessments() {
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState({ organizationId: "", title: "", processingDescription: "", triggerCategory: "", riskLevel: "medium", dataCategories: "", purposeOfProcessing: "", necessityAssessment: "", riskAssessment: "", mitigationMeasures: "" });

  const { data: assessments = [], refetch, isLoading } = trpc.dpia.list.useQuery({ status: statusFilter === "all" ? undefined : statusFilter });
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const createMutation = trpc.dpia.create.useMutation({ onSuccess: () => { toast.success("DPIA created"); setShowCreate(false); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });
  const updateMutation = trpc.dpia.update.useMutation({ onSuccess: () => { toast.success("DPIA updated");
  const [deleteId, setDeleteId] = React.useState<number | null>(null);
  const utils = trpc.useUtils();
  const deleteMutation = trpc.dpia.delete.useMutation({
    onSuccess: () => {
      toast.success("Dpia assessment deleted successfully");
      setDeleteId(null);
      utils.dpia.list.invalidate().catch(() => {});
    },
    onError: (err) => toast.error(err.message || "Failed to delete DPIA assessment"),
  }); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });

  const filtered = (assessments as any[]).filter((r: any) => !searchQuery || r.title?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Dpia Assessments" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><ClipboardCheck className="w-5 h-5 text-primary" /></div>
            <div><div className="text-xs text-primary font-mono uppercase tracking-widest">GAID Art. 28</div><h1 className="text-2xl font-bold text-foreground">Data Protection Impact Assessments</h1></div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">Conduct and manage DPIAs for high-risk processing activities including AI, health data, financial services, and large-scale profiling.</p>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total DPIAs", value: (assessments as any[]).length, icon: FileText, color: "text-primary" },
            { label: "In Review", value: (assessments as any[]).filter((a: any) => a.dpia_status === "in_review").length, icon: ClipboardCheck, color: "text-yellow-400" },
            { label: "High Risk", value: (assessments as any[]).filter((a: any) => ["high","critical"].includes(a.dpia_risk_level)).length, icon: AlertTriangle, color: "text-red-400" },
            { label: "Approved", value: (assessments as any[]).filter((a: any) => a.dpia_status === "approved").length, icon: Shield, color: "text-green-400" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-muted-foreground">{s.label}</span></div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" /><Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search DPIAs..." className="pl-9 bg-background border-border text-foreground" /></div>
          <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-44 bg-background border-border text-foreground"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-background border-border"><SelectItem value="all" className="text-foreground">All Status</SelectItem>{Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s} className="text-foreground capitalize">{s.replace(/_/g," ")}</SelectItem>)}</SelectContent></Select>
          <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary/90 text-foreground"><Plus className="w-4 h-4 mr-2" />New DPIA</Button>
        </div>
        <div className="space-y-3">
          {isLoading ? <PageSkeleton />
          : filtered.length === 0 ? <div className="text-center py-8 text-muted-foreground/70">No DPIA assessments found</div>
          : filtered.map((r: any) => (
            <div key={r.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div><div className="font-medium text-foreground">{r.title}</div><div className="text-xs text-muted-foreground/70 mt-1">{r.org_name ?? `Org #${r.organization_id}`} &middot; {r.trigger_category}</div></div>
                <div className="flex gap-2">
                  <Badge className={`text-xs ${RISK_COLORS[r.dpia_risk_level] ?? ""}`}>{r.dpia_risk_level} risk</Badge>
                  <Badge className={`text-xs border ${STATUS_COLORS[r.dpia_status] ?? ""}`}>{r.dpia_status?.replace(/_/g," ")}</Badge>
                </div>
              </div>
              {r.processing_description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.processing_description}</p>}
              <div className="flex gap-2 mt-3">
                {r.dpia_status === "draft" && <Button size="sm" variant="outline" className="text-xs" onClick={() => updateMutation.mutate({ id: r.id, status: "in_review" })}>Submit for Review</Button>}
                {r.dpia_status === "in_review" && <Button size="sm" className="text-xs bg-green-600 hover:bg-green-700" onClick={() => updateMutation.mutate({ id: r.id, status: "approved" })}>Approve</Button>}
                {r.dpia_status === "in_review" && <Button size="sm" className="text-xs bg-primary hover:bg-primary/90" onClick={() => updateMutation.mutate({ id: r.id, status: "requires_ndpc_consultation", ndpcConsultationRequired: true })}>Refer to NDPC</Button>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New DPIA Assessment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Organization *</Label><Select value={form.organizationId} onValueChange={v => setForm(p => ({...p, organizationId: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent className="bg-background border-border">{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-muted-foreground text-sm">Risk Level</Label><Select value={form.riskLevel} onValueChange={v => setForm(p => ({...p, riskLevel: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue /></SelectTrigger><SelectContent className="bg-background border-border">{["low","medium","high","critical"].map(s => <SelectItem key={s} value={s} className="text-foreground capitalize">{s}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Title *</Label><Input value={form.title} onChange={e => setForm(p => ({...p, title: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            <div><Label className="text-muted-foreground text-sm">Trigger Category *</Label><Input value={form.triggerCategory} onChange={e => setForm(p => ({...p, triggerCategory: e.target.value}))} className="bg-background border-border mt-1 text-foreground" placeholder="e.g. AI profiling, health data, financial services" /></div>
            <div><Label className="text-muted-foreground text-sm">Processing Description *</Label><Textarea value={form.processingDescription} onChange={e => setForm(p => ({...p, processingDescription: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={3} /></div>
            <div><Label className="text-muted-foreground text-sm">Purpose of Processing</Label><Textarea value={form.purposeOfProcessing} onChange={e => setForm(p => ({...p, purposeOfProcessing: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={2} /></div>
            <div><Label className="text-muted-foreground text-sm">Mitigation Measures</Label><Textarea value={form.mitigationMeasures} onChange={e => setForm(p => ({...p, mitigationMeasures: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button onClick={() => createMutation.mutate({ organizationId: Number(form.organizationId), title: form.title, processingDescription: form.processingDescription, triggerCategory: form.triggerCategory, riskLevel: form.riskLevel as any, dataCategories: form.dataCategories ? form.dataCategories.split(",").map(s => s.trim()) : undefined, purposeOfProcessing: form.purposeOfProcessing || undefined, mitigationMeasures: form.mitigationMeasures || undefined })}
              disabled={!form.organizationId || !form.title || !form.processingDescription || !form.triggerCategory || createMutation.isPending} className="bg-primary hover:bg-primary/90 text-foreground">
              {createMutation.isPending ? "Creating..." : "Create DPIA"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
