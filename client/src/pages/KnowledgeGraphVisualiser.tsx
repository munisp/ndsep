import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Network, Search, RefreshCw, ZoomIn, ZoomOut, Maximize2, Info, AlertTriangle } from "lucide-react";

// Node and edge types for the KG
interface KGNode {
  id: string;
  label: string;
  type: "organisation" | "regulation" | "violation" | "enforcement" | "officer" | "sector";
  properties?: Record<string, string>;
}

interface KGEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

interface KGData {
  nodes: KGNode[];
  edges: KGEdge[];
  query?: string;
  totalNodes?: number;
  totalEdges?: number;
}

const NODE_COLORS: Record<string, string> = {
  organisation: "#3b82f6",
  regulation: "#10b981",
  violation: "#ef4444",
  enforcement: "#f59e0b",
  officer: "#8b5cf6",
  sector: "#06b6d4",
};

const NODE_SIZES: Record<string, number> = {
  organisation: 18,
  regulation: 22,
  violation: 14,
  enforcement: 16,
  officer: 12,
  sector: 20,
};

const SAMPLE_QUERIES = [
  "MATCH (o:Organisation)-[:VIOLATED]->(r:Regulation) RETURN o, r LIMIT 20",
  "MATCH (o:Organisation)-[:SUBJECT_TO]->(e:Enforcement) RETURN o, e LIMIT 15",
  "MATCH (s:Sector)-[:CONTAINS]->(o:Organisation) RETURN s, o LIMIT 25",
  "MATCH (r:Regulation)-[:ENFORCED_BY]->(a:Officer) RETURN r, a LIMIT 10",
  "MATCH (o:Organisation {sector: 'Banking'})-[:VIOLATED]->(r:Regulation) RETURN o, r LIMIT 20",
];

