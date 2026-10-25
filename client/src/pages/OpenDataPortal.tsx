import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Database, Download, Loader2 } from "lucide-react";

type DatasetKey = "sanctions_register" | "complaint_stats" | "dcpmi_registry" | "enforcement_outcomes";

function downloadBlob(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function OpenDataPortal() {
  const utils = trpc.useUtils();
  const datasets = trpc.openDataPortal.listDatasets.useQuery();
  const [year, setYear] = useState("");
  const [preview, setPreview] = useState<{ key: DatasetKey; format: "json" | "csv" } | null>(null);

  const datasetQuery = trpc.openDataPortal.getDataset.useQuery(
    {
      dataset: preview?.key ?? "sanctions_register",
      format: preview?.format ?? "json",
      year: year ? Number(year) : undefined,
    },
    { enabled: preview != null }
  );

  const handleDownload = async (key: DatasetKey, format: "json" | "csv") => {
    try {
      const data: any = await utils.openDataPortal.getDataset.fetch({
        dataset: key,
        format,
        year: year ? Number(year) : undefined,
      });
      if (!data) throw new Error("No data returned");
      const suffix = year ? `-${year}` : "";
      if (data.format === "csv") {
        downloadBlob(`${key}${suffix}-v${data.version}.csv`, data.csv, "text/csv;charset=utf-8");
      } else {
        downloadBlob(`${key}${suffix}-v${data.version}.json`, JSON.stringify(data, null, 2), "application/json");
      }
      toast.success(`${key} v${data.version} downloaded (${format.toUpperCase()})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    }
  };

  const previewData: any = preview ? datasetQuery.data : null;
  const previewRows: Array<Record<string, unknown>> = previewData?.format === "json" ? previewData.rows ?? [] : [];
  const previewCols = previewRows.length ? Object.keys(previewRows[0]) : [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-6 py-6">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Database className="h-6 w-6" /> NDPC Open Data Portal</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Anonymised aggregate datasets published by the Nigeria Data Protection Commission under NDPA 2023 transparency obligations. Free for research, journalism and civic use.
          </p>
          <div className="mt-4 max-w-xs">
            <Label htmlFor="od-year">Filter by year (optional)</Label>
            <Input id="od-year" type="number" min={2020} max={2100} value={year} onChange={(e) => setYear(e.target.value)} placeholder="all years" />
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {((datasets.data as any[]) ?? []).map((d: any) => (
            <Card key={d.dataset_key}>
              <CardHeader>
                <CardTitle className="text-lg flex items-center justify-between">
                  {d.title}
                  <Badge variant="outline">v{d.version}</Badge>
                </CardTitle>
                <CardDescription>{d.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">Updated {d.updated_at ? new Date(d.updated_at).toLocaleDateString() : "—"}</p>
                {d.published ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={datasetQuery.isFetching} onClick={() => handleDownload(d.dataset_key as DatasetKey, "csv")}>
                      <Download className="h-3 w-3 mr-1" /> CSV
                    </Button>
                    <Button size="sm" variant="outline" disabled={datasetQuery.isFetching} onClick={() => handleDownload(d.dataset_key as DatasetKey, "json")}>
                      <Download className="h-3 w-3 mr-1" /> JSON
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPreview({ key: d.dataset_key as DatasetKey, format: "json" })}>
                      Preview
                    </Button>
                  </div>
                ) : (
                  <Badge variant="outline" className="bg-muted text-muted-foreground">unpublished</Badge>
                )}
              </CardContent>
            </Card>
          ))}
          {((datasets.data as any[]) ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Dataset catalogue is empty.</p>
          )}
        </div>

        {preview && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                {datasetQuery.isFetching && <Loader2 className="h-4 w-4 animate-spin" />}
                Preview: {preview.key}
              </CardTitle>
              {previewData?.k_anonymity_threshold != null && (
                <CardDescription>k-anonymity threshold {previewData.k_anonymity_threshold} — small cells suppressed</CardDescription>
              )}
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {previewData?.format === "csv" ? (
                <pre className="text-xs font-mono whitespace-pre-wrap max-h-96 overflow-y-auto">{previewData.csv}</pre>
              ) : previewRows.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>{previewCols.map((c) => <TableHead key={c}>{c}</TableHead>)}</TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.slice(0, 50).map((r, i) => (
                      <TableRow key={i}>
                        {previewCols.map((c) => <TableCell key={c} className="text-sm">{r[c] == null ? "—" : String(r[c])}</TableCell>)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">{datasetQuery.isFetching ? "Loading…" : "No rows."}</p>
              )}
              {previewRows.length > 50 && <p className="text-xs text-muted-foreground mt-2">Showing first 50 of {previewRows.length} rows — download for the full dataset.</p>}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
