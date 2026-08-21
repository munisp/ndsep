import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Plus, ChevronRight, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

import { Breadcrumbs } from "@/components/Breadcrumbs";
export default function SectorManagement() {
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", code: "", description: "", parentId: "", regulatoryFramework: "" });

  const { data: sectors = [], refetch } = trpc.sectors.list.useQuery({ parentId: undefined });
  const { data: stats } = trpc.sectors.stats.useQuery();

  const createMutation = trpc.sectors.create.useMutation({
    onSuccess: () => { toast.success("Sector created"); setShowCreate(false); refetch(); setForm({ name: "", code: "", description: "", parentId: "", regulatoryFramework: "" }); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const deleteMutation = trpc.sectors.delete.useMutation({
    onSuccess: () => { toast.success("Sector deleted"); setDeleteId(null); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Analytics", href: "/analytics" }, { label: "Sector Management" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sector Management</h1>
          <p className="text-muted-foreground text-sm mt-1">Multi-tenant sector hierarchy for regulatory jurisdiction management</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700"><Plus className="w-4 h-4 mr-2" /> Add Sector</Button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4"><div className="text-muted-foreground text-sm">Total Sectors</div><div className="text-2xl font-bold text-foreground">{stats?.total || 0}</div></div>
        <div className="bg-card rounded-xl border border-border p-4"><div className="text-muted-foreground text-sm">Top-Level Sectors</div><div className="text-2xl font-bold text-foreground">{stats?.topLevel || 0}</div></div>
      </div>
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-background/50">
            <tr>{["Sector Name", "Code", "Description", "Regulatory Framework", "Parent", ""].map(h => <th key={h} className="text-left px-4 py-3 text-muted-foreground font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {(sectors as any[]).length === 0 ? (
              <tr><td colSpan={6} className="text-center py-12 text-muted-foreground"><Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" /><p>No sectors defined yet</p></td></tr>
            ) : (sectors as any[]).map((s: any) => (
              <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="px-4 py-3 text-foreground font-medium flex items-center gap-2"><Building2 className="w-4 h-4 text-indigo-400" />{s.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-indigo-400">{s.code}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs max-w-xs truncate">{s.description || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{s.regulatoryFramework || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{s.parentId ? <span className="flex items-center gap-1"><ChevronRight className="w-3 h-3" />Sub-sector</span> : "Root"}</td>
                <td className="px-4 py-3">
                  <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300 hover:bg-red-900/20 h-7 w-7 p-0" onClick={() => setDeleteId(s.id)} disabled={deleteMutation.isPending} aria-label="Delete sector">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground">
          <DialogHeader><DialogTitle>Add Sector</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="bg-card border-border mt-1" placeholder="e.g. Financial Services" /></div>
            <div><Label>Code</Label><Input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} className="bg-card border-border mt-1 font-mono" placeholder="e.g. FIN" /></div>
            <div><Label>Description</Label><Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className="bg-card border-border mt-1" /></div>
            <div><Label>Regulatory Framework</Label><Input value={form.regulatoryFramework} onChange={e => setForm(p => ({ ...p, regulatoryFramework: e.target.value }))} className="bg-card border-border mt-1" placeholder="e.g. NDPR, BOFIA" /></div>
            <div><Label>Parent Sector (optional)</Label>
              <Select value={form.parentId} onValueChange={v => setForm(p => ({ ...p, parentId: v }))}>
                <SelectTrigger className="bg-card border-border mt-1"><SelectValue placeholder="None (top-level)" /></SelectTrigger>
                <SelectContent><SelectItem value="all">None (top-level)</SelectItem>{(sectors as any[]).map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate({ ...form, parentId: form.parentId ? Number(form.parentId) : undefined })} disabled={!form.name || !form.code || createMutation.isPending}>{createMutation.isPending ? "Creating..." : "Create Sector"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Delete Confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent className="bg-background border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Delete Sector</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this sector. This action cannot be undone.</AlertDialogDescription>
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
