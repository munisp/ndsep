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
import { ShieldCheck, Plus, Search, Users, FileCheck, AlertTriangle , Trash2 } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const LAWFUL_BASES = [
  { value: "consent", label: "Consent" },
  { value: "contract", label: "Contract" },
  { value: "legal_obligation", label: "Legal Obligation" },
  { value: "vital_interest", label: "Vital Interest" },
  { value: "public_interest", label: "Public Interest" },
  { value: "legitimate_interest", label: "Legitimate Interest" },
];

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/20 text-green-400 border-green-500/30",
  withdrawn: "bg-red-500/20 text-red-400 border-red-500/30",
  expired: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  pending: "bg-blue-500/20 text-primary border-blue-500/30",
};

export default function ConsentManagement() {
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState({
    organizationId: "", dataSubjectName: "", dataSubjectEmail: "",
    dataSubjectNin: "", purpose: "", lawfulBasis: "consent",
    dataCategories: "", processingActivities: "", thirdPartySharing: false,
    crossBorderTransfer: false, evidenceRef: "", expiresAt: "",
  });

  const { data: records = [], refetch, isLoading } = trpc.consent.list.useQuery(
    { status: statusFilter === "all" ? undefined : statusFilter }
  );
  const { data: stats = [] } = trpc.consent.stats.useQuery();
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });

  const createMutation = trpc.consent.create.useMutation({
    onSuccess: () => { toast.success("Consent record created"); setShowCreate(false); refetch(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const updateMutation = trpc.consent.update.useMutation({
    onSuccess: () => { toast.success("Consent updated"); setShowCreate(false); utils.consent.list.invalidate().catch(() => {}); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const utils = trpc.useUtils();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const deleteMutation = trpc.consent.delete.useMutation({
    onSuccess: () => {
      toast.success("Consent record deleted successfully");
      setDeleteId(null);
      utils.consent.list.invalidate().catch(() => {});;
    },
    onError: (err) => toast.error(err.message || "Delete failed"),
  });

  const filtered = (records as any[]).filter((r: any) => {
    if (!searchQuery) return true;
    return r.data_subject_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.data_subject_email?.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const totalActive = (stats as any[]).find((s: any) => s.consent_status === "active")?.count ?? 0;
  const totalWithdrawn = (stats as any[]).find((s: any) => s.consent_status === "withdrawn")?.count ?? 0;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Consent Management" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="text-xs text-primary font-mono uppercase tracking-widest">NDPA S.25-27 / GAID Art. 16-20</div>
              <h1 className="text-2xl font-bold text-foreground">Consent Management</h1>
            </div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">Track and manage lawful basis for data processing. Record consent, manage withdrawals, and maintain audit trails per NDPA requirements.</p>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Records", value: (records as any[]).length, icon: FileCheck, color: "text-primary" },
            { label: "Active Consents", value: totalActive, icon: ShieldCheck, color: "text-green-400" },
            { label: "Withdrawn", value: totalWithdrawn, icon: AlertTriangle, color: "text-red-400" },
            { label: "Organizations", value: new Set((records as any[]).map((r: any) => r.organization_id)).size, icon: Users, color: "text-primary" },
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
            <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search by name or email..." className="pl-9 bg-background border-border text-foreground" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 bg-background border-border text-foreground"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-background border-border">
              <SelectItem value="all" className="text-foreground">All Status</SelectItem>
              {Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s} className="text-foreground capitalize">{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary/90 text-foreground"><Plus className="w-4 h-4 mr-2" />Record Consent</Button>
        </div>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs">
              <th className="text-left p-3">Data Subject</th><th className="text-left p-3">Organization</th>
              <th className="text-left p-3">Purpose</th><th className="text-left p-3">Lawful Basis</th>
              <th className="text-left p-3">Status</th><th className="text-left p-3">Given At</th><th className="p-3">Actions</th>
            </tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/70">Loading...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/70">No consent records found</td></tr>
              : filtered.map((r: any) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-accent/50">
                  <td className="p-3"><div className="font-medium text-foreground">{r.data_subject_name}</div><div className="text-xs text-muted-foreground/70">{r.data_subject_email}</div></td>
                  <td className="p-3 text-muted-foreground">{r.org_name ?? `Org #${r.organization_id}`}</td>
                  <td className="p-3 text-muted-foreground max-w-[200px] truncate">{r.purpose}</td>
                  <td className="p-3"><Badge variant="outline" className="text-xs capitalize">{r.lawful_basis?.replace("_", " ")}</Badge></td>
                  <td className="p-3"><Badge className={`text-xs border ${STATUS_COLORS[r.consent_status] ?? ""}`}>{r.consent_status}</Badge></td>
                  <td className="p-3 text-muted-foreground text-xs">{r.consent_given_at ? new Date(r.consent_given_at).toLocaleDateString() : "-"}</td>
                  <td className="p-3 text-center">
                    {r.consent_status === "active" && (
                      <Button size="sm" variant="outline" className="text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                        onClick={() => updateMutation.mutate({ id: r.id, consentStatus: "withdrawn" })}>Withdraw</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Record New Consent</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Data Subject Name *</Label><Input value={form.dataSubjectName} onChange={e => setForm(p => ({...p, dataSubjectName: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
              <div><Label className="text-muted-foreground text-sm">Email *</Label><Input type="email" value={form.dataSubjectEmail} onChange={e => setForm(p => ({...p, dataSubjectEmail: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Organization *</Label>
                <Select value={form.organizationId} onValueChange={v => setForm(p => ({...p, organizationId: v}))}>
                  <SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent className="bg-background border-border">{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-muted-foreground text-sm">Lawful Basis *</Label>
                <Select value={form.lawfulBasis} onValueChange={v => setForm(p => ({...p, lawfulBasis: v}))}>
                  <SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-background border-border">{LAWFUL_BASES.map(b => <SelectItem key={b.value} value={b.value} className="text-foreground">{b.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Purpose *</Label><Textarea value={form.purpose} onChange={e => setForm(p => ({...p, purpose: e.target.value}))} className="bg-background border-border mt-1 text-foreground" rows={3} /></div>
            <div><Label className="text-muted-foreground text-sm">NIN (optional)</Label><Input value={form.dataSubjectNin} onChange={e => setForm(p => ({...p, dataSubjectNin: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={form.thirdPartySharing} onChange={e => setForm(p => ({...p, thirdPartySharing: e.target.checked}))} /> Third-party sharing</label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={form.crossBorderTransfer} onChange={e => setForm(p => ({...p, crossBorderTransfer: e.target.checked}))} /> Cross-border transfer</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button onClick={() => createMutation.mutate({
              organizationId: Number(form.organizationId),
              dataSubjectName: form.dataSubjectName,
              dataSubjectEmail: form.dataSubjectEmail,
              purpose: form.purpose,
              lawfulBasis: form.lawfulBasis as "consent" | "contract" | "legal_obligation" | "vital_interest" | "public_interest" | "legitimate_interest",
              dataCategories: form.dataCategories ? form.dataCategories.split(",").map(s => s.trim()) : [],
              processingActivities: form.processingActivities ? form.processingActivities.split(",").map(s => s.trim()) : [],
              thirdPartySharing: form.thirdPartySharing,
              crossBorderTransfer: form.crossBorderTransfer,
              expiresAt: form.expiresAt || undefined, dataSubjectNin: form.dataSubjectNin || undefined,
              evidenceRef: form.evidenceRef || undefined,
            })} disabled={!form.dataSubjectName || !form.dataSubjectEmail || !form.organizationId || !form.purpose || createMutation.isPending}
              className="bg-primary hover:bg-primary/90 text-foreground">
              {createMutation.isPending ? "Creating..." : "Record Consent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
