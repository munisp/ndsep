import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import * as d3 from "d3";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Network, ZoomIn, ZoomOut, RefreshCw, X, AlertTriangle, CheckCircle2, PackageCheck, Clock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const TYPE_COLORS: Record<string, string> = {
  server: "#3b82f6",
  database: "#10b981",
  api: "#f59e0b",
  storage: "#8b5cf6",
  network: "#06b6d4",
  application: "#ec4899",
  endpoint: "#f97316",
  cloud: "#6366f1",
};

const STATUS_STROKE: Record<string, string> = {
  compliant: "#22c55e",
  non_compliant: "#ef4444",
  under_review: "#f59e0b",
  remediation: "#f97316",
};

interface GraphNode extends d3.SimulationNodeDatum {
  id: number;
  name: string;
  assetType: string;
  status: string;
  orgId: number | null;
}

const EDGE_LABELS: Record<string, string[]> = {
  server:      ["hosts", "serves", "depends on"],
  database:    ["stores data", "replicates to", "feeds"],
  api:         ["calls", "integrates", "proxies"],
  storage:     ["archives", "syncs", "backs up"],
  network:     ["routes to", "peers with", "tunnels"],
  application: ["connects", "data flow", "depends on"],
  endpoint:    ["reports to", "syncs", "connects"],
  cloud:       ["mirrors", "replicates", "cross-border"],
};

function getEdgeLabel(sourceType: string, targetType: string): string {
  // Cross-org links get a special label
  const labels = EDGE_LABELS[sourceType] ?? ["linked"];
  // Deterministic pick based on type combo
  const idx = (sourceType.length + targetType.length) % labels.length;
  return labels[idx];
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: GraphNode | number;
  target: GraphNode | number;
  label?: string;
}

