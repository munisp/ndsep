import React from "react";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Bot, Plus, Search, Eye, AlertTriangle, UserCheck, Trash2, CheckCircle } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
export default function AutomatedDecisions() {
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [reviewId, setReviewId] = React.useState<number | null>(null);
  const [reviewOutcome, setReviewOutcome] = useState("");
  const [form, setForm] = useState({ organizationId: "", dataSubjectEmail: "", decisionType: "", decisionOutcome: "", significantEffect: false, logicExplanation: "", inputDataSummary: "" });

  const { data: decisions = [], refetch, isLoading } = trpc.automatedDecisions.list.useQuery();
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const [deleteId, setDeleteId] = React.useState<number | null>(null);
  const utils = trpc.useUtils();
  const createMutation = trpc.automatedDecisions.create.useMutation({ onSuccess: () => { toast.success("Decision recorded"); setShowCreate(false); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });
  const requestReviewMutation = trpc.automatedDecisions.requestReview.useMutation({
    onSuccess: () => { toast.success("Human review requested"); utils.automatedDecisions.list.invalidate().catch(() => {}); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const completeReviewMutation = trpc.automatedDecisions.completeReview.useMutation({
    onSuccess: () => { toast.success("Review completed — data subject notified"); setReviewId(null); setReviewOutcome(""); utils.automatedDecisions.list.invalidate().catch(() => {}); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const deleteMutation = trpc.automatedDecisions.delete.useMutation({
    onSuccess: () => { toast.success("Automated decision deleted"); setDeleteId(null); utils.automatedDecisions.list.invalidate().catch(() => {}); },
    onError: (err) => toast.error(err.message || "Failed to delete automated decision"),
  });

  const filtered = (decisions as any[]).filter((r: any) => !searchQuery || r.decision_type?.toLowerCase().includes(searchQuery.toLowerCase()) || r.data_subject_email?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Automated Decisions" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-fuchsia-600/20 border border-fuchsia-500/30 flex items-center justify-center"><Bot className="w-5 h-5 text-fuchsia-400" /></div>
            <div><div className="text-xs text-fuchsia-400 font-mono uppercase tracking-widest">NDPA S.36</div><h1 className="text-2xl font-bold text-foreground">Automated Decision-Making</h1></div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">Track automated decisions with significant effects, ensure human review rights, and maintain explainability records per NDPA S.36.</p>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Decisions", value: (decisions as any[]).length, icon: Bot, color: "text-fuchsia-400" },
            { label: "Significant Effect", value: (decisions as any[]).filter((d: any) => d.significant_effect).length, icon: AlertTriangle, color: "text-red-400" },
            { label: "Review Requested", value: (decisions as any[]).filter((d: any) => d.human_review_requested).length, icon: UserCheck, color: "text-yellow-400" },
            { label: "Opt-Out Granted", value: (decisions as any[]).filter((d: any) => d.opt_out_granted_at).length, icon: Eye, color: "text-green-400" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-muted-foreground">{s.label}</span></div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" /><Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search decisions..." className="pl-9 bg-background border-border text-foreground" /></div>
          <Button onClick={() => setShowCreate(true)} className="bg-fuchsia-600 hover:bg-fuchsia-700 text-foreground"><Plus className="w-4 h-4 mr-2" />Record Decision</Button>
        </div>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs">
              <th className="text-left p-3">Type</th><th className="text-left p-3">Outcome</th><th className="text-left p-3">Subject</th>
              <th className="text-left p-3">Significant</th><th className="text-left p-3">Human Review</th><th className="text-left p-3">Date</th><th className="p-3">Actions</th>
            </tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/70">Loading...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/70">No automated decisions found</td></tr>
              : filtered.map((r: any) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-accent/50">
                  <td className="p-3 font-medium text-foreground">{r.decision_type}</td>
                  <td className="p-3 text-muted-foreground">{r.decision_outcome}</td>
                  <td className="p-3 text-muted-foreground text-xs">{r.data_subject_email || "-"}</td>
                  <td className="p-3">{r.significant_effect ? <Badge className="bg-red-500/20 text-red-400 text-xs">Yes</Badge> : <span className="text-muted-foreground/70 text-xs">No</span>}</td>
                  <td className="p-3">{r.human_review_requested ? (r.human_review_outcome ? <Badge className="bg-green-500/20 text-green-400 text-xs">Completed</Badge> : <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">Pending</Badge>) : <span className="text-muted-foreground/70 text-xs">-</span>}</td>
                  <td className="p-3 text-muted-foreground text-xs">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "-"}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-center gap-1">
                      {r.significant_effect && !r.human_review_requested && (
                        <Button size="sm" variant="outline" className="text-xs" onClick={() => requestReviewMutation.mutate({ id: r.id })} disabled={requestReviewMutation.isPending}>Request Review</Button>
                      )}
                      {r.human_review_requested && !r.human_review_outcome && (
                        <Button size="sm" className="text-xs bg-green-600 hover:bg-green-700" onClick={() => setReviewId(r.id)}><CheckCircle className="w-3 h-3 mr-1" />Complete</Button>
                      )}
                      <AlertDialog open={deleteId === r.id} onOpenChange={(o) => !o && setDeleteId(null)}>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteId(r.id)}><Trash2 className="w-3 h-3" /></Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-background border-border">
                          <AlertDialogHeader><AlertDialogTitle className="text-foreground">Delete Decision Record</AlertDialogTitle><AlertDialogDescription className="text-muted-foreground">This will permanently delete this automated decision record.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="border-border text-muted-foreground">Cancel</AlertDialogCancel>
                            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => deleteMutation.mutate({ id: r.id })} disabled={deleteMutation.isPending}>{deleteMutation.isPending ? "Deleting..." : "Delete"}</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {/* Complete Review Dialog */}
      <Dialog open={reviewId !== null} onOpenChange={(o) => { if (!o) { setReviewId(null); setReviewOutcome(""); } }}>
        <DialogContent className="bg-background border-border text-foreground max-w-lg">
          <DialogHeader><DialogTitle>Complete Human Review</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">Provide the outcome of the human review. The data subject will be notified.</p>
            <div><Label className="text-muted-foreground text-sm">Review Outcome *</Label><Textarea value={reviewOutcome} onChange={e => setReviewOutcome(e.target.value)} className="bg-background border-border mt-1 text-foreground" rows={4} placeholder="e.g. After human review, the automated decision has been confirmed / overturned because..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReviewId(null); setReviewOutcome(""); }} className="border-border text-muted-foreground">Cancel</Button>
            <Button onClick={() => reviewId !== null && completeReviewMutation.mutate({ id: reviewId, outcome: reviewOutcome })} disabled={!reviewOutcome.trim() || completeReviewMutation.isPending} className="bg-green-600 hover:bg-green-700 text-foreground">{completeReviewMutation.isPending ? "Completing..." : "Complete Review"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-xl">
          <DialogHeader><DialogTitle>Record Automated Decision</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-muted-foreground text-sm">Organization *</Label><Select value={form.organizationId} onValueChange={v => setForm(p => ({...p, organizationId: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent className="bg-background border-border">{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Decision Type *</Label><Input value={form.decisionType} onChange={e => setForm(p => ({...p, decisionType: e.target.value}))} className="bg-background border-border mt-1 text-foreground" placeholder="e.g. Credit scoring, profiling" /></div>
              <div><Label className="text-muted-foreground text-sm">Outcome *</Label><Input value={form.decisionOutcome} onChange={e => setForm(p => ({...p, decisionOutcome: e.target.value}))} className="bg-background border-border mt-1 text-foreground" placeholder="e.g. Approved, Denied" /></div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Data Subject Email</Label><Input type="email" value={form.dataSubjectEmail} onChange={e => setForm(p => ({...p, dataSubjectEmail: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            <div><Label className="text-muted-foreground text-sm">Logic Explanation</Label><Textarea value={form.logicExplanation} onChange={e => setForm(p => ({...p, logicExplanation: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={3} /></div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={form.significantEffect} onChange={e => setForm(p => ({...p, significantEffect: e.target.checked}))} /> Significant effect on data subject</label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button onClick={() => createMutation.mutate({ organizationId: Number(form.organizationId), decisionType: form.decisionType, decisionOutcome: form.decisionOutcome, dataSubjectEmail: form.dataSubjectEmail || undefined, significantEffect: form.significantEffect, logicExplanation: form.logicExplanation || undefined, inputDataSummary: form.inputDataSummary || undefined })}
              disabled={!form.organizationId || !form.decisionType || !form.decisionOutcome || createMutation.isPending} className="bg-fuchsia-600 hover:bg-fuchsia-700 text-foreground">
              {createMutation.isPending ? "Recording..." : "Record Decision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
