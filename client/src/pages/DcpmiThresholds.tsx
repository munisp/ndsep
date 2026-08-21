import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Gauge, Plus, Search, Trash2 } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
export default function DcpmiThresholds() {
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ sectorCode: "", criterionName: "", criterionDescription: "", thresholdValue: "", thresholdUnit: "" });

  const utils = trpc.useUtils();
  const { data: thresholds = [], refetch, isLoading } = trpc.dcpmi.thresholds.useQuery();
  const createMutation = trpc.dcpmi.create.useMutation({ onSuccess: () => { toast.success("DCPMI threshold created"); setShowCreate(false); refetch(); }, onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))) });
  const deleteMutation = trpc.dcpmi.delete.useMutation({
    onSuccess: () => { toast.success("DCPMI threshold deleted"); setDeleteId(null); utils.dcpmi.thresholds.invalidate().catch(() => {}); },
    onError: (err) => toast.error(err.message || "Failed to delete"),
  });

  const filtered = (thresholds as any[]).filter((r: any) => !searchQuery || r.criterion_name?.toLowerCase().includes(searchQuery.toLowerCase()) || r.sector_code?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Dcpmi Thresholds" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Gauge className="w-5 h-5 text-primary" /></div>
            <div><div className="text-xs text-primary font-mono uppercase tracking-widest">GAID Art. 2</div><h1 className="text-2xl font-bold text-foreground">DCPMI Thresholds</h1></div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">Configure Data Controller/Processor of Major Importance thresholds by sector — criterion names, threshold values, and units per GAID Art. 2.</p>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" /><Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search sectors..." className="pl-9 bg-background border-border text-foreground" /></div>
          <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary/90 text-foreground"><Plus className="w-4 h-4 mr-2" />Add Threshold</Button>
        </div>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs">
              <th className="text-left p-3">Criterion</th><th className="text-left p-3">Sector</th>
              <th className="text-right p-3">Threshold Value</th><th className="text-left p-3">Unit</th><th className="text-left p-3">Created</th><th className="p-3">Actions</th>
            </tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={6} className="text-center py-8 text-muted-foreground/70">Loading...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-muted-foreground/70">No DCPMI thresholds configured</td></tr>
              : filtered.map((r: any) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-accent/50">
                  <td className="p-3"><div className="font-medium text-foreground">{r.criterion_name}</div>{r.criterion_description && <div className="text-xs text-muted-foreground/70 mt-0.5 line-clamp-1">{r.criterion_description}</div>}</td>
                  <td className="p-3"><Badge variant="outline" className="text-xs">{r.sector_code ?? "All"}</Badge></td>
                  <td className="p-3 text-right text-muted-foreground font-mono">{Number(r.threshold_value ?? 0).toLocaleString()}</td>
                  <td className="p-3 text-muted-foreground">{r.threshold_unit}</td>
                  <td className="p-3 text-muted-foreground text-xs">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "-"}</td>
                  <td className="p-3 text-center">
                    <Button size="sm" variant="outline" className="text-xs border-red-800 text-red-400 hover:bg-red-900/30 h-7 w-7 p-0" onClick={() => setDeleteId(r.id)} aria-label="Delete"><Trash2 className="w-3 h-3" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-xl">
          <DialogHeader><DialogTitle>Add DCPMI Threshold</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-muted-foreground text-sm">Criterion Name *</Label><Input value={form.criterionName} onChange={e => setForm(p => ({...p, criterionName: e.target.value}))} className="bg-background border-border mt-1 text-foreground" placeholder="e.g. Annual Turnover, Data Subject Count" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Threshold Value *</Label><Input type="number" value={form.thresholdValue} onChange={e => setForm(p => ({...p, thresholdValue: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
              <div><Label className="text-muted-foreground text-sm">Unit *</Label><Input value={form.thresholdUnit} onChange={e => setForm(p => ({...p, thresholdUnit: e.target.value}))} className="bg-background border-border mt-1 text-foreground" placeholder="e.g. NGN, count, GB" /></div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Sector Code</Label><Input value={form.sectorCode} onChange={e => setForm(p => ({...p, sectorCode: e.target.value}))} className="bg-background border-border mt-1 text-foreground" placeholder="e.g. BANKING, TELECOM, OIL_GAS" /></div>
            <div><Label className="text-muted-foreground text-sm">Description</Label><Textarea value={form.criterionDescription} onChange={e => setForm(p => ({...p, criterionDescription: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button onClick={() => createMutation.mutate({ criterionName: form.criterionName, thresholdValue: Number(form.thresholdValue), thresholdUnit: form.thresholdUnit, sectorCode: form.sectorCode || undefined, criterionDescription: form.criterionDescription || undefined })}
              disabled={!form.criterionName || !form.thresholdValue || !form.thresholdUnit || createMutation.isPending} className="bg-primary hover:bg-primary/90 text-foreground">
              {createMutation.isPending ? "Creating..." : "Create Threshold"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent className="bg-background border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete DCPMI Threshold</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">This will permanently delete this DCPMI threshold. This action cannot be undone.</AlertDialogDescription>
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
