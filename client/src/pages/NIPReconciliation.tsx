import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RefreshCw, Activity, AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/20",
  initiated: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20",
  reversed: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/20",
};

function formatNaira(amount: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount / 100);
}

export default function NIPReconciliation() {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [txSearch, setTxSearch] = useState("");
  const [txPage, setTxPage] = useState(0);

  const { data: summary, refetch: refetchSummary, isFetching: summaryLoading } = trpc.nipReconciliation.getSummary.useQuery({ date });
  const { data: txData, refetch: refetchTx } = trpc.nipReconciliation.getTransactions.useQuery({
    date,
    search: txSearch || undefined,
    limit: 20,
    offset: txPage * 20,
  });

  const refresh = () => { refetchSummary(); refetchTx(); };

  const transactions = (txData as any)?.transactions ?? (Array.isArray(txData) ? txData : []);
  const total = txData?.length ?? 0;
  const byBank = summary?.byBank ?? [];

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6 text-blue-600" />
              NIP/RTGS Reconciliation
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Real-time NIP interbank transfer reconciliation — NIBSS data sovereignty monitoring
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
            <Button variant="outline" onClick={refresh} disabled={summaryLoading} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${summaryLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Transactions", value: summary?.summary?.total_transactions ?? 0, icon: Activity, color: "text-blue-600" },
            { label: "Settled", value: summary?.summary?.settled ?? 0, icon: CheckCircle2, color: "text-green-600" },
            { label: "Pending", value: summary?.summary?.pending ?? 0, icon: AlertTriangle, color: "text-yellow-600" },
            { label: "Failed", value: summary?.summary?.failed ?? 0, icon: AlertTriangle, color: "text-red-600" },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
                  <span className="text-xs text-muted-foreground">{kpi.label}</span>
                </div>
                <div className={`text-2xl font-bold mt-1 ${kpi.color}`}>
                  {Number(kpi.value).toLocaleString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Total Settled Volume</div>
              <div className="text-2xl font-bold text-green-600 mt-1">
                {summary?.summary?.total_settled_amount ? formatNaira(Number(summary.summary?.total_settled_amount)) : "₦0"}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Avg Settlement Time</div>
              <div className="text-2xl font-bold text-blue-600 mt-1">
                {summary?.summary?.avg_settlement_seconds
                  ? `${(Number(summary.summary.avg_settlement_seconds) / 60).toFixed(1)} min`
                  : "N/A"}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* By Bank Chart */}
        {byBank.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Transaction Volume by Bank (Top 10)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byBank} margin={{ top: 5, right: 20, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="bank" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [v.toLocaleString(), "Transactions"]} />
                  <Bar dataKey="transactions" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Transactions Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transaction Ledger</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3">
              <Input
                placeholder="Search by session ID, account number, or narration…"
                value={txSearch}
                onChange={(e) => { setTxSearch(e.target.value); setTxPage(0); }}
                className="max-w-md"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left py-2 px-3 font-medium">Session ID</th>
                    <th className="text-left py-2 px-3 font-medium">Sender</th>
                    <th className="text-left py-2 px-3 font-medium">Receiver</th>
                    <th className="text-right py-2 px-3 font-medium">Amount</th>
                    <th className="text-left py-2 px-3 font-medium">Status</th>
                    <th className="text-left py-2 px-3 font-medium">Flags</th>
                    <th className="text-left py-2 px-3 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx: any) => (
                    <tr key={tx.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="py-2 px-3 font-mono">{tx.session_id}</td>
                      <td className="py-2 px-3">
                        <div>{tx.sender_bank_name ?? tx.sender_bank_code}</div>
                        <div className="text-muted-foreground">{tx.sender_account_number}</div>
                      </td>
                      <td className="py-2 px-3">
                        <div>{tx.receiver_bank_name ?? tx.receiver_bank_code}</div>
                        <div className="text-muted-foreground">{tx.receiver_account_number}</div>
                      </td>
                      <td className="py-2 px-3 text-right font-semibold">{formatNaira(Number(tx.amount))}</td>
                      <td className="py-2 px-3">
                        <Badge className={`text-xs border ${STATUS_COLORS[tx.status] ?? ""}`}>
                          {tx.status}
                        </Badge>
                      </td>
                      <td className="py-2 px-3">
                        {tx.aml_flagged && <Badge className="text-xs bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/20 mr-1">AML</Badge>}
                        {tx.fraud_flagged && <Badge className="text-xs bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20">Fraud</Badge>}
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">
                        {new Date(tx.initiated_at).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                  {transactions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-muted-foreground">
                        No transactions found for {date}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {total > 20 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground mt-3">
                <span>Showing {txPage * 20 + 1}–{Math.min((txPage + 1) * 20, total)} of {total}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setTxPage((p) => Math.max(0, p - 1))} disabled={txPage === 0} className="h-7 text-xs">Prev</Button>
                  <Button size="sm" variant="outline" onClick={() => setTxPage((p) => p + 1)} disabled={(txPage + 1) * 20 >= total} className="h-7 text-xs">Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
