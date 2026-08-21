import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Database, RefreshCw, Download, Search, TrendingUp, TrendingDown, DollarSign, Activity } from "lucide-react";

const TX_COLORS: Record<string, string> = {
  penalty: "#ef4444",
  fine: "#f97316",
  settlement: "#10b981",
  refund: "#3b82f6",
  escrow: "#8b5cf6",
};

export default function LedgerExplorer() {
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [txForm, setTxForm] = useState({
    orgId: "",
    penaltyId: "",
    amountUsd: "",
    currency: "USD",
    type: "penalty" as "penalty" | "fine" | "settlement" | "refund" | "escrow",
  });

  const { data: orgsForSelect } = trpc.financial.orgsForSelect.useQuery();
  const { data: tbBalance, isLoading: balanceLoading, refetch: refetchBalance } =
    trpc.orchestration.tigerbeetleBalance.useQuery(
      { orgId: selectedOrgId },
      { enabled: selectedOrgId.length > 0, refetchInterval: 30000 }
    );
  const { data: ledgerTransactions, refetch: refetchTxs } =
    trpc.ledger.transactions.useQuery({ limit: 100 }, { refetchInterval: 20000 });
  const { data: ledgerSummary } = trpc.ledger.summary.useQuery(undefined, { refetchInterval: 20000 });
  const { data: tbStatus } = trpc.orchestration.tigerbeetleStatus.useQuery(undefined, { refetchInterval: 30000 });

  const createTx = trpc.orchestration.tigerbeetleCreateTransaction.useMutation({
    onSuccess: () => {
      toast.success("Transaction created in TigerBeetle ledger");
      setShowCreateModal(false);
      setTxForm({ orgId: "", penaltyId: "", amountUsd: "", currency: "USD", type: "penalty" });
      refetchTxs();
      if (selectedOrgId) refetchBalance();
    },
    onError: (err) => toast.error("Failed to create transaction: " + err.message),
  });

  const filteredTxs = useMemo(() => {
    const all = (ledgerTransactions as any[]) ?? [];
    if (!searchTerm) return all;
    const q = searchTerm.toLowerCase();
    return all.filter((t: any) =>
      (t.transaction_id ?? "").toLowerCase().includes(q) ||
      (t.organization_name ?? "").toLowerCase().includes(q) ||
      (t.tx_type ?? "").toLowerCase().includes(q) ||
      String(t.amount ?? "").includes(q)
    );
  }, [ledgerTransactions, searchTerm]);

  function exportCSV() {
    const rows = filteredTxs;
    const header = ["TX ID", "Type", "Org", "Debit Account", "Credit Account", "Amount", "Currency", "Status", "Created At"];
    const lines = rows.map((t: any) => [
      t.transaction_id ?? `TX-${t.id}`,
      t.tx_type ?? "",
      t.organization_name ?? "",
      t.debit_account ?? "",
      t.credit_account ?? "",
      t.amount ?? 0,
      t.currency ?? "USD",
      t.status ?? "pending",
      t.created_at ? new Date(t.created_at).toISOString() : "",
    ].join(","));
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ndsep-ledger-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} ledger entries`);
  }

  const summary = ledgerSummary as any;
  const balance = tbBalance as any;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Banking", href: "/banking" }, { label: "Ledger Explorer" }]} />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="layer-badge">LEDGER</span>
            <span className="data-label">TigerBeetle · ACID · Double-Entry</span>
          </div>
          <h1 className="text-2xl font-bold">TigerBeetle Ledger Explorer</h1>
          <p className="text-muted-foreground mono text-sm mt-0.5">
            Immutable double-entry financial ledger · ACID guarantees · Full audit trail
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportCSV} className="font-mono text-xs flex items-center gap-2">
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          <Button onClick={() => setShowCreateModal(true)} className="font-mono text-xs flex items-center gap-2">
            <Database className="w-4 h-4" /> New Transaction
          </Button>
        </div>
      </div>

      {/* TigerBeetle Status Banner */}
      <div className={`flex items-center gap-3 px-4 py-2.5 rounded border text-xs mono ${
        (tbStatus as any)?.status === "healthy" ? "border-green-500/30 bg-green-500/5 text-green-400" : "border-yellow-500/30 bg-yellow-500/5 text-yellow-400"
      }`}>
        <span className={`w-2 h-2 rounded-full ${(tbStatus as any)?.status === "healthy" ? "bg-green-400" : "bg-yellow-400"}`} />
        TigerBeetle Service: {(tbStatus as any)?.status ?? "checking..."} · Port 8240 · ACID Transfers
        {(tbStatus as any)?.status !== "healthy" && (
          <span className="text-muted-foreground ml-2">— Ledger data from DB fallback</span>
        )}
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Transactions", value: summary?.totalTransactions ?? filteredTxs.length, icon: Activity, color: "text-primary" },
          { label: "Total Debits", value: `$${Number(summary?.totalDebits ?? 0).toLocaleString()}`, icon: TrendingDown, color: "text-red-500" },
          { label: "Total Credits", value: `$${Number(summary?.totalCredits ?? 0).toLocaleString()}`, icon: TrendingUp, color: "text-green-500" },
          { label: "Net Position", value: `$${Number(summary?.netBalance ?? 0).toLocaleString()}`, icon: DollarSign, color: "text-yellow-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="border border-border/60">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-1">
                <span className="data-label text-xs">{label}</span>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <div className={`text-2xl font-bold mono ${color}`}>{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Org Balance Probe */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Organisation Balance Probe</CardTitle>
            <span className="layer-badge">TIGERBEETLE · LIVE</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="flex-1 min-w-[220px]">
              <Label className="text-xs data-label mb-1 block">Select Organisation</Label>
              <div className="flex gap-2">
                <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                  <SelectTrigger className="font-mono text-xs h-8">
                    <SelectValue placeholder="Choose organisation..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(orgsForSelect ?? []).map((o: any) => (
                      <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="font-mono text-xs h-8"
                  onClick={() => refetchBalance()} disabled={!selectedOrgId || balanceLoading}>
                  <RefreshCw className={`w-3 h-3 mr-1 ${balanceLoading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
            </div>
          </div>
          {selectedOrgId && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {balance ? (
                <>
                  <div className="bg-muted/30 rounded p-3">
                    <div className="data-label text-xs mb-1">Total Debits</div>
                    <div className="mono font-bold text-red-500 text-lg">${Number(balance.totalDebits ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="bg-muted/30 rounded p-3">
                    <div className="data-label text-xs mb-1">Total Credits</div>
                    <div className="mono font-bold text-green-500 text-lg">${Number(balance.totalCredits ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="bg-muted/30 rounded p-3">
                    <div className="data-label text-xs mb-1">Net Liability</div>
                    <div className="mono font-bold text-yellow-500 text-lg">${Number(balance.netBalance ?? balance.balance ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="bg-muted/30 rounded p-3">
                    <div className="data-label text-xs mb-1">Currency / Status</div>
                    <div className="mono font-bold text-primary">{balance.currency ?? "USD"} · {balance.status ?? "ACTIVE"}</div>
                  </div>
                </>
              ) : (
                <div className="col-span-4 text-xs text-muted-foreground mono py-2">
                  {balanceLoading ? "Querying TigerBeetle..." : "TigerBeetle unreachable — balance unavailable"}
                </div>
              )}
            </div>
          )}
          {!selectedOrgId && (
            <p className="text-xs text-muted-foreground mono">Select an organisation to query its live double-entry balance.</p>
          )}
        </CardContent>
      </Card>

      {/* Transaction Log */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Ledger Transaction Log</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <Input
                  placeholder="Search TX ID, org, type..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-7 h-7 text-xs font-mono w-52"
                />
              </div>
              <span className="data-label">{filteredTxs.length} entries</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  {["TX ID", "Type", "Organisation", "Debit Account", "Credit Account", "Amount", "Currency", "Status", "Timestamp"].map(h => (
                    <th key={h} className="text-left px-4 py-2 data-label font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTxs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-xs mono">
                      {searchTerm ? "No transactions match your search." : "No ledger transactions yet. Issue a penalty to create the first entry."}
                    </td>
                  </tr>
                ) : (
                  filteredTxs.map((t: any) => (
                    <tr key={t.id ?? t.transaction_id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 mono font-semibold text-primary">{t.transaction_id ?? `TX-${t.id}`}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className="mono text-[9px]"
                          style={{ color: TX_COLORS[t.tx_type ?? ""] ?? "#6b7280", borderColor: (TX_COLORS[t.tx_type ?? ""] ?? "#6b7280") + "40" }}>
                          {(t.tx_type ?? "TX").toUpperCase()}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 mono text-muted-foreground">{t.organization_name ?? "—"}</td>
                      <td className="px-4 py-2.5 mono text-muted-foreground text-[10px]">{t.debit_account ?? "PENALTY_RECV"}</td>
                      <td className="px-4 py-2.5 mono text-muted-foreground text-[10px]">{t.credit_account ?? "ORG_LIABILITY"}</td>
                      <td className="px-4 py-2.5 mono font-semibold">${Number(t.amount ?? 0).toLocaleString()}</td>
                      <td className="px-4 py-2.5 mono text-muted-foreground">{t.currency ?? "USD"}</td>
                      <td className="px-4 py-2.5">
                        <span className={`mono text-[10px] font-semibold ${
                          t.status === "settled" ? "text-green-600" :
                          t.status === "failed" ? "text-red-500" : "text-yellow-500"
                        }`}>{(t.status ?? "pending").toUpperCase()}</span>
                      </td>
                      <td className="px-4 py-2.5 mono text-muted-foreground text-[10px]">
                        {t.created_at ? new Date(t.created_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Create Transaction Modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">New TigerBeetle Transaction</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs data-label">Organisation</Label>
              <Select value={txForm.orgId} onValueChange={(v) => setTxForm(f => ({ ...f, orgId: v }))}>
                <SelectTrigger className="font-mono text-xs h-8 mt-1">
                  <SelectValue placeholder="Select organisation..." />
                </SelectTrigger>
                <SelectContent>
                  {(orgsForSelect ?? []).map((o: any) => (
                    <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs data-label">Penalty / Reference ID</Label>
              <Input className="font-mono text-xs h-8 mt-1" placeholder="PEN-000001"
                value={txForm.penaltyId} onChange={(e) => setTxForm(f => ({ ...f, penaltyId: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs data-label">Amount (USD)</Label>
                <Input className="font-mono text-xs h-8 mt-1" placeholder="50000" type="number" min="0"
                  value={txForm.amountUsd} onChange={(e) => setTxForm(f => ({ ...f, amountUsd: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs data-label">Currency</Label>
                <Select value={txForm.currency} onValueChange={(v) => setTxForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger className="font-mono text-xs h-8 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["USD", "NGN", "EUR", "GBP"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs data-label">Transaction Type</Label>
              <Select value={txForm.type} onValueChange={(v) => setTxForm(f => ({ ...f, type: v as any }))}>
                <SelectTrigger className="font-mono text-xs h-8 mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["penalty", "fine", "settlement", "refund", "escrow"].map(t => (
                    <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateModal(false)} className="font-mono text-xs">Cancel</Button>
            <Button
              disabled={!txForm.orgId || !txForm.penaltyId || !txForm.amountUsd || createTx.isPending}
              onClick={() => createTx.mutate({
                orgId: txForm.orgId,
                penaltyId: txForm.penaltyId,
                amountUsd: parseFloat(txForm.amountUsd),
                currency: txForm.currency,
                type: txForm.type,
              })}
              className="font-mono text-xs"
            >
              {createTx.isPending ? "Creating..." : "Create Transaction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
