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
import { Plus, Search, Globe, AlertTriangle, CheckCircle } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/15 text-green-600 dark:text-green-400",
  suspended: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  terminated: "bg-red-500/15 text-red-600 dark:text-red-400",
  under_review: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
};

const RISK_COLORS: Record<string, string> = {
  low: "bg-green-500/15 text-green-600 dark:text-green-400",
  medium: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  high: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  very_high: "bg-red-500/15 text-red-600 dark:text-red-400",
};

const CURRENCIES = ["USD","EUR","GBP","JPY","CHF","CAD","AUD","CNY","NGN","ZAR","GHS","KES"] as const;
const REL_TYPES = ["nostro","vostro","loro","bilateral"] as const;

export default function CorrespondentBanks() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    bankId: "1", correspondentName: "", correspondentBic: "",
    country: "", currency: "USD" as typeof CURRENCIES[number],
    relationshipType: "nostro" as typeof REL_TYPES[number],
    nostroAccount: "", vostroAccount: "",
    dailyLimit: "", monthlyLimit: "",
    kycCompleted: false, amlRiskRating: "low" as "low"|"medium"|"high"|"very_high",
    notes: "",
  });

  const { data: stats } = trpc.banking.correspondents.stats.useQuery();
  const { data, isLoading, refetch } = trpc.banking.correspondents.list.useQuery({
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    page, limit: 20,
  });

  const createMutation = trpc.banking.correspondents.create.useMutation({
    onSuccess: () => {
      toast.success("Correspondent bank added", {
        description: form.amlRiskRating === "high" || form.amlRiskRating === "very_high"
          ? "⚠️ High-risk correspondent — enhanced due diligence required (FATF Rec. 13)"
          : "Relationship established successfully",
      });
      setCreateOpen(false);
      setForm({ bankId: "1", correspondentName: "", correspondentBic: "", country: "", currency: "USD", relationshipType: "nostro", nostroAccount: "", vostroAccount: "", dailyLimit: "", monthlyLimit: "", kycCompleted: false, amlRiskRating: "low", notes: "" });
      refetch();
    },
    onError: (e: { message: string }) => toast.error("Failed to add correspondent", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const updateMutation = trpc.banking.correspondents.updateStatus.useMutation({
    onSuccess: () => { toast.success("Status updated"); refetch(); },
    onError: (e: { message: string }) => toast.error("Update failed", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const rows = (data?.rows ?? []) as any[];
  const total = data?.total ?? 0;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Banking", href: "/banking" }, { label: "Correspondent Banks" }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Correspondent Banks</h1>
          <p className="text-sm text-muted-foreground mt-1">Nostro/Vostro relationships, FATF due diligence, AML risk ratings, daily/monthly limits</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" />Add Correspondent</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Add Correspondent Bank</DialogTitle></DialogHeader>
            <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">FATF Recommendation 13: KYC must be completed for all correspondent banks. High-risk correspondents require enhanced due diligence and senior management approval.</p>
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="space-y-1">
                <Label>Correspondent Name *</Label>
                <Input placeholder="Citibank N.A." value={form.correspondentName}
                  onChange={e => setForm(f => ({ ...f, correspondentName: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>BIC/SWIFT Code *</Label>
                <Input placeholder="CITIUS33" value={form.correspondentBic}
                  onChange={e => setForm(f => ({ ...f, correspondentBic: e.target.value.toUpperCase() }))} />
              </div>
              <div className="space-y-1">
                <Label>Country *</Label>
                <Input placeholder="US" maxLength={2} value={form.country}
                  onChange={e => setForm(f => ({ ...f, country: e.target.value.toUpperCase() }))} />
              </div>
              <div className="space-y-1">
                <Label>Currency *</Label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v as typeof CURRENCIES[number] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Relationship Type</Label>
                <Select value={form.relationshipType} onValueChange={v => setForm(f => ({ ...f, relationshipType: v as typeof REL_TYPES[number] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{REL_TYPES.map(r => <SelectItem key={r} value={r}>{r.toUpperCase()}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>AML Risk Rating</Label>
                <Select value={form.amlRiskRating} onValueChange={v => setForm(f => ({ ...f, amlRiskRating: v as "low"|"medium"|"high"|"very_high" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["low","medium","high","very_high"].map(r => <SelectItem key={r} value={r}>{r.replace("_"," ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Nostro Account</Label>
                <Input placeholder="001-234567-001" value={form.nostroAccount}
                  onChange={e => setForm(f => ({ ...f, nostroAccount: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Vostro Account</Label>
                <Input placeholder="002-345678-002" value={form.vostroAccount}
                  onChange={e => setForm(f => ({ ...f, vostroAccount: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Daily Limit (USD)</Label>
                <Input type="number" placeholder="1000000" value={form.dailyLimit}
                  onChange={e => setForm(f => ({ ...f, dailyLimit: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Monthly Limit (USD)</Label>
                <Input type="number" placeholder="20000000" value={form.monthlyLimit}
                  onChange={e => setForm(f => ({ ...f, monthlyLimit: e.target.value }))} />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input type="checkbox" id="kycCompleted" checked={form.kycCompleted}
                  onChange={e => setForm(f => ({ ...f, kycCompleted: e.target.checked }))} className="h-4 w-4" />
                <Label htmlFor="kycCompleted">KYC Completed (required for high-risk)</Label>
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Notes</Label>
                <Input placeholder="Additional due diligence notes" value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                onClick={() => createMutation.mutate({
                  bankId: parseInt(form.bankId) || 1,
                  correspondentName: form.correspondentName,
                  correspondentBic: form.correspondentBic,
                  country: form.country,
                  currency: form.currency,
                  relationshipType: form.relationshipType,
                  nostroAccount: form.nostroAccount || undefined,
                  vostroAccount: form.vostroAccount || undefined,
                  dailyLimit: form.dailyLimit ? parseFloat(form.dailyLimit) : undefined,
                  monthlyLimit: form.monthlyLimit ? parseFloat(form.monthlyLimit) : undefined,
                  kycCompleted: form.kycCompleted,
                  amlRiskRating: form.amlRiskRating,
                  notes: form.notes || undefined,
                })}
                disabled={!form.correspondentName || !form.correspondentBic || !form.country || createMutation.isPending}
              >
                {createMutation.isPending ? "Adding..." : "Add Correspondent"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Correspondents", value: (stats as any).total ?? 0, icon: Globe, color: "text-blue-600" },
            { label: "Active", value: (stats as any).active ?? 0, icon: CheckCircle, color: "text-green-600" },
            { label: "High Risk", value: (stats as any).high_risk ?? 0, icon: AlertTriangle, color: "text-orange-600" },
            { label: "KYC Pending", value: (stats as any).kyc_pending ?? 0, icon: AlertTriangle, color: "text-red-600" },
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
          <Input placeholder="Search name, BIC, country..." className="pl-9"
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={riskFilter} onValueChange={v => { setRiskFilter(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="AML Risk" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Risk</SelectItem>
            {["low","medium","high","very_high"].map(r => <SelectItem key={r} value={r}>{r.replace("_"," ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {["active","suspended","terminated","under_review"].map(s => (
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
                  {["Name", "BIC", "Country", "Currency", "Type", "AML Risk", "KYC", "Daily Limit", "Status", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">No correspondent banks found</td></tr>
                ) : rows.map((r: any) => (
                  <tr key={r.id} className="hover:bg-muted">
                    <td className="px-4 py-3 font-medium">{r.correspondent_name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{r.correspondent_bic}</td>
                    <td className="px-4 py-3 text-xs">{r.country}</td>
                    <td className="px-4 py-3 text-xs">{r.currency}</td>
                    <td className="px-4 py-3 text-xs uppercase">{r.relationship_type}</td>
                    <td className="px-4 py-3">
                      <Badge className={RISK_COLORS[r.aml_risk_rating] || "bg-muted text-foreground"}>
                        {r.aml_risk_rating?.replace("_"," ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {r.kyc_completed
                        ? <CheckCircle className="h-4 w-4 text-green-500" />
                        : <AlertTriangle className="h-4 w-4 text-orange-500" />}
                    </td>
                    <td className="px-4 py-3 text-xs">{r.daily_limit ? `$${Number(r.daily_limit).toLocaleString()}` : "—"}</td>
                    <td className="px-4 py-3">
                      <Badge className={STATUS_COLORS[r.status] || "bg-muted text-foreground"}>
                        {r.status?.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {r.status === "active" && (
                        <Button size="sm" variant="outline" className="text-xs h-7 text-yellow-600"
                          onClick={() => updateMutation.mutate({ id: r.id, status: "suspended" })}>
                          Suspend
                        </Button>
                      )}
                      {r.status === "suspended" && (
                        <Button size="sm" variant="outline" className="text-xs h-7 text-green-600"
                          onClick={() => updateMutation.mutate({ id: r.id, status: "active" })}>
                          Reactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
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
