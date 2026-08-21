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
import { FileText, Plus, Search, Calendar, CheckCircle, Clock , Trash2 } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const STATUS_COLORS: Record<string, string> = { draft: "bg-muted/400/20 text-muted-foreground border-border/30", submitted: "bg-blue-500/20 text-primary border-blue-500/30", under_review: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", accepted: "bg-green-500/20 text-green-400 border-green-500/30", rejected: "bg-red-500/20 text-red-400 border-red-500/30" };

export default function DpoReports() {
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState({ organizationId: "", reportPeriodStart: "", reportPeriodEnd: "", privacyNoticesReview: "", dataProcessingCategories: "", lawfulBasesReview: "", dpiaReview: "", rightsExerciseReview: "", complaintHandling: "", securityMeasuresReview: "", breachNotifications: "", trainingActivities: "", recommendations: "" });

  const { data: reports = [], refetch, isLoading } = trpc.dpoReports.list.useQuery();
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const createMutation = trpc.dpoReports.create.useMutation({ onSuccess: () => { toast.success("DPO report created"); setShowCreate(false); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });
  const updateMutation = trpc.dpoReports.update.useMutation({ onSuccess: () => { toast.success("Report updated");
  const [deleteId, setDeleteId] = React.useState<number | null>(null);
  const utils = trpc.useUtils();
  const deleteMutation = trpc.dpoReports.delete.useMutation({
    onSuccess: () => {
      toast.success("Dpo report deleted successfully");
      setDeleteId(null);
      utils.dpoReports.list.invalidate().catch(() => {});
    },
    onError: (err) => toast.error(err.message || "Failed to delete DPO report"),
  }); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });

  const filtered = (reports as any[]).filter((r: any) => !searchQuery || r.org_name?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Dpo Reports" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><FileText className="w-5 h-5 text-primary" /></div>
            <div><div className="text-xs text-primary font-mono uppercase tracking-widest">GAID Art. 12</div><h1 className="text-2xl font-bold text-foreground">Semi-Annual DPO Reports</h1></div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">Manage semi-annual DPO compliance reports covering privacy notices, processing activities, breach notifications, and training.</p>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Reports", value: (reports as any[]).length, icon: FileText, color: "text-primary" },
            { label: "Draft", value: (reports as any[]).filter((r: any) => r.dpo_report_status === "draft").length, icon: Clock, color: "text-muted-foreground" },
            { label: "Submitted", value: (reports as any[]).filter((r: any) => r.dpo_report_status === "submitted").length, icon: Calendar, color: "text-primary" },
            { label: "Accepted", value: (reports as any[]).filter((r: any) => r.dpo_report_status === "accepted").length, icon: CheckCircle, color: "text-green-400" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-muted-foreground">{s.label}</span></div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" /><Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search reports..." className="pl-9 bg-background border-border text-foreground" /></div>
          <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary/90 text-foreground"><Plus className="w-4 h-4 mr-2" />New Report</Button>
        </div>
        <div className="space-y-3">
          {isLoading ? <PageSkeleton />
          : filtered.length === 0 ? <div className="text-center py-8 text-muted-foreground/70">No DPO reports found</div>
          : filtered.map((r: any) => (
            <div key={r.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div><div className="font-medium text-foreground">{r.org_name ?? `Org #${r.organization_id}`}</div><div className="text-xs text-muted-foreground/70 mt-1">Period: {r.report_period_start instanceof Date ? r.report_period_start.toLocaleDateString() : String(r.report_period_start ?? "")} to {r.report_period_end instanceof Date ? r.report_period_end.toLocaleDateString() : String(r.report_period_end ?? "")}</div></div>
                <Badge className={`text-xs border ${STATUS_COLORS[r.dpo_report_status] ?? ""}`}>{r.dpo_report_status?.replace("_"," ")}</Badge>
              </div>
              {r.recommendations && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.recommendations}</p>}
              <div className="flex gap-2 mt-3">
                {r.dpo_report_status === "draft" && <Button size="sm" variant="outline" className="text-xs" onClick={() => updateMutation.mutate({ id: r.id, status: "submitted" })}>Submit</Button>}
                {r.dpo_report_status === "submitted" && <Button size="sm" className="text-xs bg-green-600 hover:bg-green-700" onClick={() => updateMutation.mutate({ id: r.id, status: "accepted" })}>Accept</Button>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New DPO Report</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-muted-foreground text-sm">Organization *</Label><Select value={form.organizationId} onValueChange={v => setForm(p => ({...p, organizationId: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent className="bg-background border-border">{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Period Start *</Label><Input type="date" value={form.reportPeriodStart} onChange={e => setForm(p => ({...p, reportPeriodStart: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
              <div><Label className="text-muted-foreground text-sm">Period End *</Label><Input type="date" value={form.reportPeriodEnd} onChange={e => setForm(p => ({...p, reportPeriodEnd: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Privacy Notices Review</Label><Textarea value={form.privacyNoticesReview} onChange={e => setForm(p => ({...p, privacyNoticesReview: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={2} /></div>
            <div><Label className="text-muted-foreground text-sm">DPIA Review</Label><Textarea value={form.dpiaReview} onChange={e => setForm(p => ({...p, dpiaReview: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={2} /></div>
            <div><Label className="text-muted-foreground text-sm">Breach Notifications</Label><Textarea value={form.breachNotifications} onChange={e => setForm(p => ({...p, breachNotifications: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={2} /></div>
            <div><Label className="text-muted-foreground text-sm">Training Activities</Label><Textarea value={form.trainingActivities} onChange={e => setForm(p => ({...p, trainingActivities: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={2} /></div>
            <div><Label className="text-muted-foreground text-sm">Recommendations</Label><Textarea value={form.recommendations} onChange={e => setForm(p => ({...p, recommendations: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button onClick={() => createMutation.mutate({ organizationId: Number(form.organizationId), reportPeriodStart: form.reportPeriodStart, reportPeriodEnd: form.reportPeriodEnd, privacyNoticesReview: form.privacyNoticesReview || undefined, dpiaReview: form.dpiaReview || undefined, breachNotifications: form.breachNotifications || undefined, trainingActivities: form.trainingActivities || undefined, recommendations: form.recommendations || undefined })}
              disabled={!form.organizationId || !form.reportPeriodStart || !form.reportPeriodEnd || createMutation.isPending} className="bg-primary hover:bg-primary/90 text-foreground">
              {createMutation.isPending ? "Creating..." : "Create Report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
