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
import { Database, Plus, Search, FileText, Globe, Shield, Trash2, Download } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
export default function RopaRecords() {
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteId, setDeleteId] = React.useState<number | null>(null);
  const [form, setForm] = useState({
    organizationId: "", processingActivityName: "", purpose: "",
    lawfulBasis: "consent", dataCategories: "", dataSubjectCategories: "",
    recipients: "", crossBorderTransfers: false, retentionPeriodDays: "",
    securityMeasures: "", dpiaRequired: false,
  });

  const { data: records = [], refetch, isLoading } = trpc.ropa.list.useQuery();
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const utils = trpc.useUtils();

  const createMutation = trpc.ropa.create.useMutation({
    onSuccess: () => { toast.success("ROPA entry created"); setShowCreate(false); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const updateMutation = trpc.ropa.update.useMutation({
    onSuccess: () => { toast.success("ROPA updated"); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const deleteMutation = trpc.ropa.delete.useMutation({
    onSuccess: () => {
      toast.success("ROPA record deleted");
      setDeleteId(null);
      utils.ropa.list.invalidate().catch(() => {});
    },
    onError: (err) => toast.error(err.message || "Failed to delete ROPA record"),
  });
  const exportMutation = trpc.ropa.export.useMutation({
    onSuccess: (data) => {
      toast.success(`Exported ${data.count} records — opening download`);
      window.open(data.url, "_blank");
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const filtered = (records as any[]).filter((r: any) =>
    !searchQuery || r.processing_activity_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Ropa Records" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Database className="w-5 h-5 text-primary" /></div>
            <div>
              <div className="text-xs text-primary font-mono uppercase tracking-widest">NDPA S.44</div>
              <h1 className="text-2xl font-bold text-foreground">Records of Processing Activities (ROPA)</h1>
            </div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">Maintain structured registers of all processing activities with purposes, recipients, retention periods, and lawful bases.</p>
        </div>
      </div>

      <div className="px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Activities", value: (records as any[]).length, icon: Database, color: "text-primary" },
            { label: "Active", value: (records as any[]).filter((r: any) => r.is_active !== false).length, icon: FileText, color: "text-green-400" },
            { label: "Cross-Border", value: (records as any[]).filter((r: any) => r.cross_border_transfers).length, icon: Globe, color: "text-primary" },
            { label: "DPIA Required", value: (records as any[]).filter((r: any) => r.dpia_required).length, icon: Shield, color: "text-primary" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-muted-foreground">{s.label}</span></div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
            <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search activities..." className="pl-9 bg-background border-border text-foreground" />
          </div>
          <Button variant="outline" className="border-border text-muted-foreground" onClick={() => exportMutation.mutate({ format: "pdf" })} disabled={exportMutation.isPending}>
            <Download className="w-4 h-4 mr-2" />{exportMutation.isPending ? "Exporting..." : "Export PDF"}
          </Button>
          <Button variant="outline" className="border-border text-muted-foreground" onClick={() => exportMutation.mutate({ format: "json" })} disabled={exportMutation.isPending}>
            <Download className="w-4 h-4 mr-2" />Export JSON
          </Button>
          <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary/90 text-foreground">
            <Plus className="w-4 h-4 mr-2" />Add Activity
          </Button>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs">
              <th className="text-left p-3">Activity</th>
              <th className="text-left p-3">Organization</th>
              <th className="text-left p-3">Purpose</th>
              <th className="text-left p-3">Lawful Basis</th>
              <th className="text-left p-3">Retention</th>
              <th className="text-left p-3">Cross-Border</th>
              <th className="p-3">Actions</th>
            </tr></thead>
            <tbody>
              {isLoading
                ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/70">Loading...</td></tr>
                : filtered.length === 0
                  ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/70">No ROPA entries found</td></tr>
                  : filtered.map((r: any) => (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-accent/50">
                      <td className="p-3 font-medium text-foreground">{r.processing_activity_name}</td>
                      <td className="p-3 text-muted-foreground">{r.org_name ?? `Org #${r.organization_id}`}</td>
                      <td className="p-3 text-muted-foreground max-w-[200px] truncate">{r.purpose}</td>
                      <td className="p-3"><Badge variant="outline" className="text-xs capitalize">{r.ropa_lawful_basis?.replace("_"," ")}</Badge></td>
                      <td className="p-3 text-muted-foreground">{r.retention_period_days ? `${r.retention_period_days}d` : "-"}</td>
                      <td className="p-3">{r.cross_border_transfers ? <Badge className="bg-purple-500/20 text-primary text-xs">Yes</Badge> : <span className="text-muted-foreground/70 text-xs">No</span>}</td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {!r.dpo_reviewed && (
                            <Button size="sm" variant="outline" className="text-xs" onClick={() => updateMutation.mutate({ id: r.id, dpoReviewed: true })}>
                              Mark Reviewed
                            </Button>
                          )}
                          <AlertDialog open={deleteId === r.id} onOpenChange={(o) => !o && setDeleteId(null)}>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteId(r.id)}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="bg-background border-border">
                              <AlertDialogHeader>
                                <AlertDialogTitle className="text-foreground">Delete ROPA Entry</AlertDialogTitle>
                                <AlertDialogDescription className="text-muted-foreground">This will permanently delete "{r.processing_activity_name}". This action cannot be undone.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel className="border-border text-muted-foreground">Cancel</AlertDialogCancel>
                                <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => deleteMutation.mutate({ id: r.id })} disabled={deleteMutation.isPending}>
                                  {deleteMutation.isPending ? "Deleting..." : "Delete"}
                                </AlertDialogAction>
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

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Processing Activity</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground text-sm">Organization *</Label>
                <Select value={form.organizationId} onValueChange={v => setForm(p => ({...p, organizationId: v}))}>
                  <SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent className="bg-background border-border">{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-muted-foreground text-sm">Lawful Basis *</Label>
                <Select value={form.lawfulBasis} onValueChange={v => setForm(p => ({...p, lawfulBasis: v}))}>
                  <SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-background border-border">
                    {["consent","contract","legal_obligation","vital_interest","public_interest","legitimate_interest"].map(s => (
                      <SelectItem key={s} value={s} className="text-foreground capitalize">{s.replace(/_/g," ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Activity Name *</Label><Input value={form.processingActivityName} onChange={e => setForm(p => ({...p, processingActivityName: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            <div><Label className="text-muted-foreground text-sm">Purpose *</Label><Textarea value={form.purpose} onChange={e => setForm(p => ({...p, purpose: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={2} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Retention (days)</Label><Input type="number" value={form.retentionPeriodDays} onChange={e => setForm(p => ({...p, retentionPeriodDays: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
              <div className="flex items-end gap-4 pb-1">
                <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={form.crossBorderTransfers} onChange={e => setForm(p => ({...p, crossBorderTransfers: e.target.checked}))} /> Cross-border</label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={form.dpiaRequired} onChange={e => setForm(p => ({...p, dpiaRequired: e.target.checked}))} /> DPIA required</label>
              </div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Security Measures</Label><Textarea value={form.securityMeasures} onChange={e => setForm(p => ({...p, securityMeasures: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({
                organizationId: Number(form.organizationId),
                processingActivityName: form.processingActivityName,
                purpose: form.purpose,
                lawfulBasis: form.lawfulBasis as any,
                dataCategories: form.dataCategories ? form.dataCategories.split(",").map(s=>s.trim()) : undefined,
                crossBorderTransfers: form.crossBorderTransfers,
                retentionPeriodDays: form.retentionPeriodDays ? Number(form.retentionPeriodDays) : undefined,
                securityMeasures: form.securityMeasures || undefined,
                dpiaRequired: form.dpiaRequired,
              })}
              disabled={!form.organizationId || !form.processingActivityName || !form.purpose || createMutation.isPending}
              className="bg-primary hover:bg-primary/90 text-foreground">
              {createMutation.isPending ? "Creating..." : "Add Activity"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
