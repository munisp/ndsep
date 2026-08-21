import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GitBranch, Plus, Pencil, Trash2, ChevronLeft, ChevronRight, Download, FileSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { Server, Cloud, HardDrive, Wifi, Monitor, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

import { Breadcrumbs } from "@/components/Breadcrumbs";
function NetBoxTopologyPanel() {
  const { data: metrics } = trpc.workers.metrics.useQuery({ workerId: "netbox-ipam" }, { refetchInterval: 10000 });
  const m = (metrics as any) ?? {};
  const rows = [
    { label: "Topology Nodes", value: m.topology_nodes ?? 0, color: "text-cyan-400" },
    { label: "Subnets Tracked", value: m.subnets_tracked ?? 0, color: "text-blue-400" },
    { label: "VLANs Discovered", value: m.vlans_discovered ?? 0, color: "text-purple-400" },
    { label: "IPs Allocated", value: m.ips_allocated ?? 0, color: "text-green-400" },
    { label: "Prefixes Scanned", value: m.prefixes_scanned ?? 0, color: "text-foreground" },
    { label: "IPAM Utilization", value: `${Number(m.ipam_utilization ?? 0).toFixed(1)}%`, color: "text-yellow-400" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {rows.map(r => (
        <div key={r.label} className="bg-muted/30 rounded p-2 border border-border/40">
          <p className="data-label text-[9px]">{r.label}</p>
          <p className={`mono text-sm font-bold mt-0.5 ${r.color}`}>{typeof r.value === 'number' ? Number(r.value).toLocaleString() : r.value}</p>
        </div>
      ))}
    </div>
  );
}

function NmapScannerPanel() {
  const { data: metrics } = trpc.workers.metrics.useQuery({ workerId: "nmap-scanner" }, { refetchInterval: 10000 });
  const m = (metrics as any) ?? {};
  const rows = [
    { label: "Nmap Scans", value: m.nmap_scans_completed ?? 0, color: "text-cyan-400" },
    { label: "ZMap Hosts Found", value: m.zmap_hosts_discovered ?? 0, color: "text-blue-400" },
    { label: "Masscan Open Ports", value: m.masscan_ports_open ?? 0, color: "text-purple-400" },
    { label: "Undeclared Devices", value: m.undeclared_devices ?? 0, color: "text-red-400" },
    { label: "Shodan Exposed", value: m.shodan_exposed_assets ?? 0, color: "text-orange-400" },
    { label: "Critical Exposures", value: m.critical_exposures ?? 0, color: "text-red-500" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {rows.map(r => (
        <div key={r.label} className="bg-muted/30 rounded p-2 border border-border/40">
          <p className="data-label text-[9px]">{r.label}</p>
          <p className={`mono text-sm font-bold mt-0.5 ${r.color}`}>{Number(r.value).toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}

const ASSET_COLORS: Record<string, string> = {
  server: "#2563eb", database: "#8b5cf6", cloud_storage: "#ec4899",
  network_device: "#10b981", endpoint: "#f59e0b", application: "#06b6d4",
};
const ASSET_ICONS: Record<string, React.ComponentType<any>> = {
  server: Server, database: HardDrive, cloud_storage: Cloud,
  network_device: Wifi, endpoint: Monitor, application: Monitor,
};
const ASSET_TYPES = ["hardware", "software", "cloud", "network", "database", "saas"] as const;
const ASSET_STATUSES = ["active", "inactive", "quarantined", "decommissioned"] as const;
const ASSET_PAGE_SIZE = 15;

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = { active: "#10b981", inactive: "#6b7280", quarantined: "#ef4444", pending_review: "#f59e0b" };
  return <span className="inline-block h-2 w-2 rounded-full" style={{ background: colors[status] ?? "#6b7280" }} />;
}

type AssetForm = { name: string; assetType: string; organizationId: string; ipAddress: string; hostname: string; location: string; isWithinBorders: boolean; status?: string; };
const EMPTY_ASSET_FORM: AssetForm = { name: "", assetType: "", organizationId: "", ipAddress: "", hostname: "", location: "", isWithinBorders: true };

export default function DiscoveryEngine() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [assetPage, setAssetPage] = useState(0);
  const [showCreateAsset, setShowCreateAsset] = useState(false);
  const [editAsset, setEditAsset] = useState<any>(null);
  const [deleteAsset, setDeleteAsset] = useState<any>(null);
  const [assetForm, setAssetForm] = useState<AssetForm>(EMPTY_ASSET_FORM);

  const createAssetMutation = trpc.assets.create.useMutation({
    onSuccess: () => { utils.assets.list.invalidate(); utils.assets.byType.invalidate(); setShowCreateAsset(false); setAssetForm(EMPTY_ASSET_FORM); toast.success("Asset created"); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const updateAssetMutation = trpc.assets.update.useMutation({
    onSuccess: () => { utils.assets.list.invalidate(); setEditAsset(null); toast.success("Asset updated"); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const deleteAssetMutation = trpc.assets.delete.useMutation({
    onSuccess: () => { utils.assets.list.invalidate(); utils.assets.byType.invalidate(); setDeleteAsset(null); toast.success("Asset deleted"); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const { data: assets } = trpc.assets.list.useQuery({ limit: 500 });
  const { data: assetsByType } = trpc.assets.byType.useQuery();
  const { data: bgpStats } = trpc.bgp.stats.useQuery(undefined, { refetchInterval: 20000 });
  const { data: bgpRoutes } = trpc.bgp.routes.useQuery({ limit: 5, hijackedOnly: false }, { refetchInterval: 20000 });

  const [assetSearch, setAssetSearch] = useState("");
  const [assetFilterType, setAssetFilterType] = useState("");
  const [assetFilterStatus, setAssetFilterStatus] = useState("");
  const allAssets = assets ?? [];
  const filteredAssets = allAssets.filter((a: any) => {
    const q = assetSearch.toLowerCase();
    const matchSearch = !q || (a.name ?? "").toLowerCase().includes(q) || (a.ipAddress ?? "").toLowerCase().includes(q) || (a.hostname ?? "").toLowerCase().includes(q) || (a.location ?? "").toLowerCase().includes(q);
    const matchType = !assetFilterType || a.assetType === assetFilterType;
    const matchStatus = !assetFilterStatus || a.status === assetFilterStatus;
    return matchSearch && matchType && matchStatus;
  });
  const totalAssetPages = Math.ceil(filteredAssets.length / ASSET_PAGE_SIZE);
  const pageAssets = filteredAssets.slice(assetPage * ASSET_PAGE_SIZE, (assetPage + 1) * ASSET_PAGE_SIZE);

  const typeChartData = (assetsByType ?? []).map((t: any) => ({
    name: t.assetType?.replace("_", " ").toUpperCase() ?? "UNKNOWN",
    total: Number(t.count),
    outside: Number(t.outsideBorders),
    color: ASSET_COLORS[t.assetType] ?? "#6b7280",
  }));

  const statusCounts = allAssets.reduce((acc: any, a: any) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});

  const pieData = Object.entries(statusCounts).map(([k, v]) => ({
    name: k, value: v as number,
    color: k === "active" ? "#10b981" : k === "quarantined" ? "#ef4444" : k === "inactive" ? "#6b7280" : "#f59e0b"
  }));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Discovery Engine" }]} className="mb-4" />
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="layer-badge">LAYER 1</span>
            <span className="data-label">Discovery Engine · NMAP · Censys · CloudQuery · GLPI</span>
          </div>
          <h1 className="text-2xl font-bold">Asset Discovery Engine</h1>
          <p className="text-muted-foreground mono text-sm mt-0.5">Active & passive scanning · Hardware, software, cloud, network assets · Vulnerability assessment</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="live-indicator h-2 w-2 rounded-full bg-green-500 inline-block" />
          <span className="data-label text-green-600">SCANNING</span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Assets", value: allAssets.length, icon: Server, color: "#2563eb" },
          { label: "Active", value: statusCounts["active"] ?? 0, icon: CheckCircle2, color: "#10b981" },
          { label: "Quarantined", value: statusCounts["quarantined"] ?? 0, icon: XCircle, color: "#ef4444" },
          { label: "Outside Borders", value: allAssets.filter((a: any) => !a.isWithinBorders).length, icon: AlertTriangle, color: "#f59e0b" },
        ].map((m) => (
          <Card key={m.label} className="border border-border/60 relative overflow-hidden">
            <div className="absolute inset-0 blueprint-grid opacity-20" />
            <CardContent className="relative p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="data-label">{m.label}</p>
                  <p className="metric-value text-2xl font-bold mt-1">{m.value.toLocaleString()}</p>
                </div>
                <m.icon className="h-6 w-6 opacity-60" style={{ color: m.color }} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border border-border/60">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Assets by Type</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={typeChartData} barSize={20}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }} />
                <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                <Tooltip contentStyle={{ fontSize: 11, fontFamily: "JetBrains Mono", background: "var(--card)", border: "1px solid var(--border)" }} />
                <Bar dataKey="total" name="Total" radius={[3, 3, 0, 0]}>{typeChartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}</Bar>
                <Bar dataKey="outside" name="Outside Borders" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="border border-border/60">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Asset Status</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={3}>
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11, fontFamily: "JetBrains Mono", background: "var(--card)", border: "1px solid var(--border)" }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1">
              {pieData.map((item) => (
                <div key={item.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full" style={{ background: item.color }} /><span className="data-label capitalize">{item.name.replace("_", " ")}</span></div>
                  <span className="mono text-xs font-semibold">{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Asset Table */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Asset Inventory</CardTitle>
            <div className="flex items-center gap-2">
              <span className="data-label">{filteredAssets.length}/{allAssets.length} · page {assetPage + 1}/{Math.max(1, totalAssetPages)}</span>
              <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => {
                const headers = ["ID","Name","Type","Status","IP Address","Hostname","Location","Within Borders"];
                const rows = allAssets.map((a: any) => [a.id,a.name,a.assetType,a.status,a.ipAddress ?? "",a.hostname ?? "",a.location ?? "",a.isWithinBorders].join(","));
                const csv = [headers.join(","), ...rows].join("\n");
                const el = document.createElement("a"); el.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); el.download = "assets.csv"; el.click();
              }}><Download className="h-3 w-3" /> Export CSV</Button>
              {isAdmin && (
                <Button size="sm" className="gap-1 h-7 text-xs" onClick={() => { setAssetForm(EMPTY_ASSET_FORM); setShowCreateAsset(true); }}><Plus className="h-3 w-3" /> Add Asset</Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Search + Filter bar */}
          <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-border/40">
            <div className="relative flex-1 min-w-[180px]">
              <GitBranch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search name, IP, hostname, location..." value={assetSearch} onChange={e => { setAssetSearch(e.target.value); setAssetPage(0); }} className="pl-8 h-7 text-xs" />
            </div>
            <Select value={assetFilterType || "__all__"} onValueChange={v => { setAssetFilterType(v === "__all__" ? "" : v); setAssetPage(0); }}>
              <SelectTrigger className="h-7 text-xs w-32"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-xs">All types</SelectItem>
                {["server","database","cloud_storage","network_device","endpoint","application"].map(t => <SelectItem key={t} value={t} className="text-xs capitalize">{t.replace("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={assetFilterStatus || "__all__"} onValueChange={v => { setAssetFilterStatus(v === "__all__" ? "" : v); setAssetPage(0); }}>
              <SelectTrigger className="h-7 text-xs w-28"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-xs">All statuses</SelectItem>
                {["active","inactive","quarantined","decommissioned"].map(s => <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>)}
              </SelectContent>
            </Select>
            {(assetSearch || assetFilterType || assetFilterStatus) && (
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => { setAssetSearch(""); setAssetFilterType(""); setAssetFilterStatus(""); setAssetPage(0); }}>Clear</Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  {["Status", "Name", "Type", "Organization", "IP Address", "Location", "Borders", "Risk", "Actions"].map(h => (
                    <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageAssets.map((asset: any) => {
                  const Icon = ASSET_ICONS[asset.assetType] ?? Server;
                  return (
                    <tr key={asset.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5"><div className="flex items-center gap-1.5"><StatusDot status={asset.status} /><span className="mono capitalize">{asset.status?.replace("_", " ")}</span></div></td>
                      <td className="px-4 py-2.5"><div className="flex items-center gap-2"><Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" /><span className="font-medium truncate max-w-[140px]">{asset.name}</span></div></td>
                      <td className="px-4 py-2.5"><Badge variant="outline" className="mono text-[9px] capitalize">{asset.assetType?.replace("_", " ")}</Badge></td>
                      <td className="px-4 py-2.5 mono text-muted-foreground">Org #{asset.organizationId}</td>
                      <td className="px-4 py-2.5 mono">{asset.ipAddress ?? "—"}</td>
                      <td className="px-4 py-2.5 mono text-muted-foreground truncate max-w-[120px]">{asset.location ?? "—"}</td>
                      <td className="px-4 py-2.5">{asset.isWithinBorders ? <span className="text-green-600 mono text-[10px]">✓ IN</span> : <span className="text-red-500 mono text-[10px] font-bold">✗ OUT</span>}</td>
                      <td className="px-4 py-2.5"><span className="mono font-semibold" style={{ color: Number(asset.riskScore) > 70 ? "#ef4444" : Number(asset.riskScore) > 50 ? "#f59e0b" : "#10b981" }}>{Number(asset.riskScore ?? 0).toFixed(0)}</span></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <a href={`/audit-log?resourceId=${asset.id}&resourceType=asset`} title="View Audit Trail" className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"><FileSearch className="h-3 w-3" /></a>
                          {isAdmin && (
                            <>
                              <button aria-label="Edit" onClick={() => { setAssetForm({ name: asset.name, assetType: asset.assetType ?? "", organizationId: String(asset.organizationId ?? ""), ipAddress: asset.ipAddress ?? "", hostname: asset.hostname ?? "", location: asset.location ?? "", isWithinBorders: asset.isWithinBorders ?? true, status: asset.status }); setEditAsset(asset); }} className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"><Pencil className="h-3 w-3" /></button>
                              <button aria-label="Delete" onClick={() => setDeleteAsset(asset)} className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"><Trash2 className="h-3 w-3" /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalAssetPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
              <span className="data-label">Showing {assetPage * ASSET_PAGE_SIZE + 1}–{Math.min((assetPage + 1) * ASSET_PAGE_SIZE, allAssets.length)} of {allAssets.length}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setAssetPage(p => Math.max(0, p - 1))} disabled={assetPage === 0}><ChevronLeft className="h-3 w-3" /></Button>
                <span className="mono text-xs">{assetPage + 1} / {totalAssetPages}</span>
                <Button variant="outline" size="sm" onClick={() => setAssetPage(p => Math.min(totalAssetPages - 1, p + 1))} disabled={assetPage >= totalAssetPages - 1}><ChevronRight className="h-3 w-3" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* BGP Route Validation Summary — Rust Worker */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" />
              BGP Route Validation
              <span className="text-[10px] font-bold text-orange-400 font-mono bg-orange-500/10 px-1.5 py-0.5 rounded border border-orange-500/20 ml-1">Rust</span>
            </CardTitle>
            {bgpStats && (
              <div className="flex items-center gap-3 text-xs font-mono">
                <span className="text-green-400">{(bgpStats as any).valid ?? 0} valid</span>
                <span className="text-red-400">{(bgpStats as any).hijacked ?? 0} hijacked</span>
                <span className="text-yellow-400">{(bgpStats as any).leaked ?? 0} leaked</span>
                <span className="text-muted-foreground">{(bgpStats as any).total ?? 0} total (24h)</span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  {["Prefix", "Origin ASN", "Peer ASN", "RPKI Status", "Hijacked", "Cross-Border", "IXP Site"].map(h => (
                    <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!bgpRoutes || (bgpRoutes as any[]).length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">BGP Validator generating routes...</td></tr>
                ) : (
                  (bgpRoutes as any[]).map((r: any) => (
                    <tr key={r.id} className={`border-b border-border/30 hover:bg-muted/20 ${r.is_hijacked ? 'bg-red-500/5' : ''}`}>
                      <td className="px-4 py-2.5 mono font-medium">{r.prefix}</td>
                      <td className="px-4 py-2.5 mono">AS{r.origin_asn}</td>
                      <td className="px-4 py-2.5 mono text-muted-foreground">AS{r.peer_asn}</td>
                      <td className="px-4 py-2.5">
                        <span className={`mono text-[10px] font-semibold px-1.5 py-0.5 rounded border ${r.rpki_status === 'valid' ? 'text-green-400 border-green-500/30 bg-green-500/10' : r.rpki_status === 'invalid' ? 'text-red-400 border-red-500/30 bg-red-500/10' : 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10'}`}>{r.rpki_status?.toUpperCase()}</span>
                      </td>
                      <td className="px-4 py-2.5">{r.is_hijacked ? <AlertTriangle className="h-4 w-4 text-red-400" /> : <CheckCircle2 className="h-4 w-4 text-green-400/40" />}</td>
                      <td className="px-4 py-2.5">{r.is_cross_border ? <span className="text-[10px] font-bold text-orange-400 mono">YES</span> : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-2.5 mono text-muted-foreground">{r.ixp_site}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* NetBox IPAM + Nmap Scanner Live Panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border border-border/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                NetBox IPAM — Network Topology
              </CardTitle>
              <span className="layer-badge">L1 · GO</span>
            </div>
          </CardHeader>
          <CardContent className="p-4"><NetBoxTopologyPanel /></CardContent>
        </Card>
        <Card className="border border-border/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Nmap / ZMap / Masscan — Active Scanner
              </CardTitle>
              <span className="layer-badge">L1 · GO</span>
            </div>
          </CardHeader>
          <CardContent className="p-4"><NmapScannerPanel /></CardContent>
        </Card>
      </div>

      {/* Create Asset Dialog */}
      <Dialog open={showCreateAsset} onOpenChange={setShowCreateAsset}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Asset</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label className="text-xs">Name *</Label><Input value={assetForm.name} onChange={e => setAssetForm(f => ({ ...f, name: e.target.value }))} placeholder="Asset name" className="mt-1" /></div>
            <div><Label className="text-xs">Asset Type *</Label>
              <Select value={assetForm.assetType} onValueChange={v => setAssetForm(f => ({ ...f, assetType: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>{ASSET_TYPES.map(t => <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Organization ID</Label><Input value={assetForm.organizationId} onChange={e => setAssetForm(f => ({ ...f, organizationId: e.target.value }))} placeholder="e.g. 1" className="mt-1" type="number" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">IP Address</Label><Input value={assetForm.ipAddress} onChange={e => setAssetForm(f => ({ ...f, ipAddress: e.target.value }))} placeholder="192.168.1.1" className="mt-1" /></div>
              <div><Label className="text-xs">Location</Label><Input value={assetForm.location} onChange={e => setAssetForm(f => ({ ...f, location: e.target.value }))} placeholder="Lagos DC-1" className="mt-1" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateAsset(false)}>Cancel</Button>
            <Button onClick={() => createAssetMutation.mutate({ name: assetForm.name, assetType: assetForm.assetType as any, organizationId: Number(assetForm.organizationId) || 1, ipAddress: assetForm.ipAddress || undefined, location: assetForm.location || undefined })} disabled={!assetForm.name || !assetForm.assetType || createAssetMutation.isPending}>
              {createAssetMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Asset Dialog */}
      <Dialog open={!!editAsset} onOpenChange={v => !v && setEditAsset(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Asset</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label className="text-xs">Name</Label><Input value={assetForm.name} onChange={e => setAssetForm(f => ({ ...f, name: e.target.value }))} className="mt-1" /></div>
            <div><Label className="text-xs">Status</Label>
              <Select value={assetForm.status ?? ""} onValueChange={v => setAssetForm(f => ({ ...f, status: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>{ASSET_STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Location</Label><Input value={assetForm.location} onChange={e => setAssetForm(f => ({ ...f, location: e.target.value }))} className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditAsset(null)}>Cancel</Button>
            <Button onClick={() => updateAssetMutation.mutate({ id: editAsset.id, name: assetForm.name || undefined, status: assetForm.status as any, location: assetForm.location || undefined })} disabled={updateAssetMutation.isPending}>
              {updateAssetMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Asset Dialog */}
      <Dialog open={!!deleteAsset} onOpenChange={v => !v && setDeleteAsset(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Asset</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">Are you sure you want to delete <strong>{deleteAsset?.name}</strong>? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAsset(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteAssetMutation.mutate({ id: deleteAsset.id })} disabled={deleteAssetMutation.isPending}>
              {deleteAssetMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
