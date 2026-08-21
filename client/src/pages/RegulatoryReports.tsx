import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileDown, Filter, RefreshCw, BarChart3, AlertTriangle, DollarSign, Building2, Archive } from "lucide-react";
import { toast } from "sonner";

type ReportType = "violations" | "penalties" | "scores";

const SECTORS = ["Fintech", "Telecom", "Healthcare", "E-Commerce", "Government", "Media", "Energy", "Education", "Logistics", "Insurance"];
const SEVERITIES = ["critical", "high", "medium", "low"];
const PAYMENT_STATUSES = ["pending", "processing", "completed", "failed", "overdue"];

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map(row =>
      headers.map(h => {
        const v = row[h];
        if (v === null || v === undefined) return "";
        const s = String(v);
        return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(",")
    ),
  ];
  return lines.join("\n");
}

function downloadCSV(data: Record<string, unknown>[], filename: string) {
  const csv = toCSV(data);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function RegulatoryReports() {
  const [reportType, setReportType] = useState<ReportType>("violations");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sector, setSector] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [paymentStatus, setPaymentStatus] = useState("all");
  const [limit, setLimit] = useState(500);
  const [queryEnabled, setQueryEnabled] = useState(false);

  const violationsQuery = trpc.reports.violations.useQuery(
    {
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      sector: sector !== "all" ? sector : undefined,
      severity: severity !== "all" ? severity : undefined,
      limit,
    },
    { enabled: queryEnabled && reportType === "violations" }
  );

  const penaltiesQuery = trpc.reports.penalties.useQuery(
    {
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      sector: sector !== "all" ? sector : undefined,
      paymentStatus: paymentStatus !== "all" ? paymentStatus : undefined,
      limit,
    },
    { enabled: queryEnabled && reportType === "penalties" }
  );

  const scoresQuery = trpc.reports.complianceScores.useQuery(
    {
      sector: sector !== "all" ? sector : undefined,
      limit,
    },
    { enabled: queryEnabled && reportType === "scores" }
  );

  const activeQuery = reportType === "violations" ? violationsQuery : reportType === "penalties" ? penaltiesQuery : scoresQuery;
  const rows = (activeQuery.data ?? []) as Record<string, unknown>[];

  const generateMutation = trpc.reports.generate.useMutation({
    onSuccess: (data) => {
      toast.success(`Report generated: ${data.reportId}`);
    },
    onError: (err) => toast.error(`Generate failed: ${err.message}`),
  });

  const scheduleMutation = trpc.reports.schedule.useMutation({
    onSuccess: (data) => {
      toast.success(`Report scheduled: ${data.scheduleId} (${data.frequency})`);
    },
    onError: (err) => toast.error(`Schedule failed: ${err.message}`),
  });

  const handleGenerateReport = () => {
    const typeMap: Record<string, "violations" | "penalties" | "compliance_scores"> = {
      violations: "violations", penalties: "penalties", scores: "compliance_scores",
    };
    generateMutation.mutate({
      reportType: typeMap[reportType] ?? "violations",
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      sector: sector !== "all" ? sector : undefined,
      format: "json",
    });
  };

  const handleGenerate = () => {
    setQueryEnabled(true);
    if (activeQuery.data !== undefined) activeQuery.refetch();
  };

  const handleDownloadCSV = () => {
    if (!rows.length) { toast.error("No data to export"); return; }
    const ts = new Date().toISOString().split("T")[0];
    downloadCSV(rows, `ndsep-${reportType}-report-${ts}.csv`);
    toast.success(`Exported ${rows.length} rows as CSV`);
  };

  const handleDownloadJSON = () => {
    if (!rows.length) { toast.error("No data to export"); return; }
    const ts = new Date().toISOString().split("T")[0];
    downloadJSON(rows, `ndsep-${reportType}-report-${ts}.json`);
    toast.success(`Exported ${rows.length} rows as JSON`);
  };

  const severityColor: Record<string, string> = {
    critical: "bg-red-500/20 text-red-400",
    high: "bg-orange-500/20 text-orange-400",
    medium: "bg-yellow-500/20 text-yellow-400",
    low: "bg-green-500/20 text-green-400",
  };

  const paymentColor: Record<string, string> = {
    completed: "bg-green-500/20 text-green-400",
    pending: "bg-yellow-500/20 text-yellow-400",
    overdue: "bg-red-500/20 text-red-400",
    processing: "bg-blue-500/20 text-blue-400",
    failed: "bg-muted0/20 text-muted-foreground",
  };

  return (
    <>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Regulatory Reports</h1>
            <p className="text-muted-foreground text-sm mt-1">Generate and export compliance data for NITDA/NCC periodic submissions</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleGenerateReport} size="sm" disabled={generateMutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-foreground">
              <BarChart3 className="w-4 h-4 mr-2" /> {generateMutation.isPending ? "Generating..." : "Generate Report"}
            </Button>
            <Button onClick={() => scheduleMutation.mutate({ reportType: reportType === "scores" ? "compliance_scores" : reportType as "violations" | "penalties", frequency: "monthly", recipients: [] })} size="sm" variant="outline" disabled={scheduleMutation.isPending} className="border-purple-700 text-purple-400 hover:bg-purple-900/20">
              <Archive className="w-4 h-4 mr-2" /> Schedule Monthly
            </Button>
            <Button onClick={handleDownloadCSV} variant="outline" size="sm" disabled={!rows.length} className="border-border text-muted-foreground hover:bg-card">
              <FileDown className="w-4 h-4 mr-2" /> Export CSV
            </Button>
            <Button onClick={handleDownloadJSON} variant="outline" size="sm" disabled={!rows.length} className="border-border text-muted-foreground hover:bg-card">
              <FileDown className="w-4 h-4 mr-2" /> Export JSON
            </Button>
            <Button onClick={() => {
              const ts = new Date().toISOString().slice(0, 10);
              const allData = { violations: rows, generatedAt: ts, platform: "NDSEP", framework: "NDPR" };
              const blob = new Blob([JSON.stringify(allData, null, 2)], { type: "application/json" });
              const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ndsep-full-report-${ts}.json`; a.click();
              toast.success("Full report downloaded");
            }} variant="outline" size="sm" className="border-emerald-700 text-emerald-400 hover:bg-emerald-900/20">
              <Archive className="w-4 h-4 mr-2" /> Download All
            </Button>
          </div>
        </div>

        {/* Report Type Tabs */}
        <div className="flex gap-2">
          {([
            { key: "violations", label: "Compliance Violations", icon: AlertTriangle },
            { key: "penalties", label: "Financial Penalties", icon: DollarSign },
            { key: "scores", label: "Compliance Scores", icon: Building2 },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => { setReportType(key); setQueryEnabled(false); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                reportType === key
                  ? "bg-emerald-600 text-foreground"
                  : "bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="bg-background border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium text-foreground">Filters</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {reportType !== "scores" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">From Date</Label>
                  <Input
                    type="date"
                    value={fromDate}
                    onChange={e => setFromDate(e.target.value)}
                    className="bg-card border-border text-foreground text-sm h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">To Date</Label>
                  <Input
                    type="date"
                    value={toDate}
                    onChange={e => setToDate(e.target.value)}
                    className="bg-card border-border text-foreground text-sm h-9"
                  />
                </div>
              </>
            )}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Sector</Label>
              <Select value={sector} onValueChange={setSector}>
                <SelectTrigger className="bg-card border-border text-foreground text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="all">All Sectors</SelectItem>
                  {SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {reportType === "violations" && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Severity</Label>
                <Select value={severity} onValueChange={setSeverity}>
                  <SelectTrigger className="bg-card border-border text-foreground text-sm h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="all">All Severities</SelectItem>
                    {SEVERITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {reportType === "penalties" && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Payment Status</Label>
                <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                  <SelectTrigger className="bg-card border-border text-foreground text-sm h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="all">All Statuses</SelectItem>
                    {PAYMENT_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Max Rows</Label>
              <Select value={String(limit)} onValueChange={v => setLimit(Number(v))}>
                <SelectTrigger className="bg-card border-border text-foreground text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {[100, 250, 500, 1000].map(n => <SelectItem key={n} value={String(n)}>{n} rows</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={handleGenerate} className="bg-emerald-600 hover:bg-emerald-700 text-foreground" size="sm">
              <BarChart3 className="w-4 h-4 mr-2" /> Generate Report
            </Button>
            {queryEnabled && (
              <Button onClick={() => activeQuery.refetch()} variant="outline" size="sm" className="border-border text-muted-foreground hover:bg-card">
                <RefreshCw className="w-4 h-4 mr-2" /> Refresh
              </Button>
            )}
          </div>
        </div>

        {/* Results */}
        {activeQuery.isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Generating report…
          </div>
        )}

        {rows.length > 0 && (
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-sm text-muted-foreground font-medium">{rows.length} records</span>
              <div className="flex gap-2">
                <Button onClick={handleDownloadCSV} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-foreground h-7 text-xs">
                  <FileDown className="w-3 h-3 mr-1" /> CSV
                </Button>
                <Button onClick={handleDownloadJSON} size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-card h-7 text-xs">
                  <FileDown className="w-3 h-3 mr-1" /> JSON
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr>
                    {Object.keys(rows[0]).map(col => (
                      <th key={col} className="px-3 py-2 text-left text-muted-foreground font-medium whitespace-nowrap border-b border-border">
                        {col.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className="border-b border-border hover:bg-card/30">
                      {Object.entries(row).map(([col, val]) => (
                        <td key={col} className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                          {col === "severity" && typeof val === "string" ? (
                            <Badge className={`${severityColor[val] ?? "bg-muted0/20 text-muted-foreground"} text-xs border-0`}>{val}</Badge>
                          ) : col === "paymentStatus" && typeof val === "string" ? (
                            <Badge className={`${paymentColor[val] ?? "bg-muted0/20 text-muted-foreground"} text-xs border-0`}>{val}</Badge>
                          ) : col === "amount" && typeof val === "number" ? (
                            <span className="text-yellow-400 font-mono">${val.toLocaleString()}</span>
                          ) : col === "complianceScore" && typeof val === "number" ? (
                            <span className={val >= 80 ? "text-green-400" : val >= 60 ? "text-yellow-400" : "text-red-400"}>{val.toFixed(1)}</span>
                          ) : val instanceof Date || (typeof val === "string" && val.includes("T")) ? (
                            <span className="text-muted-foreground">{new Date(val as string).toLocaleDateString()}</span>
                          ) : val === null || val === undefined ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span>{String(val)}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {queryEnabled && !activeQuery.isLoading && rows.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            No records found for the selected filters.
          </div>
        )}

        {!queryEnabled && (
          <div className="text-center py-16 text-muted-foreground">
            <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>Select filters and click <strong className="text-muted-foreground">Generate Report</strong> to load data.</p>
          </div>
        )}
      </div>
    </>
  );
}
