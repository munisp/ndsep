import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, Globe, AlertTriangle, RefreshCw, Plus } from "lucide-react";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const JURISDICTIONS = ["Nigeria", "USA", "EU", "China", "UK", "India", "UAE", "South Africa"];
const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899"];

function ChordDiagram({ flows }: { flows: any[] }) {
  const cx = 300, cy = 300, r = 200, innerR = 160;
  const nodes = useMemo(() => {
    const seen = new Set<string>();
    flows.forEach(f => { seen.add(f.sourceJurisdiction || "Nigeria"); seen.add(f.destinationJurisdiction || "Unknown"); });
    return Array.from(seen).slice(0, 8);
  }, [flows]);

  const nodeAngles = useMemo(() => {
    const step = (2 * Math.PI) / Math.max(nodes.length, 1);
    return nodes.map((n, i) => ({ name: n, angle: i * step - Math.PI / 2, color: COLORS[i % COLORS.length] }));
  }, [nodes]);

  const getPoint = (angle: number, radius: number) => ({
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  });

  const flowPaths = useMemo(() => flows.slice(0, 20).map((f, i) => {
    const src = nodeAngles.find(n => n.name === (f.sourceJurisdiction || "Nigeria"));
    const dst = nodeAngles.find(n => n.name === (f.destinationJurisdiction || "Unknown"));
    if (!src || !dst) return null;
    const p1 = getPoint(src.angle, innerR);
    const p2 = getPoint(dst.angle, innerR);
    const isViolation = f.status === "blocked" || f.riskScore > 70;
    return (
      <path key={i} d={`M${p1.x},${p1.y} Q${cx},${cy} ${p2.x},${p2.y}`}
        stroke={isViolation ? "#ef4444" : "#3b82f6"} strokeWidth={isViolation ? 2 : 1}
        fill="none" opacity={0.6} strokeDasharray={isViolation ? "4,2" : undefined} />
    );
  }), [flows, nodeAngles]);

  return (
    <svg viewBox="0 0 600 600" className="w-full max-w-lg mx-auto">
      <defs><radialGradient id="bg"><stop offset="0%" stopColor="#1f2937" /><stop offset="100%" stopColor="#111827" /></radialGradient></defs>
      <circle cx={cx} cy={cy} r={r + 40} fill="url(#bg)" />
      {flowPaths}
      {nodeAngles.map(({ name, angle, color }) => {
        const p = getPoint(angle, r);
        const lp = getPoint(angle, r + 25);
        return (
          <g key={name}>
            <circle cx={p.x} cy={p.y} r={10} fill={color} opacity={0.9} />
            <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="#d1d5db" fontFamily="monospace">{name}</text>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={40} fill="#1f2937" stroke="#374151" strokeWidth={1} />
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize={10} fill="#9ca3af">DATA</text>
      <text x={cx} y={cy + 8} textAnchor="middle" fontSize={10} fill="#9ca3af">FLOWS</text>
    </svg>
  );
}

export default function DataFlowVisualization() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [logOpen, setLogOpen] = useState(false);
  const [form, setForm] = useState({ datasetName: "", sourceCountry: "Nigeria", destinationCountry: "", destinationEntity: "", volumeGb: "1", dataClassification: "confidential", businessJustification: "", transferMethod: "encrypted_api" });

  const utils = trpc.useUtils();
  const createTransfer = trpc.transfers.create.useMutation({
    onSuccess: () => {
      toast.success("Transfer logged and queued for review");
      utils.transfers.list.invalidate();
      setLogOpen(false);
      setForm({ datasetName: "", sourceCountry: "Nigeria", destinationCountry: "", destinationEntity: "", volumeGb: "1", dataClassification: "confidential", businessJustification: "", transferMethod: "encrypted_api" });
    },
    onError: (e) => toast.error(`Failed to log transfer: ${(e instanceof Error ? e.message : String(e))}`),
  });

  const { data: transfers = [], refetch, isLoading } = trpc.transfers.list.useQuery({ limit: 100 });

  const flows = (transfers as any[]).filter(t => statusFilter === "all" || t.status === statusFilter);

  const stats = {
    total: (transfers as any[]).length,
    approved: (transfers as any[]).filter((t: any) => t.status === "approved").length,
    blocked: (transfers as any[]).filter((t: any) => t.status === "rejected" || t.status === "blocked").length,
    pending: (transfers as any[]).filter((t: any) => t.status === "pending").length,
  };

  const topRoutes = useMemo(() => {
    const routes: Record<string, number> = {};
    (transfers as any[]).forEach((t: any) => {
      const key = `${t.sourceJurisdiction || "Nigeria"} → ${t.destinationJurisdiction || "Unknown"}`;
      routes[key] = (routes[key] || 0) + 1;
    });
    return Object.entries(routes).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [transfers]);

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Data", href: "/catalog" }, { label: "Data Flow Visualization" }]} className="mb-4" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Cross-Border Data Flow Visualization</h1>
          <p className="text-muted-foreground text-sm mt-1">Real-time visualization of data transfer flows across jurisdictions</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={logOpen} onOpenChange={setLogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Log Transfer</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Log Cross-Border Data Transfer</DialogTitle></DialogHeader>
              <div className="space-y-3 pt-2">
                <div className="space-y-1">
                  <Label className="text-xs">Dataset Name *</Label>
                  <Input placeholder="e.g. Customer PII Export" value={form.datasetName} onChange={e => setForm(f => ({ ...f, datasetName: e.target.value }))} className="h-8 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Source Country</Label>
                    <Input value={form.sourceCountry} onChange={e => setForm(f => ({ ...f, sourceCountry: e.target.value }))} className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Destination Country *</Label>
                    <Input placeholder="e.g. USA" value={form.destinationCountry} onChange={e => setForm(f => ({ ...f, destinationCountry: e.target.value }))} className="h-8 text-sm" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Destination Entity *</Label>
                  <Input placeholder="e.g. AWS S3 us-east-1" value={form.destinationEntity} onChange={e => setForm(f => ({ ...f, destinationEntity: e.target.value }))} className="h-8 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Volume (GB)</Label>
                    <Input type="number" min="0.1" step="0.1" value={form.volumeGb} onChange={e => setForm(f => ({ ...f, volumeGb: e.target.value }))} className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Classification</Label>
                    <Select value={form.dataClassification} onValueChange={v => setForm(f => ({ ...f, dataClassification: v }))}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["public", "internal", "confidential", "restricted", "top_secret"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Business Justification *</Label>
                  <Input placeholder="e.g. Backup to DR site" value={form.businessJustification} onChange={e => setForm(f => ({ ...f, businessJustification: e.target.value }))} className="h-8 text-sm" />
                </div>
                <Button size="sm" className="w-full" disabled={!form.datasetName || !form.destinationCountry || !form.destinationEntity || !form.businessJustification || createTransfer.isPending}
                  onClick={() => createTransfer.mutate({ organizationId: 1, datasetName: form.datasetName, sourceCountry: form.sourceCountry, destinationCountry: form.destinationCountry, destinationEntity: form.destinationEntity, volumeGb: parseFloat(form.volumeGb), dataClassification: form.dataClassification, businessJustification: form.businessJustification, transferMethod: form.transferMethod })}>
                  {createTransfer.isPending ? "Logging..." : "Log Transfer"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="outline" className="border-border" onClick={() => refetch()}><RefreshCw className="w-4 h-4 mr-2" /> Refresh</Button>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[{ label: "Total Flows", value: stats.total, color: "text-foreground" }, { label: "Approved", value: stats.approved, color: "text-green-400" }, { label: "Blocked", value: stats.blocked, color: "text-red-400" }, { label: "Pending Review", value: stats.pending, color: "text-yellow-400" }].map(({ label, value, color }) => (
          <div key={label} className="bg-card rounded-xl border border-border p-4"><div className="text-muted-foreground text-sm">{label}</div><div className={`text-2xl font-bold ${color}`}>{value}</div></div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-foreground font-semibold mb-4 flex items-center gap-2"><Globe className="w-5 h-5 text-blue-400" /> Jurisdiction Flow Map</h2>
          {isLoading ? <div className="h-64 flex items-center justify-center text-muted-foreground">Loading flows...</div> : <ChordDiagram flows={flows} />}
          <div className="flex gap-3 mt-4 justify-center text-xs">
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block" /> Approved</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500 inline-block border-dashed border-t border-red-500" /> Blocked/High Risk</span>
          </div>
        </div>
        <div className="space-y-4">
          <div className="bg-card rounded-xl border border-border p-5">
            <h2 className="text-foreground font-semibold mb-4 flex items-center gap-2"><Activity className="w-5 h-5 text-green-400" /> Top Transfer Routes</h2>
            <div className="space-y-2">
              {topRoutes.length === 0 ? <p className="text-muted-foreground text-sm">No transfer data available</p> : topRoutes.map(([route, count]) => (
                <div key={route} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{route}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, (count / (topRoutes[0]?.[1] || 1)) * 100)}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground w-6 text-right">{count}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-card rounded-xl border border-border p-5">
            <h2 className="text-foreground font-semibold mb-4 flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-400" /> Recent Blocked Flows</h2>
            <div className="space-y-2">
              {(transfers as any[]).filter((t: any) => t.status === "rejected").slice(0, 5).length === 0 ? (
                <p className="text-muted-foreground text-sm">No blocked flows</p>
              ) : (transfers as any[]).filter((t: any) => t.status === "rejected").slice(0, 5).map((t: any) => (
                <div key={t.id} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t.sourceJurisdiction || "NG"} → {t.destinationJurisdiction || "???"}</span>
                  <Badge className="text-xs bg-red-500/20 text-red-400">{t.dataCategory || "Unknown"}</Badge>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-3"><h2 className="text-foreground font-semibold text-sm">Filter Flows</h2></div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="bg-background border-border text-foreground text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Flows</SelectItem>
                <SelectItem value="approved">Approved Only</SelectItem>
                <SelectItem value="pending">Pending Only</SelectItem>
                <SelectItem value="rejected">Blocked Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
