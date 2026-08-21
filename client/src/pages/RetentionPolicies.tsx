import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Clock, Plus, Search, Trash2, Archive, Shield } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const ACTION_COLORS: Record<string, string> = { delete: "bg-red-500/20 text-red-400 border-red-500/30", anonymize: "bg-blue-500/20 text-primary border-blue-500/30", archive: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" };

export default function RetentionPolicies() {
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState({ organizationId: "", name: "", dataCategory: "", retentionPeriodDays: "", archivalAction: "delete", legalBasis: "", isGlobal: false });

  const { data: policies = [], refetch, isLoading } = trpc.retention.list.useQuery();
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const utils = trpc.useUtils();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const createMutation = trpc.retention.create.useMutation({ onSuccess: () => { toast.success("Retention policy created"); setShowCreate(false); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });
  const updateMutation = trpc.retention.update.useMutation({ onSuccess: () => { toast.success("Policy updated"); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });
  const deleteMutation = trpc.retention.delete.useMutation({ onSuccess: () => { toast.success("Retention policy deleted"); setDeleteId(null); utils.retention.list.invalidate().catch(() => {}); }, onError: (err) => toast.error(err.message || "Failed to delete") });

  const filtered = (policies as any[]).filter((r: any) => !searchQuery || r.name?.toLowerCase().includes(searchQuery.toLowerCase()) || r.data_category?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Retention Policies" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Clock className="w-5 h-5 text-primary" /></div>
            <div><div className="text-xs text-primary font-mono uppercase tracking-widest">NDPA Data Minimization</div><h1 className="text-2xl font-bold text-foreground">Retention Policies</h1></div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">Define and enforce data retention schedules with automated deletion, anonymization, or archival actions.</p>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Policies", value: (policies as any[]).length, icon: Clock, color: "text-primary" },
            { label: "Delete", value: (policies as any[]).filter((p: any) => p.archival_action === "delete").length, icon: Trash2, color: "text-red-400" },
            { label: "Anonymize", value: (policies as any[]).filter((p: any) => p.archival_action === "anonymize").length, icon: Shield, color: "text-primary" },
            { label: "Archive", value: (policies as any[]).filter((p: any) => p.archival_action === "archive").length, icon: Archive, color: "text-yellow-400" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-muted-foreground">{s.label}</span></div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" /><Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search policies..." className="pl-9 bg-background border-border text-foreground" /></div>
          <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary/90 text-foreground"><Plus className="w-4 h-4 mr-2" />Add Policy</Button>
        </div>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs">
              <th className="text-left p-3">Policy Name</th><th className="text-left p-3">Data Category</th><th className="text-left p-3">Retention</th>
              <th className="text-left p-3">Action</th><th className="text-left p-3">Scope</th><th className="text-left p-3">Status</th><th className="p-3">Actions</th>
            </tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/70">Loading...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/70">No retention policies found</td></tr>
              : filtered.map((r: any) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-accent/50">
                  <td className="p-3 font-medium text-foreground">{r.name}</td>
                  <td className="p-3 text-muted-foreground">{r.data_category}</td>
                  <td className="p-3 text-muted-foreground">{r.retention_period_days} days</td>
                  <td className="p-3"><Badge className={`text-xs border ${ACTION_COLORS[r.archival_action] ?? ""}`}>{r.archival_action}</Badge></td>
                  <td className="p-3">{r.is_global ? <Badge className="bg-purple-500/20 text-primary text-xs">Global</Badge> : <span className="text-muted-foreground/70 text-xs">Org-specific</span>}</td>
                  <td className="p-3">{r.is_active !== false ? <Badge className="bg-green-500/20 text-green-400 text-xs border border-green-500/30">Active</Badge> : <Badge className="bg-muted/400/20 text-muted-foreground text-xs border border-border/30">Inactive</Badge>}</td>
                  <td className="p-3 text-center">
                    <div className="flex gap-2 justify-center">
                      <Button size="sm" variant="outline" className="text-xs" onClick={() => updateMutation.mutate({ id: r.id, isActive: !r.is_active })}>{r.is_active !== false ? "Deactivate" : "Activate"}</Button>
                      <Button size="sm" variant="outline" className="text-xs border-red-800 text-red-400 hover:bg-red-900/30" onClick={() => setDeleteId(r.id)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-xl">
          <DialogHeader><DialogTitle>Add Retention Policy</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-muted-foreground text-sm">Policy Name *</Label><Input value={form.name} onChange={e => setForm(p => ({...p, name: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Data Category *</Label><Input value={form.dataCategory} onChange={e => setForm(p => ({...p, dataCategory: e.target.value}))} className="bg-background border-border mt-1 text-foreground" placeholder="e.g. personal_data, financial, health" /></div>
              <div><Label className="text-muted-foreground text-sm">Retention Period (days) *</Label><Input type="number" value={form.retentionPeriodDays} onChange={e => setForm(p => ({...p, retentionPeriodDays: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Archival Action</Label><Select value={form.archivalAction} onValueChange={v => setForm(p => ({...p, archivalAction: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue /></SelectTrigger><SelectContent className="bg-background border-border">{["delete","anonymize","archive"].map(s => <SelectItem key={s} value={s} className="text-foreground capitalize">{s}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-muted-foreground text-sm">Organization</Label><Select value={form.organizationId} onValueChange={v => setForm(p => ({...p, organizationId: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue placeholder="Global if empty" /></SelectTrigger><SelectContent className="bg-background border-border">{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Legal Basis</Label><Input value={form.legalBasis} onChange={e => setForm(p => ({...p, legalBasis: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={form.isGlobal} onChange={e => setForm(p => ({...p, isGlobal: e.target.checked}))} /> Apply globally to all organizations</label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button onClick={() => createMutation.mutate({ name: form.name, dataCategory: form.dataCategory, retentionPeriodDays: Number(form.retentionPeriodDays), archivalAction: form.archivalAction as any, organizationId: form.organizationId ? Number(form.organizationId) : undefined, legalBasis: form.legalBasis || undefined, isGlobal: form.isGlobal })}
              disabled={!form.name || !form.dataCategory || !form.retentionPeriodDays || createMutation.isPending} className="bg-primary hover:bg-primary/90 text-foreground">
              {createMutation.isPending ? "Creating..." : "Create Policy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent className="bg-background border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Retention Policy</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">This will permanently delete this retention policy. This action cannot be undone.</AlertDialogDescription>
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
