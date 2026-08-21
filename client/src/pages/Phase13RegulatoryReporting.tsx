import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { FileBarChart, Plus, Search, Send, Eye } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

type ReportType = "quarterly_national" | "annual_breach" | "sector_benchmark" | "cross_border_annual" | "dsar_summary" | "enforcement_summary";

export default function Phase13RegulatoryReporting() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [submitTo, setSubmitTo] = useState("NITDA");
  const [form, setForm] = useState({
    report_name: "", report_type: "quarterly_national" as ReportType,
    reporting_period_start: "", reporting_period_end: ""
  });

  const utils = trpc.useUtils();
  const { data: reports, isLoading } = trpc.phase13.regulatoryReporting.list.useQuery({
    search: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter || undefined,
    report_type: typeFilter === "all" ? undefined : typeFilter || undefined,
  });
  const generate = trpc.phase13.regulatoryReporting.generate.useMutation({
    onSuccess: () => {
      utils.phase13.regulatoryReporting.list.invalidate();
      setOpen(false);
      toast.success("Report generated successfully");
      setForm({ report_name: "", report_type: "quarterly_national", reporting_period_start: "", reporting_period_end: "" });
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const submit = trpc.phase13.regulatoryReporting.submit.useMutation({
    onSuccess: () => {
      utils.phase13.regulatoryReporting.list.invalidate();
      setSubmitOpen(false);
      setSelectedReport(null);
      toast.success("Report submitted to regulatory authority");
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const list = (reports as any[]) ?? [];

  const statusColor: Record<string, "default" | "secondary" | "destructive"> = {
    submitted: "default",
    approved: "default",
    draft: "secondary",
    rejected: "destructive",
  };

  const reportTypeLabels: Record<string, string> = {
    quarterly_national: "Quarterly National Report",
    annual_breach: "Annual Breach Report",
    sector_benchmark: "Sector Benchmark",
    cross_border_annual: "Cross-Border Annual",
    dsar_summary: "DSAR Summary",
    enforcement_summary: "Enforcement Summary",
  };

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileBarChart className="h-6 w-6 text-emerald-600" />
              Regulatory Reporting Engine
            </h1>
            <p className="text-muted-foreground mt-1">Generate and submit NDPA compliance reports to NITDA and regulatory bodies</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Generate Report</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Generate Regulatory Report</DialogTitle></DialogHeader>
              <div className="space-y-3 mt-2">
                <Input placeholder="Report Name (e.g. Q1-2026 National Compliance Report)" value={form.report_name} onChange={e => setForm(f => ({ ...f, report_name: e.target.value }))} />
                <Select value={form.report_type} onValueChange={v => setForm(f => ({ ...f, report_type: v as ReportType }))}>
                  <SelectTrigger><SelectValue placeholder="Report Type" /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(reportTypeLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div>
                  <label className="text-sm font-medium">Reporting Period Start</label>
                  <Input type="date" value={form.reporting_period_start} onChange={e => setForm(f => ({ ...f, reporting_period_start: e.target.value }))} />
                </div>
                <div>
                  <label className="text-sm font-medium">Reporting Period End</label>
                  <Input type="date" value={form.reporting_period_end} onChange={e => setForm(f => ({ ...f, reporting_period_end: e.target.value }))} />
                </div>
                <Button className="w-full"
                  onClick={() => generate.mutate({
                    report_name: form.report_name,
                    report_type: form.report_type,
                    reporting_period_start: form.reporting_period_start,
                    reporting_period_end: form.reporting_period_end,
                  })}
                  disabled={generate.isPending || !form.report_name || !form.reporting_period_start || !form.reporting_period_end}>
                  {generate.isPending ? "Generating..." : "Generate Report"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Reports", value: list.length, color: "text-blue-600" },
            { label: "Draft", value: list.filter((r: any) => r.status === "draft").length, color: "text-orange-600" },
            { label: "Submitted", value: list.filter((r: any) => r.status === "submitted").length, color: "text-green-600" },
            { label: "Approved", value: list.filter((r: any) => r.status === "approved").length, color: "text-emerald-600" },
          ].map((card) => (
            <Card key={card.label}>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{card.label}</p>
                <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search reports..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="All Types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.entries(reportTypeLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader><CardTitle>Reports ({list.length})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading reports...</div>
            ) : list.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No regulatory reports generated yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">Report Name</th>
                      <th className="text-left py-2 px-3">Type</th>
                      <th className="text-left py-2 px-3">Period</th>
                      <th className="text-left py-2 px-3">Generated By</th>
                      <th className="text-left py-2 px-3">Status</th>
                      <th className="text-left py-2 px-3">Submitted To</th>
                      <th className="text-left py-2 px-3">Date</th>
                      <th className="text-left py-2 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r: any) => (
                      <tr key={r.id} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-medium">{r.report_name}</td>
                        <td className="py-2 px-3">
                          <Badge variant="outline" className="text-xs">{reportTypeLabels[r.report_type] ?? r.report_type}</Badge>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground text-xs">
                          {r.reporting_period_start ? new Date(r.reporting_period_start).toLocaleDateString() : "—"} — {r.reporting_period_end ? new Date(r.reporting_period_end).toLocaleDateString() : "—"}
                        </td>
                        <td className="py-2 px-3">{r.generated_by ?? "—"}</td>
                        <td className="py-2 px-3">
                          <Badge variant={statusColor[r.status] ?? "secondary"}>{r.status}</Badge>
                        </td>
                        <td className="py-2 px-3">{r.submitted_to ?? "—"}</td>
                        <td className="py-2 px-3 text-muted-foreground">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</td>
                        <td className="py-2 px-3">
                          <div className="flex gap-1">
                            {r.status === "draft" && (
                              <Button size="sm" variant="ghost" title="Submit to Authority" onClick={() => { setSelectedReport(r); setSubmitOpen(true); }}>
                                <Send className="h-3 w-3 text-green-600" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={submitOpen} onOpenChange={v => { setSubmitOpen(v); if (!v) setSelectedReport(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Submit Report to Regulatory Authority</DialogTitle></DialogHeader>
            <div className="space-y-3 mt-2">
              <p className="text-sm text-muted-foreground">Submitting: <span className="font-medium text-foreground">{selectedReport?.report_name}</span></p>
              <Select value={submitTo} onValueChange={setSubmitTo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NITDA">NITDA (National Information Technology Development Agency)</SelectItem>
                  <SelectItem value="CBN">CBN (Central Bank of Nigeria)</SelectItem>
                  <SelectItem value="NCC">NCC (Nigerian Communications Commission)</SelectItem>
                  <SelectItem value="NDPC">NDPC (Nigeria Data Protection Commission)</SelectItem>
                  <SelectItem value="SEC">SEC (Securities and Exchange Commission)</SelectItem>
                </SelectContent>
              </Select>
              <Button className="w-full"
                onClick={() => submit.mutate({ id: selectedReport.id, submitted_to: submitTo })}
                disabled={submit.isPending}>
                {submit.isPending ? "Submitting..." : `Submit to ${submitTo}`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
