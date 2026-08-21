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
import { UserCheck, Plus, Search, Shield, Award , Trash2 } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const CRED_COLORS: Record<string, string> = { pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", verified: "bg-green-500/20 text-green-400 border-green-500/30", expired: "bg-red-500/20 text-red-400 border-red-500/30", revoked: "bg-muted/400/20 text-muted-foreground border-border/30" };

export default function DpoRegistry() {
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState({ organizationId: "", dpoName: "", dpoEmail: "", dpoPhone: "", dpcoId: "", dpcoName: "", certificationExpiresAt: "", notes: "" });

  const { data: appointments = [], refetch, isLoading } = trpc.dpoRegistry.list.useQuery();
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const createMutation = trpc.dpoRegistry.create.useMutation({ onSuccess: () => { toast.success("DPO appointment registered"); setShowCreate(false); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });
  const updateMutation = trpc.dpoRegistry.update.useMutation({ onSuccess: () => { toast.success("DPO record updated");
  const [deleteId, setDeleteId] = React.useState<number | null>(null);
  const utils = trpc.useUtils();
  const deleteMutation = trpc.dpoRegistry.delete.useMutation({
    onSuccess: () => {
      toast.success("Dpo appointment deleted successfully");
      setDeleteId(null);
      utils.dpoRegistry.list.invalidate().catch(() => {});
    },
    onError: (err) => toast.error(err.message || "Failed to delete DPO appointment"),
  }); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });

  const filtered = (appointments as any[]).filter((r: any) => !searchQuery || r.dpo_name?.toLowerCase().includes(searchQuery.toLowerCase()) || r.org_name?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Dpo Registry" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><UserCheck className="w-5 h-5 text-primary" /></div>
            <div><div className="text-xs text-primary font-mono uppercase tracking-widest">GAID Art. 11-14</div><h1 className="text-2xl font-bold text-foreground">DPO Registry</h1></div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">Track Data Protection Officer appointments, DPCO certifications, independence verification, and training compliance.</p>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total DPOs", value: (appointments as any[]).length, icon: UserCheck, color: "text-primary" },
            { label: "Verified", value: (appointments as any[]).filter((a: any) => a.credential_status === "verified").length, icon: Award, color: "text-green-400" },
            { label: "Pending", value: (appointments as any[]).filter((a: any) => a.credential_status === "pending").length, icon: Shield, color: "text-yellow-400" },
            { label: "Active", value: (appointments as any[]).filter((a: any) => a.is_active).length, icon: UserCheck, color: "text-primary" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-muted-foreground">{s.label}</span></div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" /><Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search DPOs..." className="pl-9 bg-background border-border text-foreground" /></div>
          <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary/90 text-foreground"><Plus className="w-4 h-4 mr-2" />Register DPO</Button>
        </div>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs">
              <th className="text-left p-3">DPO Name</th><th className="text-left p-3">Organization</th><th className="text-left p-3">DPCO</th>
              <th className="text-left p-3">Credential</th><th className="text-left p-3">Independence</th><th className="text-left p-3">Training Hrs</th><th className="p-3">Actions</th>
            </tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/70">Loading...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/70">No DPO appointments found</td></tr>
              : filtered.map((r: any) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-accent/50">
                  <td className="p-3"><div className="font-medium text-foreground">{r.dpo_name}</div><div className="text-xs text-muted-foreground/70">{r.dpo_email}</div></td>
                  <td className="p-3 text-muted-foreground">{r.org_name ?? `Org #${r.organization_id}`}</td>
                  <td className="p-3 text-muted-foreground text-xs">{r.dpco_name || r.dpco_id || "-"}</td>
                  <td className="p-3"><Badge className={`text-xs border ${CRED_COLORS[r.credential_status] ?? ""}`}>{r.credential_status}</Badge></td>
                  <td className="p-3">{r.independence_verified ? <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs border">Verified</Badge> : <Badge className="bg-muted/400/20 text-muted-foreground border-border/30 text-xs border">Pending</Badge>}</td>
                  <td className="p-3 text-muted-foreground">{r.training_hours_completed ?? 0}h</td>
                  <td className="p-3 text-center">
                    {r.credential_status === "pending" && <Button size="sm" variant="outline" className="text-xs" onClick={() => updateMutation.mutate({ id: r.id, credentialStatus: "verified" })}>Verify</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-xl">
          <DialogHeader><DialogTitle>Register DPO Appointment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-muted-foreground text-sm">Organization *</Label><Select value={form.organizationId} onValueChange={v => setForm(p => ({...p, organizationId: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent className="bg-background border-border">{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">DPO Name *</Label><Input value={form.dpoName} onChange={e => setForm(p => ({...p, dpoName: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
              <div><Label className="text-muted-foreground text-sm">DPO Email *</Label><Input type="email" value={form.dpoEmail} onChange={e => setForm(p => ({...p, dpoEmail: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">DPCO ID</Label><Input value={form.dpcoId} onChange={e => setForm(p => ({...p, dpcoId: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
              <div><Label className="text-muted-foreground text-sm">DPCO Name</Label><Input value={form.dpcoName} onChange={e => setForm(p => ({...p, dpcoName: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Notes</Label><Textarea value={form.notes} onChange={e => setForm(p => ({...p, notes: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button onClick={() => createMutation.mutate({ organizationId: Number(form.organizationId), dpoName: form.dpoName, dpoEmail: form.dpoEmail, dpoPhone: form.dpoPhone || undefined, dpcoId: form.dpcoId || undefined, dpcoName: form.dpcoName || undefined, certificationExpiresAt: form.certificationExpiresAt || undefined, notes: form.notes || undefined })}
              disabled={!form.organizationId || !form.dpoName || !form.dpoEmail || createMutation.isPending} className="bg-primary hover:bg-primary/90 text-foreground">
              {createMutation.isPending ? "Registering..." : "Register DPO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
