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
import { GraduationCap, Plus, Search, CheckCircle, Clock, Users , Trash2 } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const STATUS_COLORS: Record<string, string> = { scheduled: "bg-blue-500/20 text-primary border-blue-500/30", in_progress: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", completed: "bg-green-500/20 text-green-400 border-green-500/30", cancelled: "bg-muted/400/20 text-muted-foreground border-border/30" };
const TRAINING_TYPES = ["data_protection_basics","ndpa_compliance","breach_response","dpia_methodology","rights_handling","security_awareness","custom"];

export default function StaffTraining() {
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState({ organizationId: "", trainingTitle: "", trainingType: "ndpa_compliance", description: "", scheduledDate: "", targetAudience: "", trainerName: "", durationHours: "", isRecurring: false, recurrenceMonths: "" });

  const { data: trainings = [], refetch, isLoading } = trpc.staffTraining.list.useQuery({ status: statusFilter === "all" ? undefined : statusFilter });
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const createMutation = trpc.staffTraining.create.useMutation({ onSuccess: () => { toast.success("Training scheduled"); setShowCreate(false); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });
  const updateMutation = trpc.staffTraining.update.useMutation({ onSuccess: () => { toast.success("Training updated");
  const [deleteId, setDeleteId] = React.useState<number | null>(null);
  const utils = trpc.useUtils();
  const deleteMutation = trpc.staffTraining.delete.useMutation({
    onSuccess: () => {
      toast.success("Training record deleted successfully");
      setDeleteId(null);
      utils.staffTraining.list.invalidate().catch(() => {});
    },
    onError: (err) => toast.error(err.message || "Failed to delete training record"),
  }); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });

  const filtered = (trainings as any[]).filter((r: any) => !searchQuery || r.training_title?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "AI Hub", href: "/ai-hub" }, { label: "Staff Training" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><GraduationCap className="w-5 h-5 text-primary" /></div>
            <div><div className="text-xs text-primary font-mono uppercase tracking-widest">NDPA Staff Awareness</div><h1 className="text-2xl font-bold text-foreground">Staff Training & Awareness</h1></div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">Schedule and track data protection training programs, monitor completion rates, and ensure NDPA compliance awareness across organizations.</p>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Programs", value: (trainings as any[]).length, icon: GraduationCap, color: "text-primary" },
            { label: "Scheduled", value: (trainings as any[]).filter((t: any) => t.training_status === "scheduled").length, icon: Clock, color: "text-primary" },
            { label: "Completed", value: (trainings as any[]).filter((t: any) => t.training_status === "completed").length, icon: CheckCircle, color: "text-green-400" },
            { label: "Total Participants", value: (trainings as any[]).reduce((sum: number, t: any) => sum + (t.participant_count ?? 0), 0), icon: Users, color: "text-primary" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-muted-foreground">{s.label}</span></div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" /><Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search training..." className="pl-9 bg-background border-border text-foreground" /></div>
          <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-44 bg-background border-border text-foreground"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-background border-border"><SelectItem value="all" className="text-foreground">All Status</SelectItem>{Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s} className="text-foreground capitalize">{s.replace(/_/g," ")}</SelectItem>)}</SelectContent></Select>
          <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary/90 text-foreground"><Plus className="w-4 h-4 mr-2" />Schedule Training</Button>
        </div>
        <div className="space-y-3">
          {isLoading ? <PageSkeleton />
          : filtered.length === 0 ? <div className="text-center py-8 text-muted-foreground/70">No training programs found</div>
          : filtered.map((r: any) => (
            <div key={r.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div><div className="font-medium text-foreground">{r.training_title}</div><div className="text-xs text-muted-foreground/70 mt-1">{r.org_name ?? `Org #${r.organization_id}`} &middot; Type: {r.training_type?.replace(/_/g," ")} &middot; {r.duration_hours ? `${r.duration_hours}h` : ""} {r.trainer_name ? `&middot; Trainer: ${r.trainer_name}` : ""}</div></div>
                <Badge className={`text-xs border ${STATUS_COLORS[r.training_status] ?? ""}`}>{r.training_status?.replace(/_/g," ")}</Badge>
              </div>
              {r.scheduled_date && <div className="text-xs text-muted-foreground mt-1">Scheduled: {new Date(r.scheduled_date).toLocaleDateString()} {r.participant_count ? `&middot; ${r.participant_count} participants` : ""} {r.pass_rate != null ? `&middot; ${r.pass_rate}% pass rate` : ""}</div>}
              <div className="flex gap-2 mt-3">
                {r.training_status === "scheduled" && <Button size="sm" variant="outline" className="text-xs" onClick={() => updateMutation.mutate({ id: r.id, status: "in_progress" })}>Start</Button>}
                {r.training_status === "in_progress" && <Button size="sm" className="text-xs bg-green-600 hover:bg-green-700" onClick={() => updateMutation.mutate({ id: r.id, status: "completed" })}>Complete</Button>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-xl">
          <DialogHeader><DialogTitle>Schedule Training Program</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-muted-foreground text-sm">Organization *</Label><Select value={form.organizationId} onValueChange={v => setForm(p => ({...p, organizationId: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent className="bg-background border-border">{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-muted-foreground text-sm">Training Title *</Label><Input value={form.trainingTitle} onChange={e => setForm(p => ({...p, trainingTitle: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Type *</Label><Select value={form.trainingType} onValueChange={v => setForm(p => ({...p, trainingType: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue /></SelectTrigger><SelectContent className="bg-background border-border">{TRAINING_TYPES.map(s => <SelectItem key={s} value={s} className="text-foreground capitalize">{s.replace(/_/g," ")}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-muted-foreground text-sm">Scheduled Date</Label><Input type="date" value={form.scheduledDate} onChange={e => setForm(p => ({...p, scheduledDate: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Trainer Name</Label><Input value={form.trainerName} onChange={e => setForm(p => ({...p, trainerName: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
              <div><Label className="text-muted-foreground text-sm">Duration (hours)</Label><Input type="number" value={form.durationHours} onChange={e => setForm(p => ({...p, durationHours: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Description</Label><Textarea value={form.description} onChange={e => setForm(p => ({...p, description: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={2} /></div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={form.isRecurring} onChange={e => setForm(p => ({...p, isRecurring: e.target.checked}))} /> Recurring training</label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button onClick={() => createMutation.mutate({ organizationId: Number(form.organizationId), trainingTitle: form.trainingTitle, trainingType: form.trainingType as any, description: form.description || undefined, scheduledDate: form.scheduledDate || undefined, trainerName: form.trainerName || undefined, durationHours: form.durationHours ? Number(form.durationHours) : undefined, isRecurring: form.isRecurring, targetAudience: form.targetAudience || undefined })}
              disabled={!form.organizationId || !form.trainingTitle || createMutation.isPending} className="bg-primary hover:bg-primary/90 text-foreground">
              {createMutation.isPending ? "Scheduling..." : "Schedule Training"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
