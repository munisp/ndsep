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
import { FileSignature, Plus, Search, CheckCircle, Clock, AlertTriangle , Trash2 } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const STATUS_COLORS: Record<string, string> = { draft: "bg-muted/400/20 text-muted-foreground border-border/30", active: "bg-green-500/20 text-green-400 border-green-500/30", expired: "bg-red-500/20 text-red-400 border-red-500/30", terminated: "bg-orange-500/20 text-primary border-orange-500/30", under_review: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" };

export default function DataProcessingAgreements() {
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState({ organizationId: "", processorName: "", processorCountry: "", processingPurpose: "", dataCategories: "", securityMeasures: "", crossBorderTransfer: false, agreementDate: "", expiryDate: "", documentUrl: "" });

  const { data: agreements = [], refetch, isLoading } = trpc.dpa.list.useQuery({ status: statusFilter === "all" ? undefined : statusFilter });
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const createMutation = trpc.dpa.create.useMutation({ onSuccess: () => { toast.success("DPA created"); setShowCreate(false); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });
  const updateMutation = trpc.dpa.update.useMutation({ onSuccess: () => { toast.success("DPA updated");
  const [deleteId, setDeleteId] = React.useState<number | null>(null);
  const utils = trpc.useUtils();
  const deleteMutation = trpc.dpa.delete.useMutation({
    onSuccess: () => {
      toast.success("Dpa deleted successfully");
      setDeleteId(null);
      utils.dpa.list.invalidate().catch(() => {});
    },
    onError: (err) => toast.error(err.message || "Failed to delete DPA"),
  }); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });

  const filtered = (agreements as any[]).filter((r: any) => !searchQuery || r.processor_name?.toLowerCase().includes(searchQuery.toLowerCase()) || r.org_name?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Data", href: "/catalog" }, { label: "Data Processing Agreements" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><FileSignature className="w-5 h-5 text-primary" /></div>
            <div><div className="text-xs text-primary font-mono uppercase tracking-widest">NDPA Data Processing</div><h1 className="text-2xl font-bold text-foreground">Data Processing Agreements</h1></div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">Manage contracts with data processors including sub-processor tracking, security measures, and cross-border transfer clauses.</p>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total DPAs", value: (agreements as any[]).length, icon: FileSignature, color: "text-primary" },
            { label: "Active", value: (agreements as any[]).filter((a: any) => a.dpa_status === "active").length, icon: CheckCircle, color: "text-green-400" },
            { label: "Expiring Soon", value: (agreements as any[]).filter((a: any) => a.expiry_date && new Date(a.expiry_date) < new Date(Date.now() + 90*86400000) && a.dpa_status === "active").length, icon: Clock, color: "text-yellow-400" },
            { label: "Expired", value: (agreements as any[]).filter((a: any) => a.dpa_status === "expired").length, icon: AlertTriangle, color: "text-red-400" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-muted-foreground">{s.label}</span></div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" /><Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search agreements..." className="pl-9 bg-background border-border text-foreground" /></div>
          <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-44 bg-background border-border text-foreground"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-background border-border"><SelectItem value="all" className="text-foreground">All Status</SelectItem>{Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s} className="text-foreground capitalize">{s.replace(/_/g," ")}</SelectItem>)}</SelectContent></Select>
          <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary/90 text-foreground"><Plus className="w-4 h-4 mr-2" />New DPA</Button>
        </div>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs">
              <th className="text-left p-3">Processor</th><th className="text-left p-3">Controller</th><th className="text-left p-3">Purpose</th>
              <th className="text-left p-3">Country</th><th className="text-left p-3">Status</th><th className="text-left p-3">Expiry</th><th className="p-3">Actions</th>
            </tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/70">Loading...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/70">No DPAs found</td></tr>
              : filtered.map((r: any) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-accent/50">
                  <td className="p-3 font-medium text-foreground">{r.processor_name}</td>
                  <td className="p-3 text-muted-foreground">{r.org_name ?? `Org #${r.organization_id}`}</td>
                  <td className="p-3 text-muted-foreground max-w-[200px] truncate text-xs">{r.processing_purpose || "-"}</td>
                  <td className="p-3 text-muted-foreground text-xs">{r.processor_country || "-"}</td>
                  <td className="p-3"><Badge className={`text-xs border ${STATUS_COLORS[r.dpa_status] ?? ""}`}>{r.dpa_status?.replace(/_/g," ")}</Badge></td>
                  <td className="p-3 text-muted-foreground text-xs">{r.expiry_date ? new Date(r.expiry_date).toLocaleDateString() : "-"}</td>
                  <td className="p-3 text-center">
                    <Select onValueChange={v => updateMutation.mutate({ id: r.id, status: v as any })}>
                      <SelectTrigger className="w-28 h-7 text-xs bg-background border-border text-foreground"><SelectValue placeholder="Update..." /></SelectTrigger>
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
          <DialogHeader><DialogTitle>New Data Processing Agreement</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Controller (Org) *</Label><Select value={form.organizationId} onValueChange={v => setForm(p => ({...p, organizationId: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent className="bg-background border-border">{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-muted-foreground text-sm">Processor Name *</Label><Input value={form.processorName} onChange={e => setForm(p => ({...p, processorName: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Processor Country</Label><Input value={form.processorCountry} onChange={e => setForm(p => ({...p, processorCountry: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
              <div className="flex items-end pb-1"><label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={form.crossBorderTransfer} onChange={e => setForm(p => ({...p, crossBorderTransfer: e.target.checked}))} /> Cross-border transfer</label></div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Processing Purpose</Label><Textarea value={form.processingPurpose} onChange={e => setForm(p => ({...p, processingPurpose: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={2} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Agreement Date</Label><Input type="date" value={form.agreementDate} onChange={e => setForm(p => ({...p, agreementDate: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
              <div><Label className="text-muted-foreground text-sm">Expiry Date</Label><Input type="date" value={form.expiryDate} onChange={e => setForm(p => ({...p, expiryDate: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button onClick={() => createMutation.mutate({ organizationId: Number(form.organizationId), processorName: form.processorName, processorCountry: form.processorCountry || undefined, processingPurpose: form.processingPurpose || undefined, crossBorderTransfer: form.crossBorderTransfer, agreementDate: form.agreementDate || undefined, expiryDate: form.expiryDate || undefined, dataCategories: form.dataCategories ? form.dataCategories.split(",").map(s=>s.trim()) : undefined, documentUrl: form.documentUrl || undefined })}
              disabled={!form.organizationId || !form.processorName || createMutation.isPending} className="bg-primary hover:bg-primary/90 text-foreground">
              {createMutation.isPending ? "Creating..." : "Create DPA"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
