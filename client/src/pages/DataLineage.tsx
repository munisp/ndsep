import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GitBranch, Database, ArrowRight, Shield, AlertTriangle, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const nodeTypeColors: Record<string, string> = {
  system: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  dataset: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  transformation: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  pipeline: "bg-green-500/20 text-green-400 border-green-500/30",
};

export default function DataLineage() {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const { data: graph } = trpc.phase12.dataLineage.getGraph.useQuery();
  const { data: nodeDetail } = trpc.phase12.dataLineage.getNode.useQuery(
    { nodeId: selectedNode! },
    { enabled: !!selectedNode }
  );

  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];

  const piiNodes = nodes.filter(n => n.pii_contained);
  const restrictedNodes = nodes.filter(n => n.classification_level === "restricted" || n.classification_level === "confidential");

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Data", href: "/catalog" }, { label: "Data Lineage" }]} className="mb-4" />
      <div>
        <h1 className="text-2xl font-bold text-foreground">Data Lineage & Provenance</h1>
        <p className="text-muted-foreground text-sm mt-1">NDPA Article 19 — Track data flows from source to consumption for full audit compliance</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Total Nodes</p>
            <p className="text-2xl font-bold text-foreground">{nodes.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Data Flows</p>
            <p className="text-2xl font-bold text-foreground">{edges.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-red-900/20 border-red-700/40">
          <CardContent className="p-4">
            <p className="text-red-400 text-xs">PII-Containing Nodes</p>
            <p className="text-2xl font-bold text-red-300">{piiNodes.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-900/20 border-amber-700/40">
          <CardContent className="p-4">
            <p className="text-amber-400 text-xs">Restricted/Confidential</p>
            <p className="text-2xl font-bold text-amber-300">{restrictedNodes.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Visual Flow Diagram */}
      <Card className="bg-card/50 border-border">
        <CardHeader>
          <CardTitle className="text-foreground text-base flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-blue-400" /> Data Flow Graph
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-background/50 rounded-lg p-6 overflow-x-auto">
            <div className="flex items-center gap-4 flex-wrap min-w-max">
              {/* Source Systems */}
              <div className="flex flex-col gap-3">
                <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider text-center">Source Systems</p>
                {nodes.filter(n => n.node_type === "system" && ["node-nimc-001", "node-cbn-001", "node-ncc-001", "node-ndpc-001"].includes(n.node_id)).map(n => (
                  <button key={n.node_id} onClick={() => setSelectedNode(n.node_id)}
                    className="bg-blue-900/40 border border-blue-700/50 rounded-lg p-3 text-left hover:border-blue-500 transition-colors min-w-[160px]">
                    <div className="flex items-center gap-2 mb-1">
                      <Database className="w-3 h-3 text-blue-400" />
                      <span className="text-blue-300 text-xs font-medium">{n.name}</span>
                    </div>
                    {n.pii_contained && <Badge className="bg-red-500/20 text-red-400 text-[10px]">PII</Badge>}
                    <Badge className="ml-1 bg-muted text-muted-foreground text-[10px]">{n.classification_level}</Badge>
                  </button>
                ))}
              </div>

              <ArrowRight className="w-6 h-6 text-muted-foreground flex-shrink-0" />

              {/* Pipeline */}
              <div className="flex flex-col gap-3">
                <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider text-center">Pipeline</p>
                {nodes.filter(n => n.node_type === "pipeline").map(n => (
                  <button key={n.node_id} onClick={() => setSelectedNode(n.node_id)}
                    className="bg-green-900/40 border border-green-700/50 rounded-lg p-3 text-left hover:border-green-500 transition-colors min-w-[160px]">
                    <div className="flex items-center gap-2 mb-1">
                      <GitBranch className="w-3 h-3 text-green-400" />
                      <span className="text-green-300 text-xs font-medium">{n.name}</span>
                    </div>
                    <Badge className="bg-green-500/20 text-green-400 text-[10px]">{n.system_name}</Badge>
                  </button>
                ))}
              </div>

              <ArrowRight className="w-6 h-6 text-muted-foreground flex-shrink-0" />

              {/* Storage */}
              <div className="flex flex-col gap-3">
                <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider text-center">Storage</p>
                {nodes.filter(n => n.node_type === "dataset").map(n => (
                  <button key={n.node_id} onClick={() => setSelectedNode(n.node_id)}
                    className="bg-purple-900/40 border border-purple-700/50 rounded-lg p-3 text-left hover:border-purple-500 transition-colors min-w-[160px]">
                    <div className="flex items-center gap-2 mb-1">
                      <Database className="w-3 h-3 text-purple-400" />
                      <span className="text-purple-300 text-xs font-medium">{n.name}</span>
                    </div>
                    {n.pii_contained && <Badge className="bg-red-500/20 text-red-400 text-[10px]">PII</Badge>}
                  </button>
                ))}
              </div>

              <ArrowRight className="w-6 h-6 text-muted-foreground flex-shrink-0" />

              {/* Transformations */}
              <div className="flex flex-col gap-3">
                <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider text-center">Transformations</p>
                {nodes.filter(n => n.node_type === "transformation").map(n => (
                  <button key={n.node_id} onClick={() => setSelectedNode(n.node_id)}
                    className="bg-orange-900/40 border border-orange-700/50 rounded-lg p-3 text-left hover:border-orange-500 transition-colors min-w-[160px]">
                    <div className="flex items-center gap-2 mb-1">
                      <GitBranch className="w-3 h-3 text-orange-400" />
                      <span className="text-orange-300 text-xs font-medium">{n.name}</span>
                    </div>
                    <Badge className="bg-orange-500/20 text-orange-400 text-[10px]">dbt</Badge>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edges Table */}
      <Card className="bg-card/50 border-border">
        <CardHeader>
          <CardTitle className="text-foreground text-base">Data Flow Edges</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="text-muted-foreground">Source</TableHead>
                <TableHead className="text-muted-foreground"></TableHead>
                <TableHead className="text-muted-foreground">Target</TableHead>
                <TableHead className="text-muted-foreground">Transformation</TableHead>
                <TableHead className="text-muted-foreground">Logic</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {edges.map(edge => {
                const sourceNode = nodes.find(n => n.node_id === edge.source_node_id);
                const targetNode = nodes.find(n => n.node_id === edge.target_node_id);
                return (
                  <TableRow key={edge.id} className="border-border">
                    <TableCell className="text-blue-400 text-sm">{sourceNode?.name ?? edge.source_node_id}</TableCell>
                    <TableCell><ArrowRight className="w-4 h-4 text-muted-foreground" /></TableCell>
                    <TableCell className="text-green-400 text-sm">{targetNode?.name ?? edge.target_node_id}</TableCell>
                    <TableCell><Badge variant="outline" className="border-border text-muted-foreground">{edge.transformation_type}</Badge></TableCell>
                    <TableCell className="text-muted-foreground text-xs max-w-xs truncate">{edge.transformation_logic}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Node Detail Dialog */}
      <Dialog open={!!selectedNode} onOpenChange={() => setSelectedNode(null)}>
        <DialogContent className="bg-card border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle>{nodeDetail?.node?.name}</DialogTitle>
          </DialogHeader>
          {nodeDetail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Type:</span> <Badge className={nodeTypeColors[nodeDetail.node.node_type] ?? ""}>{nodeDetail.node.node_type}</Badge></div>
                <div><span className="text-muted-foreground">System:</span> <span className="text-foreground">{nodeDetail.node.system_name}</span></div>
                <div><span className="text-muted-foreground">Classification:</span> <span className="text-foreground capitalize">{nodeDetail.node.classification_level}</span></div>
                <div><span className="text-muted-foreground">PII:</span> {nodeDetail.node.pii_contained ? <Badge className="bg-red-500/20 text-red-400">Yes</Badge> : <Badge className="bg-green-500/20 text-green-400">No</Badge>}</div>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-2">Upstream Sources ({nodeDetail.upstream.length})</p>
                {nodeDetail.upstream.map(e => <p key={e.id} className="text-blue-400 text-sm">← {e.source_node_id}</p>)}
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-2">Downstream Targets ({nodeDetail.downstream.length})</p>
                {nodeDetail.downstream.map(e => <p key={e.id} className="text-green-400 text-sm">→ {e.target_node_id}</p>)}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
