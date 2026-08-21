/**
 * Fine Payment Gateway
 * NDPC enforcement fine payment processing with Stripe integration
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { CreditCard, Search, AlertCircle, CheckCircle2, Clock, DollarSign } from "lucide-react";

const statusColor: Record<string, string> = {
  pending: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  paid: "bg-green-500/15 text-green-600 dark:text-green-400",
  overdue: "bg-red-500/15 text-red-600 dark:text-red-400",
  partial: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  waived: "bg-muted text-foreground",
};

export default function FinePaymentGateway() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [payOpen, setPayOpen] = useState(false);
  const [selectedFine, setSelectedFine] = useState<any>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payRef, setPayRef] = useState("");

  const { data: fines, refetch } = trpc.finePayment.getOutstanding.useQuery();
  const { data: summary } = trpc.finePayment.getPaymentStats.useQuery();

  const payMut = trpc.finePayment.recordPayment.useMutation({
    onSuccess: () => { toast.success("Payment recorded"); setPayOpen(false); refetch(); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const finesData = (fines as any) ?? [];
  const summaryData = summary as any;

  const filtered = finesData.filter((f: any) =>
    f.org_name?.toLowerCase().includes(search.toLowerCase()) ||
    f.payment_reference?.toLowerCase().includes(search.toLowerCase())
  );

  const formatNGN = (amount: number) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount);

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CreditCard className="w-6 h-6 text-green-600" />
              Fine Payment Gateway
            </h1>
            <p className="text-muted-foreground text-sm mt-1">NDPC enforcement fine tracking and payment processing</p>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Outstanding", value: formatNGN(summaryData?.total_outstanding ?? 0), icon: DollarSign, color: "text-red-600" },
            { label: "Collected (30d)", value: formatNGN(summaryData?.collected_30d ?? 0), icon: CheckCircle2, color: "text-green-600" },
            { label: "Overdue", value: summaryData?.overdue_count ?? 0, icon: AlertCircle, color: "text-orange-600" },
            { label: "Pending", value: summaryData?.pending_count ?? 0, icon: Clock, color: "text-yellow-600" },
          ].map(s => (
            <div key={s.label} className="border rounded-lg p-4 flex items-center gap-3">
              <s.icon className={`w-8 h-8 ${s.color}`} />
              <div>
                <div className="text-lg font-bold">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by org or reference..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-3 font-medium">Organisation</th>
                <th className="text-left p-3 font-medium">Amount (NGN)</th>
                <th className="text-left p-3 font-medium">Paid</th>
                <th className="text-left p-3 font-medium">Due Date</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center p-8 text-muted-foreground">No fines found</td></tr>
              ) : filtered.map((f: any) => (
                <tr key={f.id} className="border-t hover:bg-muted/30">
                  <td className="p-3">{f.org_name ?? `Org #${f.org_id}`}</td>
                  <td className="p-3 font-mono">{formatNGN(f.amount)}</td>
                  <td className="p-3 font-mono">{formatNGN(f.amount_paid ?? 0)}</td>
                  <td className="p-3">{f.due_date ? new Date(f.due_date).toLocaleDateString() : '-'}</td>
                  <td className="p-3"><Badge className={statusColor[f.status] ?? "bg-muted text-foreground"}>{f.status}</Badge></td>
                  <td className="p-3">
                    {f.status !== 'paid' && (
                      <Button size="sm" onClick={() => { setSelectedFine(f); setPayAmount(String(f.amount - (f.amount_paid ?? 0))); setPayRef(""); setPayOpen(true); }}>
                        <CreditCard className="w-3 h-3 mr-1" />Record Payment
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Payment Dialog */}
        <Dialog open={payOpen} onOpenChange={setPayOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Record Fine Payment</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
              <p className="text-sm text-muted-foreground">Fine for: <strong>{selectedFine?.org_name ?? `Org #${selectedFine?.org_id}`}</strong></p>
              <p className="text-sm">Outstanding: <strong>{formatNGN((selectedFine?.amount ?? 0) - (selectedFine?.amount_paid ?? 0))}</strong></p>
              <div>
                <Label>Payment Amount (NGN)</Label>
                <Input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} />
              </div>
              <div>
                <Label>Payment Reference</Label>
                <Input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="e.g. REMITA-2026-XXXX" />
              </div>
              <Button className="w-full" onClick={() => payMut.mutate({ fineId: selectedFine?.id, amount: Number(payAmount), paymentMethod: "bank_transfer", paymentReference: payRef, paymentDate: new Date().toISOString() })} disabled={payMut.isPending || !payAmount}>
                {payMut.isPending ? "Recording..." : "Confirm Payment"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
