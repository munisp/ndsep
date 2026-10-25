import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BarChart3, Download, FileText, Loader2, RefreshCw } from "lucide-react";

function MetricGrid({ data }: { data: Record<string, unknown> | null | undefined }) {
  if (!data) return <p className="text-sm text-muted-foreground">No data.</p>;
  const scalars = Object.entries(data).filter(([k, v]) => (typeof v === "string" || typeof v === "number" || v == null) && k !== "year");
  const arrays = Object.entries(data).filter(([, v]) => Array.isArray(v));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {scalars.map(([k, v]) => (
          <div key={k} className="border rounded p-3">
            <p className="text-xs text-muted-foreground">{k.replaceAll("_", " ")}</p>
            <p className="text-xl font-mono font-bold">{v == null ? "—" : typeof v === "number" && !Number.isInteger(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v)}</p>
          </div>
        ))}
      </div>
      {arrays.map(([k, rows]) => (
        <div key={k}>
          <p className="text-sm font-medium mb-1">{k.replaceAll("_", " ")}</p>
          <GenericTable rows={rows as Array<Record<string, unknown>>} />
        </div>
      ))}
      {scalars.length === 0 && arrays.length === 0 && (
        <pre className="text-xs font-mono whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  );
}

function GenericTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No rows.</p>;
  const cols = Object.keys(rows[0]);
  return (
    <Table>
      <TableHeader>
        <TableRow>{cols.map((c) => <TableHead key={c}>{c.replaceAll("_", " ")}</TableHead>)}</TableRow>
      </TableHeader>
      <TableBody>
        {rows.slice(0, 50).map((r, i) => (
          <TableRow key={i}>
            {cols.map((c) => <TableCell key={c} className="text-sm">{r[c] == null ? "—" : typeof r[c] === "object" ? JSON.stringify(r[c]) : String(r[c])}</TableCell>)}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function EnforcementAnalytics() {
  const [year, setYear] = useState(new Date().getFullYear());
  const ttr = trpc.enforcementAnalytics.timeToResolution.useQuery({ year });
  const deterrence = trpc.enforcementAnalytics.deterrenceMetrics.useQuery({ year });
  const collection = trpc.enforcementAnalytics.penaltyCollection.useQuery({ year });
  const sectors = trpc.enforcementAnalytics.sectorBreakdown.useQuery({ year });
  const reports = trpc.enforcementAnalytics.listReports.useQuery();
  const reportRuns = trpc.enforcementAnalytics.reportRuns.useQuery({ limit: 20 });

  const generateReport = trpc.enforcementAnalytics.generateReport.useMutation({
    onSuccess: () => { toast.success(`Annual report for ${year} generated`); reports.refetch(); reportRuns.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const [reportView, setReportView] = useState<{ year: number; format: "json" | "markdown" } | null>(null);
  const reportQuery = trpc.enforcementAnalytics.getReport.useQuery(
    { year: reportView?.year ?? year, format: reportView?.format ?? "json" },
    { enabled: reportView != null }
  );

  const refresh = () => { ttr.refetch(); deterrence.refetch(); collection.refetch(); sectors.refetch(); reports.refetch(); reportRuns.refetch(); };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Enforcement Analytics" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6" /> Enforcement Analytics</h1>
        <div className="flex gap-2 items-end">
          <div>
            <Label htmlFor="ea-year">Year</Label>
            <Input id="ea-year" type="number" min={2020} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" />
          </div>
          <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4" /></Button>
          <Button onClick={() => generateReport.mutate({ year })} disabled={generateReport.isPending}>
            {generateReport.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
            Generate annual report
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-lg">Time to resolution — {year}</CardTitle></CardHeader>
          <CardContent><MetricGrid data={ttr.data as any} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-lg">Deterrence metrics — {year}</CardTitle></CardHeader>
          <CardContent><MetricGrid data={deterrence.data as any} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-lg">Penalty collection — {year}</CardTitle></CardHeader>
          <CardContent><MetricGrid data={collection.data as any} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-lg">Sector breakdown — {year}</CardTitle></CardHeader>
          <CardContent><GenericTable rows={((sectors.data as any[]) ?? []) as Array<Record<string, unknown>>} /></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Annual report snapshots</CardTitle>
          <CardDescription>Deterministic, source-hashed annual reports (regenerating the same year from unchanged data reproduces the same hash).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead><TableHead>Source hash</TableHead><TableHead>Trigger</TableHead>
                <TableHead>Generated by</TableHead><TableHead>Generated at</TableHead><TableHead className="text-right">Export</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {((reports.data as any[]) ?? []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.report_year}</TableCell>
                  <TableCell className="font-mono text-xs">{String(r.source_hash ?? "").slice(0, 16)}…</TableCell>
                  <TableCell><Badge variant="outline">{r.trigger}</Badge></TableCell>
                  <TableCell className="text-sm">{r.generated_by}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.generated_at ? new Date(r.generated_at).toLocaleString() : "—"}</TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="sm" variant="outline" onClick={() => setReportView({ year: r.report_year, format: "markdown" })}>View</Button>
                  </TableCell>
                </TableRow>
              ))}
              {((reports.data as any[]) ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No report snapshots yet — generate one above.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>

          {reportView && reportQuery.data && (
            <div className="border rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-medium">Report {reportView.year}</h3>
                <div className="space-x-2">
                  <Button
                    size="sm" variant="outline"
                    onClick={() => {
                      const d: any = reportQuery.data;
                      const content = d.markdown ?? JSON.stringify(d.payload ?? d, null, 2);
                      const blob = new Blob([content], { type: d.markdown ? "text/markdown" : "application/json" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `ndpc-annual-report-${reportView.year}.${d.markdown ? "md" : "json"}`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                  ><Download className="h-3 w-3 mr-1" /> Download</Button>
                  <Button size="sm" variant="ghost" onClick={() => setReportView(null)}>Close</Button>
                </div>
              </div>
              <pre className="text-xs font-mono whitespace-pre-wrap max-h-96 overflow-y-auto">
                {(reportQuery.data as any).markdown ?? JSON.stringify((reportQuery.data as any).payload, null, 2)}
              </pre>
            </div>
          )}

          <div>
            <p className="text-sm font-medium mb-1">Generation runs</p>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Year</TableHead><TableHead>Trigger</TableHead><TableHead>By</TableHead><TableHead>At</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {((reportRuns.data as any[]) ?? []).map((r: any, i: number) => (
                  <TableRow key={r.id ?? i}>
                    <TableCell className="font-mono">{r.report_year}</TableCell>
                    <TableCell>{r.trigger}</TableCell>
                    <TableCell>{r.generated_by}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.generated_at ? new Date(r.generated_at).toLocaleString() : "—"}</TableCell>
                  </TableRow>
                ))}
                {((reportRuns.data as any[]) ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No runs recorded.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
