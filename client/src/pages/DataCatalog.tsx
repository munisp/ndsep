import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { ComplianceHeatmap } from "@/components/ComplianceHeatmap";
import { AlertTriangle, CheckCircle, Shield, Plus, Pencil, Trash2, ChevronLeft, ChevronRight, Download, FileSearch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts";
import { Database, Globe, Tag, GitBranch, Star } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const CLASS_COLORS: Record<string, string> = {
  top_secret: "#ef4444", secret: "#f97316", confidential: "#f59e0b",
  restricted: "#8b5cf6", public: "#10b981",
};

const CLASS_LABELS: Record<string, string> = {
  top_secret: "TOP SECRET", secret: "SECRET", confidential: "CONFIDENTIAL",
  restricted: "RESTRICTED", public: "PUBLIC",
};

const CLASSIFICATIONS = ["top_secret", "secret", "confidential", "restricted", "public"] as const;
const FORMATS = ["parquet", "csv", "json", "avro", "orc", "delta"];
const CATALOG_PAGE_SIZE = 15;

type CatalogForm = { name: string; classification: string; format: string; storageLocation: string; description: string; };
const EMPTY_CATALOG_FORM: CatalogForm = { name: "", classification: "", format: "", storageLocation: "", description: "" };

export default function DataCatalog() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [catPage, setCatPage] = useState(0);
  const [catSearch, setCatSearch] = useState("");
  const [catFilterClass, setCatFilterClass] = useState("");
  const [catFilterFormat, setCatFilterFormat] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editEntry, setEditEntry] = useState<any>(null);
  const [deleteEntry, setDeleteEntry] = useState<any>(null);
  const [form, setForm] = useState<CatalogForm>(EMPTY_CATALOG_FORM);

  const createMutation = trpc.catalog.create.useMutation({
    onSuccess: () => { utils.catalog.entries.invalidate(); setShowCreate(false); setForm(EMPTY_CATALOG_FORM); toast.success("Catalog entry created"); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const updateMutation = trpc.catalog.update.useMutation({
    onSuccess: () => { utils.catalog.entries.invalidate(); setEditEntry(null); toast.success("Catalog entry updated"); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const deleteMutation = trpc.catalog.delete.useMutation({
    onSuccess: () => { utils.catalog.entries.invalidate(); setDeleteEntry(null); toast.success("Catalog entry deleted"); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const { data: entries } = trpc.catalog.entries.useQuery({ limit: 500 });
  const { data: residencyMap } = trpc.catalog.residencyMap.useQuery();
  const { data: residencyChecks } = trpc.residency.checks.useQuery({ limit: 30 }, { refetchInterval: 15000 });
  const { data: residencyStats } = trpc.residency.stats.useQuery(undefined, { refetchInterval: 15000 });

  const classBreakdown = (entries ?? []).reduce((acc: any, e: any) => {
    acc[e.classification] = (acc[e.classification] ?? 0) + 1;
    return acc;
  }, {});

  const classChartData = Object.entries(classBreakdown).map(([k, v]) => ({
    name: CLASS_LABELS[k] ?? k.toUpperCase(),
    count: v as number,
    color: CLASS_COLORS[k] ?? "#6b7280",
  }));

  const insideBorders = (residencyMap ?? []).filter((e: any) => e.isWithinBorders).length;
  const outsideBorders = (residencyMap ?? []).filter((e: any) => !e.isWithinBorders).length;

  // Geospatial scatter data
  const geoData = (residencyMap ?? []).map((e: any) => ({
    x: Number(e.longitude ?? 0),
    y: Number(e.latitude ?? 0),
    name: e.name,
    classification: e.classification,
    inside: e.isWithinBorders,
    quality: Number(e.qualityScore ?? 0),
  }));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Data", href: "/catalog" }, { label: "Data Catalog" }]} className="mb-4" />
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="layer-badge">LAYER 2</span>
            <span className="data-label">DataHub · OpenMetadata · Apache Atlas · Delta Lake · Apache Sedona</span>
          </div>
          <h1 className="text-2xl font-bold">Data Catalog & Lakehouse</h1>
          <p className="text-muted-foreground mono text-sm mt-0.5">Metadata management · Data lineage · Geospatial residency verification · Classification taxonomy</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Catalog Entries", value: entries?.length ?? 0, icon: Database, color: "#2563eb" },
          { label: "Within Borders", value: insideBorders, icon: Globe, color: "#10b981" },
          { label: "Outside Borders", value: outsideBorders, icon: Globe, color: "#ef4444" },
          { label: "Avg Quality Score", value: `${Math.round((entries ?? []).reduce((s: number, e: any) => s + Number(e.qualityScore ?? 0), 0) / Math.max(1, (entries ?? []).length))}%`, icon: Star, color: "#f59e0b" },
        ].map((m) => (
          <Card key={m.label} className="border border-border/60 relative overflow-hidden">
            <div className="absolute inset-0 blueprint-grid opacity-20" />
            <CardContent className="relative p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="data-label">{m.label}</p>
                  <p className="metric-value text-2xl font-bold mt-1">{typeof m.value === "number" ? m.value.toLocaleString() : m.value}</p>
                </div>
                <m.icon className="h-6 w-6 opacity-60" style={{ color: m.color }} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Geospatial Map + Classification */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border border-border/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Data Residency Map (Geospatial — Apache Sedona)</CardTitle>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-blue-500" /><span className="data-label">Within</span></div>
                <div className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-red-500" /><span className="data-label">Outside</span></div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-hidden rounded-b-lg">
            <ComplianceHeatmap showFlows={false} height="h-[320px]" />
            <div className="p-3 border-t border-border/40 flex items-center gap-4 text-[10px] mono text-muted-foreground">
              <span className="text-green-600 font-semibold">✓ {insideBorders} within national boundary</span>
              <span className="text-red-500 font-semibold">✗ {outsideBorders} outside boundary</span>
              <span className="ml-auto">Apache Sedona ST_Contains · Real-time verification</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Classification Taxonomy</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={classChartData} layout="vertical" barSize={14}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }} width={80} />
                <Tooltip contentStyle={{ fontSize: 11, fontFamily: "JetBrains Mono", background: "var(--card)", border: "1px solid var(--border)" }} />
                <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                  {classChartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 space-y-1.5">
              {Object.entries(CLASS_LABELS).map(([k, label]) => (
                <div key={k} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-sm" style={{ background: CLASS_COLORS[k] }} />
                    <span className="mono text-[10px]">{label}</span>
                  </div>
                  <span className="mono text-xs font-semibold">{classBreakdown[k] ?? 0}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Catalog Table */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Data Catalog Entries</CardTitle>
            <div className="flex items-center gap-2">
              <span className="layer-badge">DELTA LAKE · PARQUET</span>
              <span className="data-label">{entries?.length ?? 0} datasets</span>
              <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => {
                const headers = ["ID","Name","Classification","Format","Storage Location","Description"];
                const rows = (entries ?? []).map((e: any) => [e.id,e.name,e.classification ?? "",e.format ?? "",e.storageLocation ?? "",`"${(e.description ?? "").replace(/"/g, "'")}"`].join(","));
                const csv = [headers.join(","), ...rows].join("\n");
                const el = document.createElement("a"); el.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); el.download = "data-catalog.csv"; el.click();
              }}><Download className="h-3 w-3" /> Export CSV</Button>
              {isAdmin && (
                <Button size="sm" className="gap-1 h-7 text-xs" onClick={() => { setForm(EMPTY_CATALOG_FORM); setShowCreate(true); }}>
                  <Plus className="h-3 w-3" /> Add Entry
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Search + Filter bar */}
          <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-border/40">
            <div className="relative flex-1 min-w-[180px]">
              <Database className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search name, location, description..." value={catSearch} onChange={e => { setCatSearch(e.target.value); setCatPage(0); }} className="pl-8 h-7 text-xs" />
            </div>
            <Select value={catFilterClass || "__all__"} onValueChange={v => { setCatFilterClass(v === "__all__" ? "" : v); setCatPage(0); }}>
              <SelectTrigger className="h-7 text-xs w-36"><SelectValue placeholder="Classification" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-xs">All classifications</SelectItem>
                {CLASSIFICATIONS.map(c => <SelectItem key={c} value={c} className="text-xs">{CLASS_LABELS[c]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={catFilterFormat || "__all__"} onValueChange={v => { setCatFilterFormat(v === "__all__" ? "" : v); setCatPage(0); }}>
              <SelectTrigger className="h-7 text-xs w-28"><SelectValue placeholder="Format" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-xs">All formats</SelectItem>
                {FORMATS.map(f => <SelectItem key={f} value={f} className="text-xs uppercase">{f}</SelectItem>)}
              </SelectContent>
            </Select>
            {(catSearch || catFilterClass || catFilterFormat) && (
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => { setCatSearch(""); setCatFilterClass(""); setCatFilterFormat(""); setCatPage(0); }}>Clear</Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  {["Name", "Classification", "Format", "Location", "Rows", "Quality", "Lineage", "Borders", "Actions"].map(h => (
                    <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(entries ?? []).filter((e: any) => {
                    const q = catSearch.toLowerCase();
                    const matchSearch = !q || (e.name ?? "").toLowerCase().includes(q) || (e.storageLocation ?? "").toLowerCase().includes(q) || (e.description ?? "").toLowerCase().includes(q);
                    const matchClass = !catFilterClass || e.classification === catFilterClass;
                    const matchFormat = !catFilterFormat || e.format === catFilterFormat;
                    return matchSearch && matchClass && matchFormat;
                  }).slice(catPage * CATALOG_PAGE_SIZE, (catPage + 1) * CATALOG_PAGE_SIZE).map((entry: any) => (
                  <tr key={entry.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Database className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate max-w-[160px]">{entry.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="mono text-[9px]" style={{ borderColor: CLASS_COLORS[entry.classification], color: CLASS_COLORS[entry.classification] }}>
                        {CLASS_LABELS[entry.classification] ?? entry.classification}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 mono text-muted-foreground uppercase">{entry.format ?? "—"}</td>
                    <td className="px-4 py-2.5 mono text-muted-foreground truncate max-w-[120px]">{entry.storageLocation ?? "—"}</td>
                    <td className="px-4 py-2.5 mono">{Number(entry.rowCount ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Progress value={Number(entry.qualityScore ?? 0)} className="h-1.5 w-12" />
                        <span className="mono text-[10px]">{Number(entry.qualityScore ?? 0).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        <GitBranch className="h-3 w-3 text-muted-foreground" />
                        <span className="mono text-muted-foreground">{entry.lineageSource ?? "—"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {entry.isWithinBorders ? (
                        <span className="text-green-600 mono text-[10px]">✓ IN</span>
                      ) : (
                        <span className="text-red-500 mono text-[10px] font-bold">✗ OUT</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        <a href={`/audit-log?resourceId=${entry.id}&resourceType=catalog_entry`} title="View Audit Trail" className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"><FileSearch className="h-3 w-3" /></a>
                        {isAdmin && (
                          <>
                            <button aria-label="Edit" onClick={() => { setForm({ name: entry.name, classification: entry.classification ?? "", format: entry.format ?? "", storageLocation: entry.storageLocation ?? "", description: entry.description ?? "" }); setEditEntry(entry); }} className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"><Pencil className="h-3 w-3" /></button>
                            <button aria-label="Delete" onClick={() => setDeleteEntry(entry)} className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"><Trash2 className="h-3 w-3" /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {(entries ?? []).length > CATALOG_PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
              <span className="data-label">Showing {catPage * CATALOG_PAGE_SIZE + 1}–{Math.min((catPage + 1) * CATALOG_PAGE_SIZE, (entries ?? []).length)} of {(entries ?? []).length}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setCatPage(p => Math.max(0, p - 1))} disabled={catPage === 0}><ChevronLeft className="h-3 w-3" /></Button>
                <span className="mono text-xs">{catPage + 1} / {Math.ceil((entries ?? []).length / CATALOG_PAGE_SIZE)}</span>
                <Button variant="outline" size="sm" onClick={() => setCatPage(p => Math.min(Math.ceil((entries ?? []).length / CATALOG_PAGE_SIZE) - 1, p + 1))} disabled={catPage >= Math.ceil((entries ?? []).length / CATALOG_PAGE_SIZE) - 1}><ChevronRight className="h-3 w-3" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Catalog Entry</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label className="text-xs">Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Dataset name" className="mt-1" /></div>
            <div><Label className="text-xs">Classification</Label>
              <Select value={form.classification} onValueChange={v => setForm(f => ({ ...f, classification: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select classification" /></SelectTrigger>
                <SelectContent>{CLASSIFICATIONS.map(c => <SelectItem key={c} value={c}>{CLASS_LABELS[c] ?? c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Format</Label>
              <Select value={form.format} onValueChange={v => setForm(f => ({ ...f, format: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select format" /></SelectTrigger>
                <SelectContent>{FORMATS.map(f => <SelectItem key={f} value={f}>{f.toUpperCase()}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Storage Location</Label><Input value={form.storageLocation} onChange={e => setForm(f => ({ ...f, storageLocation: e.target.value }))} placeholder="s3://bucket/path" className="mt-1" /></div>
            <div><Label className="text-xs">Description</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description" className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate({ organizationId: 1, name: form.name, storageLocation: form.storageLocation || undefined, description: form.description || undefined })} disabled={!form.name || createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editEntry} onOpenChange={v => !v && setEditEntry(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Catalog Entry</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label className="text-xs">Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mt-1" /></div>
            <div><Label className="text-xs">Classification</Label>
              <Select value={form.classification} onValueChange={v => setForm(f => ({ ...f, classification: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select classification" /></SelectTrigger>
                <SelectContent>{CLASSIFICATIONS.map(c => <SelectItem key={c} value={c}>{CLASS_LABELS[c] ?? c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Format</Label>
              <Select value={form.format} onValueChange={v => setForm(f => ({ ...f, format: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select format" /></SelectTrigger>
                <SelectContent>{FORMATS.map(f => <SelectItem key={f} value={f}>{f.toUpperCase()}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Storage Location</Label><Input value={form.storageLocation} onChange={e => setForm(f => ({ ...f, storageLocation: e.target.value }))} className="mt-1" /></div>
            <div><Label className="text-xs">Description</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEntry(null)}>Cancel</Button>
            <Button onClick={() => updateMutation.mutate({ id: editEntry.id, name: form.name || undefined, storageLocation: form.storageLocation || undefined, description: form.description || undefined })} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteEntry} onOpenChange={v => !v && setDeleteEntry(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Catalog Entry</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">Are you sure you want to delete <strong>{deleteEntry?.name}</strong>? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteEntry(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate({ id: deleteEntry.id })} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rust Residency Enforcer Live Checks */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Live Residency Enforcement Checks
              <span className="text-[10px] font-bold text-orange-400 font-mono bg-orange-500/10 px-1.5 py-0.5 rounded border border-orange-500/20 ml-1">Rust</span>
            </CardTitle>
            <div className="flex items-center gap-3 text-xs">
              {residencyStats && (
                <>
                  <span className="text-green-400 font-mono">{(residencyStats as any).compliant ?? 0} compliant</span>
                  <span className="text-red-400 font-mono">{(residencyStats as any).violations ?? 0} violations</span>
                  <span className="text-yellow-400 font-mono">{(residencyStats as any).warnings ?? 0} warnings</span>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  {["Organization", "Data Asset", "Classification", "Storage Country", "Within Borders", "Status", "Checked"].map(h => (
                    <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!residencyChecks || (residencyChecks as any[]).length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Rust Residency Enforcer is scanning data assets...</td></tr>
                ) : (
                  (residencyChecks as any[]).map((check: any) => (
                    <tr key={check.id} className={`border-b border-border/30 hover:bg-muted/20 transition-colors ${check.residency_status === 'violation' ? 'bg-red-500/5' : ''}`}>
                      <td className="px-4 py-2.5 font-medium">{check.organization_name ?? '—'}</td>
                      <td className="px-4 py-2.5 mono text-muted-foreground truncate max-w-[160px]">{check.data_asset_name}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-[10px] font-semibold mono px-1.5 py-0.5 rounded" style={{ color: CLASS_COLORS[check.data_classification] ?? '#6b7280', background: (CLASS_COLORS[check.data_classification] ?? '#6b7280') + '20' }}>
                          {CLASS_LABELS[check.data_classification] ?? check.data_classification?.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 mono text-muted-foreground">{check.storage_country}</td>
                      <td className="px-4 py-2.5">
                        {check.is_within_borders
                          ? <CheckCircle className="h-4 w-4 text-green-400" />
                          : <AlertTriangle className="h-4 w-4 text-red-400" />}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`mono text-[10px] font-semibold ${
                          check.residency_status === 'compliant' ? 'text-green-600' :
                          check.residency_status === 'violation' ? 'text-red-500' : 'text-yellow-500'
                        }`}>{(check.residency_status ?? 'unknown').toUpperCase()}</span>
                      </td>
                      <td className="px-4 py-2.5 mono text-muted-foreground">{check.checked_at ? new Date(check.checked_at).toLocaleTimeString() : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
