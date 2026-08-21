import React from "react";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { TableSkeleton } from "@/components/SkeletonLoaders";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeftRight, Plus, Search, Shield, FileText, CheckCircle , Trash2 } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const STATUS_COLORS: Record<string, string> = { draft: "bg-muted/400/20 text-muted-foreground border-border/30", active: "bg-green-500/20 text-green-400 border-green-500/30", expired: "bg-red-500/20 text-red-400 border-red-500/30", revoked: "bg-orange-500/20 text-primary border-orange-500/30", pending_approval: "bg-blue-500/20 text-primary border-blue-500/30" };
const INSTRUMENT_TYPES = ["bcr","scc","adequacy_decision","derogation","ndpc_authorization"];

export default function TransferInstruments() {
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState({ instrumentType: "scc", name: "", description: "", templateContent: "", applicableCountries: "", organizationId: "", ndpcApprovalRef: "", effectiveDate: "", expiryDate: "" });

  const { data: instruments = [], refetch, isLoading } = trpc.transferInstruments.list.useQuery({ status: statusFilter === "all" ? undefined : statusFilter });
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const createMutation = trpc.transferInstruments.create.useMutation({ onSuccess: () => { toast.success("Transfer instrument created"); setShowCreate(false); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });
  const updateMutation = trpc.transferInstruments.update.useMutation({ onSuccess: () => { toast.success("Instrument updated");
  const [deleteId, setDeleteId] = React.useState<number | null>(null);
  const utils = trpc.useUtils();
  const deleteMutation = trpc.transferInstruments.delete.useMutation({
    onSuccess: () => {
      toast.success("Transfer instrument deleted successfully");
      setDeleteId(null);
      utils.transferInstruments.list.invalidate().catch(() => {});
    },
    onError: (err) => toast.error(err.message || "Failed to delete transfer instrument"),
  }); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });

  const filtered = (instruments as any[]).filter((r: any) => !searchQuery || r.name?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Transfer Instruments" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><ArrowLeftRight className="w-5 h-5 text-primary" /></div>
            <div><div className="text-xs text-primary font-mono uppercase tracking-widest">NDPA Cross-Border</div><h1 className="text-2xl font-bold text-foreground">Transfer Instruments (BCR/SCC)</h1></div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">Manage Binding Corporate Rules, Standard Contractual Clauses, and other transfer instruments for cross-border data transfers.</p>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Instruments", value: (instruments as any[]).length, icon: ArrowLeftRight, color: "text-primary" },
            { label: "Active", value: (instruments as any[]).filter((i: any) => i.transfer_instrument_status === "active").length, icon: CheckCircle, color: "text-green-400" },
            { label: "BCRs", value: (instruments as any[]).filter((i: any) => i.instrument_type === "bcr").length, icon: Shield, color: "text-primary" },
            { label: "SCCs", value: (instruments as any[]).filter((i: any) => i.instrument_type === "scc").length, icon: FileText, color: "text-primary" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-muted-foreground">{s.label}</span></div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" /><Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search instruments..." className="pl-9 bg-background border-border text-foreground" /></div>
          <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-44 bg-background border-border text-foreground"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-background border-border"><SelectItem value="all" className="text-foreground">All Status</SelectItem>{Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s} className="text-foreground capitalize">{s.replace(/_/g," ")}</SelectItem>)}</SelectContent></Select>
          <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary/90 text-foreground"><Plus className="w-4 h-4 mr-2" />New Instrument</Button>
        </div>
        <div className="space-y-3">
          {isLoading ? <TableSkeleton rows={3} cols={4} />
          : filtered.length === 0 ? <div className="text-center py-8 text-muted-foreground/70">No transfer instruments found</div>
          : filtered.map((r: any) => (
            <div key={r.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div><div className="font-medium text-foreground">{r.name}</div><div className="text-xs text-muted-foreground/70 mt-1">Type: {r.instrument_type?.toUpperCase()} {r.ndpc_approval_ref ? `&middot; NDPC Ref: ${r.ndpc_approval_ref}` : ""}</div></div>
                <Badge className={`text-xs border ${STATUS_COLORS[r.transfer_instrument_status] ?? ""}`}>{r.transfer_instrument_status?.replace(/_/g," ")}</Badge>
              </div>
              {r.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.description}</p>}
              {r.effective_date && <div className="text-xs text-muted-foreground/70 mt-1">Effective: {new Date(r.effective_date).toLocaleDateString()} {r.expiry_date ? ` - ${new Date(r.expiry_date).toLocaleDateString()}` : ""}</div>}
              <div className="flex gap-2 mt-3">
                {r.transfer_instrument_status === "draft" && <Button size="sm" variant="outline" className="text-xs" onClick={() => updateMutation.mutate({ id: r.id, status: "pending_approval" })}>Submit for Approval</Button>}
                {r.transfer_instrument_status === "pending_approval" && <Button size="sm" className="text-xs bg-green-600 hover:bg-green-700" onClick={() => updateMutation.mutate({ id: r.id, status: "active" })}>Approve</Button>}
                {r.transfer_instrument_status === "active" && <Button size="sm" variant="outline" className="text-xs border-red-500/30 text-red-400" onClick={() => updateMutation.mutate({ id: r.id, status: "revoked" })}>Revoke</Button>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-xl">
          <DialogHeader><DialogTitle>New Transfer Instrument</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Type *</Label><Select value={form.instrumentType} onValueChange={v => setForm(p => ({...p, instrumentType: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue /></SelectTrigger><SelectContent className="bg-background border-border">{INSTRUMENT_TYPES.map(s => <SelectItem key={s} value={s} className="text-foreground uppercase">{s.replace(/_/g," ")}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-muted-foreground text-sm">Organization</Label><Select value={form.organizationId} onValueChange={v => setForm(p => ({...p, organizationId: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue placeholder="Global if empty" /></SelectTrigger><SelectContent className="bg-background border-border">{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Name *</Label><Input value={form.name} onChange={e => setForm(p => ({...p, name: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            <div><Label className="text-muted-foreground text-sm">Description</Label><Textarea value={form.description} onChange={e => setForm(p => ({...p, description: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={2} /></div>
            <div><Label className="text-muted-foreground text-sm">NDPC Approval Reference</Label><Input value={form.ndpcApprovalRef} onChange={e => setForm(p => ({...p, ndpcApprovalRef: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Effective Date</Label><Input type="date" value={form.effectiveDate} onChange={e => setForm(p => ({...p, effectiveDate: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
              <div><Label className="text-muted-foreground text-sm">Expiry Date</Label><Input type="date" value={form.expiryDate} onChange={e => setForm(p => ({...p, expiryDate: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button onClick={() => createMutation.mutate({ instrumentType: form.instrumentType as any, name: form.name, description: form.description || undefined, organizationId: form.organizationId ? Number(form.organizationId) : undefined, ndpcApprovalRef: form.ndpcApprovalRef || undefined, effectiveDate: form.effectiveDate || undefined, expiryDate: form.expiryDate || undefined, applicableCountries: form.applicableCountries ? form.applicableCountries.split(",").map(s=>s.trim()) : undefined })}
              disabled={!form.name || createMutation.isPending} className="bg-primary hover:bg-primary/90 text-foreground">
              {createMutation.isPending ? "Creating..." : "Create Instrument"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
