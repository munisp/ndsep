import { toast } from "sonner";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileText, AlertTriangle, Database } from "lucide-react";


function downloadContent(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AuditExport() {
  

  // Audit logs export
  const [logStart, setLogStart] = useState(new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0]);
  const [logEnd, setLogEnd] = useState(new Date().toISOString().split("T")[0]);
  const [logFormat, setLogFormat] = useState<"json" | "csv">("csv");
  const [logResource, setLogResource] = useState("");
  const [logLimit, setLogLimit] = useState(1000);

  // Violations export
  const [vStart, setVStart] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0]);
  const [vEnd, setVEnd] = useState(new Date().toISOString().split("T")[0]);
  const [vSector, setVSector] = useState("");

  // Leaderboard export
  const [lbSector, setLbSector] = useState("");
  const [lbMinScore, setLbMinScore] = useState(0);

  const exportLogs = trpc.auditExport.exportAuditLogs.useQuery(
    { startDate: logStart, endDate: logEnd, format: logFormat, resourceType: logResource || undefined, limit: logLimit },
    { enabled: false }
  );

  const exportViolations = trpc.auditExport.exportViolations.useQuery(
    { startDate: vStart, endDate: vEnd, sector: vSector || undefined },
    { enabled: false }
  );

  const exportLeaderboard = trpc.leaderboardExport.exportCsv.useQuery(
    { sector: lbSector || undefined, minScore: lbMinScore || undefined },
    { enabled: false }
  );

  const handleExportLogs = async () => {
    const result = await exportLogs.refetch();
    if (result.data) {
      const { content, format, rowCount } = result.data;
      downloadContent(
        format === "csv" ? (content ?? "") : JSON.stringify((result.data as any).rows ?? [], null, 2),
        `audit-logs-${logStart}-${logEnd}.${format}`,
        format === "csv" ? "text/csv" : "application/json"
      );
      toast.success(`Exported ${rowCount} audit log entries`);
    }
  };

  const handleExportViolations = async () => {
    const result = await exportViolations.refetch();
    if (result.data) {
      downloadContent(result.data.content, `violations-${vStart}-${vEnd}.csv`, "text/csv");
      toast.success(`Exported ${result.data.rowCount} violation records`);
    }
  };

  const handleExportLeaderboard = async () => {
    const result = await exportLeaderboard.refetch();
    if (result.data) {
      downloadContent(result.data.content, `compliance-leaderboard-${new Date().toISOString().split("T")[0]}.csv`, "text/csv");
      toast.success(`Exported ${result.data.rowCount} organisations`);
    }
  };

  return (
    <>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Download className="h-6 w-6 text-blue-600" />
            Audit & Data Export
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Export platform data for external reporting, compliance audits, and regulatory submissions
          </p>
        </div>

        {/* Audit Logs Export */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4" />
              Audit Logs Export
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label className="text-xs">Start Date</Label>
                <Input type="date" value={logStart} onChange={(e) => setLogStart(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">End Date</Label>
                <Input type="date" value={logEnd} onChange={(e) => setLogEnd(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Format</Label>
                <Select value={logFormat} onValueChange={(v) => setLogFormat(v as "json" | "csv")}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">CSV</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Max Records</Label>
                <Select value={String(logLimit)} onValueChange={(v) => setLogLimit(Number(v))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="500">500</SelectItem>
                    <SelectItem value="1000">1,000</SelectItem>
                    <SelectItem value="5000">5,000</SelectItem>
                    <SelectItem value="10000">10,000</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Resource Type (optional)</Label>
              <Input
                placeholder="e.g. breach_incident, organization, user…"
                value={logResource}
                onChange={(e) => setLogResource(e.target.value)}
                className="mt-1 max-w-xs"
              />
            </div>
            <Button onClick={handleExportLogs} disabled={exportLogs.isFetching} className="gap-2">
              <Download className="h-4 w-4" />
              {exportLogs.isFetching ? "Exporting…" : "Export Audit Logs"}
            </Button>
          </CardContent>
        </Card>

        {/* Violations Export */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Compliance Violations Export (CSV)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <Label className="text-xs">Start Date</Label>
                <Input type="date" value={vStart} onChange={(e) => setVStart(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">End Date</Label>
                <Input type="date" value={vEnd} onChange={(e) => setVEnd(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Sector (optional)</Label>
                <Input
                  placeholder="e.g. finance, health…"
                  value={vSector}
                  onChange={(e) => setVSector(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
            <Button onClick={handleExportViolations} disabled={exportViolations.isFetching} className="gap-2">
              <Download className="h-4 w-4" />
              {exportViolations.isFetching ? "Exporting…" : "Export Violations"}
            </Button>
          </CardContent>
        </Card>

        {/* Leaderboard Export */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Compliance Leaderboard Export (CSV)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <Label className="text-xs">Sector (optional)</Label>
                <Input
                  placeholder="e.g. finance, health…"
                  value={lbSector}
                  onChange={(e) => setLbSector(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Min Compliance Score</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={lbMinScore}
                  onChange={(e) => setLbMinScore(Number(e.target.value))}
                  className="mt-1"
                />
              </div>
            </div>
            <Button onClick={handleExportLeaderboard} disabled={exportLeaderboard.isFetching} className="gap-2">
              <Download className="h-4 w-4" />
              {exportLeaderboard.isFetching ? "Exporting…" : "Export Leaderboard"}
            </Button>
          </CardContent>
        </Card>

        {/* Info */}
        <Card className="border-blue-500/20 bg-blue-50/50">
          <CardContent className="pt-4 text-sm text-blue-800">
            <p className="font-semibold mb-1">Export Notes</p>
            <ul className="list-disc list-inside space-y-1 text-blue-700">
              <li>All exports are generated in real-time from the live database.</li>
              <li>CSV exports are UTF-8 encoded and compatible with Microsoft Excel and Google Sheets.</li>
              <li>JSON exports include full record metadata and are suitable for API integrations.</li>
              <li>Exports are subject to your role permissions — admin exports include all records.</li>
              <li>For NDPC regulatory submissions, use the Audit Returns section for official formatted reports.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
