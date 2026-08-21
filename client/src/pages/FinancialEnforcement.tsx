import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";
import { Wallet, DollarSign, AlertTriangle, CheckCircle2, Clock, TrendingUp, Plus, Zap, CheckCircle, Upload, FileSpreadsheet, AlertCircle, X, ChevronLeft, ChevronRight, Download, Gavel, Users, Loader2 } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b", completed: "#10b981", overdue: "#ef4444",
  disputed: "#8b5cf6", waived: "#6b7280", processing: "#3b82f6"
};





interface BulkRow {
  orgName: string;
  amount: number;
  currency: string;
  description: string;
  dueDate?: string;
  rowIndex: number;
  orgId: number | null;
  error: string | null;
}

export default function FinancialEnforcement() {
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState<"form" | "processing" | "success">("form");
  const [form, setForm] = useState({ organizationId: "", amount: "", currency: "USD", description: "", dueDate: "" });
  const [createdPenalty, setCreatedPenalty] = useState<any>(null);
  // Bulk import state
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkPreviewDone, setBulkPreviewDone] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ created: number; skipped: number } | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  // Bulk Issue (multi-org same penalty) state
  const [showBulkIssueModal, setShowBulkIssueModal] = useState(false);
  const [bulkIssueSelected, setBulkIssueSelected] = useState<number[]>([]);
  const [bulkIssueForm, setBulkIssueForm] = useState({ amount: "", currency: "NGN", description: "", dueDate: "" });
  const [bulkIssueResult, setBulkIssueResult] = useState<{ issued: number; failed: number } | null>(null);
  const [penaltyPage, setPenaltyPage] = useState(0);
  const PENALTY_PAGE_SIZE = 15;
  const [balanceOrgId, setBalanceOrgId] = useState<string>("");

  const { data: penalties, refetch: refetchPenalties } = trpc.financial.penalties.useQuery({ limit: 50 });
  const { data: tbBalance, isLoading: tbBalanceLoading, refetch: refetchTbBalance } = trpc.orchestration.tigerbeetleBalance.useQuery(
    { orgId: balanceOrgId },
    { enabled: balanceOrgId.length > 0, refetchInterval: 30000 }
  );
  const { data: monthlyTrendRaw } = trpc.financial.monthlyTrend.useQuery();
  const { data: ledgerTransactions } = trpc.ledger.transactions.useQuery({ limit: 20 }, { refetchInterval: 15000 });
  const { data: ledgerSummary } = trpc.ledger.summary.useQuery(undefined, { refetchInterval: 15000 });
  const { data: orgsForSelect } = trpc.financial.orgsForSelect.useQuery();
  const monthlyData = (monthlyTrendRaw ?? []).map((r: any) => ({
    month: r.month,
    issued: Number(r.issued ?? 0),
    collected: Number(r.collected ?? 0),
    overdue: Number(r.overdue ?? 0),
  }));

  const bulkImport = trpc.financial.bulkImportPenalties.useMutation({
    onSuccess: (result) => {
      if (result.preview) {
        setBulkRows(result.rows as BulkRow[]);
        setBulkPreviewDone(true);
      } else {
        setBulkResult({ created: result.created ?? 0, skipped: result.skipped ?? 0 });
        refetchPenalties();
        toast.success(`Bulk import complete: ${result.created} penalties created, ${result.skipped} skipped`);
      }
    },
    onError: (err) => toast.error("Bulk import failed: " + err.message),
  });
  const bulkIssueMutation = trpc.financial.bulkIssuePenalties.useMutation({
    onSuccess: (result) => {
      setBulkIssueResult({ issued: result.issued, failed: result.failed });
      refetchPenalties();
      toast.success(`Bulk issuance complete: ${result.issued} penalties issued`);
    },
    onError: (err) => toast.error("Bulk issuance failed: " + err.message),
  });

  function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.trim().split("\n");
      // Skip header row if present
      const dataLines = lines[0]?.toLowerCase().includes("orgname") ? lines.slice(1) : lines;
      const rows = dataLines.map((line, i) => {
        const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
        return {
          orgName: cols[0] ?? "",
          amount: parseFloat(cols[1] ?? "0") || 0,
          currency: cols[2] || "USD",
          description: cols[3] ?? "",
          dueDate: cols[4] || undefined,
        };
      }).filter(r => r.orgName && r.amount > 0 && r.description);
      if (rows.length === 0) { toast.error("No valid rows found in CSV"); return; }
      bulkImport.mutate({ rows, commit: false });
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleBulkCommit() {
    const validRows = bulkRows.filter(r => !r.error).map(r => ({
      orgName: r.orgName, amount: r.amount, currency: r.currency,
      description: r.description, dueDate: r.dueDate,
    }));
    bulkImport.mutate({ rows: validRows, commit: true });
  }

  function resetBulkModal() {
    setShowBulkModal(false);
    setBulkRows([]);
    setBulkPreviewDone(false);
    setBulkResult(null);
  }

  const createPenalty = trpc.financial.createPenalty.useMutation({
    onSuccess: (result) => {
      setCreatedPenalty(result);
      setStep("success");
      refetchPenalties();
    },
    onError: (err) => {
      setStep("form");
      toast.error("Failed to create penalty: " + err.message);
    },
  });

  function handleSubmit() {
    if (!form.organizationId || !form.amount || !form.description) {
      toast.error("Please fill in all required fields.");
      return;
    }
    setStep("processing");
    createPenalty.mutate({
      organizationId: parseInt(form.organizationId),
      amount: parseFloat(form.amount),
      currency: form.currency,
      description: form.description,
      dueDate: form.dueDate || undefined,
    });
  }

  function handleClose() {
    setShowModal(false);
    setStep("form");
    setForm({ organizationId: "", amount: "", currency: "USD", description: "", dueDate: "" });
    setCreatedPenalty(null);
  }

  const totalAmount = (penalties ?? []).reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);

  function exportPenaltiesCSV() {
    const rows = penalties ?? [];
    const header = ["Penalty ID", "Organisation", "Amount", "Currency", "Status", "Description", "Due Date", "Paid At", "Created At"];
    const lines = rows.map((p: any) => [
      `PEN-${String(p.id).padStart(6, "0")}`,
      `"${(p.organizationName ?? p.organizationId ?? "").toString().replace(/"/g, "'")}"`,
      p.amount,
      p.currency ?? "NGN",
      p.paymentStatus,
      `"${(p.description ?? "").replace(/"/g, "'")}"`,
      p.dueDate ? new Date(p.dueDate).toLocaleDateString("en-NG") : "",
      p.paidAt ? new Date(p.paidAt).toLocaleDateString("en-NG") : "",
      new Date(p.createdAt).toLocaleDateString("en-NG"),
    ].join(","));
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ndsep-penalties-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} penalties to CSV`);
  }
  const pendingAmount = (penalties ?? []).filter((p: any) => p.paymentStatus === "pending").reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
  const overdueAmount = (penalties ?? []).filter((p: any) => p.paymentStatus === "overdue").reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
  const collectedAmount = (penalties ?? []).filter((p: any) => p.paymentStatus === "completed").reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);

  const statusBreakdown = (penalties ?? []).reduce((acc: any, p: any) => {
    acc[p.paymentStatus] = (acc[p.paymentStatus] ?? 0) + 1;
    return acc;
  }, {});

  const pieData = Object.entries(statusBreakdown).map(([k, v]) => ({
    name: k.charAt(0).toUpperCase() + k.slice(1), value: v as number, color: STATUS_COLORS[k] ?? "#6b7280"
  }));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Banking", href: "/financial" }, { label: "Financial Enforcement" }]} className="mb-4" />
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="layer-badge">FINANCIAL</span>
            <span className="data-label">TigerBeetle · Mojaloop · Temporal · Go</span>
          </div>
          <h1 className="text-2xl font-bold">Financial Enforcement Loop</h1>
          <p className="text-muted-foreground mono text-sm mt-0.5">Immutable penalty ledger · Automated fine collection · Mojaloop payment switch · TigerBeetle ACID guarantees</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportPenaltiesCSV} className="flex items-center gap-2 font-mono text-xs" title="Export all penalties to CSV">
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
          <Button variant="outline" onClick={() => setShowBulkModal(true)} className="flex items-center gap-2 font-mono text-xs">
            <Upload className="w-4 h-4" />
            Bulk Import CSV
          </Button>
          <Button variant="outline" onClick={() => { setShowBulkIssueModal(true); setBulkIssueSelected([]); setBulkIssueResult(null); setBulkIssueForm({ amount: "", currency: "NGN", description: "", dueDate: "" }); }} className="flex items-center gap-2 font-mono text-xs">
            <Users className="w-4 h-4" />
            Bulk Issue
          </Button>
          <Button onClick={() => setShowModal(true)} className="flex items-center gap-2 font-mono text-xs">
            <Plus className="w-4 h-4" />
            Issue Penalty
          </Button>
        </div>
      </div>

      {/* Penalty Creation Modal */}
      <Dialog open={showModal} onOpenChange={handleClose}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm tracking-widest uppercase flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary" />
              Issue Financial Penalty
            </DialogTitle>
          </DialogHeader>

          {step === "form" && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="mono text-xs">Organization *</Label>
                  <Select value={form.organizationId} onValueChange={v => setForm(f => ({ ...f, organizationId: v }))}>
                    <SelectTrigger className="mono text-xs mt-1"><SelectValue placeholder="Select organization" /></SelectTrigger>
                    <SelectContent>
                      {(orgsForSelect ?? []).map((o: any) => (
                        <SelectItem key={o.id} value={String(o.id)} className="mono text-xs">
                          {o.name} — Risk {Number(o.riskScore ?? 0).toFixed(0)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mono text-xs">Amount *</Label>
                  <Input type="number" min="1" placeholder="250000" value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                    className="mono text-xs mt-1" />
                </div>
                <div>
                  <Label className="mono text-xs">Currency</Label>
                  <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                    <SelectTrigger className="mono text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["USD", "EUR", "GBP", "NGN", "KES", "ZAR"].map(c => (
                        <SelectItem key={c} value={c} className="mono text-xs">{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="mono text-xs">Description / Violation Reference *</Label>
                  <Textarea placeholder="Data residency violation — cross-border transfer without consent..." value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    className="mono text-xs mt-1 h-20" />
                </div>
                <div className="col-span-2">
                  <Label className="mono text-xs">Due Date (optional)</Label>
                  <Input type="date" value={form.dueDate}
                    onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                    className="mono text-xs mt-1" />
                </div>
              </div>
              <div className="bg-muted/40 rounded p-3 text-xs mono text-muted-foreground border border-border/40">
                <div className="font-semibold text-foreground mb-1">Workflow: TigerBeetle → Mojaloop → Temporal</div>
                <div>1. TigerBeetle ACID transfer record created</div>
                <div>2. Mojaloop ISO 20022 payment request initiated</div>
                <div>3. Temporal workflow tracks collection status</div>
              </div>
            </div>
          )}

          {step === "processing" && (
            <div className="py-10 flex flex-col items-center gap-4">
              <div className="relative">
                <Loader2 className="w-16 h-16 animate-spin text-primary" />
                <Zap className="w-6 h-6 text-primary absolute inset-0 m-auto" />
              </div>
              <div className="text-center">
                <div className="font-mono text-sm font-semibold">Processing Penalty</div>
                <div className="text-xs text-muted-foreground mono mt-1">Writing to TigerBeetle ledger...</div>
                <div className="text-xs text-muted-foreground mono">Initiating Mojaloop transfer...</div>
                <div className="text-xs text-muted-foreground mono">Registering Temporal workflow...</div>
              </div>
            </div>
          )}

          {step === "success" && createdPenalty && (
            <div className="py-6 space-y-4">
              <div className="flex flex-col items-center gap-2 mb-4">
                <CheckCircle className="w-12 h-12 text-green-500" />
                <div className="font-mono text-sm font-semibold text-green-600">Penalty Issued Successfully</div>
              </div>
              <div className="bg-muted/40 rounded p-4 space-y-2 text-xs mono border border-border/40">
                <div className="flex justify-between"><span className="text-muted-foreground">Penalty ID</span><span className="font-semibold">PEN-{String(createdPenalty.id).padStart(4, "0")}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-semibold text-primary">${Number(createdPenalty.amount ?? 0).toLocaleString()} {createdPenalty.currency}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">TigerBeetle ID</span><span className="font-semibold truncate max-w-[200px]">{createdPenalty.tigerBeetleTransferId}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Mojaloop Ref</span><span className="font-semibold truncate max-w-[200px]">{createdPenalty.mojaloopTransferId}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Status</span><Badge variant="outline" className="mono text-[9px] text-amber-500 border-amber-500/40">PENDING</Badge></div>
              </div>
            </div>
          )}

          <DialogFooter>
            {step === "form" && (
              <>
                <Button variant="outline" onClick={handleClose} className="mono text-xs">Cancel</Button>
                <Button onClick={handleSubmit} className="mono text-xs">Issue Penalty</Button>
              </>
            )}
            {step === "success" && (
              <Button onClick={handleClose} className="mono text-xs w-full">Close</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Import CSV Modal */}
      <Dialog open={showBulkModal} onOpenChange={resetBulkModal}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm tracking-widest uppercase flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-primary" />
              Bulk Penalty Import
            </DialogTitle>
          </DialogHeader>

          {!bulkPreviewDone && !bulkResult && (
            <div className="space-y-4">
              <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
                <p className="text-sm font-medium mb-2">CSV Format</p>
                <p className="text-xs text-muted-foreground font-mono">orgName, amount, currency, description, dueDate(optional)</p>
                <p className="text-xs text-muted-foreground mt-1">Example: First Bank Nigeria, 50000, USD, NDPR Article 2.3 violation, 2026-04-30</p>
              </div>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleCsvUpload}
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="font-mono text-xs"
                  onClick={() => {
                    const template = "orgName,amount,currency,description,dueDate\nFirst Bank Nigeria,50000,USD,NDPR Article 2.3 violation,2026-04-30\nGTBank,25000,USD,Data residency non-compliance,2026-05-15";
                    const blob = new Blob([template], { type: "text/csv" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = "ndsep-penalty-import-template.csv"; a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />
                  Download Template
                </Button>
              </div>
              <Button
                onClick={() => csvInputRef.current?.click()}
                disabled={bulkImport.isPending}
                className="w-full font-mono text-xs"
              >
                {bulkImport.isPending ? (
                  <><span className="animate-spin mr-2">⟳</span> Validating...</>
                ) : (
                  <><Upload className="w-4 h-4 mr-2" /> Select CSV File</>
                )}
              </Button>
            </div>
          )}

          {bulkPreviewDone && !bulkResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="text-green-600 font-medium">{bulkRows.filter(r => !r.error).length} valid rows</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <AlertCircle className="w-4 h-4 text-red-500" />
                  <span className="text-red-600 font-medium">{bulkRows.filter(r => r.error).length} errors</span>
                </div>
              </div>
              <div className="border border-border/50 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-mono">#</th>
                      <th className="px-3 py-2 text-left font-mono">Org Name</th>
                      <th className="px-3 py-2 text-right font-mono">Amount</th>
                      <th className="px-3 py-2 text-left font-mono">Description</th>
                      <th className="px-3 py-2 text-left font-mono">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkRows.map(row => (
                      <tr key={row.rowIndex} className={`border-t border-border/30 ${row.error ? "bg-red-500/5" : "bg-green-500/5"}`}>
                        <td className="px-3 py-2 font-mono text-muted-foreground">{row.rowIndex}</td>
                        <td className="px-3 py-2">{row.orgName}</td>
                        <td className="px-3 py-2 text-right font-mono">${row.amount.toLocaleString()} {row.currency}</td>
                        <td className="px-3 py-2 text-muted-foreground truncate max-w-[160px]">{row.description}</td>
                        <td className="px-3 py-2">
                          {row.error
                            ? <span className="text-red-500 flex items-center gap-1"><X className="w-3 h-3" />{row.error}</span>
                            : <span className="text-green-600 flex items-center gap-1"><CheckCircle className="w-3 h-3" />Ready</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={resetBulkModal} className="font-mono text-xs">Cancel</Button>
                <Button
                  onClick={handleBulkCommit}
                  disabled={bulkImport.isPending || bulkRows.filter(r => !r.error).length === 0}
                  className="font-mono text-xs"
                >
                  {bulkImport.isPending ? "Importing..." : `Commit ${bulkRows.filter(r => !r.error).length} Penalties`}
                </Button>
              </DialogFooter>
            </div>
          )}

          {bulkResult && (
            <div className="space-y-4 text-center py-4">
              <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              </div>
              <h3 className="font-bold text-lg">Import Complete</h3>
              <div className="flex justify-center gap-8">
                <div>
                  <p className="text-2xl font-bold text-green-600">{bulkResult.created}</p>
                  <p className="text-xs text-muted-foreground">Penalties Created</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-muted-foreground">{bulkResult.skipped}</p>
                  <p className="text-xs text-muted-foreground">Rows Skipped</p>
                </div>
              </div>
              <Button onClick={resetBulkModal} className="font-mono text-xs">Close</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Penalties", value: `$${(totalAmount / 1e6).toFixed(1)}M`, icon: DollarSign, color: "#2563eb" },
          { label: "Collected", value: `$${(collectedAmount / 1e6).toFixed(1)}M`, icon: CheckCircle2, color: "#10b981" },
          { label: "Pending", value: `$${(pendingAmount / 1e6).toFixed(1)}M`, icon: Clock, color: "#f59e0b" },
          { label: "Overdue", value: `$${(overdueAmount / 1e6).toFixed(1)}M`, icon: AlertTriangle, color: "#ef4444" },
        ].map((m) => (
          <Card key={m.label} className="border border-border/60 relative overflow-hidden">
            <div className="absolute inset-0 blueprint-grid opacity-20" />
            <CardContent className="relative p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="data-label">{m.label}</p>
                  <p className="metric-value text-2xl font-bold mt-1">{m.value}</p>
                </div>
                <m.icon className="h-6 w-6 opacity-60" style={{ color: m.color }} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Collection Rate */}
      <Card className="border border-border/60">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">Collection Rate</span>
            <span className="mono text-sm font-bold text-green-600">{totalAmount > 0 ? ((collectedAmount / totalAmount) * 100).toFixed(1) : 0}%</span>
          </div>
          <Progress value={totalAmount > 0 ? (collectedAmount / totalAmount) * 100 : 0} className="h-2" />
          <div className="flex justify-between mt-1">
            <span className="data-label">$0</span>
            <span className="data-label">${(totalAmount / 1e6).toFixed(1)}M total issued</span>
          </div>
        </CardContent>
      </Card>

      {/* Monthly Chart + Status Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Monthly Penalty Collection (6-month)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyData} barSize={18}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                <YAxis tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }} tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`} />
                <Tooltip contentStyle={{ fontSize: 11, fontFamily: "JetBrains Mono", background: "var(--card)", border: "1px solid var(--border)" }} formatter={(v: any) => `$${Number(v).toLocaleString()}`} />
                <Bar dataKey="issued" fill="#2563eb" name="Issued" radius={[3, 3, 0, 0]} />
                <Bar dataKey="collected" fill="#10b981" name="Collected" radius={[3, 3, 0, 0]} />
                <Bar dataKey="overdue" fill="#ef4444" name="Overdue" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Payment Status</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={150}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={3}>
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11, fontFamily: "JetBrains Mono", background: "var(--card)", border: "1px solid var(--border)" }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1">
              {pieData.map((item) => (
                <div key={item.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                    <span className="data-label">{item.name}</span>
                  </div>
                  <span className="mono text-xs font-semibold">{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* TigerBeetle Live Balance Panel */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">TigerBeetle Live Balance Probe</CardTitle>
            <span className="layer-badge">TIGERBEETLE · DOUBLE-ENTRY</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs data-label mb-1 block">Organisation ID</Label>
              <div className="flex gap-2">
                <Select value={balanceOrgId} onValueChange={setBalanceOrgId}>
                  <SelectTrigger className="font-mono text-xs h-8">
                    <SelectValue placeholder="Select organisation..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(orgsForSelect ?? []).map((o: any) => (
                      <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="font-mono text-xs h-8" onClick={() => refetchTbBalance()} disabled={!balanceOrgId || tbBalanceLoading}>
                  {tbBalanceLoading ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Loading</> : "Refresh"}
                </Button>
              </div>
            </div>
          </div>
          {balanceOrgId && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {tbBalance ? (
                <>
                  <div className="bg-muted/30 rounded p-3">
                    <div className="data-label text-xs mb-1">Total Debits (Penalties)</div>
                    <div className="mono font-bold text-red-500">${Number((tbBalance as any)?.totalDebits ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="bg-muted/30 rounded p-3">
                    <div className="data-label text-xs mb-1">Total Credits (Payments)</div>
                    <div className="mono font-bold text-green-500">${Number((tbBalance as any)?.totalCredits ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="bg-muted/30 rounded p-3">
                    <div className="data-label text-xs mb-1">Net Liability</div>
                    <div className="mono font-bold text-yellow-500">${Number((tbBalance as any)?.netBalance ?? (tbBalance as any)?.balance ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="bg-muted/30 rounded p-3">
                    <div className="data-label text-xs mb-1">Ledger Status</div>
                    <div className="mono font-bold text-primary">{(tbBalance as any)?.currency ?? "USD"} · {(tbBalance as any)?.status ?? "ACTIVE"}</div>
                  </div>
                </>
              ) : (
                <div className="col-span-4 text-xs text-muted-foreground mono py-2">
                  {tbBalanceLoading ? "Querying TigerBeetle ledger..." : "TigerBeetle service unreachable — balance unavailable"}
                </div>
              )}
            </div>
          )}
          {!balanceOrgId && (
            <p className="text-xs text-muted-foreground mono">Select an organisation above to query its live double-entry balance from TigerBeetle.</p>
          )}
        </CardContent>
      </Card>

      {/* TigerBeetle Ledger */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">TigerBeetle Immutable Ledger</CardTitle>
            <div className="flex items-center gap-2">
              <span className="layer-badge">TIGERBEETLE · ACID</span>
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span className="data-label text-green-600">LEDGER HEALTHY</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  {["Entry ID", "Type", "Account", "Amount", "Currency", "Timestamp", "Status"].map(h => (
                    <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!ledgerTransactions || (ledgerTransactions as any[]).length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground text-xs">Rust Financial Ledger worker is generating transactions...</td></tr>
                ) : (
                  (ledgerTransactions as any[]).map((entry: any) => (
                    <tr key={entry.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 mono font-semibold text-primary">{entry.transaction_id ?? `TX-${entry.id}`}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className="mono text-[9px]" style={{ color: entry.tx_type === "penalty" ? "#ef4444" : "#10b981", borderColor: entry.tx_type === "penalty" ? "#ef444440" : "#10b98140" }}>
                          {(entry.tx_type ?? "tx").toUpperCase()}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 mono text-muted-foreground">{entry.debit_account ?? entry.organization_name ?? "—"}</td>
                      <td className="px-4 py-2.5 mono font-semibold">${Number(entry.amount ?? 0).toLocaleString()}</td>
                      <td className="px-4 py-2.5 mono text-muted-foreground">{entry.currency ?? "USD"}</td>
                      <td className="px-4 py-2.5 mono text-muted-foreground">{entry.created_at ? new Date(entry.created_at).toLocaleString() : "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className={`mono text-[10px] font-semibold ${entry.status === "settled" ? "text-green-600" : entry.status === "failed" ? "text-red-500" : "text-yellow-500"}`}>{(entry.status ?? "pending").toUpperCase()}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Penalties Table */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Penalty Register</CardTitle>
            <div className="flex items-center gap-2">
              <span className="layer-badge">MOJALOOP · ISO 20022</span>
              <span className="data-label">{penalties?.length ?? 0} cases</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  {["Penalty ID", "Organization", "Amount", "Description", "Status", "Due Date", "Mojaloop Ref"].map(h => (
                    <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(penalties ?? []).slice(penaltyPage * PENALTY_PAGE_SIZE, (penaltyPage + 1) * PENALTY_PAGE_SIZE).map((p: any) => (
                  <tr key={p.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 mono font-semibold text-primary">PEN-{String(p.id).padStart(4, "0")}</td>
                    <td className="px-4 py-2.5 mono font-medium">{p.organizationName ?? `Org #${p.organizationId}`}</td>
                    <td className="px-4 py-2.5 mono font-semibold">${Number(p.amount ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 mono text-muted-foreground max-w-[180px] truncate">{p.description ?? `Viol #${p.violationId}`}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="mono text-[9px] capitalize" style={{ borderColor: (STATUS_COLORS[p.paymentStatus] ?? "#6b7280") + "60", color: STATUS_COLORS[p.paymentStatus] ?? "#6b7280" }}>
                        {p.paymentStatus?.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 mono text-muted-foreground">{p.dueDate ? new Date(p.dueDate).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-2.5 mono text-[10px] text-muted-foreground">{p.mojaloopTransferId?.substring(0, 16) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(penalties ?? []).length > PENALTY_PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
              <span className="data-label">Showing {penaltyPage * PENALTY_PAGE_SIZE + 1}–{Math.min((penaltyPage + 1) * PENALTY_PAGE_SIZE, (penalties ?? []).length)} of {(penalties ?? []).length}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPenaltyPage(p => Math.max(0, p - 1))} disabled={penaltyPage === 0}><ChevronLeft className="h-3 w-3" /></Button>
                <span className="mono text-xs">{penaltyPage + 1} / {Math.ceil((penalties ?? []).length / PENALTY_PAGE_SIZE)}</span>
                <Button variant="outline" size="sm" onClick={() => setPenaltyPage(p => Math.min(Math.ceil((penalties ?? []).length / PENALTY_PAGE_SIZE) - 1, p + 1))} disabled={penaltyPage >= Math.ceil((penalties ?? []).length / PENALTY_PAGE_SIZE) - 1}><ChevronRight className="h-3 w-3" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Penalty Appeals */}
      <AppealsSection />

      {/* Bulk Issue Penalties Modal */}
      <Dialog open={showBulkIssueModal} onOpenChange={v => { if (!v) { setShowBulkIssueModal(false); setBulkIssueResult(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm tracking-widest uppercase flex items-center gap-2">
              <Gavel className="w-4 h-4 text-primary" />
              Bulk Issue Penalties
            </DialogTitle>
          </DialogHeader>
          {bulkIssueResult ? (
            <div className="py-6 text-center space-y-3">
              <CheckCircle2 className="h-10 w-10 text-green-400 mx-auto" />
              <p className="text-sm font-semibold text-foreground">{bulkIssueResult.issued} penalties issued successfully</p>
              {bulkIssueResult.failed > 0 && <p className="text-xs text-red-400">{bulkIssueResult.failed} failed</p>}
              <Button size="sm" onClick={() => { setShowBulkIssueModal(false); setBulkIssueResult(null); }}>Close</Button>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="mono text-xs">Select Organisations <span className="text-red-400">*</span></Label>
                <div className="max-h-40 overflow-y-auto border border-border/40 rounded-lg p-2 space-y-1">
                  {(orgsForSelect as any[] ?? []).map((org: any) => (
                    <label key={org.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 px-2 py-1 rounded">
                      <input
                        type="checkbox"
                        checked={bulkIssueSelected.includes(org.id)}
                        onChange={e => setBulkIssueSelected(prev => e.target.checked ? [...prev, org.id] : prev.filter((id: number) => id !== org.id))}
                        className="h-3.5 w-3.5"
                      />
                      <span className="text-xs text-foreground">{org.name}</span>
                      {org.sector && <span className="mono text-[10px] text-muted-foreground ml-auto">{org.sector}</span>}
                    </label>
                  ))}
                </div>
                <p className="mono text-[10px] text-muted-foreground">{bulkIssueSelected.length} organisation(s) selected</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="mono text-xs">Amount <span className="text-red-400">*</span></Label>
                  <Input value={bulkIssueForm.amount} onChange={e => setBulkIssueForm(f => ({ ...f, amount: e.target.value }))} placeholder="e.g. 5000000" className="h-8 text-xs mono" type="number" min="1" />
                </div>
                <div className="space-y-1.5">
                  <Label className="mono text-xs">Currency</Label>
                  <Select value={bulkIssueForm.currency} onValueChange={v => setBulkIssueForm(f => ({ ...f, currency: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["NGN", "USD", "EUR", "GBP"].map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="mono text-xs">Description <span className="text-red-400">*</span></Label>
                <Textarea value={bulkIssueForm.description} onChange={e => setBulkIssueForm(f => ({ ...f, description: e.target.value }))} placeholder="Reason for penalty (applies to all selected orgs)..." className="text-xs min-h-[60px] resize-none" />
              </div>
              <div className="space-y-1.5">
                <Label className="mono text-xs">Due Date</Label>
                <Input value={bulkIssueForm.dueDate} onChange={e => setBulkIssueForm(f => ({ ...f, dueDate: e.target.value }))} type="date" className="h-8 text-xs mono" />
              </div>
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-950/20 p-2.5">
                <p className="text-xs text-yellow-300">Warning: This will issue a {bulkIssueForm.currency} {Number(bulkIssueForm.amount || 0).toLocaleString()} penalty to {bulkIssueSelected.length} organisation(s). Each org will receive an email notification.</p>
              </div>
            </div>
          )}
          {!bulkIssueResult && (
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setShowBulkIssueModal(false)}>Cancel</Button>
              <Button
                size="sm"
                className="gap-1"
                disabled={bulkIssueSelected.length === 0 || !bulkIssueForm.amount || !bulkIssueForm.description || bulkIssueMutation.isPending}
                onClick={() => bulkIssueMutation.mutate({
                  organizationIds: bulkIssueSelected,
                  amount: Number(bulkIssueForm.amount),
                  currency: bulkIssueForm.currency,
                  description: bulkIssueForm.description,
                  dueDate: bulkIssueForm.dueDate || undefined,
                })}
              >
                {bulkIssueMutation.isPending ? "Issuing..." : `Issue to ${bulkIssueSelected.length} Org(s)`}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AppealsSection() {
  const utils = trpc.useUtils();
  const { data: appeals = [] } = trpc.financial.appeals.useQuery();
  const [showReview, setShowReview] = useState(false);
  const [selectedAppeal, setSelectedAppeal] = useState<any>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const reviewMutation = trpc.financial.reviewAppeal.useMutation({
    onSuccess: () => { utils.financial.appeals.invalidate(); setShowReview(false); setReviewNotes(""); },
    onError: (e: any) => {},
  });
  const APPEAL_STATUS_COLORS: Record<string, string> = { pending: "#f59e0b", under_review: "#3b82f6", upheld: "#10b981", dismissed: "#ef4444" };
  return (
    <>
    <Card className="border border-border/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Penalty Appeals</CardTitle>
          <span className="data-label">{(appeals as any[]).length} appeals</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border/60 bg-muted/30">{["Appeal ID","Penalty ID","Org ID","Grounds","Status","Submitted","Action"].map(h => <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {(appeals as any[]).length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No appeals filed</td></tr>
              ) : (appeals as any[]).map((a: any) => (
                <tr key={a.id} className="border-b border-border/30 hover:bg-muted/20">
                  <td className="px-4 py-2.5 mono font-medium">#{a.id}</td>
                  <td className="px-4 py-2.5 mono">{a.penaltyId}</td>
                  <td className="px-4 py-2.5 mono">{a.organizationId}</td>
                  <td className="px-4 py-2.5 max-w-[200px] truncate">{a.groundsForAppeal}</td>
                  <td className="px-4 py-2.5"><Badge variant="outline" className="mono text-[9px] capitalize" style={{ borderColor: (APPEAL_STATUS_COLORS[a.status] ?? "#6b7280") + "60", color: APPEAL_STATUS_COLORS[a.status] ?? "#6b7280" }}>{a.status?.replace("_", " ")}</Badge></td>
                  <td className="px-4 py-2.5 mono text-muted-foreground">{a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-2.5">
                    {a.status === "pending" || a.status === "under_review" ? (
                      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => { setSelectedAppeal(a); setShowReview(true); }}>Review</Button>
                    ) : <span className="text-muted-foreground mono text-[10px]">{a.reviewedBy ? `By #${a.reviewedBy}` : "—"}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
    <Dialog open={showReview} onOpenChange={setShowReview}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-mono text-sm">Review Appeal #{selectedAppeal?.id}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="p-3 bg-muted/40 rounded text-xs mono">{selectedAppeal?.groundsForAppeal}</div>
          <div><Label className="mono text-xs">Decision</Label>
            <div className="flex gap-2 mt-1">
              <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700 text-xs" onClick={() => reviewMutation.mutate({ appealId: selectedAppeal.id, decision: "upheld", reviewNotes })} disabled={reviewMutation.isPending}>Uphold</Button>
              <Button size="sm" className="flex-1 bg-red-600 hover:bg-red-700 text-xs" onClick={() => reviewMutation.mutate({ appealId: selectedAppeal.id, decision: "dismissed", reviewNotes })} disabled={reviewMutation.isPending}>Dismiss</Button>
            </div>
          </div>
          <div><Label className="mono text-xs">Review Notes (optional)</Label><Textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} className="mt-1 text-xs" rows={3} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setShowReview(false)}>Cancel</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
