import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useAuth } from "@/_core/hooks/useAuth";
import { BrainCircuit, RefreshCw, Play, Database, Network, Activity } from "lucide-react";

/**
 * MlOpsConsole (Round-16 W4)
 * ==========================
 * Operations console for the previously orphaned aiml namespaces:
 *   - mlProduction      (11 procs) — deployed models, versions, metrics, health
 *   - gnn               (10 procs) — graph engine status, scores, runs
 *   - lakehouseAnalytics(13 procs) — watermarks, tables, snapshots, ad-hoc SQL
 * All 34 procedures are wired. All three engines are external Python/Ray
 * services proxied via safeFetch — responses are loosely typed JSON, rendered
 * defensively with raw-JSON fallbacks.
 */

// ── Shared helpers ────────────────────────────────────────────────────────────

function StatusBadge({ data }: { data: any }) {
  const ok = data && !data.error && (data.status === "healthy" || data.status === "ok" || data.available !== false);
  return (
    <Badge variant="outline" className={ok ? "border-green-500/40 text-green-300" : "border-red-500/40 text-red-300"}>
      {ok ? "healthy" : "unavailable"}
    </Badge>
  );
}

function JsonBlock({ data, label }: { data: any; label?: string }) {
  if (data === undefined || data === null) return null;
  return (
    <div className="space-y-1">
      {label && <div className="text-xs font-medium text-muted-foreground">{label}</div>}
      <pre className="text-xs bg-muted/40 border border-border rounded-md p-3 overflow-auto max-h-80 whitespace-pre-wrap break-all">
        {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

function asRows(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.tables)) return data.tables;
  if (Array.isArray(data?.models)) return data.models;
  if (Array.isArray(data?.snapshots)) return data.snapshots;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function ErrText({ error }: { error: any }) {
  if (!error) return null;
  return <div className="text-xs text-red-400">{error.message ?? String(error)}</div>;
}

function parseJsonObject(text: string): Record<string, number> | null {
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
    return null;
  } catch {
    return null;
  }
}

// ── Models tab (mlProduction) ─────────────────────────────────────────────────

function ModelsTab() {
  const health = trpc.mlProduction.health.useQuery();
  const models = trpc.mlProduction.models.useQuery();
  const [selected, setSelected] = useState("");
  const detail = trpc.mlProduction.modelDetail.useQuery(
    { modelName: selected },
    { enabled: selected.length > 0 },
  );
  const shap = trpc.mlProduction.shapExplanation.useQuery(
    { modelName: selected },
    { enabled: false },
  );

  const rows = asRows(models.data);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-lg">ML Production Engine</CardTitle>
            <CardDescription>XGBoost / LSTM / SHAP serving layer</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge data={health.data} />
            <Button variant="ghost" size="sm" onClick={() => { health.refetch(); models.refetch(); }}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        {health.data?.error === undefined && health.data ? null : <CardContent><JsonBlock data={health.data} label="Health detail" /></CardContent>}
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Deployed models</CardTitle></CardHeader>
        <CardContent>
          {models.isError && <ErrText error={models.error} />}
          {rows.length === 0 && !models.isLoading && !models.isError && (
            <JsonBlock data={models.data} label="Raw response" />
          )}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Metrics</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m: any, i: number) => {
                  const name = String(m.name ?? m.model_name ?? m.modelName ?? `model_${i}`);
                  return (
                    <TableRow key={name} className={selected === name ? "bg-muted/30" : ""}>
                      <TableCell className="font-mono text-xs">{name}</TableCell>
                      <TableCell className="text-xs">{String(m.version ?? m.model_version ?? "—")}</TableCell>
                      <TableCell className="text-xs font-mono">
                        {m.metrics ? JSON.stringify(m.metrics) : m.accuracy != null ? `acc=${m.accuracy}` : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={m.error ? "border-red-500/40 text-red-300" : "border-green-500/40 text-green-300"}>
                          {String(m.status ?? (m.error ? "error" : "deployed"))}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => setSelected(name)}>Inspect</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Model detail — <span className="font-mono">{selected}</span></CardTitle>
            <Button
              size="sm"
              variant="outline"
              disabled={shap.isFetching}
              onClick={() => shap.refetch().then((r) => {
                if (r.isError) toast.error(r.error.message);
              })}
            >
              {shap.isFetching ? "Loading…" : "Load SHAP explanation"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {detail.isError && <ErrText error={detail.error} />}
            <JsonBlock data={detail.data} label="Detail" />
            {shap.data !== undefined && <JsonBlock data={shap.data} label="SHAP feature attributions" />}
            {shap.isError && <ErrText error={shap.error} />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── GNN tab ───────────────────────────────────────────────────────────────────

function GnnTab() {
  const health = trpc.gnn.health.useQuery();
  const stats = trpc.gnn.graphStats.useQuery();
  const allEmb = trpc.gnn.allEmbeddings.useQuery(undefined, { enabled: false });
  const buildGraph = trpc.gnn.buildGraph.useMutation({
    onSuccess: () => { toast.success("Graph rebuild triggered"); stats.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const [embNode, setEmbNode] = useState("");
  const [embDepth, setEmbDepth] = useState("2");
  const embedding = trpc.gnn.embedding.useQuery(
    { nodeId: embNode, depth: Math.min(3, Math.max(1, parseInt(embDepth) || 2)) },
    { enabled: false },
  );

  const [linkSrc, setLinkSrc] = useState("");
  const [linkDst, setLinkDst] = useState("");
  const predictLink = trpc.gnn.predictLink.useQuery(
    { source: linkSrc, target: linkDst },
    { enabled: false },
  );

  const [violOrg, setViolOrg] = useState("");
  const predictViolations = trpc.gnn.predictViolations.useQuery(
    { orgId: violOrg },
    { enabled: false },
  );

  const [nbNode, setNbNode] = useState("");
  const [nbRel, setNbRel] = useState("");
  const neighbors = trpc.gnn.neighbors.useQuery(
    { nodeId: nbNode, relation: nbRel || undefined },
    { enabled: false },
  );

  const [pathSrc, setPathSrc] = useState("");
  const [pathDst, setPathDst] = useState("");
  const [pathDepth, setPathDepth] = useState("4");
  const findPath = trpc.gnn.findPath.useQuery(
    { src: pathSrc, dst: pathDst, maxDepth: Math.min(6, Math.max(1, parseInt(pathDepth) || 4)) },
    { enabled: false },
  );

  const [simA, setSimA] = useState("");
  const [simB, setSimB] = useState("");
  const similarity = trpc.gnn.similarity.useQuery(
    { nodeA: simA, nodeB: simB },
    { enabled: false },
  );

  const run = (q: { refetch: () => Promise<any> }) =>
    q.refetch().then((r) => { if (r.isError) toast.error(r.error.message); });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-lg">GNN Compliance Engine</CardTitle>
            <CardDescription>PyTorch engine (Ray ML) for predictions; legacy numpy engine for traversals</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge data={health.data} />
            <Button variant="ghost" size="sm" onClick={() => { health.refetch(); stats.refetch(); }}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" disabled={buildGraph.isPending} onClick={() => buildGraph.mutate()}>
              <Play className="h-3.5 w-3.5 mr-1" /> {buildGraph.isPending ? "Building…" : "Rebuild graph"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {stats.isError && <ErrText error={stats.error} />}
          <JsonBlock data={stats.data} label="Graph stats (legacy engine — may report unavailable)" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Node embedding</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1"><Label>Node ID</Label><Input value={embNode} onChange={(e) => setEmbNode(e.target.value)} placeholder="org:123" /></div>
              <div className="w-20"><Label>Depth</Label><Input type="number" min={1} max={3} value={embDepth} onChange={(e) => setEmbDepth(e.target.value)} /></div>
              <Button size="sm" disabled={!embNode || embedding.isFetching} onClick={() => run(embedding)}>Run</Button>
            </div>
            <JsonBlock data={embedding.data} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Link prediction</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1"><Label>Source</Label><Input value={linkSrc} onChange={(e) => setLinkSrc(e.target.value)} /></div>
              <div className="flex-1"><Label>Target</Label><Input value={linkDst} onChange={(e) => setLinkDst(e.target.value)} /></div>
              <Button size="sm" disabled={!linkSrc || !linkDst || predictLink.isFetching} onClick={() => run(predictLink)}>Score</Button>
            </div>
            <JsonBlock data={predictLink.data} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Violation forecast (LSTM)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1"><Label>Organisation ID</Label><Input value={violOrg} onChange={(e) => setViolOrg(e.target.value)} placeholder="org id" /></div>
              <Button size="sm" disabled={!violOrg || predictViolations.isFetching} onClick={() => run(predictViolations)}>Forecast</Button>
            </div>
            <JsonBlock data={predictViolations.data} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Graph neighbours</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1"><Label>Node ID</Label><Input value={nbNode} onChange={(e) => setNbNode(e.target.value)} /></div>
              <div className="flex-1"><Label>Relation (optional)</Label><Input value={nbRel} onChange={(e) => setNbRel(e.target.value)} /></div>
              <Button size="sm" disabled={!nbNode || neighbors.isFetching} onClick={() => run(neighbors)}>Query</Button>
            </div>
            <JsonBlock data={neighbors.data} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Find path</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2 items-end flex-wrap">
              <div className="flex-1 min-w-28"><Label>Source</Label><Input value={pathSrc} onChange={(e) => setPathSrc(e.target.value)} /></div>
              <div className="flex-1 min-w-28"><Label>Destination</Label><Input value={pathDst} onChange={(e) => setPathDst(e.target.value)} /></div>
              <div className="w-24"><Label>Max depth</Label><Input type="number" min={1} max={6} value={pathDepth} onChange={(e) => setPathDepth(e.target.value)} /></div>
              <Button size="sm" disabled={!pathSrc || !pathDst || findPath.isFetching} onClick={() => run(findPath)}>Find</Button>
            </div>
            <JsonBlock data={findPath.data} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Node similarity</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1"><Label>Node A</Label><Input value={simA} onChange={(e) => setSimA(e.target.value)} /></div>
              <div className="flex-1"><Label>Node B</Label><Input value={simB} onChange={(e) => setSimB(e.target.value)} /></div>
              <Button size="sm" disabled={!simA || !simB || similarity.isFetching} onClick={() => run(similarity)}>Compare</Button>
            </div>
            <JsonBlock data={similarity.data} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">All embeddings (Ray ML)</CardTitle>
          <Button size="sm" variant="outline" disabled={allEmb.isFetching} onClick={() => run(allEmb)}>
            {allEmb.isFetching ? "Loading…" : "Load embeddings"}
          </Button>
        </CardHeader>
        {allEmb.data !== undefined && <CardContent><JsonBlock data={allEmb.data} /></CardContent>}
      </Card>
    </div>
  );
}

// ── Lakehouse tab (lakehouseAnalytics) ───────────────────────────────────────

function LakehouseTab() {
  const health = trpc.lakehouseAnalytics.health.useQuery();
  const etlStatus = trpc.lakehouseAnalytics.etlStatus.useQuery();
  const tables = trpc.lakehouseAnalytics.tables.useQuery();
  const snapshots = trpc.lakehouseAnalytics.snapshots.useQuery();
  const lineage = trpc.lakehouseAnalytics.lineage.useQuery(undefined, { enabled: false });
  const incremental = trpc.lakehouseAnalytics.incrementalStatus.useQuery();

  const refresh = () => { health.refetch(); etlStatus.refetch(); tables.refetch(); snapshots.refetch(); incremental.refetch(); };

  const triggerETL = trpc.lakehouseAnalytics.triggerETL.useMutation({
    onSuccess: () => { toast.success("ETL run triggered"); etlStatus.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const resetIncremental = trpc.lakehouseAnalytics.resetIncremental.useMutation({
    onSuccess: () => { toast.success("Incremental watermarks reset"); incremental.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const compact = trpc.lakehouseAnalytics.compact.useMutation({
    onSuccess: () => toast.success("Compaction triggered"),
    onError: (err) => toast.error(err.message),
  });
  const ingest = trpc.lakehouseAnalytics.ingest.useMutation({
    onSuccess: () => { toast.success("Records ingested"); setIngestRecords(""); },
    onError: (err) => toast.error(err.message),
  });

  const [sql, setSql] = useState("SHOW TABLES");
  const query = trpc.lakehouseAnalytics.query.useQuery({ sql }, { enabled: false });

  const [viewName, setViewName] = useState("");
  const matView = trpc.lakehouseAnalytics.materializedView.useQuery({ viewName }, { enabled: false });

  const [featureGroup, setFeatureGroup] = useState("");
  const features = trpc.lakehouseAnalytics.features.useQuery({ featureGroup }, { enabled: false });

  const [ingestNs, setIngestNs] = useState("ndsep");
  const [ingestTable, setIngestTable] = useState("");
  const [ingestRecords, setIngestRecords] = useState("");

  const tableRows = asRows(tables.data);
  const snapshotRows = asRows(snapshots.data);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-lg">Lakehouse Analytics</CardTitle>
            <CardDescription>DuckDB / Parquet analytical store</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge data={health.data} />
            <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4" /></Button>
            <Button size="sm" variant="outline" disabled={triggerETL.isPending} onClick={() => triggerETL.mutate()}>
              <Play className="h-3.5 w-3.5 mr-1" /> {triggerETL.isPending ? "Running…" : "Run ETL"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <JsonBlock data={etlStatus.data} label="ETL status" />
          <div className="space-y-2">
            <JsonBlock data={incremental.data} label="Incremental watermarks" />
            <Button
              size="sm"
              variant="outline"
              disabled={resetIncremental.isPending}
              onClick={() => {
                if (window.confirm("Reset all incremental ETL watermarks? The next run reprocesses from scratch.")) {
                  resetIncremental.mutate();
                }
              }}
            >
              Reset incremental watermarks
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Tables</CardTitle></CardHeader>
        <CardContent>
          {tables.isError && <ErrText error={tables.error} />}
          {tableRows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableRows.map((t: any, i: number) => {
                  const name = String(t.name ?? t.table ?? t.table_name ?? `table_${i}`);
                  return (
                    <TableRow key={name}>
                      <TableCell className="font-mono text-xs">{name}</TableCell>
                      <TableCell className="text-xs">{t.row_count ?? t.rows ?? t.count ?? "—"}</TableCell>
                      <TableCell className="text-xs font-mono">{t.schema ? JSON.stringify(t.schema).slice(0, 120) : "—"}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={compact.isPending}
                          onClick={() => compact.mutate({ table: name })}
                        >
                          Compact
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            !tables.isLoading && !tables.isError && <JsonBlock data={tables.data} label="Raw response" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Snapshot browser</CardTitle></CardHeader>
        <CardContent>
          {snapshots.isError && <ErrText error={snapshots.error} />}
          {snapshotRows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Snapshot</TableHead>
                  <TableHead>Table</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshotRows.map((s: any, i: number) => (
                  <TableRow key={s.id ?? s.snapshot_id ?? i}>
                    <TableCell className="font-mono text-xs">{String(s.id ?? s.snapshot_id ?? i)}</TableCell>
                    <TableCell className="text-xs">{String(s.table ?? s.table_name ?? "—")}</TableCell>
                    <TableCell className="text-xs">{s.created_at ? new Date(String(s.created_at)).toLocaleString() : "—"}</TableCell>
                    <TableCell className="text-xs font-mono">{JSON.stringify(s).slice(0, 140)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            !snapshots.isLoading && !snapshots.isError && <JsonBlock data={snapshots.data} label="Raw response" />
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Ad-hoc SQL (ab_results & analytical queries)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Textarea rows={4} className="font-mono text-xs" value={sql} onChange={(e) => setSql(e.target.value)} />
            <Button
              size="sm"
              disabled={!sql.trim() || query.isFetching}
              onClick={() => query.refetch().then((r) => { if (r.isError) toast.error(r.error.message); })}
            >
              {query.isFetching ? "Running…" : "Run query"}
            </Button>
            <JsonBlock data={query.data} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Materialized view / feature group</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 items-end">
              <div className="flex-1"><Label>View name</Label><Input value={viewName} onChange={(e) => setViewName(e.target.value)} /></div>
              <Button size="sm" disabled={!viewName || matView.isFetching} onClick={() => matView.refetch().then((r) => { if (r.isError) toast.error(r.error.message); })}>Load view</Button>
            </div>
            <JsonBlock data={matView.data} />
            <div className="flex gap-2 items-end">
              <div className="flex-1"><Label>Feature group</Label><Input value={featureGroup} onChange={(e) => setFeatureGroup(e.target.value)} /></div>
              <Button size="sm" disabled={!featureGroup || features.isFetching} onClick={() => features.refetch().then((r) => { if (r.isError) toast.error(r.error.message); })}>Load features</Button>
            </div>
            <JsonBlock data={features.data} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Lineage</CardTitle>
            <Button size="sm" variant="outline" disabled={lineage.isFetching} onClick={() => lineage.refetch().then((r) => { if (r.isError) toast.error(r.error.message); })}>
              {lineage.isFetching ? "Loading…" : "Load lineage"}
            </Button>
          </CardHeader>
          {lineage.data !== undefined && <CardContent><JsonBlock data={lineage.data} /></CardContent>}
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Ingest records</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2">
              <div className="w-32"><Label>Namespace</Label><Input value={ingestNs} onChange={(e) => setIngestNs(e.target.value)} /></div>
              <div className="flex-1"><Label>Table</Label><Input value={ingestTable} onChange={(e) => setIngestTable(e.target.value)} /></div>
            </div>
            <Label>Records (JSON array of objects)</Label>
            <Textarea rows={4} className="font-mono text-xs" value={ingestRecords} onChange={(e) => setIngestRecords(e.target.value)} placeholder='[{"key": "value"}]' />
            <Button
              size="sm"
              disabled={!ingestTable || !ingestRecords.trim() || ingest.isPending}
              onClick={() => {
                let records: Record<string, unknown>[];
                try {
                  const parsed = JSON.parse(ingestRecords);
                  if (!Array.isArray(parsed)) { toast.error("Records must be a JSON array"); return; }
                  records = parsed;
                } catch {
                  toast.error("Invalid JSON");
                  return;
                }
                ingest.mutate({ namespace: ingestNs || "ndsep", table: ingestTable, records });
              }}
            >
              Ingest
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Drift & Retrain tab (mlProduction pipeline + prediction signals) ─────────

function DriftRetrainTab() {
  const pipeline = trpc.mlProduction.pipelineStatus.useQuery();
  const incremental = trpc.lakehouseAnalytics.incrementalStatus.useQuery();
  const predictViolations = trpc.mlProduction.predictViolations.useQuery(undefined, { enabled: false });

  const trainAll = trpc.mlProduction.trainAll.useMutation({
    onSuccess: () => { toast.success("Full retrain started (all models)"); pipeline.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const trainModel = trpc.mlProduction.trainModel.useMutation({
    onSuccess: () => { toast.success("Model retrain started"); pipeline.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const [trainName, setTrainName] = useState("");

  const [featText, setFeatText] = useState('{"open_violations": 2, "dsar_overdue": 0, "breach_count_12m": 1}');
  const predictBreach = trpc.mlProduction.predictBreach.useQuery(
    { orgFeatures: parseJsonObject(featText) ?? {} },
    { enabled: false },
  );
  const detectAnomaly = trpc.mlProduction.detectAnomaly.useQuery(
    { orgFeatures: parseJsonObject(featText) ?? {} },
    { enabled: false },
  );
  const scoreRisk = trpc.mlProduction.scoreRisk.useQuery(
    { orgFeatures: parseJsonObject(featText) ?? {} },
    { enabled: false },
  );

  const featuresValid = parseJsonObject(featText) !== null;
  const run = (q: { refetch: () => Promise<any> }) =>
    q.refetch().then((r) => { if (r.isError) toast.error(r.error.message); });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-lg">Training pipeline</CardTitle>
            <CardDescription>Pipeline status and retrain triggers</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => { pipeline.refetch(); incremental.refetch(); }}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" disabled={trainAll.isPending} onClick={() => trainAll.mutate()}>
              <Play className="h-3.5 w-3.5 mr-1" /> {trainAll.isPending ? "Starting…" : "Retrain all models"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {pipeline.isError && <ErrText error={pipeline.error} />}
          <JsonBlock data={pipeline.data} label="Pipeline status (last runs, drift signals as reported by the engine)" />
          <div className="flex gap-2 items-end">
            <div className="flex-1"><Label>Retrain single model</Label><Input value={trainName} onChange={(e) => setTrainName(e.target.value)} placeholder="model name" /></div>
            <Button size="sm" variant="outline" disabled={!trainName || trainModel.isPending} onClick={() => trainModel.mutate({ modelName: trainName })}>
              Retrain model
            </Button>
          </div>
          <JsonBlock data={incremental.data} label="Lakehouse incremental watermarks (retrain inputs freshness)" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Violation forecast (all orgs)</CardTitle>
            <CardDescription>Platform-wide LSTM violation predictions — drift signal source</CardDescription>
          </div>
          <Button size="sm" variant="outline" disabled={predictViolations.isFetching} onClick={() => run(predictViolations)}>
            {predictViolations.isFetching ? "Scoring…" : "Run forecast"}
          </Button>
        </CardHeader>
        {predictViolations.data !== undefined && <CardContent><JsonBlock data={predictViolations.data} /></CardContent>}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-organisation scoring</CardTitle>
          <CardDescription>Breach probability, anomaly detection and risk score from an org feature vector</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label>Organisation features (JSON object of numeric features)</Label>
          <Textarea rows={3} className="font-mono text-xs" value={featText} onChange={(e) => setFeatText(e.target.value)} />
          {!featuresValid && <div className="text-xs text-red-400">Invalid JSON object</div>}
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" disabled={!featuresValid || predictBreach.isFetching} onClick={() => run(predictBreach)}>Predict breach</Button>
            <Button size="sm" variant="outline" disabled={!featuresValid || detectAnomaly.isFetching} onClick={() => run(detectAnomaly)}>Detect anomaly</Button>
            <Button size="sm" variant="outline" disabled={!featuresValid || scoreRisk.isFetching} onClick={() => run(scoreRisk)}>Score risk</Button>
          </div>
          <JsonBlock data={predictBreach.data} label="Breach prediction" />
          <JsonBlock data={detectAnomaly.data} label="Anomaly detection" />
          <JsonBlock data={scoreRisk.data} label="Risk score" />
        </CardContent>
      </Card>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MlOpsConsole() {
  const { user } = useAuth();

  if (!user || user.role !== "admin") {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Breadcrumbs items={[{ label: "ML Ops Console" }]} />
        <Card className="mt-4">
          <CardContent className="py-8 text-center text-muted-foreground">
            Admin access required to operate ML/AI infrastructure.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "ML Ops Console" }]} />
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BrainCircuit className="h-6 w-6" /> ML Ops Console
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Operations surface for the ML Production engine, GNN compliance engine and Lakehouse analytics store.
        </p>
      </div>

      <Tabs defaultValue="models">
        <TabsList>
          <TabsTrigger value="models"><Activity className="h-3.5 w-3.5 mr-1" />Models</TabsTrigger>
          <TabsTrigger value="gnn"><Network className="h-3.5 w-3.5 mr-1" />GNN</TabsTrigger>
          <TabsTrigger value="lakehouse"><Database className="h-3.5 w-3.5 mr-1" />Lakehouse</TabsTrigger>
          <TabsTrigger value="drift"><RefreshCw className="h-3.5 w-3.5 mr-1" />Drift &amp; Retrain</TabsTrigger>
        </TabsList>

        <TabsContent value="models" className="mt-4"><ModelsTab /></TabsContent>
        <TabsContent value="gnn" className="mt-4"><GnnTab /></TabsContent>
        <TabsContent value="lakehouse" className="mt-4"><LakehouseTab /></TabsContent>
        <TabsContent value="drift" className="mt-4"><DriftRetrainTab /></TabsContent>
      </Tabs>
    </div>
  );
}