export default function KnowledgeGraphVisualiser() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [query, setQuery] = useState(SAMPLE_QUERIES[0]);
  const [selectedNode, setSelectedNode] = useState<KGNode | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [filterType, setFilterType] = useState<string>("all");
  const [kgData, setKgData] = useState<KGData>({ nodes: [], edges: [] });
  const [nodePositions, setNodePositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [isDemoData, setIsDemoData] = useState(false);

  // Use the knowledgeGraph tRPC router
  const [kgqaQuestion, setKgqaQuestion] = useState("Show all organisations and their violations");
  const queryMutation = trpc.knowledgeGraph.rebuild.useMutation({
    onSuccess: (data: any) => {
      const result = data as KGData;
      setKgData(result);
      // Generate force-directed layout positions
      const positions = new Map<string, { x: number; y: number }>();
      const centerX = 600, centerY = 350;
      const radius = Math.min(250, 50 * Math.sqrt(result.nodes.length));
      result.nodes.forEach((node: KGNode, i: number) => {
        const angle = (2 * Math.PI * i) / result.nodes.length;
        const r = radius * (0.5 + Math.random() * 0.5);
        positions.set(node.id, {
          x: centerX + r * Math.cos(angle) + (Math.random() - 0.5) * 80,
          y: centerY + r * Math.sin(angle) + (Math.random() - 0.5) * 80,
        });
      });
      setNodePositions(positions);
      setIsDemoData(false);
      toast.success(`Graph loaded: ${result.nodes.length} nodes, ${result.edges.length} edges`);
    },
    onError: (err: any) => {
      // Generate demo data when FalkorDB is not running
      const mockData = generateMockKGData();
      setKgData(mockData);
      setIsDemoData(true);
      const positions = new Map<string, { x: number; y: number }>();
      const centerX = 600, centerY = 350;
      mockData.nodes.forEach((node: KGNode, i: number) => {
        const angle = (2 * Math.PI * i) / mockData.nodes.length;
        const r = 180 + Math.random() * 120;
        positions.set(node.id, {
          x: centerX + r * Math.cos(angle) + (Math.random() - 0.5) * 60,
          y: centerY + r * Math.sin(angle) + (Math.random() - 0.5) * 60,
        });
      });
      setNodePositions(positions);
      toast.info("Showing demo graph (FalkorDB offline)");
    },
  });

  function generateMockKGData(): KGData {
    const nodes: KGNode[] = [
      { id: "s1", label: "Banking", type: "sector" },
      { id: "s2", label: "Telecom", type: "sector" },
      { id: "s3", label: "Healthcare", type: "sector" },
      { id: "o1", label: "GTBank", type: "organisation" },
      { id: "o2", label: "Zenith Bank", type: "organisation" },
      { id: "o3", label: "MTN Nigeria", type: "organisation" },
      { id: "o4", label: "Lagos University Hospital", type: "organisation" },
      { id: "r1", label: "NDPA Section 24", type: "regulation" },
      { id: "r2", label: "NDPA Section 38", type: "regulation" },
      { id: "r3", label: "CBN Data Policy", type: "regulation" },
      { id: "v1", label: "Data Breach 2025", type: "violation" },
      { id: "v2", label: "Consent Failure", type: "violation" },
      { id: "v3", label: "Cross-border Transfer", type: "violation" },
      { id: "e1", label: "Fine ₦50M", type: "enforcement" },
      { id: "e2", label: "Suspension Notice", type: "enforcement" },
      { id: "a1", label: "NDPC Officer A", type: "officer" },
      { id: "a2", label: "NDPC Officer B", type: "officer" },
    ];
    const edges: KGEdge[] = [
      { id: "e1", source: "s1", target: "o1", label: "CONTAINS" },
      { id: "e2", source: "s1", target: "o2", label: "CONTAINS" },
      { id: "e3", source: "s2", target: "o3", label: "CONTAINS" },
      { id: "e4", source: "s3", target: "o4", label: "CONTAINS" },
      { id: "e5", source: "o1", target: "v1", label: "COMMITTED" },
      { id: "e6", source: "o2", target: "v2", label: "COMMITTED" },
      { id: "e7", source: "o3", target: "v3", label: "COMMITTED" },
      { id: "e8", source: "v1", target: "r1", label: "VIOLATES" },
      { id: "e9", source: "v2", target: "r2", label: "VIOLATES" },
      { id: "e10", source: "v3", target: "r3", label: "VIOLATES" },
      { id: "e11", source: "v1", target: "e1", label: "RESULTED_IN" },
      { id: "e12", source: "v2", target: "e2", label: "RESULTED_IN" },
      { id: "e13", source: "a1", target: "e1", label: "ISSUED_BY" },
      { id: "e14", source: "a2", target: "e2", label: "ISSUED_BY" },
      { id: "e15", source: "r1", target: "a1", label: "ENFORCED_BY" },
      { id: "e16", source: "r2", target: "a2", label: "ENFORCED_BY" },
    ];
    return { nodes, edges, totalNodes: nodes.length, totalEdges: edges.length };
  }

  // Draw the graph on canvas
  const drawGraph = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || kgData.nodes.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    const filteredNodes = filterType === "all"
      ? kgData.nodes
      : kgData.nodes.filter((n: KGNode) => n.type === filterType);
    const filteredNodeIds = new Set(filteredNodes.map((n: KGNode) => n.id));
    const filteredEdges = kgData.edges.filter(
      (e: KGEdge) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
    );

    // Draw edges
    filteredEdges.forEach((edge: KGEdge) => {
      const src = nodePositions.get(edge.source);
      const tgt = nodePositions.get(edge.target);
      if (!src || !tgt) return;

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.strokeStyle = "rgba(100,116,139,0.4)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Edge label
      const mx = (src.x + tgt.x) / 2;
      const my = (src.y + tgt.y) / 2;
      ctx.fillStyle = "rgba(148,163,184,0.9)";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(edge.label, mx, my - 4);
    });

    // Draw nodes
    filteredNodes.forEach((node: KGNode) => {
      const pos = nodePositions.get(node.id);
      if (!pos) return;

      const color = NODE_COLORS[node.type] || "#64748b";
      const size = NODE_SIZES[node.type] || 14;
      const isSelected = selectedNode?.id === node.id;

      // Node circle
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, size, 0, 2 * Math.PI);
      ctx.fillStyle = isSelected ? "#ffffff" : color;
      ctx.fill();
      ctx.strokeStyle = isSelected ? color : color + "80";
      ctx.lineWidth = isSelected ? 3 : 1.5;
      ctx.stroke();

      // Node label
      ctx.fillStyle = isSelected ? color : "#e2e8f0";
      ctx.font = `${isSelected ? "bold " : ""}11px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(node.label.length > 16 ? node.label.slice(0, 14) + "…" : node.label, pos.x, pos.y + size + 14);
    });

    ctx.restore();
  }, [kgData, nodePositions, zoom, pan, filterType, selectedNode]);

  useEffect(() => {
    drawGraph();
  }, [drawGraph]);

  // Load initial graph
  useEffect(() => {
    queryMutation.mutate();
  }, []);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;

    const clicked = kgData.nodes.find((node: KGNode) => {
      const pos = nodePositions.get(node.id);
      if (!pos) return false;
      const size = NODE_SIZES[node.type] || 14;
      return Math.hypot(pos.x - x, pos.y - y) <= size + 4;
    });
    setSelectedNode(clicked || null);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);

  const nodeTypeCounts = kgData.nodes.reduce((acc: Record<string, number>, n: KGNode) => {
    acc[n.type] = (acc[n.type] || 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Network className="w-7 h-7 text-cyan-600" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Knowledge Graph Visualiser</h1>
            <p className="text-sm text-muted-foreground">FalkorDB + EPR-KGQA — NDPA entity relationship explorer</p>
          </div>
        </div>

        {/* Demo data warning banner */}
        {isDemoData && (
          <Alert className="border-amber-500/50 bg-amber-500/10">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <AlertDescription className="text-amber-600 dark:text-amber-400">
              <strong>Demo Data</strong> — FalkorDB is offline. The graph below shows sample data for demonstration purposes.
              Connect FalkorDB and re-run a query to see real entity relationships.
            </AlertDescription>
          </Alert>
        )}

        {/* Query bar */}
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex gap-2">
              <Select onValueChange={(v) => setQuery(v)}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Sample queries" />
                </SelectTrigger>
                <SelectContent>
                  {SAMPLE_QUERIES.map((q, i) => (
                    <SelectItem key={i} value={q}>Query {i + 1}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="flex-1 font-mono text-xs"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="MATCH (o:Organisation)-[:VIOLATED]->(r:Regulation) RETURN o, r LIMIT 20"
              />
              <Button
                onClick={() => { queryMutation.mutate(); }}
                disabled={queryMutation.isPending}
                className="gap-2"
              >
                {queryMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Run
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-4 gap-4">
          {/* Graph canvas */}
          <div className="col-span-3">
            <Card className="relative">
              <CardContent className="p-0">
                {/* Toolbar */}
                <div className="absolute top-3 right-3 z-10 flex gap-1">
                  <Button size="icon" variant="outline" className="w-7 h-7 bg-background/80" onClick={() => setZoom(z => Math.min(z + 0.2, 3))} aria-label="Zoom in">
                    <ZoomIn className="w-3 h-3" />
                  </Button>
                  <Button size="icon" variant="outline" className="w-7 h-7 bg-background/80" onClick={() => setZoom(z => Math.max(z - 0.2, 0.3))} aria-label="Zoom out">
                    <ZoomOut className="w-3 h-3" />
                  </Button>
                  <Button size="icon" variant="outline" className="w-7 h-7 bg-background/80" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} aria-label="Reset view">
                    <Maximize2 className="w-3 h-3" />
                  </Button>
                </div>
                {/* Filter */}
                <div className="absolute top-3 left-3 z-10">
                  <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger className="w-36 h-7 text-xs bg-background/80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {Object.keys(NODE_COLORS).map(t => (
                        <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <canvas
                  ref={canvasRef}
                  width={900}
                  height={580}
                  className="w-full rounded-lg bg-background cursor-grab active:cursor-grabbing"
                  style={{ maxHeight: 580 }}
                  onClick={handleCanvasClick}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                />
              </CardContent>
            </Card>
          </div>

          {/* Side panel */}
          <div className="space-y-4">
            {/* Stats */}
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm">Graph Statistics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Nodes</span>
                  <span className="font-mono font-bold">{kgData.nodes.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Edges</span>
                  <span className="font-mono font-bold">{kgData.edges.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Zoom</span>
                  <span className="font-mono">{(zoom * 100).toFixed(0)}%</span>
                </div>
              </CardContent>
            </Card>

            {/* Legend */}
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm">Node Types</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {Object.entries(NODE_COLORS).map(([type, color]) => (
                  <div key={type} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ background: color }} />
                      <span className="capitalize text-muted-foreground">{type}</span>
                    </div>
                    <span className="font-mono text-foreground">{nodeTypeCounts[type] || 0}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Selected node details */}
            {selectedNode && (
              <Card className="border-cyan-500/30">
                <CardHeader className="pb-2 pt-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Info className="w-4 h-4 text-cyan-600" />
                    Node Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Label</p>
                    <p className="text-sm font-medium">{selectedNode.label}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Type</p>
                    <Badge
                      className="text-xs capitalize"
                      style={{ background: NODE_COLORS[selectedNode.type] + "30", color: NODE_COLORS[selectedNode.type] }}
                    >
                      {selectedNode.type}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">ID</p>
                    <p className="text-xs font-mono text-muted-foreground">{selectedNode.id}</p>
                  </div>
                  {selectedNode.properties && Object.entries(selectedNode.properties).map(([k, v]) => (
                    <div key={k}>
                      <p className="text-xs text-muted-foreground capitalize">{k}</p>
                      <p className="text-xs">{v}</p>
                    </div>
                  ))}
                  <div>
                    <p className="text-xs text-muted-foreground">Connections</p>
                    <p className="text-sm font-mono">
                      {kgData.edges.filter((e: KGEdge) => e.source === selectedNode.id || e.target === selectedNode.id).length}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