function AssetDrawer({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const { data: violations = [] } = trpc.compliance.violations.useQuery({ limit: 100 });
  const { data: evidence = [] } = trpc.evidencePackages.list.useQuery({});
  const { data: alerts = [] } = trpc.siem.alerts.useQuery({ limit: 100 });

  const nodeViolations = (violations as any[]).filter((v: any) => v.organizationId === node.orgId).slice(0, 5);
  const nodeEvidence = (evidence as any[]).filter((e: any) => e.referenceType === "asset" && Number(e.referenceId) === node.id).slice(0, 5);
  const nodeAlerts = (alerts as any[]).filter((a: any) => a.organizationId === node.orgId && !a.isResolved).slice(0, 3);

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-background border-l border-border z-50 flex flex-col shadow-2xl">
      {/* Drawer Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-full" style={{ backgroundColor: TYPE_COLORS[node.assetType] ?? "#6b7280" }} />
          <div>
            <div className="font-semibold text-foreground">{node.name}</div>
            <div className="text-xs text-muted-foreground">Asset #{node.id} · {node.assetType}</div>
          </div>
        </div>
        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground" onClick={onClose} aria-label="Close"><X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Status Overview */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Compliance</div>
            <Badge className={`text-xs mt-1 ${
              node.status === "compliant" ? "bg-green-500/20 text-green-400" :
              node.status === "non_compliant" ? "bg-red-500/20 text-red-400" :
              "bg-yellow-500/20 text-yellow-400"
            }`}>
              {node.status?.replace(/_/g, " ")}
            </Badge>
          </div>
          <div className="bg-card rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Organization</div>
            <div className="text-sm text-muted-foreground mt-1">#{node.orgId ?? "—"}</div>
          </div>
        </div>

        {/* Active Alerts */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Alerts</span>
            <Badge className="text-[10px] bg-orange-500/20 text-orange-400">{nodeAlerts.length}</Badge>
          </div>
          {nodeAlerts.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No active alerts for this organization</p>
          ) : nodeAlerts.map((a: any) => (
            <div key={a.id} className="bg-card rounded-lg p-2.5 mb-2 border border-border">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium">{a.title}</span>
                <Badge className={`text-[10px] ${a.severity === "critical" ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"}`}>{a.severity}</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">{a.alertType} · {a.detectedAt ? new Date(a.detectedAt).toLocaleDateString() : "—"}</div>
            </div>
          ))}
        </div>

        {/* Compliance Violations */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-red-400" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Compliance Violations</span>
            <Badge className="text-[10px] bg-red-500/20 text-red-400">{nodeViolations.length}</Badge>
          </div>
          {nodeViolations.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No violations for this organization</p>
          ) : nodeViolations.map((v: any) => (
            <div key={v.id} className="bg-card rounded-lg p-2.5 mb-2 border border-border">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium truncate max-w-[200px]">{v.title}</span>
                <Badge className={`text-[10px] shrink-0 ${v.severity === "critical" ? "bg-red-500/20 text-red-400" : v.severity === "high" ? "bg-orange-500/20 text-orange-400" : "bg-yellow-500/20 text-yellow-400"}`}>{v.severity}</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">{v.status} · {v.detectedAt ? new Date(v.detectedAt).toLocaleDateString() : "—"}</div>
            </div>
          ))}
        </div>

        {/* Linked Evidence Packages */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <PackageCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Evidence Packages</span>
            <Badge className="text-[10px] bg-emerald-500/20 text-emerald-400">{nodeEvidence.length}</Badge>
          </div>
          {nodeEvidence.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No evidence packages linked to this asset</p>
          ) : nodeEvidence.map((e: any) => (
            <div key={e.id} className="bg-card rounded-lg p-2.5 mb-2 border border-border">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-blue-400">EP-{String(e.id).padStart(6, "0")}</span>
                <Badge className={`text-[10px] ${e.status === "ready" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>{e.status}</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">{e.packageType} · {e.createdAt ? new Date(e.createdAt).toLocaleDateString() : "—"}</div>
            </div>
          ))}
        </div>

        {/* Compliance Timeline hint */}
        <div className="bg-card/50 rounded-lg p-3 border border-border/50">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Compliance Timeline</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Full compliance history is available in the Compliance Engine and Audit Log pages filtered by Organization #{node.orgId ?? "—"}.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AssetGraph() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newAsset, setNewAsset] = useState({ name: "", assetType: "server", organizationId: 1, ipAddress: "", hostname: "" });

  const { data: allAssets = [], isLoading, refetch } = trpc.assets.list.useQuery({ limit: 200 });

  const createMutation = trpc.assets.create.useMutation({
    onSuccess: () => { toast.success("Asset created"); refetch(); setShowAddDialog(false); setNewAsset({ name: "", assetType: "server", organizationId: 1, ipAddress: "", hostname: "" }); },
    onError: (err) => toast.error(`Create failed: ${err.message}`),
  });

  const deleteMutation = trpc.assets.delete.useMutation({
    onSuccess: () => { toast.success("Asset removed"); refetch(); setSelectedNode(null); },
    onError: (err) => toast.error(`Delete failed: ${err.message}`),
  });
  const assets = filterType && filterType !== "all"
    ? (allAssets as any[]).filter((a: any) => a.assetType === filterType)
    : allAssets;

  useEffect(() => {
    if (!svgRef.current || isLoading) return;

    const rawAssets = assets as any[];
    const nodes: GraphNode[] = rawAssets.map(a => ({
      id: a.id,
      name: a.name,
      assetType: a.assetType ?? "server",
      status: a.complianceStatus ?? "under_review",
      orgId: a.organizationId ?? null,
    }));

    const links: GraphLink[] = [];
    const orgGroups: Record<number, number[]> = {};
    nodes.forEach(n => {
      if (n.orgId != null) {
        if (!orgGroups[n.orgId]) orgGroups[n.orgId] = [];
        orgGroups[n.orgId].push(n.id);
      }
    });
    Object.values(orgGroups).forEach(ids => {
      for (let i = 0; i < Math.min(ids.length - 1, 5); i++) {
        const srcNode = nodes.find(n => n.id === ids[i]);
        const tgtNode = nodes.find(n => n.id === ids[i + 1]);
        const label = srcNode && tgtNode ? getEdgeLabel(srcNode.assetType, tgtNode.assetType) : "linked";
        links.push({ source: ids[i], target: ids[i + 1], label });
      }
    });

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    const g = svg.append("g");

    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        setZoom(Math.round(event.transform.k * 100) / 100);
      });
    svg.call(zoomBehavior);
    zoomRef.current = zoomBehavior;

    svg.append("defs").append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 18).attr("refY", 0)
      .attr("markerWidth", 6).attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#4b5563");

    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force("link", d3.forceLink<GraphNode, GraphLink>(links).id(d => d.id).distance(80).strength(0.5))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide(30));

    // Add a unique id to each link for textPath references
    const linksWithId = links.map((l, i) => ({ ...l, _idx: i }));

    const linkGroup = g.append("g");
    const link = linkGroup.selectAll("line").data(linksWithId).enter().append("line")
      .attr("id", (_d, i) => `link-${i}`)
      .attr("stroke", "#374151").attr("stroke-width", 1.5).attr("marker-end", "url(#arrow)");

    // Edge label text
    const linkLabel = linkGroup.selectAll(".edge-label").data(linksWithId).enter().append("text")
      .attr("class", "edge-label")
      .attr("font-size", "8px")
      .attr("fill", "#6b7280")
      .attr("text-anchor", "middle")
      .attr("dy", -3)
      .text(d => d.label ?? "");

    const node = g.append("g").selectAll("g").data(nodes).enter().append("g")
      .attr("cursor", "pointer")
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on("end", (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
      )
      .on("click", (_event, d) => setSelectedNode(d));

    node.append("circle")
      .attr("r", 14)
      .attr("fill", d => TYPE_COLORS[d.assetType] ?? "#6b7280")
      .attr("fill-opacity", 0.85)
      .attr("stroke", d => STATUS_STROKE[d.status] ?? "#6b7280")
      .attr("stroke-width", 2.5);

    node.append("text")
      .attr("dy", 26).attr("text-anchor", "middle")
      .attr("font-size", "9px").attr("fill", "#9ca3af")
      .text(d => d.name.slice(0, 14));

    simulation.on("tick", () => {
      link
        .attr("x1", d => (d.source as GraphNode).x ?? 0)
        .attr("y1", d => (d.source as GraphNode).y ?? 0)
        .attr("x2", d => (d.target as GraphNode).x ?? 0)
        .attr("y2", d => (d.target as GraphNode).y ?? 0);
      linkLabel
        .attr("x", d => (((d.source as GraphNode).x ?? 0) + ((d.target as GraphNode).x ?? 0)) / 2)
        .attr("y", d => (((d.source as GraphNode).y ?? 0) + ((d.target as GraphNode).y ?? 0)) / 2);
      node.attr("transform", d => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => { simulation.stop(); };
  }, [assets, isLoading]);

  const handleZoom = (factor: number) => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, factor);
  };

  return (
    <div className="p-6 space-y-4 h-full flex flex-col">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Asset Graph" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Asset Relationship Graph</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Force-directed graph of {(assets as any[]).length} assets · click a node to drill down
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-36 bg-card border-border text-sm">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {Object.keys(TYPE_COLORS).map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="border-border" onClick={() => handleZoom(1.3)} aria-label="Zoom in"><ZoomIn className="w-4 h-4" /></Button>
          <Button size="sm" variant="outline" className="border-border" onClick={() => handleZoom(0.7)} aria-label="Zoom out"><ZoomOut className="w-4 h-4" /></Button>
          <Button size="sm" variant="outline" className="border-border" onClick={() => refetch()} aria-label="Refresh"><RefreshCw className="w-4 h-4" /></Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-foreground" onClick={() => setShowAddDialog(true)}><Plus className="w-4 h-4 mr-1" /> Add Asset</Button>
          {selectedNode && (
            <Button size="sm" variant="outline" className="border-red-700 text-red-400 hover:bg-red-900/20" onClick={() => deleteMutation.mutate({ id: selectedNode.id })} disabled={deleteMutation.isPending}>
              <Trash2 className="w-4 h-4 mr-1" /> Remove
            </Button>
          )}
        </div>
      </div>

      {/* Add Asset Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="bg-background border-border text-foreground">
          <DialogHeader><DialogTitle>Add New Asset</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-muted-foreground text-sm">Asset Name</Label><Input value={newAsset.name} onChange={e => setNewAsset(p => ({ ...p, name: e.target.value }))} className="bg-card border-border text-foreground mt-1" placeholder="e.g. prod-db-01" /></div>
            <div><Label className="text-muted-foreground text-sm">Type</Label>
              <Select value={newAsset.assetType} onValueChange={v => setNewAsset(p => ({ ...p, assetType: v }))}>
                <SelectTrigger className="bg-card border-border mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{["hardware","software","cloud","network","database","saas"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-muted-foreground text-sm">Org ID</Label><Input type="number" value={newAsset.organizationId} onChange={e => setNewAsset(p => ({ ...p, organizationId: Number(e.target.value) }))} className="bg-card border-border text-foreground mt-1" /></div>
            <div><Label className="text-muted-foreground text-sm">IP Address (optional)</Label><Input value={newAsset.ipAddress} onChange={e => setNewAsset(p => ({ ...p, ipAddress: e.target.value }))} className="bg-card border-border text-foreground mt-1" placeholder="192.168.1.1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)} className="border-border">Cancel</Button>
            <Button onClick={() => createMutation.mutate({ ...newAsset, assetType: newAsset.assetType as "hardware" | "software" | "cloud" | "network" | "database" | "saas" })} disabled={!newAsset.name || createMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700">{createMutation.isPending ? "Creating..." : "Create Asset"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
            {type}
          </div>
        ))}
        <div className="ml-4 flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded-full border-2 border-green-500 bg-transparent" /> compliant
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded-full border-2 border-red-500 bg-transparent" /> non-compliant
          </div>
        </div>
      </div>

      {/* Graph Canvas */}
      <div className="flex-1 bg-background rounded-xl border border-border relative overflow-hidden" style={{ minHeight: 480 }}>
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <Network className="w-8 h-8 animate-pulse" />
          </div>
        ) : (assets as any[]).length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
            <Network className="w-10 h-10 mb-2 opacity-30" />
            <p>No assets found. Discover assets to populate the graph.</p>
          </div>
        ) : (
          <svg ref={svgRef} className="w-full h-full" style={{ minHeight: 480 }} />
        )}
        <div className="absolute bottom-3 right-3 text-xs text-muted-foreground font-mono">
          {Math.round(zoom * 100)}% zoom · drag to pan · scroll to zoom · click node to inspect
        </div>
      </div>

      {/* Drill-down Drawer */}
      {selectedNode && <AssetDrawer node={selectedNode} onClose={() => setSelectedNode(null)} />}
    </div>
  );
}
