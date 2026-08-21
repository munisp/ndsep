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
import { Download, Plus, Search, Clock, CheckCircle, AlertTriangle, HardDrive , Trash2 } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const STATUS_COLORS: Record<string, string> = { pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", processing: "bg-blue-500/20 text-primary border-blue-500/30", completed: "bg-green-500/20 text-green-400 border-green-500/30", failed: "bg-red-500/20 text-red-400 border-red-500/30", expired: "bg-muted/400/20 text-muted-foreground border-border/30" };
const EXPORT_FORMATS = ["json","csv","xml","parquet"];

export default function DataExportJobs() {
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState({ organizationId: "", dataSubjectEmail: "", exportFormat: "json", dataCategories: "", requestedBy: "" });

  const { data: jobs = [], refetch, isLoading } = trpc.dataExport.list.useQuery();
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const createMutation = trpc.dataExport.create.useMutation({ onSuccess: () => { toast.success("Export job created");
  const [deleteId, setDeleteId] = React.useState<number | null>(null);
  const utils = trpc.useUtils();
  const deleteMutation = trpc.dataExport.delete.useMutation({
    onSuccess: () => {
      toast.success("Data export job deleted successfully");
      setDeleteId(null);
      utils.dataExport.list.invalidate().catch(() => {});
    },
    onError: (err) => toast.error(err.message || "Failed to delete data export job"),
  }); setShowCreate(false); refetch(); }, onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))) });

  const filtered = (jobs as any[]).filter((r: any) => !searchQuery || r.data_subject_email?.toLowerCase().includes(searchQuery.toLowerCase()) || r.requested_by?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Data", href: "/catalog" }, { label: "Data Export Jobs" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Download className="w-5 h-5 text-primary" /></div>
            <div><div className="text-xs text-primary font-mono uppercase tracking-widest">NDPA S.46</div><h1 className="text-2xl font-bold text-foreground">Data Portability / Export Jobs</h1></div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">Process data portability requests with high-performance export in JSON, CSV, XML, and Parquet formats per NDPA S.46.</p>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Jobs", value: (jobs as any[]).length, icon: Download, color: "text-primary" },
            { label: "Processing", value: (jobs as any[]).filter((j: any) => j.export_status === "processing").length, icon: Clock, color: "text-primary" },
            { label: "Completed", value: (jobs as any[]).filter((j: any) => j.export_status === "completed").length, icon: CheckCircle, color: "text-green-400" },
            { label: "Failed", value: (jobs as any[]).filter((j: any) => j.export_status === "failed").length, icon: AlertTriangle, color: "text-red-400" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-muted-foreground">{s.label}</span></div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" /><Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search by email or requester..." className="pl-9 bg-background border-border text-foreground" /></div>
          <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-44 bg-background border-border text-foreground"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-background border-border"><SelectItem value="all" className="text-foreground">All Status</SelectItem>{Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s} className="text-foreground capitalize">{s}</SelectItem>)}</SelectContent></Select>
          <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary/90 text-foreground"><Plus className="w-4 h-4 mr-2" />New Export</Button>
        </div>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs">
              <th className="text-left p-3">Subject Email</th><th className="text-left p-3">Format</th><th className="text-left p-3">Status</th>
              <th className="text-left p-3">Size</th><th className="text-left p-3">Requested</th><th className="text-left p-3">Completed</th><th className="p-3">Actions</th>
            </tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/70">Loading...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/70">No export jobs found</td></tr>
              : filtered.map((r: any) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-accent/50">
                  <td className="p-3"><div className="font-medium text-foreground">{r.data_subject_email}</div><div className="text-xs text-muted-foreground/70">{r.requested_by || "-"}</div></td>
                  <td className="p-3 text-muted-foreground uppercase text-xs">{r.export_format}</td>
                  <td className="p-3"><Badge className={`text-xs border ${STATUS_COLORS[r.export_status] ?? ""}`}>{r.export_status}</Badge></td>
                  <td className="p-3 text-muted-foreground text-xs">{r.file_size_bytes ? `${(r.file_size_bytes / 1024 / 1024).toFixed(2)} MB` : "-"}</td>
                  <td className="p-3 text-muted-foreground text-xs">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "-"}</td>
                  <td className="p-3 text-muted-foreground text-xs">{r.completed_at ? new Date(r.completed_at).toLocaleDateString() : "-"}</td>
                  <td className="p-3 text-center">
                    {r.export_status === "completed" && r.download_url && <Button size="sm" variant="outline" className="text-xs" onClick={() => window.open(r.download_url, "_blank")}><HardDrive className="w-3 h-3 mr-1" />Download</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-xl">
          <DialogHeader><DialogTitle>New Data Export Job</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-muted-foreground text-sm">Organization *</Label><Select value={form.organizationId} onValueChange={v => setForm(p => ({...p, organizationId: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent className="bg-background border-border">{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-muted-foreground text-sm">Data Subject Email *</Label><Input type="email" value={form.dataSubjectEmail} onChange={e => setForm(p => ({...p, dataSubjectEmail: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Export Format *</Label><Select value={form.exportFormat} onValueChange={v => setForm(p => ({...p, exportFormat: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue /></SelectTrigger><SelectContent className="bg-background border-border">{EXPORT_FORMATS.map(s => <SelectItem key={s} value={s} className="text-foreground uppercase">{s}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-muted-foreground text-sm">Requested By</Label><Input value={form.requestedBy} onChange={e => setForm(p => ({...p, requestedBy: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Data Categories (comma-separated)</Label><Input value={form.dataCategories} onChange={e => setForm(p => ({...p, dataCategories: e.target.value}))} className="bg-background border-border mt-1 text-foreground" placeholder="personal, financial, health" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button onClick={() => createMutation.mutate({ organizationId: Number(form.organizationId), dataSubjectEmail: form.dataSubjectEmail, exportFormat: form.exportFormat as "json" | "csv" | "xml" | "pdf", dataCategories: form.dataCategories ? form.dataCategories.split(",").map(s=>s.trim()) : undefined })}
              disabled={!form.organizationId || !form.dataSubjectEmail || createMutation.isPending} className="bg-primary hover:bg-primary/90 text-foreground">
              {createMutation.isPending ? "Creating..." : "Create Export Job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
