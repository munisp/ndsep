import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Search, Plus, AlertTriangle, FileText, TrendingUp, Shield, Filter, X, Activity } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-500/15 text-red-600 dark:text-red-400",
  under_investigation: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  escalated: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  filed_str: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  closed_no_action: "bg-green-500/15 text-green-600 dark:text-green-400",
  closed_action_taken: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  closed: "bg-muted text-foreground",
};

const CASE_TYPES = [
  "suspicious_transaction", "pep_match", "sanctions_match", "structuring",
  "unusual_pattern", "high_risk_country", "adverse_media", "threshold_breach",
];

const STATUS_TRANSITIONS = [
  "under_investigation", "escalated", "filed_str", "closed_no_action", "closed_action_taken",
] as const;

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default function AmlCases() {
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [caseTypeFilter, setCaseTypeFilter] = useState("all");
  const [minRiskScore, setMinRiskScore] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedCase, setSelectedCase] = useState<any>(null);
  const [form, setForm] = useState({
    subjectName: "", caseType: "suspicious_transaction",
    riskScore: "50", narrative: "", transactionRef: "",
    transactionAmount: "", bankId: "",
  });

  const debouncedSearch = useDebounce(searchInput, 300);

  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter, caseTypeFilter, minRiskScore]);

  const { data: stats } = trpc.banking.aml.stats.useQuery();
  const { data, isLoading, refetch } = trpc.banking.aml.list.useQuery({
    search: debouncedSearch || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    caseType: caseTypeFilter !== "all" ? caseTypeFilter : undefined,
    minRiskScore: minRiskScore > 0 ? minRiskScore : undefined,
    page,
    limit: 20,
  });

  const createMutation = trpc.banking.aml.create.useMutation({
    onSuccess: () => {
      toast.success("AML case created");
      setCreateOpen(false);
      setForm({ subjectName: "", caseType: "suspicious_transaction", riskScore: "50", narrative: "", transactionRef: "", transactionAmount: "", bankId: "" });
      refetch();
    },
    onError: (e) => toast.error("Create failed", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const updateStatusMutation = trpc.banking.aml.updateStatus.useMutation({
    onSuccess: () => { toast.success("Case status updated"); refetch(); setSelectedCase(null); },
    onError: (e) => toast.error("Update failed", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const hasActiveFilters = statusFilter !== "all" || caseTypeFilter !== "all" || minRiskScore > 0;
  const activeFilterCount = [statusFilter !== "all", caseTypeFilter !== "all", minRiskScore > 0].filter(Boolean).length;

  const clearAllFilters = () => {
    setSearchInput(""); setStatusFilter("all"); setCaseTypeFilter("all"); setMinRiskScore(0); setPage(1);
  };

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Banking", href: "/banking" }, { label: "AML Cases" }]} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AML Cases</h1>
          <p className="text-sm text-muted-foreground mt-1">NFIU AML/CFT Guidelines 2022 — Anti-Money Laundering Monitoring</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" />New AML Case</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Create AML Case</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="col-span-2 space-y-1">
                <Label>Subject Name *</Label>
                <Input placeholder="Individual or corporate name" value={form.subjectName}
                  onChange={e => setForm(f => ({ ...f, subjectName: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Case Type *</Label>
                <Select value={form.caseType} onValueChange={v => setForm(f => ({ ...f, caseType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CASE_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Risk Score (0-100)</Label>
                <Input type="number" min="0" max="100" placeholder="50" value={form.riskScore}
                  onChange={e => setForm(f => ({ ...f, riskScore: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Transaction Ref</Label>
                <Input placeholder="TXN-2024-001" value={form.transactionRef}
                  onChange={e => setForm(f => ({ ...f, transactionRef: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Transaction Amount (kobo)</Label>
                <Input type="number" placeholder="5000000" value={form.transactionAmount}
                  onChange={e => setForm(f => ({ ...f, transactionAmount: e.target.value }))} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Narrative *</Label>
                <Textarea placeholder="Describe the suspicious activity..." rows={3} value={form.narrative}
                  onChange={e => setForm(f => ({ ...f, narrative: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={() => {
                if (!form.subjectName || !form.narrative) { toast.error("Subject name and narrative are required"); return; }
                createMutation.mutate({
                  subjectName: form.subjectName,
                  caseType: form.caseType as any,
                  riskScore: parseInt(form.riskScore) || 50,
                  narrative: form.narrative,
                  transactionRef: form.transactionRef || undefined,
                  transactionAmount: form.transactionAmount ? parseInt(form.transactionAmount) : undefined,
                  bankId: form.bankId ? parseInt(form.bankId) : undefined,
                });
              }} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create Case"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPI Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Cases", value: stats.total, icon: FileText, color: "text-blue-600" },
            { label: "Open Cases", value: stats.open_cases, icon: AlertTriangle, color: "text-red-600" },
            { label: "Escalated", value: stats.escalated, icon: TrendingUp, color: "text-orange-600" },
            { label: "STR Filed", value: stats.str_filed, icon: Shield, color: "text-purple-600" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <Icon className={`h-8 w-8 ${color}`} />
                  <div>
                    <p className="text-2xl font-bold">{value ?? 0}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Real-time Search + Filter Toggle */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          {isLoading && debouncedSearch && (
            <Activity className="absolute right-3 top-2.5 h-4 w-4 text-blue-400 animate-pulse" />
          )}
          <Input
            placeholder="Real-time search: case ref, subject name, BVN..."
            className="pl-9 pr-9"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
        </div>
        <Button
          variant={showFilters ? "default" : "outline"}
          className="gap-2 relative"
          onClick={() => setShowFilters(v => !v)}
        >
          <Filter className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </Button>
        {(searchInput || hasActiveFilters) && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters} className="gap-1 text-muted-foreground">
            <X className="h-3 w-3" /> Clear
          </Button>
        )}
      </div>

      {/* Collapsible Filter Panel */}
      {showFilters && (
        <Card className="border-blue-500/20 bg-blue-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-blue-800">Advanced Filters</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    {["open", "under_investigation", "escalated", "filed_str", "closed_no_action", "closed_action_taken"].map(s => (
                      <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Case Type</Label>
                <Select value={caseTypeFilter} onValueChange={setCaseTypeFilter}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {CASE_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Min Risk Score: <span className="font-bold text-orange-600">{minRiskScore}</span></Label>
                <input
                  type="range" min={0} max={100} step={5}
                  value={minRiskScore}
                  onChange={e => setMinRiskScore(parseInt(e.target.value))}
                  className="w-full h-2 accent-orange-500"
                />
                <div className="flex gap-1 mt-1">
                  {[0, 25, 50, 70, 85].map(v => (
                    <Button key={v} size="sm" variant={minRiskScore === v ? "default" : "outline"}
                      className="h-6 px-2 text-xs flex-1" onClick={() => setMinRiskScore(v)}>
                      {v === 0 ? "All" : `≥${v}`}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results summary */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {isLoading ? "Searching..." : `${total} case${total !== 1 ? "s" : ""} found`}
          {debouncedSearch && <span className="ml-1 text-blue-600">for "{debouncedSearch}"</span>}
          {hasActiveFilters && <span className="ml-1 text-orange-600">• filters active</span>}
        </span>
        {stats && (
          <span className="text-xs">
            Avg Risk: <span className="font-semibold text-orange-600">{stats.avg_risk_score ? parseFloat(stats.avg_risk_score).toFixed(1) : "—"}</span>
            {" · "}PEP: <span className="font-semibold text-red-600">{stats.pep_matches ?? 0}</span>
            {" · "}Sanctions: <span className="font-semibold text-red-600">{stats.sanctions_matches ?? 0}</span>
          </span>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted border-b">
                <tr>
                  {["Case Ref", "Subject", "Case Type", "Risk", "Amount", "Status", "STR", "Assigned", "Date", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <Activity className="h-4 w-4 animate-pulse text-blue-400" />
                      Searching...
                    </div>
                  </td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                    No AML cases match your search criteria
                  </td></tr>
                ) : rows.map((c: any) => (
                  <tr key={c.id} className="hover:bg-muted">
                    <td className="px-4 py-3 font-mono text-xs">{c.case_ref}</td>
                    <td className="px-4 py-3 text-xs font-medium">
                      {c.subject_name}
                      {c.pep_match ? <Badge className="ml-1 bg-red-500/15 text-red-600 dark:text-red-400 text-xs">PEP</Badge> : null}
                      {c.sanctions_match ? <Badge className="ml-1 bg-red-500/15 text-red-600 dark:text-red-400 text-xs">SANC</Badge> : null}
                    </td>
                    <td className="px-4 py-3 text-xs">{c.case_type?.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <div className={`w-2 h-2 rounded-full ${(c.risk_score || 0) >= 80 ? "bg-red-500" : (c.risk_score || 0) >= 60 ? "bg-orange-500" : (c.risk_score || 0) >= 40 ? "bg-yellow-500" : "bg-green-500"}`} />
                        <span className={`font-medium ${(c.risk_score || 0) >= 70 ? "text-red-600" : (c.risk_score || 0) >= 40 ? "text-yellow-600" : "text-green-600"}`}>
                          {c.risk_score ? parseFloat(c.risk_score).toFixed(0) : "—"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {c.transaction_amount ? `₦${(parseInt(c.transaction_amount) / 100).toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={STATUS_COLORS[c.status] || "bg-muted text-foreground"}>
                        {c.status?.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {c.str_reference ? <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400">Filed</Badge> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{c.assigned_to || "Unassigned"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {c.created_at ? new Date(c.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Button size="sm" variant="ghost" onClick={() => setSelectedCase(c)}>Review</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > 20 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-muted-foreground">Showing {((page - 1) * 20) + 1}–{Math.min(page * 20, total)} of {total}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Case Review Dialog */}
      {selectedCase && (
        <Dialog open={!!selectedCase} onOpenChange={() => setSelectedCase(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>AML Case — {selectedCase.case_ref}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {([
                  ["Subject", selectedCase.subject_name],
                  ["Case Type", selectedCase.case_type?.replace(/_/g, " ")],
                  ["Risk Score", selectedCase.risk_score ? parseFloat(selectedCase.risk_score).toFixed(1) : "—"],
                  ["Amount", selectedCase.transaction_amount ? `₦${(parseInt(selectedCase.transaction_amount) / 100).toLocaleString()}` : "—"],
                  ["PEP Match", selectedCase.pep_match ? "⚠️ YES" : "No"],
                  ["Sanctions Match", selectedCase.sanctions_match ? "🚨 YES" : "No"],
                  ["Adverse Media", selectedCase.adverse_media_match ? "YES" : "No"],
                  ["Current Status", selectedCase.status?.replace(/_/g, " ")],
                  ["Assigned To", selectedCase.assigned_to || "Unassigned"],
                  ["STR Reference", selectedCase.str_reference || "Not filed"],
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-medium">{value}</p>
                  </div>
                ))}
              </div>
              {selectedCase.narrative && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Narrative</p>
                  <p className="text-sm bg-muted p-3 rounded">{selectedCase.narrative}</p>
                </div>
              )}
              <div className="space-y-2">
                <Label>Update Status</Label>
                <div className="flex gap-2 flex-wrap">
                  {STATUS_TRANSITIONS.map(s => (
                    <Button
                      key={s}
                      size="sm"
                      variant={selectedCase.status === s ? "default" : "outline"}
                      disabled={selectedCase.status === s || updateStatusMutation.isPending}
                      onClick={() => updateStatusMutation.mutate({ id: selectedCase.id, status: s })}
                    >
                      {s.replace(/_/g, " ")}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
