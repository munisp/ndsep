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
import { Baby, Plus, Search, Shield, CheckCircle, Clock , Trash2 } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const STATUS_COLORS: Record<string, string> = { pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", granted: "bg-green-500/20 text-green-400 border-green-500/30", denied: "bg-red-500/20 text-red-400 border-red-500/30", withdrawn: "bg-muted/400/20 text-muted-foreground border-border/30" };
const VERIFICATION_METHODS = ["email","sms","id_upload","video_call","in_person"];

export default function ParentalConsent() {
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState({ organizationId: "", childName: "", childAge: "", parentName: "", parentEmail: "", purpose: "", verificationMethod: "email", ageVerificationMethod: "" });

  const { data: consents = [], refetch, isLoading } = trpc.parentalConsent.list.useQuery();
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const createMutation = trpc.parentalConsent.create.useMutation({ onSuccess: () => { toast.success("Parental consent request created"); setShowCreate(false); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });
  const updateMutation = trpc.parentalConsent.update.useMutation({ onSuccess: () => { toast.success("Consent updated");
  const [deleteId, setDeleteId] = React.useState<number | null>(null);
  const utils = trpc.useUtils();
  const deleteMutation = trpc.parentalConsent.delete.useMutation({
    onSuccess: () => {
      toast.success("Parental consent deleted successfully");
      setDeleteId(null);
      utils.parentalConsent.list.invalidate().catch(() => {});
    },
    onError: (err) => toast.error(err.message || "Failed to delete parental consent"),
  }); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });

  const filtered = (consents as any[]).filter((r: any) => !searchQuery || r.child_name?.toLowerCase().includes(searchQuery.toLowerCase()) || r.parent_name?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Parental Consent" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Baby className="w-5 h-5 text-primary" /></div>
            <div><div className="text-xs text-primary font-mono uppercase tracking-widest">NDPA S.35</div><h1 className="text-2xl font-bold text-foreground">Children's Data / Parental Consent</h1></div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">Manage parental consent for processing children's data with age verification, identity validation, and consent lifecycle tracking.</p>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Requests", value: (consents as any[]).length, icon: Baby, color: "text-primary" },
            { label: "Granted", value: (consents as any[]).filter((c: any) => c.parental_consent_status === "granted").length, icon: CheckCircle, color: "text-green-400" },
            { label: "Pending", value: (consents as any[]).filter((c: any) => c.parental_consent_status === "pending").length, icon: Clock, color: "text-yellow-400" },
            { label: "ID Verified", value: (consents as any[]).filter((c: any) => c.parent_id_verified).length, icon: Shield, color: "text-primary" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-muted-foreground">{s.label}</span></div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" /><Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search by child or parent name..." className="pl-9 bg-background border-border text-foreground" /></div>
          <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary/90 text-foreground"><Plus className="w-4 h-4 mr-2" />New Request</Button>
        </div>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs">
              <th className="text-left p-3">Child</th><th className="text-left p-3">Parent</th><th className="text-left p-3">Purpose</th>
              <th className="text-left p-3">Verification</th><th className="text-left p-3">Status</th><th className="text-left p-3">ID Verified</th><th className="p-3">Actions</th>
            </tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/70">Loading...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/70">No parental consent records</td></tr>
              : filtered.map((r: any) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-accent/50">
                  <td className="p-3"><div className="font-medium text-foreground">{r.child_name || "Minor"}</div>{r.child_age != null && <div className="text-xs text-muted-foreground/70">Age: {r.child_age}</div>}</td>
                  <td className="p-3"><div className="text-muted-foreground">{r.parent_name}</div><div className="text-xs text-muted-foreground/70">{r.parent_email}</div></td>
                  <td className="p-3 text-muted-foreground max-w-[200px] truncate text-xs">{r.purpose}</td>
                  <td className="p-3 text-muted-foreground text-xs capitalize">{r.verification_method?.replace("_"," ") || "-"}</td>
                  <td className="p-3"><Badge className={`text-xs border ${STATUS_COLORS[r.parental_consent_status] ?? ""}`}>{r.parental_consent_status}</Badge></td>
                  <td className="p-3">{r.parent_id_verified ? <Badge className="bg-green-500/20 text-green-400 text-xs">Yes</Badge> : <span className="text-muted-foreground/70 text-xs">No</span>}</td>
                  <td className="p-3 text-center">
                    {r.parental_consent_status === "pending" && <div className="flex gap-1 justify-center">
                      <Button size="sm" className="text-xs bg-green-600 hover:bg-green-700" onClick={() => updateMutation.mutate({ id: r.id, consentStatus: "granted", parentIdVerified: true })}>Grant</Button>
                      <Button size="sm" variant="outline" className="text-xs border-red-500/30 text-red-400" onClick={() => updateMutation.mutate({ id: r.id, consentStatus: "denied" })}>Deny</Button>
                    </div>}
                    {r.parental_consent_status === "granted" && <Button size="sm" variant="outline" className="text-xs" onClick={() => updateMutation.mutate({ id: r.id, consentStatus: "withdrawn" })}>Withdraw</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-xl">
          <DialogHeader><DialogTitle>New Parental Consent Request</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-muted-foreground text-sm">Organization *</Label><Select value={form.organizationId} onValueChange={v => setForm(p => ({...p, organizationId: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent className="bg-background border-border">{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Child Name</Label><Input value={form.childName} onChange={e => setForm(p => ({...p, childName: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
              <div><Label className="text-muted-foreground text-sm">Child Age</Label><Input type="number" min="0" max="17" value={form.childAge} onChange={e => setForm(p => ({...p, childAge: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Parent Name *</Label><Input value={form.parentName} onChange={e => setForm(p => ({...p, parentName: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
              <div><Label className="text-muted-foreground text-sm">Parent Email *</Label><Input type="email" value={form.parentEmail} onChange={e => setForm(p => ({...p, parentEmail: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Purpose *</Label><Textarea value={form.purpose} onChange={e => setForm(p => ({...p, purpose: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={2} /></div>
            <div><Label className="text-muted-foreground text-sm">Verification Method</Label><Select value={form.verificationMethod} onValueChange={v => setForm(p => ({...p, verificationMethod: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue /></SelectTrigger><SelectContent className="bg-background border-border">{VERIFICATION_METHODS.map(s => <SelectItem key={s} value={s} className="text-foreground capitalize">{s.replace("_"," ")}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button onClick={() => createMutation.mutate({ organizationId: Number(form.organizationId), childName: form.childName || undefined, childAge: form.childAge ? Number(form.childAge) : undefined, parentName: form.parentName, parentEmail: form.parentEmail, purpose: form.purpose, verificationMethod: form.verificationMethod as any, ageVerificationMethod: form.ageVerificationMethod || undefined })}
              disabled={!form.organizationId || !form.parentName || !form.parentEmail || !form.purpose || createMutation.isPending} className="bg-primary hover:bg-primary/90 text-foreground">
              {createMutation.isPending ? "Creating..." : "Create Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
