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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FileText, Plus, Zap, Search, Filter , Trash2 } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const FRAMEWORKS = ["All", "NDPR", "GDPR", "PIPL", "DPDP", "HIPAA", "SOC2", "ISO27001", "DOJ_EO_14117", "CUSTOM"];
const FRAMEWORK_COLORS: Record<string, string> = {
  NDPR: "bg-green-500/20 text-green-400 border-green-500/30",
  GDPR: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  PIPL: "bg-red-500/20 text-red-400 border-red-500/30",
  DPDP: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  HIPAA: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  SOC2: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  ISO27001: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  DOJ_EO_14117: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  CUSTOM: "bg-muted0/20 text-muted-foreground border-border/30",
};

export default function PolicyTemplates() {
  const [framework, setFramework] = useState("All");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showInstantiate, setShowInstantiate] = useState<number | null>(null);
  const [orgId, setOrgId] = useState("");
  const [newTemplate, setNewTemplate] = useState({ name: "", framework: "NDPR", description: "", policyDefinition: "", version: "1.0" });

  const { data: templates = [], refetch } = trpc.policyTemplates.list.useQuery({ framework: framework === "All" ? undefined : framework });
  const { data: orgs = [] } = trpc.organizations.list.useQuery({ limit: 100 });

  const createMutation = trpc.policyTemplates.create.useMutation({
    onSuccess: () => { toast.success("Policy template created"); setShowCreate(false); refetch(); setNewTemplate({ name: "", framework: "NDPR", description: "", policyDefinition: "", version: "1.0" }); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const instantiateMutation = trpc.policyTemplates.instantiate.useMutation({
    onSuccess: () => { toast.success("Policy instantiated for organization"); setShowInstantiate(null); utils.policyTemplates.list.invalidate().catch(() => {}); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const utils = trpc.useUtils();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const deleteMutation = trpc.policyTemplates.delete.useMutation({
    onSuccess: () => {
      toast.success("Policy template deleted successfully");
      setDeleteId(null);
      utils.policyTemplates.list.invalidate().catch(() => {});;
    },
    onError: (err) => toast.error(err.message || "Delete failed"),
  });

  const filtered = (templates as any[]).filter((t: any) => search === "" || t.name?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Policy Templates" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Policy Templates Library</h1>
          <p className="text-muted-foreground text-sm mt-1">Pre-built regulation-specific policy templates for instant deployment</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="bg-blue-600 hover:bg-blue-700"><Plus className="w-4 h-4 mr-2" /> New Template</Button>
      </div>
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search templates..." className="pl-9 bg-card border-border text-foreground" />
        </div>
        <Select value={framework} onValueChange={setFramework}>
          <SelectTrigger className="w-48 bg-card border-border text-foreground"><Filter className="w-4 h-4 mr-2" /><SelectValue /></SelectTrigger>
          <SelectContent>{FRAMEWORKS.map(fw => <SelectItem key={fw} value={fw}>{fw}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.length === 0 ? (
          <div className="col-span-3 text-center py-16 text-muted-foreground"><FileText className="w-12 h-12 mx-auto mb-3 opacity-30" /><p>No templates found. Create one to get started.</p></div>
        ) : filtered.map((t: any) => (
          <div key={t.id} className="bg-card rounded-xl border border-border p-5 space-y-3 hover:border-blue-500/50 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2"><FileText className="w-5 h-5 text-blue-400 shrink-0" /><span className="font-semibold text-foreground text-sm">{t.name}</span></div>
              <Badge className={`text-xs border ${FRAMEWORK_COLORS[t.framework] || "bg-muted text-muted-foreground"}`}>{t.framework}</Badge>
            </div>
            {t.description && <p className="text-muted-foreground text-xs line-clamp-2">{t.description}</p>}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>v{t.version || "1.0"} · Used {t.instantiatedCount || 0}x</span>
              <Badge variant="outline" className={`text-xs ${t.status === "active" ? "border-green-500/50 text-green-400" : "border-yellow-500/50 text-yellow-400"}`}>{t.status}</Badge>
            </div>
            <Button size="sm" className="w-full bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-500/30" onClick={() => setShowInstantiate(t.id)}>
              <Zap className="w-3 h-3 mr-1" /> Instantiate for Org
            </Button>
          </div>
        ))}
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-background border-border text-foreground max-w-lg">
          <DialogHeader><DialogTitle>Create Policy Template</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name</Label><Input value={newTemplate.name} onChange={e => setNewTemplate(p => ({ ...p, name: e.target.value }))} className="bg-card border-border mt-1" /></div>
            <div><Label>Framework</Label>
              <Select value={newTemplate.framework} onValueChange={v => setNewTemplate(p => ({ ...p, framework: v }))}>
                <SelectTrigger className="bg-card border-border mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{FRAMEWORKS.slice(1).map(fw => <SelectItem key={fw} value={fw}>{fw}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Description</Label><Input value={newTemplate.description} onChange={e => setNewTemplate(p => ({ ...p, description: e.target.value }))} className="bg-card border-border mt-1" /></div>
            <div><Label>Policy Definition (OPA Rego / JSON)</Label><Textarea value={newTemplate.policyDefinition} onChange={e => setNewTemplate(p => ({ ...p, policyDefinition: e.target.value }))} className="bg-card border-border mt-1 font-mono text-xs" rows={5} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate({ name: newTemplate.name, framework: newTemplate.framework, category: newTemplate.description || undefined, template_text: newTemplate.policyDefinition, is_public: true })} disabled={!newTemplate.name || !newTemplate.policyDefinition || createMutation.isPending}>{createMutation.isPending ? "Creating..." : "Create Template"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={showInstantiate !== null} onOpenChange={() => setShowInstantiate(null)}>
        <DialogContent className="bg-background border-border text-foreground">
          <DialogHeader><DialogTitle>Instantiate Policy for Organization</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Select Organization</Label>
            <Select value={orgId} onValueChange={setOrgId}>
              <SelectTrigger className="bg-card border-border"><SelectValue placeholder="Choose organization..." /></SelectTrigger>
              <SelectContent>{(orgs as any[]).map((o: any) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInstantiate(null)}>Cancel</Button>
            <Button onClick={() => showInstantiate && orgId && instantiateMutation.mutate({ templateId: showInstantiate, orgId: Number(orgId) })} disabled={!orgId || instantiateMutation.isPending}>{instantiateMutation.isPending ? "Instantiating..." : "Instantiate"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
