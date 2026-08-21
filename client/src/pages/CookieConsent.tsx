import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Cookie, Plus, Search, BarChart3, Globe, CheckCircle, Trash2 } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
export default function CookieConsent() {
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ organizationId: "", domain: "", visitorId: "", consentGiven: true, analyticalCookies: false, marketingCookies: false, functionalCookies: true });

  const utils = trpc.useUtils();
  const { data: records = [], refetch, isLoading } = trpc.cookieConsent.list.useQuery();
  const { data: stats = [] } = trpc.cookieConsent.stats.useQuery();
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 200 });
  const createMutation = trpc.cookieConsent.create.useMutation({ onSuccess: () => { toast.success("Cookie consent recorded"); setShowCreate(false); refetch(); }, onError: (e) => toast.error((e instanceof Error ? e.message : String(e))) });
  const deleteMutation = trpc.cookieConsent.delete.useMutation({
    onSuccess: () => { toast.success("Cookie consent record deleted"); setDeleteId(null); utils.cookieConsent.list.invalidate().catch(() => {}); },
    onError: (err) => toast.error(err.message || "Failed to delete"),
  });

  const filtered = (records as any[]).filter((r: any) => !searchQuery || r.domain?.toLowerCase().includes(searchQuery.toLowerCase()));
  const totalConsented = (stats as any[]).find((s: any) => s.consent_given === true)?.count ?? 0;
  const totalDeclined = (stats as any[]).find((s: any) => s.consent_given === false)?.count ?? 0;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Cookie Consent" }]} className="mb-4" />
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-yellow-600/20 border border-yellow-500/30 flex items-center justify-center"><Cookie className="w-5 h-5 text-yellow-400" /></div>
            <div><div className="text-xs text-yellow-400 font-mono uppercase tracking-widest">NDPA Cookie Compliance</div><h1 className="text-2xl font-bold text-foreground">Cookie Consent Management</h1></div>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">Track cookie consent preferences across domains with granular category controls for analytical, marketing, and functional cookies.</p>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Records", value: (records as any[]).length, icon: Cookie, color: "text-yellow-400" },
            { label: "Consented", value: totalConsented, icon: CheckCircle, color: "text-green-400" },
            { label: "Declined", value: totalDeclined, icon: Cookie, color: "text-red-400" },
            { label: "Domains", value: new Set((records as any[]).map((r: any) => r.domain)).size, icon: Globe, color: "text-primary" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-muted-foreground">{s.label}</span></div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" /><Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search by domain..." className="pl-9 bg-background border-border text-foreground" /></div>
          <Button onClick={() => setShowCreate(true)} className="bg-yellow-600 hover:bg-yellow-700 text-foreground"><Plus className="w-4 h-4 mr-2" />Record Consent</Button>
        </div>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs">
              <th className="text-left p-3">Domain</th><th className="text-left p-3">Organization</th><th className="text-left p-3">Consent</th>
              <th className="text-left p-3">Analytical</th><th className="text-left p-3">Marketing</th><th className="text-left p-3">Functional</th><th className="text-left p-3">Date</th><th className="p-3">Actions</th>
            </tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={8} className="text-center py-8 text-muted-foreground/70">Loading...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-muted-foreground/70">No cookie consent records</td></tr>
              : filtered.map((r: any) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-accent/50">
                  <td className="p-3 font-medium text-foreground">{r.domain}</td>
                  <td className="p-3 text-muted-foreground">{r.org_name ?? `Org #${r.organization_id}`}</td>
                  <td className="p-3">{r.consent_given ? <Badge className="bg-green-500/20 text-green-400 text-xs">Given</Badge> : <Badge className="bg-red-500/20 text-red-400 text-xs">Declined</Badge>}</td>
                  <td className="p-3">{r.analytical_cookies ? <BarChart3 className="w-4 h-4 text-green-400" /> : <span className="text-muted-foreground">-</span>}</td>
                  <td className="p-3">{r.marketing_cookies ? <BarChart3 className="w-4 h-4 text-green-400" /> : <span className="text-muted-foreground">-</span>}</td>
                  <td className="p-3">{r.functional_cookies ? <BarChart3 className="w-4 h-4 text-green-400" /> : <span className="text-muted-foreground">-</span>}</td>
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
          <DialogHeader><DialogTitle>Record Cookie Consent</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground text-sm">Organization *</Label><Select value={form.organizationId} onValueChange={v => setForm(p => ({...p, organizationId: v}))}><SelectTrigger className="bg-background border-border mt-1 text-foreground"><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent className="bg-background border-border">{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)} className="text-foreground">{o.name}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-muted-foreground text-sm">Domain *</Label><Input value={form.domain} onChange={e => setForm(p => ({...p, domain: e.target.value}))} className="bg-background border-border mt-1 text-foreground" placeholder="example.com" /></div>
            </div>
            <div><Label className="text-muted-foreground text-sm">Visitor ID</Label><Input value={form.visitorId} onChange={e => setForm(p => ({...p, visitorId: e.target.value}))} className="bg-background border-border mt-1 text-foreground" /></div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={form.consentGiven} onChange={e => setForm(p => ({...p, consentGiven: e.target.checked}))} /> Consent given</label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={form.analyticalCookies} onChange={e => setForm(p => ({...p, analyticalCookies: e.target.checked}))} /> Analytical cookies</label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={form.marketingCookies} onChange={e => setForm(p => ({...p, marketingCookies: e.target.checked}))} /> Marketing cookies</label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={form.functionalCookies} onChange={e => setForm(p => ({...p, functionalCookies: e.target.checked}))} /> Functional cookies</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-border text-muted-foreground">Cancel</Button>
            <Button onClick={() => createMutation.mutate({ organizationId: Number(form.organizationId), domain: form.domain, visitorId: form.visitorId || undefined, consentGiven: form.consentGiven, analyticalCookies: form.analyticalCookies, marketingCookies: form.marketingCookies, functionalCookies: form.functionalCookies })}
              disabled={!form.organizationId || !form.domain || createMutation.isPending} className="bg-yellow-600 hover:bg-yellow-700 text-foreground">
              {createMutation.isPending ? "Recording..." : "Record Consent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent className="bg-background border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Cookie Consent Record</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">This will permanently delete this cookie consent record. This action cannot be undone.</AlertDialogDescription>
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
