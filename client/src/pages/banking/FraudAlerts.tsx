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
import { Plus, Search, Shield, AlertTriangle, CheckCircle, Lock } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-500/15 text-red-600 dark:text-red-400",
  investigating: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  resolved: "bg-green-500/15 text-green-600 dark:text-green-400",
  false_positive: "bg-muted text-foreground",
  escalated: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
};

const ALERT_TYPES = [
  "velocity_breach","unusual_amount","geo_anomaly","device_fingerprint",
  "account_takeover","synthetic_identity","card_not_present","social_engineering",
  "insider_threat","ml_anomaly",
] as const;

export default function FraudAlerts() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    bankId: "", transactionRef: "", transactionAmount: "",
    accountNumber: "", alertType: "velocity_breach" as typeof ALERT_TYPES[number],
    riskScore: "75", mlModel: "", mlConfidence: "", ruleTriggered: "",
  });

  const { data: stats } = trpc.banking.fraud.stats.useQuery();
  const { data, isLoading, refetch } = trpc.banking.fraud.list.useQuery({
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    alertType: typeFilter !== "all" ? typeFilter : undefined,
    page, limit: 20,
  });

  const createMutation = trpc.banking.fraud.create.useMutation({
    onSuccess: (r) => {
      toast.success(`Fraud alert created — ${r.alertRef}`, {
        description: r.autoBlocked ? "⚠️ Account automatically blocked (risk score ≥ 90)" : "Alert created successfully",
      });
      setCreateOpen(false);
      setForm({ bankId: "", transactionRef: "", transactionAmount: "", accountNumber: "", alertType: "velocity_breach", riskScore: "75", mlModel: "", mlConfidence: "", ruleTriggered: "" });
      refetch();
    },
    onError: (e: { message: string }) => toast.error("Failed to create alert", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const updateMutation = trpc.banking.fraud.investigate.useMutation({
    onSuccess: () => { toast.success("Alert status updated"); refetch(); },
    onError: (e: { message: string }) => toast.error("Update failed", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const rows = (data?.rows ?? []) as any[];
  const total = data?.total ?? 0;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Banking", href: "/banking" }, { label: "Fraud Alerts" }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fraud Alerts</h1>
          <p className="text-sm text-muted-foreground mt-1">Real-time fraud detection — ML anomaly detection, velocity checks, geo-anomaly analysis</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-red-600 hover:bg-red-700"><Plus className="h-4 w-4" />Create Alert</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Fraud Alert</DialogTitle></DialogHeader>
            <p className="text-xs text-red-600 bg-red-50 p-2 rounded">CBN Rule: Risk score ≥ 90 triggers automatic account block per CBN Fraud Management Framework.</p>
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="space-y-1">
                <Label>Alert Type *</Label>
                <Select value={form.alertType} onValueChange={v => setForm(f => ({ ...f, alertType: v as typeof ALERT_TYPES[number] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALERT_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Risk Score (0-100) *</Label>
                <Input type="number" min="0" max="100" placeholder="75" value={form.riskScore}
                  onChange={e => setForm(f => ({ ...f, riskScore: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Account Number</Label>
                <Input placeholder="0123456789" value={form.accountNumber}
                  onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Transaction Amount (₦)</Label>
                <Input type="number" placeholder="500000" value={form.transactionAmount}
                  onChange={e => setForm(f => ({ ...f, transactionAmount: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Transaction Ref</Label>
                <Input placeholder="TXN-2026-001" value={form.transactionRef}
                  onChange={e => setForm(f => ({ ...f, transactionRef: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>ML Model</Label>
                <Input placeholder="xgboost-v2.1" value={form.mlModel}
                  onChange={e => setForm(f => ({ ...f, mlModel: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>ML Confidence (%)</Label>
                <Input type="number" min="0" max="100" placeholder="92" value={form.mlConfidence}
                  onChange={e => setForm(f => ({ ...f, mlConfidence: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Rule Triggered</Label>
                <Input placeholder="VELOCITY_5MIN_RULE" value={form.ruleTriggered}
                  onChange={e => setForm(f => ({ ...f, ruleTriggered: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                className="bg-red-600 hover:bg-red-700"
                onClick={() => createMutation.mutate({
                  alertType: form.alertType,
                  riskScore: parseInt(form.riskScore),
                  bankId: form.bankId ? parseInt(form.bankId) : undefined,
                  transactionRef: form.transactionRef || undefined,
                  transactionAmount: form.transactionAmount ? parseFloat(form.transactionAmount) : undefined,
                  accountNumber: form.accountNumber || undefined,
                  mlModel: form.mlModel || undefined,
                  mlConfidence: form.mlConfidence ? parseFloat(form.mlConfidence) : undefined,
                  ruleTriggered: form.ruleTriggered || undefined,
                })}
                disabled={!form.riskScore || createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create Alert"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Alerts", value: (stats as any).total ?? 0, icon: Shield, color: "text-muted-foreground" },
            { label: "Open", value: (stats as any).open ?? 0, icon: AlertTriangle, color: "text-red-600" },
            { label: "Investigating", value: (stats as any).investigating ?? 0, icon: Search, color: "text-yellow-600" },
            { label: "Auto Blocked", value: (stats as any).auto_blocked ?? 0, icon: Lock, color: "text-purple-600" },
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
          <Input placeholder="Search alert ref, account, transaction..." className="pl-9"
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Alert Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {ALERT_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {["open","investigating","resolved","false_positive","escalated"].map(s => (
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
                  {["Alert Ref", "Type", "Account", "Amount", "Risk Score", "ML Model", "Status", "Blocked", "Created", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">No fraud alerts found</td></tr>
                ) : rows.map((r: any) => (
                  <tr key={r.id} className="hover:bg-muted">
                    <td className="px-4 py-3 font-mono text-xs">{r.alert_ref}</td>
                    <td className="px-4 py-3 text-xs">{r.alert_type?.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3 font-mono text-xs">{r.account_number || "—"}</td>
                    <td className="px-4 py-3 text-xs">{r.transaction_amount ? `₦${Number(r.transaction_amount).toLocaleString()}` : "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`font-bold text-sm ${r.risk_score >= 90 ? "text-red-600" : r.risk_score >= 70 ? "text-orange-500" : "text-green-600"}`}>
                        {r.risk_score}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{r.ml_model || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge className={STATUS_COLORS[r.status] || "bg-muted text-foreground"}>
                        {r.status?.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {r.blocked_at ? <Lock className="h-4 w-4 text-red-500" /> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-3">
                      {r.status === "open" && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="text-xs h-7"
                            onClick={() => updateMutation.mutate({ id: r.id, action: "start_investigation" })}>
                            Investigate
                          </Button>
                          <Button size="sm" variant="outline" className="text-xs h-7 text-green-600"
                            onClick={() => updateMutation.mutate({ id: r.id, action: "mark_false_positive" })}>
                            FP
                          </Button>
                        </div>
                      )}
                      {r.status === "investigating" && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="text-xs h-7 text-green-600"
                            onClick={() => updateMutation.mutate({ id: r.id, action: "resolve" })}>
                            Resolve
                          </Button>
                          <Button size="sm" variant="outline" className="text-xs h-7 text-purple-600"
                            onClick={() => updateMutation.mutate({ id: r.id, action: "escalate" })}>
                            Escalate
                          </Button>
                        </div>
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
