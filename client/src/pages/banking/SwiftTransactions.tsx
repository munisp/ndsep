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
import { Plus, Search, Globe, TrendingUp, Clock, AlertTriangle } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-500/15 text-green-600 dark:text-green-400",
  settled: "bg-green-500/15 text-green-600 dark:text-green-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
  rejected: "bg-red-500/15 text-red-600 dark:text-red-400",
  initiated: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  pending: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  processing: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  compliance_hold: "bg-red-500/20 text-red-600 dark:text-red-400",
};

const MSG_TYPES = ["MT103","MT202","MT202COV","MT910","MT940","MT950"] as const;
const CURRENCIES = ["USD","EUR","GBP","JPY","CHF","CAD","AUD","CNY","NGN"] as const;

const fmt = (n: number | null | undefined, ccy?: string) =>
  n == null ? "—" : `${ccy || ""} ${Number(n).toLocaleString()}`.trim();

export default function SwiftTransactions() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [msgTypeFilter, setMsgTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    senderBic: "", receiverBic: "", messageType: "MT103" as typeof MSG_TYPES[number],
    currency: "USD" as typeof CURRENCIES[number], amount: "",
    correspondentBic: "", remittanceInfo: "",
    orderingCustomer: "", beneficiaryCustomer: "",
  });

  const { data: stats } = trpc.banking.swift.stats.useQuery();
  const { data, isLoading, refetch } = trpc.banking.swift.list.useQuery({
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    messageType: msgTypeFilter !== "all" ? msgTypeFilter : undefined,
    page, limit: 20,
  });

  const createMutation = trpc.banking.swift.create.useMutation({
    onSuccess: (r) => {
      toast.success(`SWIFT message created — ${r.messageRef}`, {
        description: r.sanctionsFlagged ? "⚠️ Sanctions flag set — escalate to compliance" : "Awaiting processing",
      });
      setCreateOpen(false);
      setForm({ senderBic: "", receiverBic: "", messageType: "MT103", currency: "USD", amount: "", correspondentBic: "", remittanceInfo: "", orderingCustomer: "", beneficiaryCustomer: "" });
      refetch();
    },
    onError: (e: { message: string }) => toast.error("SWIFT creation failed", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const rows = (data?.rows ?? []) as any[];
  const total = data?.total ?? 0;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Banking", href: "/banking" }, { label: "SWIFT Transactions" }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">SWIFT Transactions</h1>
          <p className="text-sm text-muted-foreground mt-1">Cross-border payment messages — MT103 / MT202 / MT940 / MT950</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" />New SWIFT Message</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create SWIFT Message</DialogTitle></DialogHeader>
            <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">FATF Rule: Cross-border transactions ≥ USD 1,000 require beneficiary information (Travel Rule). Transactions to high-risk jurisdictions trigger compliance hold.</p>
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="space-y-1">
                <Label>Sender BIC *</Label>
                <Input placeholder="GTBINGLA" value={form.senderBic}
                  onChange={e => setForm(f => ({ ...f, senderBic: e.target.value.toUpperCase() }))} />
              </div>
              <div className="space-y-1">
                <Label>Receiver BIC *</Label>
                <Input placeholder="CHASUS33" value={form.receiverBic}
                  onChange={e => setForm(f => ({ ...f, receiverBic: e.target.value.toUpperCase() }))} />
              </div>
              <div className="space-y-1">
                <Label>Message Type</Label>
                <Select value={form.messageType} onValueChange={v => setForm(f => ({ ...f, messageType: v as typeof MSG_TYPES[number] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MSG_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v as typeof CURRENCIES[number] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Amount *</Label>
                <Input type="number" placeholder="50000" value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Ordering Customer</Label>
                <Input placeholder="GTBank Nigeria" value={form.orderingCustomer}
                  onChange={e => setForm(f => ({ ...f, orderingCustomer: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Correspondent BIC</Label>
                <Input placeholder="CITIUS33" value={form.correspondentBic}
                  onChange={e => setForm(f => ({ ...f, correspondentBic: e.target.value.toUpperCase() }))} />
              </div>
              <div className="space-y-1">
                <Label>Beneficiary Customer</Label>
                <Input placeholder="Acme Corporation" value={form.beneficiaryCustomer}
                  onChange={e => setForm(f => ({ ...f, beneficiaryCustomer: e.target.value }))} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Remittance Info</Label>
                <Input placeholder="Payment for goods and services" value={form.remittanceInfo}
                  onChange={e => setForm(f => ({ ...f, remittanceInfo: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                onClick={() => createMutation.mutate({
                  senderBic: form.senderBic,
                  receiverBic: form.receiverBic,
                  messageType: form.messageType,
                  currency: form.currency,
                  amount: parseFloat(form.amount),
                  correspondentBic: form.correspondentBic || undefined,
                  remittanceInfo: form.remittanceInfo || undefined,
                  orderingCustomer: form.orderingCustomer || undefined,
                  beneficiaryCustomer: form.beneficiaryCustomer || undefined,
                })}
                disabled={!form.senderBic || !form.receiverBic || !form.amount || createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create SWIFT Message"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Messages", value: (stats as any).total ?? 0, icon: Globe, color: "text-blue-600" },
            { label: "Completed", value: (stats as any).completed ?? 0, icon: TrendingUp, color: "text-green-600" },
            { label: "Pending", value: (stats as any).pending ?? 0, icon: Clock, color: "text-yellow-600" },
            { label: "Compliance Hold", value: (stats as any).compliance_hold ?? 0, icon: AlertTriangle, color: "text-red-600" },
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
          <Input placeholder="Search BIC, reference, UETR..." className="pl-9"
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={msgTypeFilter} onValueChange={v => { setMsgTypeFilter(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Msg Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {MSG_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {["pending","processing","completed","failed","compliance_hold"].map(s => (
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
                  {["Ref", "Type", "Sender BIC", "Receiver BIC", "Currency", "Amount", "Status", "UETR", "Created"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No SWIFT messages found</td></tr>
                ) : rows.map((r: any) => (
                  <tr key={r.id} className="hover:bg-muted">
                    <td className="px-4 py-3 font-mono text-xs">{r.transaction_ref}</td>
                    <td className="px-4 py-3"><Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400">{r.message_type}</Badge></td>
                    <td className="px-4 py-3 font-mono text-xs">{r.sender_bic}</td>
                    <td className="px-4 py-3 font-mono text-xs">{r.receiver_bic}</td>
                    <td className="px-4 py-3 text-xs font-medium">{r.currency}</td>
                    <td className="px-4 py-3 font-medium">{fmt(r.amount, r.currency)}</td>
                    <td className="px-4 py-3">
                      <Badge className={STATUS_COLORS[r.status] || "bg-muted text-foreground"}>
                        {r.status?.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.uetr?.substring(0, 12)}...</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</td>
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
    </div>
  );
}
