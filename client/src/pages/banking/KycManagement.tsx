import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Search, Plus, Eye, CheckCircle, AlertTriangle, Clock, Shield, Download, Filter } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  submitted: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  in_review: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  verified: "bg-green-500/15 text-green-600 dark:text-green-400",
  approved: "bg-green-500/15 text-green-600 dark:text-green-400",
  rejected: "bg-red-500/15 text-red-600 dark:text-red-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
  suspended: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  edd_required: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  expired: "bg-muted text-foreground",
};

export default function KycManagement() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [pepFilter, setPepFilter] = useState("all");
  const [sanctionsFilter, setSanctionsFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewRecord, setViewRecord] = useState<any>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [form, setForm] = useState({
    bankId: "1", fullName: "", dateOfBirth: "", bvn: "", nationality: "NG",
    nin: "", phoneNumber: "", email: "", address: "",
    tier: "tier1" as "tier1" | "tier2" | "tier3",
  });

  const { data: stats } = trpc.banking.kyc.stats.useQuery();
  const { data, isLoading, refetch } = trpc.banking.kyc.list.useQuery({
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    tier: tierFilter !== "all" ? (tierFilter as "tier1" | "tier2" | "tier3") : undefined,
    pepFlag: pepFilter === "yes" ? true : pepFilter === "no" ? false : undefined,
    sanctionsFlag: sanctionsFilter === "yes" ? true : sanctionsFilter === "no" ? false : undefined,
    page,
    limit: 20,
  });

  // CSV export query — only fires when triggered
  const exportQuery = trpc.banking.kyc.exportCsv.useQuery(
    {
      status: statusFilter !== "all" ? statusFilter : undefined,
      tier: tierFilter !== "all" ? tierFilter : undefined,
      search: search || undefined,
      pepFlag: pepFilter === "yes" ? true : pepFilter === "no" ? false : undefined,
      sanctionsFlag: sanctionsFilter === "yes" ? true : sanctionsFilter === "no" ? false : undefined,
    },
    { enabled: false }
  );

  const handleExportCsv = useCallback(async () => {
    setIsExporting(true);
    try {
      const result = await exportQuery.refetch();
      if (result.data?.csv) {
        const blob = new Blob([result.data.csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = result.data.filename ?? "kyc_export.csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success(`Exported ${result.data.count} KYC records`, {
          description: `File: ${result.data.filename}`,
        });
      }
    } catch (err) {
      toast.error("Export failed", { description: "Please try again." });
    } finally {
      setIsExporting(false);
    }
  }, [exportQuery, statusFilter, tierFilter, search, pepFilter, sanctionsFilter]);

  const createMutation = trpc.banking.kyc.create.useMutation({
    onSuccess: () => {
      toast.success("KYC record created", { description: "Verification will begin shortly." });
      setCreateOpen(false);
      setForm({ bankId: "1", fullName: "", dateOfBirth: "", bvn: "", nationality: "NG", nin: "", phoneNumber: "", email: "", address: "", tier: "tier1" });
      refetch();
    },
    onError: (e) => toast.error("Create failed", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const reviewMutation = trpc.banking.kyc.review.useMutation({
    onSuccess: () => { toast.success("KYC reviewed"); refetch(); },
    onError: (e) => toast.error("Review failed", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const handleCreate = () => {
    if (!form.fullName) { toast.error("Full name is required"); return; }
    createMutation.mutate({
      bankId: parseInt(form.bankId) || 1,
      fullName: form.fullName,
      dateOfBirth: form.dateOfBirth || undefined,
      bvn: form.bvn || undefined,
      nin: form.nin || undefined,
      phoneNumber: form.phoneNumber || undefined,
      email: form.email || undefined,
      address: form.address || undefined,
      nationality: form.nationality || undefined,
      tier: form.tier,
    });
  };

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Banking", href: "/banking" }, { label: "KYC Management" }]} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">KYC Management</h1>
          <p className="text-sm text-muted-foreground mt-1">CBN KYC Manual 2023 — Customer Due Diligence</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={handleExportCsv} disabled={isExporting}>
            <Download className="h-4 w-4" />
            {isExporting ? "Exporting..." : `Export CSV${total > 0 ? ` (${total})` : ""}`}
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="h-4 w-4" />New KYC Record</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>Create KYC Record</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                {([
                  { label: "Full Name *", key: "fullName", placeholder: "John Doe" },
                  { label: "Bank ID", key: "bankId", placeholder: "1" },
                  { label: "Date of Birth", key: "dateOfBirth", placeholder: "1990-01-15", type: "date" },
                  { label: "BVN (11 digits)", key: "bvn", placeholder: "22345678901" },
                  { label: "Nationality (ISO 2)", key: "nationality", placeholder: "NG" },
                  { label: "NIN (11 digits)", key: "nin", placeholder: "12345678901" },
                  { label: "Phone", key: "phoneNumber", placeholder: "+2348012345678" },
                  { label: "Email", key: "email", placeholder: "john@example.com" },
                ] as { label: string; key: keyof typeof form; placeholder: string; type?: string }[]).map(({ label, key, placeholder, type }) => (
                  <div key={key} className="space-y-1">
                    <Label>{label}</Label>
                    <Input type={type || "text"} placeholder={placeholder}
                      value={form[key] as string}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label>KYC Tier</Label>
                  <Select value={form.tier} onValueChange={v => setForm(f => ({ ...f, tier: v as "tier1" | "tier2" | "tier3" }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tier1">Tier 1 (Basic)</SelectItem>
                      <SelectItem value="tier2">Tier 2 (BVN Required)</SelectItem>
                      <SelectItem value="tier3">Tier 3 (Full KYC)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Address</Label>
                  <Input placeholder="123 Main St, Lagos" value={form.address}
                    onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating..." : "Create"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPI Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Records", value: stats.total, icon: Shield, color: "text-blue-600" },
            { label: "Verified", value: stats.verified, icon: CheckCircle, color: "text-green-600" },
            { label: "Pending", value: stats.pending, icon: Clock, color: "text-yellow-600" },
            { label: "PEP Flagged", value: stats.pep_flagged, icon: AlertTriangle, color: "text-red-600" },
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

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="h-4 w-4" /> Search & Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search name, BVN, NIN, ref, email..." className="pl-9"
                value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {["pending", "submitted", "in_review", "verified", "rejected", "suspended", "edd_required", "expired"].map(s => (
                  <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={tierFilter} onValueChange={v => { setTierFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Tier" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                <SelectItem value="tier1">Tier 1</SelectItem>
                <SelectItem value="tier2">Tier 2</SelectItem>
                <SelectItem value="tier3">Tier 3</SelectItem>
              </SelectContent>
            </Select>
            <Select value={pepFilter} onValueChange={v => { setPepFilter(v); setPage(1); }}>
              <SelectTrigger className="w-32"><SelectValue placeholder="PEP" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All PEP</SelectItem>
                <SelectItem value="yes">PEP Flagged</SelectItem>
                <SelectItem value="no">No PEP</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sanctionsFilter} onValueChange={v => { setSanctionsFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Sanctions" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sanctions</SelectItem>
                <SelectItem value="yes">Sanctions Match</SelectItem>
                <SelectItem value="no">No Sanctions</SelectItem>
              </SelectContent>
            </Select>
            {(search || statusFilter !== "all" || tierFilter !== "all" || pepFilter !== "all" || sanctionsFilter !== "all") && (
              <Button variant="ghost" size="sm" onClick={() => {
                setSearch(""); setStatusFilter("all"); setTierFilter("all");
                setPepFilter("all"); setSanctionsFilter("all"); setPage(1);
              }}>Clear Filters</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted border-b">
                <tr>
                  {["Ref ID", "Customer Ref", "Full Name", "BVN", "Tier", "Status", "Risk Score", "PEP", "Sanctions", "Created", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr><td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">No KYC records found</td></tr>
                ) : rows.map((r: any) => (
                  <tr key={r.id} className="hover:bg-muted">
                    <td className="px-4 py-3 font-mono text-xs">{r.reference_id}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.customer_ref || "—"}</td>
                    <td className="px-4 py-3 font-medium">{r.full_name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{r.bvn ? r.bvn.replace(/(\d{3})\d{5}(\d{3})/, "$1*****$2") : "—"}</td>
                    <td className="px-4 py-3">
                      <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400">{r.tier?.toUpperCase() || "—"}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={STATUS_COLORS[r.status] || "bg-muted text-foreground"}>
                        {r.status?.replace(/_/g, " ") || "—"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-medium ${(r.risk_score || 0) >= 70 ? "text-red-600" : (r.risk_score || 0) >= 40 ? "text-yellow-600" : "text-green-600"}`}>
                        {r.risk_score ? parseFloat(r.risk_score).toFixed(1) : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {r.pep_flag ? <Badge className="bg-red-500/15 text-red-600 dark:text-red-400">PEP</Badge> : <span className="text-muted-foreground text-xs">No</span>}
                    </td>
                    <td className="px-4 py-3">
                      {r.sanctions_flag ? <Badge className="bg-red-500/15 text-red-600 dark:text-red-400">MATCH</Badge> : <span className="text-muted-foreground text-xs">Clear</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setViewRecord(r)}>
                          <Eye className="h-3 w-3" />
                        </Button>
                        {(r.status === "pending" || r.status === "submitted") && (
                          <Button size="sm" variant="ghost" className="text-green-600"
                            onClick={() => reviewMutation.mutate({ id: r.id, action: "approve", notes: "Approved via UI" })}>
                            <CheckCircle className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > 20 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-muted-foreground">
                Showing {((page - 1) * 20) + 1}–{Math.min(page * 20, total)} of {total} records
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* View Record Dialog */}
      {viewRecord && (
        <Dialog open={!!viewRecord} onOpenChange={() => setViewRecord(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>KYC Record — {viewRecord.reference_id}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-4 text-sm">
              {([
                ["Full Name", viewRecord.full_name],
                ["Customer Ref", viewRecord.customer_ref || "—"],
                ["Date of Birth", viewRecord.date_of_birth || "—"],
                ["BVN", viewRecord.bvn || "—"],
                ["NIN", viewRecord.nin || "—"],
                ["Phone", viewRecord.phone_number || "—"],
                ["Email", viewRecord.email || "—"],
                ["KYC Tier", viewRecord.tier?.toUpperCase()],
                ["Status", viewRecord.status?.replace(/_/g, " ")],
                ["Risk Score", viewRecord.risk_score ? `${parseFloat(viewRecord.risk_score).toFixed(1)}` : "—"],
                ["PEP Flag", viewRecord.pep_flag ? "⚠️ YES" : "No"],
                ["Sanctions Flag", viewRecord.sanctions_flag ? "🚨 YES" : "Clear"],
                ["BVN Verified", viewRecord.bvn_verified ? "✓ Yes" : "No"],
                ["NIN Verified", viewRecord.nin_verified ? "✓ Yes" : "No"],
                ["Reviewed By", viewRecord.reviewed_by || "—"],
                ["Created At", viewRecord.created_at ? new Date(viewRecord.created_at).toLocaleString() : "—"],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-medium">{value}</p>
                </div>
              ))}
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">Address</p>
                <p className="font-medium">{viewRecord.address || "—"}</p>
              </div>
              {viewRecord.rejection_reason && (
                <div className="col-span-2">
                  <p className="text-xs text-red-500">Rejection Reason</p>
                  <p className="font-medium text-red-700">{viewRecord.rejection_reason}</p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t pt-3">
              {(viewRecord.status === "pending" || viewRecord.status === "submitted" || viewRecord.status === "in_review") && (
                <>
                  <Button size="sm" variant="outline" className="text-green-600 border-green-500/30"
                    onClick={() => { reviewMutation.mutate({ id: viewRecord.id, action: "approve" }); setViewRecord(null); }}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" className="text-red-600 border-red-500/30"
                    onClick={() => { reviewMutation.mutate({ id: viewRecord.id, action: "reject", notes: "Rejected via UI" }); setViewRecord(null); }}>
                    Reject
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => setViewRecord(null)}>Close</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
