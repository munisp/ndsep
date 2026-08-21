import React from "react";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { PageSkeleton } from "@/components/SkeletonLoaders";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollText, Plus, Search, Eye, FileText, CheckCircle , Trash2 } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const STATUS_COLORS: Record<string, string> = { draft: "bg-muted/400/20 text-muted-foreground border-border/30", published: "bg-green-500/20 text-green-400 border-green-500/30", archived: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", under_review: "bg-blue-500/20 text-primary border-blue-500/30" };
const NOTICE_TYPES = ["general","employee","customer","website","mobile_app","service_specific"];

export default function PrivacyNotices() {
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState({ organizationId: "", title: "", content: "", noticeType: "general", version: "", dataControllerInfo: "", dpoContactInfo: "", dataRetentionInfo: "", rightsInfo: "" });

  const { data: notices = [], refetch, isLoading } = trpc.privacyNotices.list.useQuery({ status: statusFilter === "all" ? undefined : statusFilter });
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const [deleteId, setDeleteId] = React.useState<number | null>(null);
  const utils = trpc.useUtils();
  const createMutation = trpc.privacyNotices.create.useMutation({ onSuccess: () => { toast.success("Privacy notice created"); setShowCreate(false); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });
  const updateMutation = trpc.privacyNotices.update.useMutation({
    onSuccess: () => { toast.success("Notice status updated"); utils.privacyNotices.list.invalidate().catch(() => {}); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const deleteMutation = trpc.privacyNotices.delete.useMutation({
    onSuccess: () => { toast.success("Privacy notice deleted"); setDeleteId(null); utils.privacyNotices.list.invalidate().catch(() => {}); },
    onError: (err) => toast.error(err.message || "Failed to delete privacy notice"),
  });

  const filtered = (notices as any[]).filter((r: any) => !searchQuery || r.title?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Privacy Notices" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><ScrollText className="w-5 h-5 text-primary" /></div>
            <div><div className="text-xs text-primary font-mono uppercase tracking-widest">NDPA Transparency</div><h1 className="text-2xl font-bold text-foreground">Privacy Notices</h1></div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">Manage privacy notices with versioning, approval workflows, and publication tracking for NDPA transparency requirements.</p>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Notices", value: (notices as any[]).length, icon: ScrollText, color: "text-primary" },
            { label: "Published", value: (notices as any[]).filter((n: any) => n.privacy_notice_status === "published").length, icon: Eye, color: "text-green-400" },
            { label: "Draft", value: (notices as any[]).filter((n: any) => n.privacy_notice_status === "draft").length, icon: FileText, color: "text-muted-foreground" },
            { label: "Under Review", value: (notices as any[]).filter((n: any) => n.privacy_notice_status === "under_review").length, icon: CheckCircle, color: "text-primary" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-muted-foreground">{s.label}</span></div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" /><Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search notices..." className="pl-9 bg-background border-border text-foreground" /></div>
          <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-44 bg-background border-border text-foreground"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-background border-border"><SelectItem value="all" className="text-foreground">All Status</SelectItem>{Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s} className="text-foreground capitalize">{s.replace(/_/g," ")}</SelectItem>)}</SelectContent></Select>
          <Button onClick={() => setShowCreate(true)} className="bg-lime-600 hover:bg-lime-700 text-foreground"><Plus className="w-4 h-4 mr-2" />New Notice</Button>
        </div>
        <div className="space-y-3">
          {isLoading ? <PageSkeleton />
          : filtered.length === 0 ? <div className="text-center py-8 text-muted-foreground/70">No privacy notices found</div>
          : filtered.map((r: any) => (
            <div key={r.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div><div className="font-medium text-foreground">{r.title}</div><div className="text-xs text-muted-foreground/70 mt-1">{r.org_name ?? `Org #${r.organization_id}`} &middot; Type: {r.notice_type?.replace(/_/g," ")} {r.version ? `&middot; v${r.version}` : ""}</div></div>
                <Badge className={`text-xs border ${STATUS_COLORS[r.privacy_notice_status] ?? ""}`}>{r.privacy_notice_status?.replace(/_/g," ")}</Badge>
              </div>
              <div className="flex gap-2 mt-3">
                {r.privacy_notice_status === "draft" && <Button size="sm" variant="outline" className="text-xs" onClick={() => updateMutation.mutate({ id: r.id, status: "under_review" })}>Submit for Review</Button>}
                {r.privacy_notice_status === "under_review" && <Button size="sm" className="text-xs bg-green-600 hover:bg-green-700" onClick={() => updateMutation.mutate({ id: r.id, status: "published" })}>Publish</Button>}
                {r.privacy_notice_status === "published" && <Button size="sm" variant="outline" className="text-xs" onClick={() => updateMutation.mutate({ id: r.id, status: "archived" })}>Archive</Button>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Privacy Notice</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Organization *</Label><Select value={form.organizationId} onValueChange={v => setForm(p => ({...p, organizationId: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent className="bg-background border-border">{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-muted-foreground text-sm">Notice Type</Label><Select value={form.noticeType} onValueChange={v => setForm(p => ({...p, noticeType: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue /></SelectTrigger><SelectContent className="bg-background border-border">{NOTICE_TYPES.map(s => <SelectItem key={s} value={s} className="text-foreground capitalize">{s.replace(/_/g," ")}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Title *</Label><Input value={form.title} onChange={e => setForm(p => ({...p, title: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            <div><Label className="text-muted-foreground text-sm">Content *</Label><Textarea value={form.content} onChange={e => setForm(p => ({...p, content: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={6} /></div>
            <div><Label className="text-muted-foreground text-sm">Version</Label><Input value={form.version} onChange={e => setForm(p => ({...p, version: e.target.value}))} className="bg-background border-border mt-1 text-foreground" placeholder="e.g. 1.0" /></div>
            <div><Label className="text-muted-foreground text-sm">DPO Contact Info</Label><Input value={form.dpoContactInfo} onChange={e => setForm(p => ({...p, dpoContactInfo: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button onClick={() => createMutation.mutate({ organizationId: Number(form.organizationId), title: form.title, content: form.content, noticeType: form.noticeType as any, version: form.version || undefined, dpoContactInfo: form.dpoContactInfo || undefined, dataControllerInfo: form.dataControllerInfo || undefined, dataRetentionInfo: form.dataRetentionInfo || undefined, rightsInfo: form.rightsInfo || undefined })}
              disabled={!form.organizationId || !form.title || !form.content || createMutation.isPending} className="bg-lime-600 hover:bg-lime-700 text-foreground">
              {createMutation.isPending ? "Creating..." : "Create Notice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
