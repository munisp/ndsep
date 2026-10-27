/**
 * KnowledgeGraph — knowledge graph browser (R17-W3).
 *
 * Wires the knowledgeGraph router (server/routers/aimlRouter.ts):
 *   dbStats         node/edge counts by label (Postgres-derived, fail-closed)
 *   health          FalkorDB worker liveness badge
 *   searchEntities  entity search across orgs/sectors/violations/policies/enforcement
 *   exportSubgraph  bounded BFS subgraph → force-directed canvas + JSON export
 *   getEntity       side-panel properties
 *   getTimeline     dated violation/enforcement events
 *   relationTypes   edge vocabulary legend
 *
 * The graph is the same model the FalkorDB worker materializes
 * (workers/go/cmd/falkordb_kg_worker buildGraph), derived directly from the
 * source tables so the page works even when the FalkorDB worker is offline.
 * Fail-closed everywhere: empty graph states, never fabricated nodes.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { PageShell } from "@/components/PageShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GraphCanvas, KIND_COLORS, type GraphEdge, type GraphNode } from "@/components/graphs/GraphCanvas";
import {
  Building2, Clock, Download, FolderTree, Network, RefreshCw, ScrollText,
  Search, ShieldAlert, TriangleAlert,
} from "lucide-react";

const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Organization: Building2,
  Sector: FolderTree,
  Violation: TriangleAlert,
  Policy: ScrollText,
  EnforcementAction: ShieldAlert,
};
const KINDS = ["Organization", "Sector", "Violation", "Policy", "EnforcementAction"] as const;

function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

export default function KnowledgeGraph() {
  // ── Stats + worker health ────────────────────────────────────────────────
  const stats = trpc.knowledgeGraph.dbStats.useQuery(undefined, { refetchInterval: 60_000 });
  const health = trpc.knowledgeGraph.health.useQuery(undefined, { refetchInterval: 60_000, retry: false });
  const relations = trpc.knowledgeGraph.relationTypes.useQuery();
  const falkorUp = !health.isError && !(health.data as any)?.error && (health.data as any)?.available !== false;

  // ── Search ───────────────────────────────────────────────────────────────
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string>("all");
  const search = trpc.knowledgeGraph.searchEntities.useQuery(
    { q, ...(kind !== "all" ? { kind: kind as (typeof KINDS)[number] } : {}), limit: 12 },
    { enabled: q.trim().length >= 2 },
  );
  const results = search.data?.results ?? [];

  // ── Selection + subgraph ─────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const subgraph = trpc.knowledgeGraph.exportSubgraph.useQuery(
    { rootId: selectedId ?? "", depth: 2, limit: 80 },
    { enabled: selectedId != null, refetchInterval: 60_000 },
  );
  const entity = trpc.knowledgeGraph.getEntity.useQuery(
    { id: selectedId ?? "" },
    { enabled: selectedId != null, retry: false },
  );
  const timeline = trpc.knowledgeGraph.getTimeline.useQuery(
    { entityId: selectedId ?? "", limit: 40 },
    { enabled: selectedId != null },
  );

  const nodes: GraphNode[] = useMemo(() => subgraph.data?.nodes ?? [], [subgraph.data]);
  const edges: GraphEdge[] = useMemo(() => subgraph.data?.edges ?? [], [subgraph.data]);

  const exportJson = () => {
    if (!subgraph.data) return;
    const blob = new Blob([JSON.stringify(subgraph.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kg-subgraph-${(selectedId ?? "root").replace(/[^a-z0-9_-]/gi, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statCards = [
    { label: "Organizations", value: stats.data?.nodes.Organization ?? "—" },
    { label: "Violations", value: stats.data?.nodes.Violation ?? "—" },
    { label: "Enforcement actions", value: stats.data?.nodes.EnforcementAction ?? "—" },
    { label: "Policies", value: stats.data?.nodes.Policy ?? "—" },
    { label: "Graph edges (derived)", value: stats.data?.edgeTotal ?? "—" },
  ];

  return (
    <PageShell>
      <Breadcrumbs items={[{ label: "AI & Intelligence" }, { label: "Knowledge Graph" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Network className="h-6 w-6 text-primary" /> Knowledge Graph
          </h1>
          <p className="text-sm text-muted-foreground">
            Organizations, sectors, violations, policies and enforcement — derived live from source tables.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={falkorUp ? "default" : "outline"} className="gap-1.5">
            <span className={`h-2 w-2 rounded-full ${falkorUp ? "bg-emerald-500" : "bg-muted-foreground"}`} />
            FalkorDB worker {falkorUp ? "online" : "offline"}
          </Badge>
          <Badge variant="outline" className="gap-1.5"><RefreshCw className="h-3 w-3" /> 60s</Badge>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardHeader className="p-3 pb-1">
              <CardTitle className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0"><div className="text-xl font-bold text-foreground">{s.value}</div></CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Search className="h-4 w-4 text-primary" /> Entity search</CardTitle>
          <CardDescription>Search organizations, sectors, violations, policies and enforcement actions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search entities (min. 2 characters)…"
              className="max-w-md"
            />
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All kinds</SelectItem>
                {KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {q.trim().length >= 2 && (
            results.length === 0 ? (
              <EmptyState title={search.isLoading ? "Searching…" : "No matching entities"} description={search.isLoading ? undefined : "The graph derives from live tables — no fabricated results."} className="py-6" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {results.map((r) => {
                  const Icon = KIND_ICONS[r.kind] ?? Network;
                  return (
                    <button
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={`flex items-center gap-2 rounded-lg border p-2.5 text-left text-sm transition-colors hover:bg-accent ${selectedId === r.id ? "border-primary bg-accent" : ""}`}
                    >
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: KIND_COLORS[r.kind] ?? KIND_COLORS.Unknown }} />
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">{r.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{r.kind}{r.subtitle ? ` — ${r.subtitle}` : ""}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )
          )}
        </CardContent>
      </Card>

      {/* Graph + side panel */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Neighborhood subgraph</CardTitle>
              <CardDescription>
                {selectedId ? (
                  <>Depth-2 expansion from <span className="font-mono">{selectedId}</span>
                    {subgraph.data?.truncated ? " (truncated at node cap)" : ""} — click a node to re-center</>
                ) : "Select an entity from search to explore its neighborhood"}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={exportJson} disabled={!subgraph.data}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export JSON
            </Button>
          </CardHeader>
          <CardContent>
            {!selectedId ? (
              <EmptyState icon={Network} title="No entity selected" description="Search above and click a result to render its subgraph." className="h-80" />
            ) : subgraph.isLoading ? (
              <div className="h-80 animate-pulse rounded bg-muted" />
            ) : nodes.length === 0 ? (
              <EmptyState title="Empty subgraph" description="This entity has no derived neighbors." className="h-80" />
            ) : (
              <div className="h-[420px] rounded-lg border bg-background">
                <GraphCanvas nodes={nodes} edges={edges} selectedId={selectedId} onNodeClick={setSelectedId} />
              </div>
            )}
            {/* Legend */}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
              {Object.entries(KIND_COLORS).filter(([k]) => k !== "Unknown").map(([k, c]) => (
                <span key={k} className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c }} />{k}
                </span>
              ))}
              <span className="ml-auto font-mono">
                {(relations.data?.relations ?? []).map((r) => r.relation).join(" · ")}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Side panel: details + timeline */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Entity details</CardTitle>
              <CardDescription className="font-mono text-xs">{selectedId ?? "—"}</CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedId ? (
                <EmptyState title="Nothing selected" className="py-6" />
              ) : entity.isLoading ? (
                <div className="h-24 animate-pulse rounded bg-muted" />
              ) : entity.isError ? (
                <EmptyState title="Entity not found" description={entity.error?.message} className="py-6" />
              ) : entity.data ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" style={{ borderColor: KIND_COLORS[entity.data.kind] }}>{entity.data.kind}</Badge>
                    <span className="text-sm font-semibold text-foreground truncate">{entity.data.name}</span>
                  </div>
                  <Table>
                    <TableBody>
                      {Object.entries(entity.data.properties ?? {}).map(([k, v]) => (
                        <TableRow key={k}>
                          <TableCell className="py-1.5 text-xs text-muted-foreground font-mono">{k}</TableCell>
                          <TableCell className="py-1.5 text-xs text-foreground break-all">
                            {v == null ? "—" : v instanceof Date ? v.toLocaleString() : typeof v === "object" ? JSON.stringify(v) : String(v)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> Timeline</CardTitle>
              <CardDescription>Dated violation / enforcement events</CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedId ? (
                <EmptyState title="Nothing selected" className="py-6" />
              ) : timeline.isLoading ? (
                <div className="h-24 animate-pulse rounded bg-muted" />
              ) : (timeline.data?.events?.length ?? 0) === 0 ? (
                <EmptyState title="No dated events" description="No violations or enforcement actions with dates for this entity." className="py-6" />
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {(timeline.data?.events ?? []).map((ev, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" />
                      <div className="min-w-0">
                        <div className="text-foreground">{ev.label}</div>
                        <div className="text-[10px] text-muted-foreground">{fmtDate(ev.ts)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
