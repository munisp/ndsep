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
import { Globe, Plus, Search, CheckCircle, AlertTriangle, Shield , Trash2 } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const STATUS_COLORS: Record<string, string> = { adequate: "bg-green-500/20 text-green-400 border-green-500/30", partially_adequate: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", not_adequate: "bg-red-500/20 text-red-400 border-red-500/30", pending: "bg-blue-500/20 text-primary border-blue-500/30", under_review: "bg-orange-500/20 text-primary border-orange-500/30" };

export default function AdequacyRegistry() {
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState({ countryCode: "", countryName: "", status: "pending", dataProtectionLaw: "", supervisoryAuthority: "", requiresAdditionalSafeguards: false, notes: "" });

  const { data: determinations = [], refetch, isLoading } = trpc.adequacy.list.useQuery();
  const createMutation = trpc.adequacy.create.useMutation({ onSuccess: () => { toast.success("Adequacy determination added"); setShowCreate(false); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });
  const updateMutation = trpc.adequacy.update.useMutation({ onSuccess: () => { toast.success("Determination updated");
  const [deleteId, setDeleteId] = React.useState<number | null>(null);
  const utils = trpc.useUtils();
  const deleteMutation = trpc.adequacy.delete.useMutation({
    onSuccess: () => {
      toast.success("Adequacy determination deleted successfully");
      setDeleteId(null);
      utils.adequacy.list.invalidate().catch(() => {});
    },
    onError: (err) => toast.error(err.message || "Failed to delete adequacy determination"),
  }); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });

  const filtered = (determinations as any[]).filter((r: any) => !searchQuery || r.country_name?.toLowerCase().includes(searchQuery.toLowerCase()) || r.country_code?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Adequacy Registry" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Globe className="w-5 h-5 text-primary" /></div>
            <div><div className="text-xs text-primary font-mono uppercase tracking-widest">NDPA Cross-Border Transfer</div><h1 className="text-2xl font-bold text-foreground">Adequacy Registry</h1></div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">Registry of countries with adequate data protection frameworks for cross-border transfers under NDPA.</p>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Countries", value: (determinations as any[]).length, icon: Globe, color: "text-primary" },
            { label: "Adequate", value: (determinations as any[]).filter((d: any) => d.adequacy_status === "adequate").length, icon: CheckCircle, color: "text-green-400" },
            { label: "Not Adequate", value: (determinations as any[]).filter((d: any) => d.adequacy_status === "not_adequate").length, icon: AlertTriangle, color: "text-red-400" },
            { label: "Pending Review", value: (determinations as any[]).filter((d: any) => ["pending","under_review"].includes(d.adequacy_status)).length, icon: Shield, color: "text-primary" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-muted-foreground">{s.label}</span></div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" /><Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search countries..." className="pl-9 bg-background border-border text-foreground" /></div>
          <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary/90 text-foreground"><Plus className="w-4 h-4 mr-2" />Add Country</Button>
        </div>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs">
              <th className="text-left p-3">Country</th><th className="text-left p-3">Code</th><th className="text-left p-3">Data Protection Law</th>
              <th className="text-left p-3">Authority</th><th className="text-left p-3">Status</th><th className="text-left p-3">Safeguards</th><th className="p-3">Actions</th>
            </tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/70">Loading...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/70">No adequacy determinations found</td></tr>
              : filtered.map((r: any) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-accent/50">
                  <td className="p-3 font-medium text-foreground">{r.country_name}</td>
                  <td className="p-3 text-muted-foreground font-mono">{r.country_code}</td>
                  <td className="p-3 text-muted-foreground text-xs">{r.data_protection_law || "-"}</td>
                  <td className="p-3 text-muted-foreground text-xs">{r.supervisory_authority || "-"}</td>
                  <td className="p-3"><Badge className={`text-xs border ${STATUS_COLORS[r.adequacy_status] ?? ""}`}>{r.adequacy_status?.replace(/_/g," ")}</Badge></td>
                  <td className="p-3">{r.requires_additional_safeguards ? <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">Required</Badge> : <span className="text-muted-foreground/70 text-xs">No</span>}</td>
                  <td className="p-3 text-center">
                    <Select onValueChange={v => updateMutation.mutate({ id: r.id, status: v as any })}>
                      <SelectTrigger className="w-32 h-7 text-xs bg-background border-border text-foreground"><SelectValue placeholder="Update..." /></SelectTrigger>
                      <SelectContent className="bg-background border-border">{Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s} className="text-foreground capitalize text-xs">{s.replace(/_/g," ")}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-xl">
          <DialogHeader><DialogTitle>Add Adequacy Determination</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Country Name *</Label><Input value={form.countryName} onChange={e => setForm(p => ({...p, countryName: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
              <div><Label className="text-muted-foreground text-sm">Country Code *</Label><Input value={form.countryCode} onChange={e => setForm(p => ({...p, countryCode: e.target.value}))} className="bg-background border-border mt-1 text-foreground" maxLength={3} placeholder="e.g. GBR" /></div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Status</Label><Select value={form.status} onValueChange={v => setForm(p => ({...p, status: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue /></SelectTrigger><SelectContent className="bg-background border-border">{Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s} className="text-foreground capitalize">{s.replace(/_/g," ")}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-muted-foreground text-sm">Data Protection Law</Label><Input value={form.dataProtectionLaw} onChange={e => setForm(p => ({...p, dataProtectionLaw: e.target.value}))} className="bg-background border-border mt-1 text-foreground" placeholder="e.g. GDPR, UK DPA 2018" /></div>
            <div><Label className="text-muted-foreground text-sm">Supervisory Authority</Label><Input value={form.supervisoryAuthority} onChange={e => setForm(p => ({...p, supervisoryAuthority: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={form.requiresAdditionalSafeguards} onChange={e => setForm(p => ({...p, requiresAdditionalSafeguards: e.target.checked}))} /> Requires additional safeguards</label>
            <div><Label className="text-muted-foreground text-sm">Notes</Label><Textarea value={form.notes} onChange={e => setForm(p => ({...p, notes: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button onClick={() => createMutation.mutate({ countryCode: form.countryCode, countryName: form.countryName, status: form.status as any, dataProtectionLaw: form.dataProtectionLaw || undefined, supervisoryAuthority: form.supervisoryAuthority || undefined, requiresAdditionalSafeguards: form.requiresAdditionalSafeguards, notes: form.notes || undefined })}
              disabled={!form.countryCode || !form.countryName || createMutation.isPending} className="bg-primary hover:bg-primary/90 text-foreground">
              {createMutation.isPending ? "Adding..." : "Add Country"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
