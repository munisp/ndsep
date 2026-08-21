import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus, Search, FileText, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-foreground",
  pending_review: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  submitted: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  acknowledged: "bg-green-500/15 text-green-600 dark:text-green-400",
  rejected: "bg-red-500/15 text-red-600 dark:text-red-400",
  overdue: "bg-red-500/20 text-red-600 dark:text-red-400",
};

const REPORT_TYPES = ["ctr","str","capital_adequacy","scuml_report","aml_annual","prudential_return","liquidity_return","credit_risk","operational_risk"] as const;

export default function CbnReports() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    bankId: "1", reportType: "ctr" as typeof REPORT_TYPES[number],
    reportingPeriod: "", filingDeadline: "",
    totalTransactions: "", totalAmount: "", preparedBy: "",
  });

  const { data: stats } = trpc.banking.cbnReports.stats.useQuery();
  const { data, isLoading, refetch } = trpc.banking.cbnReports.list.useQuery({
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    reportType: typeFilter !== "all" ? typeFilter : undefined,
    page, limit: 20,
  });

  const createMutation = trpc.banking.cbnReports.create.useMutation({
    onSuccess: (r: { success: boolean; reportRef: string }) => {
      toast.success(`CBN Report created — ${r.reportRef}`, {
        description: "Report created. Submit to CBN when ready.",
      });
      setCreateOpen(false);      setForm({ bankId: "1", reportType: "ctr", reportingPeriod: "", filingDeadline: "", totalTransactions: "", totalAmount: "", preparedBy: "" });
      refetch();
    },
    onError: (e: { message: string }) => toast.error("Failed to create report", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const submitMutation = trpc.banking.cbnReports.submit.useMutation({
    onSuccess: () => { toast.success("Report submitted to CBN"); refetch(); },
    onError: (e: { message: string }) => toast.error("Submission failed", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const rows = (data?.rows ?? []) as any[];
  const total = data?.total ?? 0;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Banking", href: "/banking" }, { label: "CBN Reports" }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">CBN Regulatory Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">Currency Transaction Reports (CTR), Suspicious Transaction Reports (STR), SAR, Prudential Returns</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" />New Report</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create CBN Report</DialogTitle></DialogHeader>
            <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">CBN Regulation: CTR must be filed within 24 hours for transactions ≥ ₦5M. STR must be filed within 48 hours of detection. Failure attracts ₦1M–₦5M fine.</p>
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="space-y-1">
                <Label>Report Type *</Label>
                <Select value={form.reportType} onValueChange={v => setForm(f => ({ ...f, reportType: v as typeof REPORT_TYPES[number] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REPORT_TYPES.map(t => <SelectItem key={t} value={t}>{t.toUpperCase()}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Filing Deadline *</Label>
                <Input type="date" value={form.filingDeadline}
                  onChange={e => setForm(f => ({ ...f, filingDeadline: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Reporting Period *</Label>
                <Input placeholder="2026-Q1" value={form.reportingPeriod}
                  onChange={e => setForm(f => ({ ...f, reportingPeriod: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Prepared By</Label>
                <Input placeholder="John Adeyemi" value={form.preparedBy}
                  onChange={e => setForm(f => ({ ...f, preparedBy: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Total Transactions</Label>
                <Input type="number" placeholder="150" value={form.totalTransactions}
                  onChange={e => setForm(f => ({ ...f, totalTransactions: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Total Amount (₦)</Label>
                <Input type="number" placeholder="50000000" value={form.totalAmount}
                  onChange={e => setForm(f => ({ ...f, totalAmount: e.target.value }))} />
              </div>

            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                onClick={() => createMutation.mutate({
                  reportType: form.reportType,
                  filingDeadline: form.filingDeadline,
                  bankId: parseInt(form.bankId) || 1,
                  reportingPeriod: form.reportingPeriod || "2026-Q1",
                  totalTransactions: form.totalTransactions ? parseInt(form.totalTransactions) : undefined,
                  totalAmount: form.totalAmount ? parseFloat(form.totalAmount) : undefined,
                  preparedBy: form.preparedBy || undefined,
                })}
                disabled={!form.reportType || !form.filingDeadline || !form.reportingPeriod || createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create Report"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Reports", value: (stats as any).total ?? 0, icon: FileText, color: "text-blue-600" },
            { label: "CTR Reports", value: (stats as any).ctr_count ?? 0, icon: CheckCircle, color: "text-green-600" },
            { label: "STR Reports", value: (stats as any).str_count ?? 0, icon: AlertTriangle, color: "text-orange-600" },
            { label: "Past Deadline", value: (stats as any).past_deadline ?? 0, icon: Clock, color: "text-red-600" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <Icon className={`h-8 w-8 ${color}`} />
                  <div>
                    <p className="text-2xl font-bold">{value}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search report ref, bank name..." className="pl-9"
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Report Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {REPORT_TYPES.map(t => <SelectItem key={t} value={t}>{t.toUpperCase()}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {["draft","pending_review","submitted","acknowledged","rejected","overdue"].map(s => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted border-b">
                <tr>
                  {["Report Ref", "Type", "Period", "Total Txns", "Total Amount", "Suspicious", "Status", "Deadline", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No CBN reports found</td></tr>
                ) : rows.map((r: any) => {
                  const isOverdue = r.filing_deadline && new Date(r.filing_deadline) < new Date() && !["submitted","acknowledged"].includes(r.status);
                  return (
                    <tr key={r.id} className={`hover:bg-muted ${isOverdue ? "bg-red-50" : ""}`}>
                      <td className="px-4 py-3 font-mono text-xs">{r.report_ref}</td>
                      <td className="px-4 py-3"><Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400">{r.report_type?.toUpperCase()}</Badge></td>
                      <td className="px-4 py-3 text-xs">
                        {r.report_period_start ? new Date(r.report_period_start).toLocaleDateString() : "—"} –{" "}
                        {r.report_period_end ? new Date(r.report_period_end).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs">{r.total_transactions?.toLocaleString() || "—"}</td>
                      <td className="px-4 py-3 text-xs">{r.total_amount ? `₦${Number(r.total_amount).toLocaleString()}` : "—"}</td>
                      <td className="px-4 py-3 text-xs">
                        {r.suspicious_count > 0 ? (
                          <span className="text-red-600 font-medium">{r.suspicious_count}</span>
                        ) : "0"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={STATUS_COLORS[isOverdue ? "overdue" : r.status] || "bg-muted text-foreground"}>
                          {isOverdue ? "overdue" : r.status?.replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className={isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"}>
                          {r.filing_deadline ? new Date(r.filing_deadline).toLocaleDateString() : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {["draft","pending_review"].includes(r.status) && (
                          <Button size="sm" variant="outline" className="text-xs h-7"
                            onClick={() => submitMutation.mutate({ id: r.id })}>
                            Submit to CBN
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {total > 20 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-muted-foreground">Page {page} of {Math.ceil(total / 20)}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
