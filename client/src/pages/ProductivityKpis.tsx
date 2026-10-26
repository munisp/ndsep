import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BarChart3, Loader2, RefreshCw, Save, MousePointerClick, Clock, CheckCircle2, Bot, FormInput } from "lucide-react";

/**
 * Round-12 §8 — Productivity KPI baseline dashboard.
 * Reads kpiDashboard.baseline (computed live from complaint_events,
 * audit_ledger, scan_findings, adverse_media_items, analytics_events) and
 * kpiDashboard.history (kpi_snapshots time-series, migration 0131).
 *
 * NOTE: kpiDashboardRouter (server/routers/kpiDashboard.ts) is mounted in
 * server/routers.ts (round-12 integration), so the client is fully typed
 * through AppRouter.
 */
const kpiTrpc = trpc.kpiDashboard;

interface KpiMetric {
  id: string;
  label: string;
  value: number;
  unit: string;
  sampleSize: number;
  dimensions: Record<string, unknown>;
  description: string;
}

const METRIC_ICONS: Record<string, typeof BarChart3> = {
  clicks_per_workflow: MousePointerClick,
  time_to_triage_hours: Clock,
  time_to_resolution_hours: CheckCircle2,
  queue_auto_clear_rate: Bot,
  form_fields_edited: FormInput,
};

function formatValue(metric: KpiMetric): string {
  if (metric.unit === "percent") return `${metric.value}%`;
  if (metric.unit === "hours") return `${metric.value}h`;
  return metric.value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function ProductivityKpis() {
  const utils = trpc.useUtils();
  const baseline = kpiTrpc.baseline.useQuery({ persist: false });
  const history = kpiTrpc.history.useQuery({ limit: 200 });

  const persist = kpiTrpc.baseline.useQuery({ persist: true }, { enabled: false });

  const metrics = (baseline.data?.metrics ?? []) as KpiMetric[];
  const snapshots = (history.data?.rows ?? []) as Array<{
    id: string; metric: string; value: string | number; dimensions: unknown; captured_at: string;
  }>;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Productivity KPIs" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6" /> Productivity KPI Baselines
          </h1>
          <p className="text-sm text-muted-foreground">
            Operator productivity metrics computed live from complaint_events, audit_ledger,
            scan/adverse-media queues and analytics_events. Snapshot to build the trend baseline.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void baseline.refetch(); void history.refetch(); }}
            disabled={baseline.isFetching}
          >
            {baseline.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Refresh</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await persist.refetch();
              await (utils as any).kpiDashboard.history.invalidate();
            }}
            disabled={persist.isFetching}
            title="Append the current baseline to kpi_snapshots (migration 0131)"
          >
            {persist.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            <span className="ml-2">Capture snapshot</span>
          </Button>
        </div>
      </div>

      {baseline.error && (
        <Card className="border-destructive">
          <CardContent className="pt-4 text-sm text-destructive">
            Failed to compute baseline: {baseline.error.message}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {metrics.map((m) => {
          const Icon = METRIC_ICONS[m.id] ?? BarChart3;
          return (
            <Card key={m.id}>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2">
                  <Icon className="h-4 w-4" /> {m.label}
                </CardDescription>
                <CardTitle className="text-2xl font-mono">{formatValue(m)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{m.unit.replaceAll("_", " ")}</Badge>
                  <span className="text-xs text-muted-foreground">n={m.sampleSize}</span>
                </div>
                <p className="text-xs text-muted-foreground">{m.description}</p>
              </CardContent>
            </Card>
          );
        })}
        {baseline.isLoading && (
          <Card className="md:col-span-3 xl:col-span-5">
            <CardContent className="pt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Computing baseline…
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Snapshot trend</CardTitle>
          <CardDescription>
            Recent kpi_snapshots captures (most recent first). Empty until migration 0131 is applied
            and snapshots are captured.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {snapshots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No snapshots yet — use “Capture snapshot” after migration 0131 is applied.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Captured at</TableHead>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Dimensions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">
                      {new Date(s.captured_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.metric}</TableCell>
                    <TableCell className="text-right font-mono">{Number(s.value)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-md truncate">
                      {typeof s.dimensions === "string" ? s.dimensions : JSON.stringify(s.dimensions)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Baseline computed at {baseline.data?.computedAt ? new Date(baseline.data.computedAt).toLocaleString() : "—"}.
        Queue auto-clear rate baseline is 0 — no auto-resolution automation exists yet; the metric is wired
        so future automation moves the number.
      </p>
    </div>
  );
}
