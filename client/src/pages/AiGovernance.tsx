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
import { Bot, Plus, AlertTriangle, CheckCircle, Clock , Trash2 } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const RISK_COLORS: Record<string, string> = {
  minimal: "bg-green-500/20 text-green-400 border-green-500/30",
  limited: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  unacceptable: "bg-red-500/20 text-red-400 border-red-500/30",
};

export default function AiGovernance() {
  const [riskFilter, setRiskFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [showUpdate, setShowUpdate] = useState<any>(null);
  const [form, setForm] = useState({ organizationId: "", name: "", purpose: "", vendor: "", version: "", personalDataProcessed: false });
  const [updateForm, setUpdateForm] = useState({ status: "", riskLevel: "", auditNotes: "" });

  const utils = trpc.useUtils();
  const { data: systems = [], refetch } = trpc.aiGovernance.list.useQuery({ riskLevel: riskFilter === "all" ? undefined : riskFilter });
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 100 });

  const createMutation = trpc.aiGovernance.create.useMutation({
    onSuccess: () => { toast.success("AI system registered"); setShowCreate(false); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const updateMutation = trpc.aiGovernance.update.useMutation({
    onSuccess: () => { toast.success("AI system updated"); setShowUpdate(null); utils.aiGovernance.list.invalidate().catch(() => {}); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const deleteMutation = trpc.aiGovernance.delete.useMutation({
    onSuccess: () => {
      toast.success("Ai system deleted successfully");
      setDeleteId(null);
      utils.aiGovernance.list.invalidate().catch(() => {});;
    },
    onError: (err) => toast.error(err.message || "Delete failed"),
  });

  const stats = {
    total: (systems as any[]).length,
    high: (systems as any[]).filter((s: any) => s.riskLevel === "high" || s.riskLevel === "unacceptable").length,
    pii: (systems as any[]).filter((s: any) => s.personalDataProcessed).length,
    pending: (systems as any[]).filter((s: any) => s.status === "under_review").length,
  };

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "AI Hub", href: "/ai-hub" }, { label: "Ai Governance" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Governance Registry</h1>
          <p className="text-muted-foreground text-sm mt-1">Register and audit AI systems operated by regulated organizations</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="bg-purple-600 hover:bg-purple-700"><Plus className="w-4 h-4 mr-2" /> Register AI System</Button>
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[{ label: "Total Systems", value: stats.total, icon: Bot, color: "text-blue-400" }, { label: "High Risk", value: stats.high, icon: AlertTriangle, color: "text-red-400" }, { label: "Processes PII", value: stats.pii, icon: AlertTriangle, color: "text-orange-400" }, { label: "Under Review", value: stats.pending, icon: Clock, color: "text-yellow-400" }].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-2"><Icon className={`w-5 h-5 ${color}`} /><span className="text-muted-foreground text-sm">{label}</span></div>
            <div className="text-2xl font-bold text-foreground">{value}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <Select value={riskFilter} onValueChange={setRiskFilter}>
          <SelectTrigger className="w-48 bg-card border-border text-foreground"><SelectValue placeholder="Filter by risk..." /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Risk Levels</SelectItem>
            <SelectItem value="minimal">Minimal</SelectItem>
            <SelectItem value="limited">Limited</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="unacceptable">Unacceptable</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-background/50">
            <tr>{["System Name", "Vendor", "Purpose", "Risk Level", "PII", "Status", "Actions"].map(h => <th key={h} className="text-left px-4 py-3 text-muted-foreground font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {(systems as any[]).length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-muted-foreground"><Bot className="w-8 h-8 mx-auto mb-2 opacity-30" /><p>No AI systems registered yet</p></td></tr>
            ) : (systems as any[]).map((s: any) => (
              <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="px-4 py-3 text-foreground font-medium">{s.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{s.vendor || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{s.purpose || "—"}</td>
                <td className="px-4 py-3"><Badge className={`text-xs border ${RISK_COLORS[s.riskLevel] || "bg-muted text-muted-foreground"}`}>{s.riskLevel}</Badge></td>
                <td className="px-4 py-3">{s.personalDataProcessed ? <CheckCircle className="w-4 h-4 text-orange-400" /> : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-4 py-3"><Badge variant="outline" className={`text-xs ${s.status === "approved" ? "border-green-500/50 text-green-400" : s.status === "suspended" ? "border-red-500/50 text-red-400" : "border-yellow-500/50 text-yellow-400"}`}>{s.status}</Badge></td>
                <td className="px-4 py-3 flex gap-2">
                  <Button size="sm" variant="outline" className="text-xs border-border" onClick={() => { setShowUpdate(s); setUpdateForm({ status: s.status, riskLevel: s.riskLevel, auditNotes: s.auditNotes || "" }); }}>Review</Button>
                  <Button size="sm" variant="outline" className="text-xs border-red-800 text-red-400 hover:bg-red-900/30" onClick={() => setDeleteId(s.id)}><Trash2 className="w-3 h-3" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground">
          <DialogHeader><DialogTitle>Register AI System</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Organization</Label>
              <Select value={form.organizationId} onValueChange={v => setForm(p => ({ ...p, organizationId: v }))}>
                <SelectTrigger className="bg-card border-border mt-1"><SelectValue placeholder="Select org..." /></SelectTrigger>
                <SelectContent>{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>System Name</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="bg-card border-border mt-1" /></div>
            <div><Label>Vendor</Label><Input value={form.vendor} onChange={e => setForm(p => ({ ...p, vendor: e.target.value }))} className="bg-card border-border mt-1" /></div>
            <div><Label>Purpose</Label><Input value={form.purpose} onChange={e => setForm(p => ({ ...p, purpose: e.target.value }))} className="bg-card border-border mt-1" /></div>
            <div className="flex items-center gap-2"><input type="checkbox" checked={form.personalDataProcessed} onChange={e => setForm(p => ({ ...p, personalDataProcessed: e.target.checked }))} /><Label>Processes Personal Data</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate({ ...form, organizationId: Number(form.organizationId) })} disabled={!form.name || !form.organizationId || createMutation.isPending}>{createMutation.isPending ? "Registering..." : "Register"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent className="bg-background border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete AI System</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">This will permanently remove the AI system from the registry. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteId && deleteMutation.mutate({ id: deleteId })} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={!!showUpdate} onOpenChange={() => setShowUpdate(null)}>
        <DialogContent className="bg-background border-border text-foreground">
          <DialogHeader><DialogTitle>Review AI System: {showUpdate?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Status</Label>
              <Select value={updateForm.status} onValueChange={v => setUpdateForm(p => ({ ...p, status: v }))}>
                <SelectTrigger className="bg-card border-border mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="registered">Registered</SelectItem><SelectItem value="under_review">Under Review</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="suspended">Suspended</SelectItem><SelectItem value="decommissioned">Decommissioned</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>Risk Level</Label>
              <Select value={updateForm.riskLevel} onValueChange={v => setUpdateForm(p => ({ ...p, riskLevel: v }))}>
                <SelectTrigger className="bg-card border-border mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="minimal">Minimal</SelectItem><SelectItem value="limited">Limited</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="unacceptable">Unacceptable</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>Audit Notes</Label><Textarea value={updateForm.auditNotes} onChange={e => setUpdateForm(p => ({ ...p, auditNotes: e.target.value }))} className="bg-card border-border mt-1" rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpdate(null)}>Cancel</Button>
            <Button onClick={() => updateMutation.mutate({ id: showUpdate.id, ...updateForm })} disabled={updateMutation.isPending}>{updateMutation.isPending ? "Saving..." : "Save Review"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
