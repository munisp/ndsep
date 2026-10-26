/**
 * Production Readiness Dashboard (round 16, wave 3)
 * ==================================================
 * Operator console for the `productionReadiness` tRPC router
 * (server/routers/productionReadiness.ts, mounted as `productionReadiness`).
 * Wires all 16 procedures:
 *
 *   errorSummary, errorMetrics, middlewareHealth, middlewareStatus,
 *   authConfig, workerBuildStatus, readinessScore, seedDataSummary,
 *   eventBusMetrics, workflowDefinitions, workflowHealth, serviceStatus,
 *   serviceDefinitions, mlModels, mlPipelineStatus, k8sReadiness
 *
 * The readiness score evaluates only evidence observable by this process
 * (Postgres/Redis connectivity, error rate, worker binaries, Keycloak JWKS
 * freshness, middleware health). The score trend is session-local: the router
 * exposes no historical series, so scores are accumulated client-side on each
 * assessment run/refresh.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Gauge,
  KeyRound,
  Play,
  RefreshCw,
  Server,
  Workflow,
  XCircle,
} from "lucide-react";

const pr = trpc.productionReadiness;

const LEVEL_STYLES: Record<string, string> = {
  production: "bg-green-500/20 text-green-300 border-green-500/40",
  staging: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  development: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  ready: "bg-green-500/20 text-green-300 border-green-500/40",
  almost: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  not_ready: "bg-red-500/20 text-red-300 border-red-500/40",
};

const STATUS_STYLES: Record<string, string> = {
  connected: "bg-green-500/20 text-green-300 border-green-500/40",
  healthy: "bg-green-500/20 text-green-300 border-green-500/40",
  ready: "bg-green-500/20 text-green-300 border-green-500/40",
  degraded: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  training: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  starting: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  pending: "bg-muted text-muted-foreground border-border",
  stale: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  skipped: "bg-muted text-muted-foreground border-border",
  unconfigured: "bg-muted text-muted-foreground border-border",
  disconnected: "bg-red-500/20 text-red-300 border-red-500/40",
  unhealthy: "bg-red-500/20 text-red-300 border-red-500/40",
  untrained: "bg-red-500/20 text-red-300 border-red-500/40",
};

function statusBadge(status: string | null | undefined) {
  const s = status ?? "unknown";
  return <Badge className={STATUS_STYLES[s] ?? "bg-muted text-muted-foreground border-border"}>{s}</Badge>;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

type GateCheck = { name: string; pass: boolean };

export default function ProductionReadiness() {
  const utils = trpc.useUtils();

  // ── All 16 procedures ─────────────────────────────────────────────────
  const readinessScore = pr.readinessScore.useQuery(undefined, { refetchInterval: 60_000 });
  const middlewareHealth = pr.middlewareHealth.useQuery(undefined, { refetchInterval: 30_000 });
  const [selectedMiddleware, setSelectedMiddleware] = useState<string | null>(null);
  const middlewareStatus = pr.middlewareStatus.useQuery(
    { name: selectedMiddleware ?? "" },
    { enabled: !!selectedMiddleware },
  );
  const authConfig = pr.authConfig.useQuery();
  const workerBuildStatus = pr.workerBuildStatus.useQuery();
  const errorSummary = pr.errorSummary.useQuery(undefined, { refetchInterval: 30_000 });
  const errorMetrics = pr.errorMetrics.useQuery();
  const seedDataSummary = pr.seedDataSummary.useQuery();
  const eventBusMetrics = pr.eventBusMetrics.useQuery(undefined, { refetchInterval: 30_000 });
  const workflowDefinitions = pr.workflowDefinitions.useQuery();
  const workflowHealth = pr.workflowHealth.useQuery();
  const serviceStatus = pr.serviceStatus.useQuery();
  const serviceDefinitions = pr.serviceDefinitions.useQuery();
  const mlModels = pr.mlModels.useQuery();
  const mlPipelineStatus = pr.mlPipelineStatus.useQuery();
  const k8sReadiness = pr.k8sReadiness.useQuery();

  // ── Session-local score trend (router exposes no history) ─────────────
  const [trend, setTrend] = useState<Array<{ at: string; score: number }>>([]);
  const lastScore = useRef<number | null>(null);
  useEffect(() => {
    const score = readinessScore.data?.score;
    if (typeof score === "number" && score !== lastScore.current) {
      lastScore.current = score;
      setTrend((t) => [...t.slice(-49), { at: new Date().toISOString(), score }]);
    }
  }, [readinessScore.data?.score]);

  const runAssessment = () => {
    readinessScore.refetch();
    middlewareHealth.refetch();
    errorSummary.refetch();
    eventBusMetrics.refetch();
    utils.productionReadiness.invalidate();
    toast.info("Assessment re-run — all readiness queries refreshed.");
  };

  // ── Gate details drawer ───────────────────────────────────────────────
  const [drawerCheck, setDrawerCheck] = useState<string | null>(null);
  const checks: GateCheck[] = useMemo(() => readinessScore.data?.checks ?? [], [readinessScore.data]);

  /** Evidence slice relevant to each gate, drawn from the live queries. */
  const gateEvidence = (name: string): unknown => {
    switch (name) {
      case "PostgreSQL Connected":
      case "Redis Available":
      case "Middleware Health":
        return middlewareHealth.data ?? null;
      case "Error Rate Normal":
        return { summary: errorSummary.data ?? null, metrics: errorMetrics.data ?? null };
      case "Worker Binaries Built":
        return workerBuildStatus.data ?? null;
      case "Keycloak Verification Ready":
        return authConfig.data ?? null;
      default:
        return readinessScore.data ?? null;
    }
  };

  const score = readinessScore.data?.score ?? 0;
  const level = readinessScore.data?.level ?? "development";
  const mw = middlewareHealth.data;
  const mwServices = useMemo(() => mw?.services ?? [], [mw]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <Breadcrumbs items={[{ label: "Production Readiness" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Gauge className="h-6 w-6" /> Production Readiness
          </h1>
          <p className="text-muted-foreground text-sm">
            Readiness gates over live, observable evidence — middleware, errors, workers, Keycloak auth, event
            bus, Temporal workflows, services, ML pipeline, and static K8s manifest review.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={runAssessment}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={runAssessment} disabled={readinessScore.isFetching}>
            <Play className="h-4 w-4 mr-1" /> Run assessment
          </Button>
        </div>
      </div>

      {/* ── Score + gates ─────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Readiness score</CardTitle>
            <CardDescription>
              {readinessScore.data?.checks?.filter((c) => c.pass).length ?? "—"}/
              {readinessScore.data?.checks?.length ?? "—"} gates passing
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-4">
              <span className="text-4xl font-bold font-mono">{readinessScore.data ? score : "—"}</span>
              <Badge className={LEVEL_STYLES[level] ?? ""}>{level}</Badge>
            </div>
            <Progress value={score} />
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Middleware: {readinessScore.data?.middleware?.overall ?? "—"} ({readinessScore.data?.middleware?.connected ?? "—"}/{readinessScore.data?.middleware?.total ?? "—"} connected)</div>
              <div>Errors: {readinessScore.data?.errors?.lastMinute ?? "—"} last minute · {readinessScore.data?.errors?.total ?? "—"} total</div>
            </div>
            {trend.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Score trend (this session, {trend.length} sample{trend.length === 1 ? "" : "s"})</div>
                <div className="flex items-end gap-1 h-10">
                  {trend.map((t, i) => (
                    <div
                      key={`${t.at}-${i}`}
                      title={`${t.score} @ ${new Date(t.at).toLocaleTimeString()}`}
                      className={`w-2 rounded-sm ${t.score >= 80 ? "bg-green-500" : t.score >= 50 ? "bg-yellow-500" : "bg-orange-500"}`}
                      style={{ height: `${Math.max(8, t.score)}%` }}
                    />
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Readiness gates</CardTitle>
            <CardDescription>Click a gate for its evidence. Gates evaluate only what this process can observe.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gate</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {checks.map((c) => (
                  <TableRow key={c.name} className="cursor-pointer" onClick={() => setDrawerCheck(c.name)}>
                    <TableCell className="text-sm font-medium">{c.name}</TableCell>
                    <TableCell>
                      {c.pass ? (
                        <Badge className="bg-green-500/20 text-green-300 border-green-500/40"><CheckCircle2 className="h-3 w-3 mr-1" />pass</Badge>
                      ) : (
                        <Badge className="bg-red-500/20 text-red-300 border-red-500/40"><XCircle className="h-3 w-3 mr-1" />fail</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {checks.length === 0 && (
                  <TableRow><TableCell colSpan={2} className="text-muted-foreground text-sm">No assessment data yet — run an assessment.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="middleware">
        <TabsList>
          <TabsTrigger value="middleware"><Server className="h-4 w-4 mr-1" /> Middleware</TabsTrigger>
          <TabsTrigger value="errors"><AlertTriangle className="h-4 w-4 mr-1" /> Errors</TabsTrigger>
          <TabsTrigger value="auth"><KeyRound className="h-4 w-4 mr-1" /> Auth</TabsTrigger>
          <TabsTrigger value="workers"><Activity className="h-4 w-4 mr-1" /> Workers &amp; services</TabsTrigger>
          <TabsTrigger value="workflows"><Workflow className="h-4 w-4 mr-1" /> Workflows &amp; bus</TabsTrigger>
          <TabsTrigger value="ml"><Database className="h-4 w-4 mr-1" /> ML &amp; data</TabsTrigger>
          <TabsTrigger value="k8s">K8s</TabsTrigger>
        </TabsList>

        {/* ── Middleware ──────────────────────────────────────────────── */}
        <TabsContent value="middleware" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Middleware health</CardTitle>
                {mw && (
                  <div className="text-sm text-muted-foreground">
                    {statusBadge(mw.overall)} {mw.connected}/{mw.total} connected · checked {fmtDate(mw.checkedAt)}
                  </div>
                )}
              </div>
              <CardDescription>Live probes across Postgres, Redis, Kafka, Temporal, Keycloak and the rest of the middleware mesh.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Latency</TableHead>
                    <TableHead>Circuit</TableHead>
                    <TableHead>Retries</TableHead>
                    <TableHead>Last check</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mwServices.map((s) => (
                    <TableRow
                      key={s.name}
                      className="cursor-pointer"
                      onClick={() => setSelectedMiddleware(selectedMiddleware === s.name ? null : s.name)}
                    >
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{s.type}</TableCell>
                      <TableCell>{statusBadge(s.status)}</TableCell>
                      <TableCell className="font-mono text-xs">{s.latencyMs} ms</TableCell>
                      <TableCell className="text-xs">{s.circuitState}</TableCell>
                      <TableCell className="font-mono text-xs">{s.retries}</TableCell>
                      <TableCell className="text-xs">{fmtDate(s.lastCheck)}</TableCell>
                    </TableRow>
                  ))}
                  {mwServices.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-muted-foreground text-sm">No middleware status available.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              {selectedMiddleware && middlewareStatus.data && (
                <div className="mt-3 rounded border border-border p-3 text-xs">
                  <div className="font-semibold mb-1">Cached status — {selectedMiddleware}</div>
                  <pre className="overflow-auto max-h-48">{JSON.stringify(middlewareStatus.data, null, 2)}</pre>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Errors ──────────────────────────────────────────────────── */}
        <TabsContent value="errors" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Card><CardHeader className="pb-2"><CardDescription>Total errors</CardDescription><CardTitle className="text-2xl font-mono">{errorSummary.data?.totalErrors ?? "—"}</CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Total warnings</CardDescription><CardTitle className="text-2xl font-mono">{errorSummary.data?.totalWarnings ?? "—"}</CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Errors / minute</CardDescription><CardTitle className="text-2xl font-mono">{errorSummary.data?.errorsLastMinute ?? "—"}</CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Alerts sent (threshold {errorSummary.data?.alertThreshold ?? "—"})</CardDescription><CardTitle className="text-2xl font-mono">{errorSummary.data?.alertsSent ?? "—"}</CardTitle></CardHeader></Card>
          </div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Error categories</CardTitle>
              <CardDescription>
                Sentry {errorSummary.data?.sentryConfigured ? "configured" : "NOT configured"} · metrics snapshot:
                {" "}{errorMetrics.data ? `${errorMetrics.data.total_errors} errors / ${errorMetrics.data.total_warnings} warnings / ${errorMetrics.data.alerts_sent} alerts` : "—"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {Object.entries(errorSummary.data?.categories ?? {}).map(([cat, count]) => (
                  <Badge key={cat} className="bg-muted text-muted-foreground border-border">{cat}: {count}</Badge>
                ))}
                {Object.keys(errorSummary.data?.categories ?? {}).length === 0 && (
                  <span className="text-muted-foreground text-sm">No error categories recorded.</span>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-lg">Recent errors (last window)</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Count</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(errorSummary.data?.recentErrors ?? []).map((e, i) => (
                    <TableRow key={`${e.timestamp}-${i}`}>
                      <TableCell className="text-xs">{fmtDate(e.timestamp)}</TableCell>
                      <TableCell>{statusBadge(e.severity)}</TableCell>
                      <TableCell className="text-xs">{e.category}</TableCell>
                      <TableCell className="text-xs">{e.source}</TableCell>
                      <TableCell className="font-mono text-xs">{e.count}</TableCell>
                      <TableCell className="text-xs max-w-md truncate">{e.message}</TableCell>
                    </TableRow>
                  ))}
                  {(errorSummary.data?.recentErrors ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-muted-foreground text-sm">No recent errors.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Auth ────────────────────────────────────────────────────── */}
        <TabsContent value="auth">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Authentication status</CardTitle>
              <CardDescription>
                Production requires Keycloak with a fresh verified JWKS cache — the demo-login fallback is never
                production-ready.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span>Mode</span><Badge className={authConfig.data?.mode === "keycloak" ? LEVEL_STYLES.production : LEVEL_STYLES.development}>{authConfig.data?.mode ?? "—"}</Badge></div>
              <div className="flex justify-between"><span>Keycloak enabled</span><span className="font-mono">{String(authConfig.data?.keycloak?.enabled ?? "—")}</span></div>
              <div className="flex justify-between"><span>Issuer</span><span className="font-mono text-xs max-w-[60%] truncate">{authConfig.data?.keycloak?.issuer ?? "—"}</span></div>
              <div className="flex justify-between"><span>Realm / client</span><span className="font-mono text-xs">{authConfig.data?.health?.realm ?? "—"} / {authConfig.data?.health?.clientId ?? "—"}</span></div>
              <div className="flex justify-between"><span>JWKS cached</span><span className="font-mono">{String(authConfig.data?.health?.jwksCached ?? "—")}</span></div>
              <div className="flex justify-between"><span>JWKS cache age</span><span className="font-mono">{authConfig.data?.health?.jwksCacheAge != null ? `${authConfig.data.health.jwksCacheAge}s` : "—"} (gate: ≤ 3600s)</span></div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Workers & services ──────────────────────────────────────── */}
        <TabsContent value="workers" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Worker binaries</CardTitle>
              <CardDescription>Gate requires &gt;50% of worker binaries built.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Worker</TableHead>
                    <TableHead>Language</TableHead>
                    <TableHead>Built</TableHead>
                    <TableHead>Binary path</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(workerBuildStatus.data ?? []).map((b) => (
                    <TableRow key={b.name}>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell className="text-xs">{b.language}</TableCell>
                      <TableCell>{b.success
                        ? <Badge className="bg-green-500/20 text-green-300 border-green-500/40">built</Badge>
                        : <Badge className="bg-red-500/20 text-red-300 border-red-500/40">missing</Badge>}
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-md truncate">{b.binaryPath}</TableCell>
                    </TableRow>
                  ))}
                  {(workerBuildStatus.data ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-muted-foreground text-sm">No worker build data.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-lg">Service auto-start status</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Service</TableHead><TableHead>Port</TableHead><TableHead>Status</TableHead><TableHead>Health</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {(serviceStatus.data ?? []).map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="text-sm">{s.name}</TableCell>
                        <TableCell className="font-mono text-xs">{s.port}</TableCell>
                        <TableCell>{statusBadge(s.status)}</TableCell>
                        <TableCell className="font-mono text-xs">{s.healthCheckMs != null ? `${s.healthCheckMs} ms` : "—"}{s.error ? ` · ${s.error}` : ""}</TableCell>
                      </TableRow>
                    ))}
                    {(serviceStatus.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-muted-foreground text-sm">No service status.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-lg">Service definitions</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>ID</TableHead><TableHead>Name</TableHead><TableHead>Priority</TableHead><TableHead>Language</TableHead><TableHead>Dependencies</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {(serviceDefinitions.data ?? []).map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs">{s.id}</TableCell>
                        <TableCell className="text-sm">{s.name}</TableCell>
                        <TableCell className="font-mono text-xs">P{s.priority}</TableCell>
                        <TableCell className="text-xs">{s.language}</TableCell>
                        <TableCell className="text-xs">{(s.dependencies ?? []).join(", ") || "—"}</TableCell>
                      </TableRow>
                    ))}
                    {(serviceDefinitions.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-muted-foreground text-sm">No service definitions.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Workflows & event bus ───────────────────────────────────── */}
        <TabsContent value="workflows" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Temporal workflow health</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span>SDK loaded</span><span className="font-mono">{String(workflowHealth.data?.temporalSdkLoaded ?? "—")}</span></div>
                <div className="flex justify-between"><span>Address</span><span className="font-mono text-xs">{workflowHealth.data?.temporalAddress ?? "—"}</span></div>
                <div className="flex justify-between"><span>Namespace</span><span className="font-mono">{workflowHealth.data?.namespace ?? "—"}</span></div>
                <div className="flex justify-between"><span>Cloud</span><span className="font-mono">{String(workflowHealth.data?.isCloud ?? "—")}</span></div>
                <div className="flex justify-between"><span>Auth method</span><span className="font-mono">{workflowHealth.data?.authMethod ?? "—"}</span></div>
                <div className="flex justify-between"><span>Definitions</span><span className="font-mono">{workflowHealth.data?.workflowCount ?? "—"}</span></div>
                <div className="flex justify-between"><span>Task queues</span><span className="font-mono text-xs">{(workflowHealth.data?.taskQueues ?? []).join(", ") || "—"}</span></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-lg">Event bus metrics</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span>Published</span><span className="font-mono">{eventBusMetrics.data?.published ?? "—"}</span></div>
                <div className="flex justify-between"><span>Failed</span><span className="font-mono">{eventBusMetrics.data?.failed ?? "—"}</span></div>
                <div className="flex justify-between"><span>Retried</span><span className="font-mono">{eventBusMetrics.data?.retried ?? "—"}</span></div>
                <div className="flex justify-between"><span>Retry queue</span><span className="font-mono">{eventBusMetrics.data?.retryQueueSize ?? "—"} / {eventBusMetrics.data?.maxRetryQueue ?? "—"}</span></div>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-lg">Workflow definitions</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Name</TableHead><TableHead>Task queue</TableHead><TableHead>Timeout (h)</TableHead><TableHead>Steps</TableHead><TableHead>Description</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {(workflowDefinitions.data ?? []).map((w) => (
                    <TableRow key={w.name}>
                      <TableCell className="font-mono text-xs">{w.name}</TableCell>
                      <TableCell className="font-mono text-xs">{w.taskQueue}</TableCell>
                      <TableCell className="font-mono text-xs">{w.defaultTimeoutHours}</TableCell>
                      <TableCell className="font-mono text-xs">{w.stepCount}</TableCell>
                      <TableCell className="text-xs max-w-md truncate">{w.description}</TableCell>
                    </TableRow>
                  ))}
                  {(workflowDefinitions.data ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-muted-foreground text-sm">No workflow definitions.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── ML & seed data ──────────────────────────────────────────── */}
        <TabsContent value="ml" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">ML pipeline status</CardTitle>
                <CardDescription>
                  Worker {mlPipelineStatus.data?.workerConnected ? "connected" : "disconnected"} ·{" "}
                  {mlPipelineStatus.data?.successfulTrainings ?? "—"}/{mlPipelineStatus.data?.totalTrainings ?? "—"} trainings successful
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Model</TableHead><TableHead>Status</TableHead><TableHead>Last trained</TableHead><TableHead>Next training</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {(mlPipelineStatus.data?.models ?? []).map((m) => (
                      <TableRow key={m.name}>
                        <TableCell className="font-mono text-xs">{m.name}</TableCell>
                        <TableCell>{statusBadge(m.status)}</TableCell>
                        <TableCell className="text-xs">{fmtDate(m.lastTrained)}</TableCell>
                        <TableCell className="text-xs">{fmtDate(m.nextTraining)}</TableCell>
                      </TableRow>
                    ))}
                    {(mlPipelineStatus.data?.models ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-muted-foreground text-sm">No model pipeline data.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-lg">Model definitions</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Model</TableHead><TableHead>Algorithm</TableHead><TableHead>Min rows</TableHead><TableHead>Retrain (h)</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {(mlModels.data ?? []).map((m) => (
                      <TableRow key={m.name}>
                        <TableCell className="font-mono text-xs" title={m.description}>{m.name}</TableCell>
                        <TableCell className="text-xs">{m.algorithm}</TableCell>
                        <TableCell className="font-mono text-xs">{m.minRows}</TableCell>
                        <TableCell className="font-mono text-xs">{m.retrainHours}</TableCell>
                      </TableRow>
                    ))}
                    {(mlModels.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-muted-foreground text-sm">No model definitions.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Seed data summary</CardTitle>
              <CardDescription>
                {seedDataSummary.data?.totalRows ?? "—"} rows across {seedDataSummary.data?.tables?.length ?? "—"} tables
                ({seedDataSummary.data?.tablesWithData ?? "—"} with data, {seedDataSummary.data?.tablesEmpty ?? "—"} empty)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Table</TableHead><TableHead>Live rows</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {(seedDataSummary.data?.tables ?? []).map((t) => (
                    <TableRow key={t.name}>
                      <TableCell className="font-mono text-xs">{t.name}</TableCell>
                      <TableCell className="font-mono text-xs">{t.rows}</TableCell>
                    </TableRow>
                  ))}
                  {(seedDataSummary.data?.tables ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={2} className="text-muted-foreground text-sm">No table statistics (database pool unavailable?).</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── K8s ─────────────────────────────────────────────────────── */}
        <TabsContent value="k8s" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">K8s static manifest review</CardTitle>
                <Badge className={LEVEL_STYLES[k8sReadiness.data?.level ?? "not_ready"] ?? ""}>
                  {k8sReadiness.data?.level ?? "—"} · score {k8sReadiness.data?.score ?? "—"}
                </Badge>
              </div>
              <CardDescription>
                Static repository review only — it cannot query a cluster or prove a rollout, so the release
                signal is fail-closed (releaseEligible = {String(k8sReadiness.data?.releaseEligible ?? false)}).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid gap-2 md:grid-cols-5">
                <div>Manifests: <span className="font-mono">{k8sReadiness.data?.summary?.validManifests ?? "—"}/{k8sReadiness.data?.summary?.totalManifests ?? "—"} valid</span></div>
                <div>Dockerfiles: <span className="font-mono">{k8sReadiness.data?.summary?.existingDockerfiles ?? "—"}/{k8sReadiness.data?.summary?.totalDockerfiles ?? "—"}</span></div>
                <div>Port conflicts: <span className="font-mono">{k8sReadiness.data?.summary?.portConflicts ?? "—"}</span></div>
                <div>Missing health probes: <span className="font-mono">{k8sReadiness.data?.missingHealthProbes?.length ?? "—"}</span></div>
                <div>Missing resource limits: <span className="font-mono">{k8sReadiness.data?.missingResourceLimits?.length ?? "—"}</span></div>
              </div>
              {(k8sReadiness.data?.limitations ?? []).length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Limitations</div>
                  <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
                    {(k8sReadiness.data?.limitations ?? []).map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                </div>
              )}
              {(k8sReadiness.data?.missingHealthProbes ?? []).length > 0 && (
                <div className="text-xs">Missing probes: {(k8sReadiness.data?.missingHealthProbes ?? []).join(", ")}</div>
              )}
              {(k8sReadiness.data?.missingResourceLimits ?? []).length > 0 && (
                <div className="text-xs">Missing resource limits: {(k8sReadiness.data?.missingResourceLimits ?? []).join(", ")}</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Gate evidence drawer ──────────────────────────────────────── */}
      <Sheet open={!!drawerCheck} onOpenChange={(open) => !open && setDrawerCheck(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{drawerCheck}</SheetTitle>
            <SheetDescription>Live evidence behind this gate, from the readiness subsystems.</SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <pre className="text-xs overflow-auto max-h-[70vh] rounded border border-border p-3">
              {JSON.stringify(drawerCheck ? gateEvidence(drawerCheck) : null, null, 2)}
            </pre>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
