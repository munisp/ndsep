import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Building2, Shield, AlertTriangle, CheckCircle2, XCircle, Plus, Pencil, Trash2, ChevronLeft, ChevronRight, Download, FileSearch, Mail, Gavel, TrendingUp, TrendingDown, Minus , Loader2 } from "lucide-react";

// Lazy-loaded sparkline: only fetches data when hovered
function OrgSparkline({ orgId, complianceScore }: { orgId: number; complianceScore: number }) {
  const [hovered, setHovered] = useState(false);
  const { data: trend } = trpc.leaderboard.scoreTrend.useQuery(
    { orgId },
    { enabled: hovered, staleTime: 5 * 60 * 1000 }
  );

  // Build 7-point series from trend data (last 7 days) or estimate from score
  const points: number[] = trend
    ? trend.slice(-7).map((d: any) => d.score)
    : Array.from({ length: 7 }, (_, i) => Math.max(0, Math.min(100, complianceScore + (i - 3) * 1.5)));

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 48; const h = 20;
  const pts = points.map((v, i) => `${(i / (points.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  const last = points[points.length - 1];
  const first = points[0];
  const color = last > first ? "#10b981" : last < first ? "#ef4444" : "#6b7280";
  const TrendIcon = last > first ? TrendingUp : last < first ? TrendingDown : Minus;

  return (
    <div
      className="flex items-center gap-1.5 cursor-default"
      onMouseEnter={() => setHovered(true)}
      title={trend ? `7-day trend: ${first.toFixed(0)} → ${last.toFixed(0)}` : "Hover to load trend"}
    >
      <svg width={w} height={h} className="overflow-visible">
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <TrendIcon className="h-3 w-3" style={{ color }} />
    </div>
  );
}
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const STATUS_COLORS: Record<string, string> = {
  compliant: "#10b981", non_compliant: "#ef4444", under_review: "#f59e0b", suspended: "#8b5cf6"
};
const SECTOR_COLORS = ["#2563eb", "#ec4899", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ef4444", "#f97316"];
const SECTORS = ["finance", "health", "telecom", "government", "energy", "education", "retail", "transport"];
const COMPLIANCE_STATUSES = ["compliant", "non_compliant", "under_review", "remediation"] as const;

type OrgForm = { name: string; sector: string; country: string; city: string; registrationNumber: string; contactEmail: string; complianceStatus?: typeof COMPLIANCE_STATUSES[number] };
const EMPTY_FORM: OrgForm = { name: "", sector: "", country: "", city: "", registrationNumber: "", contactEmail: "" };
const PAGE_SIZE = 15;

export default function Organizations() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [editOrg, setEditOrg] = useState<any>(null);
  const [deleteOrg, setDeleteOrg] = useState<any>(null);
  const [caseHistoryOrg, setCaseHistoryOrg] = useState<any>(null);
  const [form, setForm] = useState<OrgForm>(EMPTY_FORM);

  const { data: orgCases } = trpc.enforcementCases.byOrg.useQuery(
    { organizationId: caseHistoryOrg?.id ?? 0, limit: 20 },
    { enabled: !!caseHistoryOrg?.id }
  );

  const { data: orgs } = trpc.organizations.list.useQuery({ limit: 500 });

  const createMutation = trpc.organizations.create.useMutation({
    onSuccess: () => { utils.organizations.list.invalidate(); setShowCreate(false); setForm(EMPTY_FORM); toast.success("Organisation created"); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const updateMutation = trpc.organizations.update.useMutation({
    onSuccess: () => { utils.organizations.list.invalidate(); setEditOrg(null); toast.success("Organisation updated"); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const deleteMutation = trpc.organizations.delete.useMutation({
    onSuccess: () => { utils.organizations.list.invalidate(); setDeleteOrg(null); toast.success("Organisation deleted"); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSector, setFilterSector] = useState("");
  const allOrgs = orgs ?? [];
  const filteredOrgs = allOrgs.filter((o: any) => {
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || (o.name ?? "").toLowerCase().includes(q) || (o.registrationNumber ?? "").toLowerCase().includes(q) || (o.jurisdiction ?? "").toLowerCase().includes(q);
    const matchStatus = !filterStatus || o.complianceStatus === filterStatus;
    const matchSector = !filterSector || o.sector === filterSector;
    return matchSearch && matchStatus && matchSector;
  });
  const totalPages = Math.ceil(filteredOrgs.length / PAGE_SIZE);
  const pageOrgs = filteredOrgs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const sectorBreakdown = allOrgs.reduce((acc: any, o: any) => { acc[o.sector] = (acc[o.sector] ?? 0) + 1; return acc; }, {});
  const sectorChartData = Object.entries(sectorBreakdown).map(([k, v], i) => ({ name: k?.replace("_", " ").toUpperCase() ?? "OTHER", count: v as number, color: SECTOR_COLORS[i % SECTOR_COLORS.length] }));
  const compliantCount = allOrgs.filter((o: any) => o.complianceStatus === "compliant").length;
  const nonCompliantCount = allOrgs.filter((o: any) => o.complianceStatus === "non_compliant").length;
  const avgRisk = allOrgs.length ? allOrgs.reduce((s: number, o: any) => s + Number(o.riskScore ?? 0), 0) / allOrgs.length : 0;
  const avgCompliance = allOrgs.length ? allOrgs.reduce((s: number, o: any) => s + Number(o.complianceScore ?? 0), 0) / allOrgs.length : 0;

  function openEdit(org: any) {
    setForm({ name: org.name, sector: org.sector ?? "", country: org.country ?? "", city: org.city ?? "", registrationNumber: org.registrationNumber ?? "", contactEmail: org.contactEmail ?? "", complianceStatus: org.complianceStatus });
    setEditOrg(org);
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Admin", href: "/" }, { label: "Organizations" }]} className="mb-4" />
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="layer-badge">ORG</span>
            <span className="data-label">Organization Registry · Compliance Profiles · Risk Scoring</span>
          </div>
          <h1 className="text-2xl font-bold">Organization Registry</h1>
          <p className="text-muted-foreground mono text-sm mt-0.5">All monitored organizations · Compliance status · Risk profiles · Enforcement history</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-2" onClick={() => {
            const headers = ["ID","Name","Sector","Country","Compliance Status","Compliance Score","Risk Score","Assets","Violations"];
            const rows = allOrgs.map((o: any) => [o.id,o.name,o.sector,o.country,o.complianceStatus,o.complianceScore,o.riskScore,o.totalAssets,o.openViolations].join(","));
            const csv = [headers.join(","), ...rows].join("\n");
            const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "organizations.csv"; a.click();
          }}><Download className="h-3.5 w-3.5" /> Export CSV</Button>
          {isAdmin && (
            <Button size="sm" className="gap-2" onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }}>
              <Plus className="h-3.5 w-3.5" /> Add Organization
            </Button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Organizations", value: allOrgs.length, icon: Building2, color: "#2563eb" },
          { label: "Compliant", value: compliantCount, icon: CheckCircle2, color: "#10b981" },
          { label: "Non-Compliant", value: nonCompliantCount, icon: XCircle, color: "#ef4444" },
          { label: "Avg Risk Score", value: avgRisk.toFixed(1), icon: AlertTriangle, color: "#f59e0b" },
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

      {/* Sector Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border border-border/60">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Organizations by Sector</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={sectorChartData} barSize={20}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }} />
                <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                <Tooltip contentStyle={{ fontSize: 11, fontFamily: "JetBrains Mono", background: "var(--card)", border: "1px solid var(--border)" }} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>{sectorChartData.map((e, i) => <Cell key={i} fill={e.color} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="border border-border/60">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">National Compliance Overview</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: "Average Compliance Score", value: avgCompliance, display: `${avgCompliance.toFixed(1)}/100`, color: "#2563eb" },
              { label: "Average Risk Score", value: avgRisk, display: `${avgRisk.toFixed(1)}/100`, color: avgRisk > 70 ? "#ef4444" : avgRisk > 50 ? "#f59e0b" : "#10b981" },
              { label: "Compliance Rate", value: allOrgs.length ? (compliantCount / allOrgs.length) * 100 : 0, display: `${allOrgs.length ? ((compliantCount / allOrgs.length) * 100).toFixed(1) : 0}%`, color: "#10b981" },
            ].map(m => (
              <div key={m.label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="data-label">{m.label}</span>
                  <span className="mono text-sm font-bold" style={{ color: m.color }}>{m.display}</span>
                </div>
                <Progress value={m.value} className="h-2" />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2 mt-2">
              {Object.entries(STATUS_COLORS).map(([status, color]) => {
                const count = allOrgs.filter((o: any) => o.complianceStatus === status).length;
                return (
                  <div key={status} className="flex items-center justify-between p-2 rounded bg-muted/40 border border-border/40">
                    <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-full" style={{ background: color }} /><span className="data-label capitalize">{status.replace("_", " ")}</span></div>
                    <span className="mono text-xs font-semibold">{count}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Organizations Table */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Organization Registry</CardTitle>
            <span className="data-label">{filteredOrgs.length}/{allOrgs.length} · page {page + 1}/{Math.max(1, totalPages)}</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Search + Filter bar */}
          <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-border/40">
            <div className="relative flex-1 min-w-[180px]">
              <Shield className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search name, reg. no., jurisdiction..." value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setPage(0); }} className="pl-8 h-7 text-xs" />
            </div>
            <Select value={filterStatus || "__all__"} onValueChange={v => { setFilterStatus(v === "__all__" ? "" : v); setPage(0); }}>
              <SelectTrigger className="h-7 text-xs w-36"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-xs">All statuses</SelectItem>
                {COMPLIANCE_STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs capitalize">{s.replace("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterSector || "__all__"} onValueChange={v => { setFilterSector(v === "__all__" ? "" : v); setPage(0); }}>
              <SelectTrigger className="h-7 text-xs w-32"><SelectValue placeholder="Sector" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-xs">All sectors</SelectItem>
                {SECTORS.map(s => <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>)}
              </SelectContent>
            </Select>
            {(searchQuery || filterStatus || filterSector) && (
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground" onClick={() => { setSearchQuery(""); setFilterStatus(""); setFilterSector(""); setPage(0); }}>Clear</Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  {["Organization", "Sector", "Jurisdiction", "Compliance Status", "Compliance Score", "7d Trend", "Risk Score", "Assets", "Violations", "Actions"].map(h => (
                    <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageOrgs.map((org: any) => (
                  <tr key={org.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <div><p className="font-medium">{org.name}</p><p className="data-label">{org.registrationNumber}</p></div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5"><Badge variant="outline" className="mono text-[9px] capitalize">{org.sector?.replace("_", " ")}</Badge></td>
                    <td className="px-4 py-2.5 mono text-muted-foreground">{org.jurisdiction}</td>
                    <td className="px-4 py-2.5">
                      {isAdmin ? (
                        <Select
                          value={org.complianceStatus ?? "under_review"}
                          onValueChange={(val) => updateMutation.mutate({ id: org.id, complianceStatus: val as any })}
                        >
                          <SelectTrigger className="h-6 text-[10px] mono w-28 border-0 bg-transparent p-0 focus:ring-0" style={{ color: STATUS_COLORS[org.complianceStatus] ?? "#6b7280" }}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {COMPLIANCE_STATUSES.map(s => (
                              <SelectItem key={s} value={s} className="text-xs capitalize">{s.replace(/_/g, " ")}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full" style={{ background: STATUS_COLORS[org.complianceStatus] ?? "#6b7280" }} />
                          <span className="mono text-[10px] capitalize" style={{ color: STATUS_COLORS[org.complianceStatus] ?? "#6b7280" }}>{org.complianceStatus?.replace("_", " ")}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2"><Progress value={Number(org.complianceScore ?? 0)} className="h-1.5 w-16" /><span className="mono text-[10px]">{Number(org.complianceScore ?? 0).toFixed(0)}</span></div>
                    </td>
                    <td className="px-4 py-2.5">
                      <OrgSparkline orgId={org.id} complianceScore={Number(org.complianceScore ?? 0)} />
                    </td>
                    <td className="px-4 py-2.5"><span className="mono font-semibold" style={{ color: Number(org.riskScore) > 70 ? "#ef4444" : Number(org.riskScore) > 50 ? "#f59e0b" : "#10b981" }}>{Number(org.riskScore ?? 0).toFixed(1)}</span></td>
                    <td className="px-4 py-2.5 mono">{Number(org.totalAssets ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 mono">{Number(org.openViolations ?? 0)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        <button aria-label="View cases" onClick={() => setCaseHistoryOrg(org)} title="View Case History" className="p-1 rounded hover:bg-orange-500/10 text-muted-foreground hover:text-orange-500 transition-colors"><Gavel className="h-3 w-3" /></button>
                        <a href={`/audit-log?resourceId=${org.id}&resourceType=organization`} title="View Audit Trail" className="p-1 rounded hover:bg-blue-500/10 text-muted-foreground hover:text-blue-500 transition-colors"><FileSearch className="h-3 w-3" /></a>
                        <a href={`/trends/${org.id}`} title="View 90-day Compliance Trend" className="p-1 rounded hover:bg-green-500/10 text-muted-foreground hover:text-green-500 transition-colors"><TrendingUp className="h-3 w-3" /></a>
                        {(org as any).contactEmail && (
                          <a href={`mailto:${(org as any).contactEmail}`} title={`Email DPO: ${(org as any).contactEmail}`} className="p-1 rounded hover:bg-emerald-500/10 text-muted-foreground hover:text-emerald-500 transition-colors"><Mail className="h-3 w-3" /></a>
                        )}
                        {isAdmin && (<>
                          <button aria-label="Edit" onClick={() => openEdit(org)} className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"><Pencil className="h-3 w-3" /></button>
                          <button aria-label="Delete" onClick={() => setDeleteOrg(org)} className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"><Trash2 className="h-3 w-3" /></button>
                        </>)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
              <span className="data-label">Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, allOrgs.length)} of {allOrgs.length}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}><ChevronLeft className="h-3 w-3" /></Button>
                <span className="mono text-xs">{page + 1} / {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}><ChevronRight className="h-3 w-3" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Organization</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label className="text-xs">Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Organization name" className="mt-1" /></div>
            <div><Label className="text-xs">Sector</Label>
              <Select value={form.sector} onValueChange={v => setForm(f => ({ ...f, sector: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select sector" /></SelectTrigger>
                <SelectContent>{SECTORS.map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Country</Label><Input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="e.g. Nigeria" className="mt-1" /></div>
              <div><Label className="text-xs">City</Label><Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="e.g. Abuja" className="mt-1" /></div>
            </div>
            <div><Label className="text-xs">Registration Number</Label><Input value={form.registrationNumber} onChange={e => setForm(f => ({ ...f, registrationNumber: e.target.value }))} placeholder="RC-XXXXXX" className="mt-1" /></div>
            <div><Label className="text-xs">Contact Email (for penalty notifications)</Label><Input type="email" value={form.contactEmail} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} placeholder="compliance@organisation.com" className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate({ name: form.name, sector: form.sector || undefined, country: form.country || undefined, city: form.city || undefined, registrationNumber: form.registrationNumber || undefined, contactEmail: form.contactEmail || undefined })} disabled={!form.name || createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editOrg} onOpenChange={v => !v && setEditOrg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Organization</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label className="text-xs">Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mt-1" /></div>
            <div><Label className="text-xs">Sector</Label>
              <Select value={form.sector} onValueChange={v => setForm(f => ({ ...f, sector: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select sector" /></SelectTrigger>
                <SelectContent>{SECTORS.map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Country</Label><Input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} className="mt-1" /></div>
              <div><Label className="text-xs">City</Label><Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} className="mt-1" /></div>
            </div>
            <div><Label className="text-xs">Compliance Status</Label>
              <Select value={form.complianceStatus ?? ""} onValueChange={v => setForm(f => ({ ...f, complianceStatus: v as any }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>{COMPLIANCE_STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Contact Email (for penalty notifications)</Label><Input type="email" value={form.contactEmail} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} placeholder="compliance@organisation.com" className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOrg(null)}>Cancel</Button>
            <Button onClick={() => updateMutation.mutate({ id: editOrg.id, name: form.name || undefined, sector: form.sector || undefined, country: form.country || undefined, city: form.city || undefined, complianceStatus: form.complianceStatus, contactEmail: form.contactEmail || undefined })} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Case History Dialog */}
      <Dialog open={!!caseHistoryOrg} onOpenChange={v => !v && setCaseHistoryOrg(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Enforcement Case History — {caseHistoryOrg?.name}</DialogTitle></DialogHeader>
          <div className="py-2">
            {!orgCases ? (
              <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
            ) : (orgCases as any[]).length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No enforcement cases found for this organisation.</p>
            ) : (
              <div className="space-y-2">
                {(orgCases as any[]).map((c: any) => {
                  const statusColor: Record<string, string> = { open: "#ef4444", under_investigation: "#f59e0b", notice_issued: "#2563eb", escalated_to_nitda: "#8b5cf6", settled: "#10b981", closed: "#6b7280" };
                  const color = statusColor[c.status] ?? "#6b7280";
                  return (
                    <div key={c.id} className="flex items-start gap-3 p-3 rounded-lg border border-border/40 bg-muted/20">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="mono text-xs font-bold text-foreground">{c.case_reference}</span>
                          <span className="mono text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ color, background: color + "20" }}>{c.status?.replace(/_/g, " ").toUpperCase()}</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{c.penalty_description ?? c.escalation_reason ?? "—"}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="mono text-[10px] text-muted-foreground">Amount: <span className="text-foreground font-semibold">{Number(c.amount ?? 0).toLocaleString()} {c.currency}</span></span>
                          <span className="mono text-[10px] text-muted-foreground">Opened: {c.opened_at ? new Date(c.opened_at).toLocaleDateString() : "—"}</span>
                          {c.nitda_reference_number && <span className="mono text-[10px] text-muted-foreground">NITDA Ref: <span className="text-foreground">{c.nitda_reference_number}</span></span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { window.location.href = "/enforcement-cases"; }}>View All Cases</Button>
            <Button variant="outline" size="sm" onClick={() => setCaseHistoryOrg(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteOrg} onOpenChange={v => !v && setDeleteOrg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Organization</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">Are you sure you want to delete <strong>{deleteOrg?.name}</strong>? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOrg(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate({ id: deleteOrg.id })} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
