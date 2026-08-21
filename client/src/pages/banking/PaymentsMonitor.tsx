import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, Search, TrendingUp, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-500/15 text-green-600 dark:text-green-400",
  settled: "bg-green-500/15 text-green-600 dark:text-green-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
  rejected: "bg-red-500/15 text-red-600 dark:text-red-400",
  initiated: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  queued: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  processing: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
};

const fmt = (n: number | null | undefined) => n == null ? "—" : `₦${Number(n).toLocaleString()}`;

export default function PaymentsMonitor() {
  const [nipSearch, setNipSearch] = useState("");
  const [nipStatus, setNipStatus] = useState("all");
  const [nipPage, setNipPage] = useState(1);
  const [rtgsSearch, setRtgsSearch] = useState("");
  const [rtgsStatus, setRtgsStatus] = useState("all");
  const [rtgsPage, setRtgsPage] = useState(1);
  const [nipOpen, setNipOpen] = useState(false);
  const [rtgsOpen, setRtgsOpen] = useState(false);

  const [nipForm, setNipForm] = useState({
    senderBankCode: "", senderAccountNumber: "", senderAccountName: "",
    receiverBankCode: "", receiverAccountNumber: "", receiverAccountName: "",
    amount: "", narration: "", channelCode: "API",
  });
  const [rtgsForm, setRtgsForm] = useState({
    senderBankCode: "", senderAccountNumber: "",
    receiverBankCode: "", receiverAccountNumber: "",
    amount: "", narration: "", priority: "normal" as "normal" | "urgent" | "critical",
  });

  const { data: stats } = trpc.banking.payments.paymentStats.useQuery();
  const { data: nipData, isLoading: nipLoading, refetch: refetchNip } = trpc.banking.payments.listNip.useQuery({
    search: nipSearch || undefined,
    status: nipStatus !== "all" ? nipStatus : undefined,
    page: nipPage, limit: 20,
  });
  const { data: rtgsData, isLoading: rtgsLoading, refetch: refetchRtgs } = trpc.banking.payments.listRtgs.useQuery({
    search: rtgsSearch || undefined,
    status: rtgsStatus !== "all" ? rtgsStatus : undefined,
    page: rtgsPage, limit: 20,
  });

  const nipMutation = trpc.banking.payments.initiateNip.useMutation({
    onSuccess: (r) => {
      toast.success(`NIP initiated — ${r.sessionId}`, { description: r.amlFlagged ? "⚠️ AML flagged for review" : "Processing via NIBSS" });
      setNipOpen(false);
      setNipForm({ senderBankCode: "", senderAccountNumber: "", senderAccountName: "", receiverBankCode: "", receiverAccountNumber: "", receiverAccountName: "", amount: "", narration: "", channelCode: "API" });
      refetchNip();
    },
    onError: (e: { message: string }) => toast.error("NIP initiation failed", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const rtgsMutation = trpc.banking.payments.initiateRtgs.useMutation({
    onSuccess: (r) => {
      toast.success(`RTGS queued — ${r.reference}`, { description: `Settlement cycle: ${r.settlementCycle}` });
      setRtgsOpen(false);
      setRtgsForm({ senderBankCode: "", senderAccountNumber: "", receiverBankCode: "", receiverAccountNumber: "", amount: "", narration: "", priority: "normal" });
      refetchRtgs();
    },
    onError: (e: { message: string }) => toast.error("RTGS initiation failed", { description: (e instanceof Error ? e.message : String(e)) }),
  });

  const nipRows = (nipData?.rows ?? []) as any[];
  const rtgsRows = (rtgsData?.rows ?? []) as any[];

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Banking", href: "/banking" }, { label: "Payments Monitor" }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payment Rails Monitor</h1>
          <p className="text-sm text-muted-foreground mt-1">NIP (NIBSS Instant Payment) & RTGS (Real-Time Gross Settlement)</p>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "NIP Transactions", value: (stats as any).total_nip ?? 0, sub: fmt((stats as any).total_nip_value), icon: TrendingUp, color: "text-blue-600" },
            { label: "NIP Completed", value: (stats as any).nip_completed ?? 0, sub: `${(stats as any).nip_failed ?? 0} failed`, icon: CheckCircle, color: "text-green-600" },
            { label: "RTGS Transactions", value: (stats as any).total_rtgs ?? 0, sub: fmt((stats as any).total_rtgs_value), icon: TrendingUp, color: "text-purple-600" },
            { label: "AML Flagged", value: (stats as any).nip_aml_flagged ?? 0, sub: "Requires review", icon: AlertTriangle, color: "text-red-600" },
          ].map(({ label, value, sub, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <Icon className={`h-8 w-8 ${color}`} />
                  <div>
                    <p className="text-2xl font-bold">{value}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-xs text-muted-foreground">{sub}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Tabs defaultValue="nip">
        <TabsList>
          <TabsTrigger value="nip">NIP Transactions</TabsTrigger>
          <TabsTrigger value="rtgs">RTGS Transactions</TabsTrigger>
        </TabsList>

        <TabsContent value="nip" className="space-y-4">
          <div className="flex gap-3 flex-wrap items-center">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search session ID, account, NIBSS ref..." className="pl-9"
                value={nipSearch} onChange={e => { setNipSearch(e.target.value); setNipPage(1); }} />
            </div>
            <Select value={nipStatus} onValueChange={v => { setNipStatus(v); setNipPage(1); }}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {["initiated","processing","completed","failed"].map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Dialog open={nipOpen} onOpenChange={setNipOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2"><Plus className="h-4 w-4" />Initiate NIP</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Initiate NIP Transaction</DialogTitle></DialogHeader>
                <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded">CBN Rule: Single NIP limit is ₦10,000,000. Transactions ≥ ₦5M are AML-flagged.</p>
                <div className="grid grid-cols-2 gap-4 py-2">
                  {[
                    { label: "Sender Bank Code *", key: "senderBankCode", ph: "000001" },
                    { label: "Sender Account", key: "senderAccountNumber", ph: "0123456789" },
                    { label: "Sender Name", key: "senderAccountName", ph: "John Doe" },
                    { label: "Receiver Bank Code *", key: "receiverBankCode", ph: "000014" },
                    { label: "Receiver Account", key: "receiverAccountNumber", ph: "0987654321" },
                    { label: "Receiver Name", key: "receiverAccountName", ph: "Jane Smith" },
                  ].map(({ label, key, ph }) => (
                    <div key={key} className="space-y-1">
                      <Label>{label}</Label>
                      <Input placeholder={ph} value={(nipForm as any)[key]}
                        onChange={e => setNipForm(f => ({ ...f, [key]: e.target.value }))} />
                    </div>
                  ))}
                  <div className="space-y-1">
                    <Label>Amount (₦) *</Label>
                    <Input type="number" placeholder="500000" value={nipForm.amount}
                      onChange={e => setNipForm(f => ({ ...f, amount: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Channel</Label>
                    <Select value={nipForm.channelCode} onValueChange={v => setNipForm(f => ({ ...f, channelCode: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["API","MOBILE","INTERNET","POS","ATM","USSD"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label>Narration</Label>
                    <Input placeholder="Payment for services" value={nipForm.narration}
                      onChange={e => setNipForm(f => ({ ...f, narration: e.target.value }))} />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setNipOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() => nipMutation.mutate({
                      senderBankCode: nipForm.senderBankCode,
                      senderAccountNumber: nipForm.senderAccountNumber || "0000000000",
                      senderAccountName: nipForm.senderAccountName || undefined,
                      receiverBankCode: nipForm.receiverBankCode,
                      receiverAccountNumber: nipForm.receiverAccountNumber || "0000000000",
                      receiverAccountName: nipForm.receiverAccountName || undefined,
                      amount: parseFloat(nipForm.amount),
                      narration: nipForm.narration || undefined,
                      channelCode: nipForm.channelCode || undefined,
                    })}
                    disabled={!nipForm.senderBankCode || !nipForm.receiverBankCode || !nipForm.amount || nipMutation.isPending}
                  >
                    {nipMutation.isPending ? "Initiating..." : "Initiate NIP"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted border-b">
                    <tr>
                      {["Session ID", "Sender Bank", "Receiver Bank", "Amount", "Status", "AML", "NIBSS Ref", "Time"].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {nipLoading ? (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
                    ) : nipRows.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No NIP transactions found</td></tr>
                    ) : nipRows.map((r: any) => (
                      <tr key={r.id} className="hover:bg-muted">
                        <td className="px-4 py-3 font-mono text-xs">{r.session_id?.substring(0, 16)}...</td>
                        <td className="px-4 py-3 text-xs">{r.sender_bank_code}</td>
                        <td className="px-4 py-3 text-xs">{r.receiver_bank_code}</td>
                        <td className="px-4 py-3 font-medium">{fmt(r.amount)}</td>
                        <td className="px-4 py-3">
                          <Badge className={STATUS_COLORS[r.status] || "bg-muted text-foreground"}>{r.status}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {r.aml_flagged ? <Badge className="bg-red-500/15 text-red-600 dark:text-red-400">Flagged</Badge> : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{r.nibss_ref}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{r.created_at ? new Date(r.created_at).toLocaleString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(nipData?.total ?? 0) > 20 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <span className="text-sm text-muted-foreground">Page {nipPage} of {Math.ceil((nipData?.total ?? 0) / 20)}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={nipPage === 1} onClick={() => setNipPage(p => p - 1)}>Previous</Button>
                    <Button size="sm" variant="outline" disabled={nipPage * 20 >= (nipData?.total ?? 0)} onClick={() => setNipPage(p => p + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rtgs" className="space-y-4">
          <div className="flex gap-3 flex-wrap items-center">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search reference, bank code, CBN ref..." className="pl-9"
                value={rtgsSearch} onChange={e => { setRtgsSearch(e.target.value); setRtgsPage(1); }} />
            </div>
            <Select value={rtgsStatus} onValueChange={v => { setRtgsStatus(v); setRtgsPage(1); }}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {["queued","processing","settled","rejected"].map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Dialog open={rtgsOpen} onOpenChange={setRtgsOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2"><Plus className="h-4 w-4" />Initiate RTGS</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Initiate RTGS Transaction</DialogTitle></DialogHeader>
                <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">CBN Rule: RTGS minimum is ₦10,000,000. Settlement cycles: AM (before 12:00), PM1 (12:00–16:00), PM2 (after 16:00).</p>
                <div className="grid grid-cols-2 gap-4 py-2">
                  {[
                    { label: "Sender Bank Code *", key: "senderBankCode", ph: "000001" },
                    { label: "Sender Account", key: "senderAccountNumber", ph: "0123456789" },
                    { label: "Receiver Bank Code *", key: "receiverBankCode", ph: "000014" },
                    { label: "Receiver Account", key: "receiverAccountNumber", ph: "0987654321" },
                  ].map(({ label, key, ph }) => (
                    <div key={key} className="space-y-1">
                      <Label>{label}</Label>
                      <Input placeholder={ph} value={(rtgsForm as any)[key]}
                        onChange={e => setRtgsForm(f => ({ ...f, [key]: e.target.value }))} />
                    </div>
                  ))}
                  <div className="space-y-1">
                    <Label>Amount (₦) *</Label>
                    <Input type="number" placeholder="10000000" value={rtgsForm.amount}
                      onChange={e => setRtgsForm(f => ({ ...f, amount: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Priority</Label>
                    <Select value={rtgsForm.priority} onValueChange={v => setRtgsForm(f => ({ ...f, priority: v as "normal" | "urgent" | "critical" }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label>Narration</Label>
                    <Input placeholder="Interbank settlement" value={rtgsForm.narration}
                      onChange={e => setRtgsForm(f => ({ ...f, narration: e.target.value }))} />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setRtgsOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() => rtgsMutation.mutate({
                      senderBankCode: rtgsForm.senderBankCode,
                      senderAccountNumber: rtgsForm.senderAccountNumber || undefined,
                      receiverBankCode: rtgsForm.receiverBankCode,
                      receiverAccountNumber: rtgsForm.receiverAccountNumber || undefined,
                      amount: parseFloat(rtgsForm.amount),
                      narration: rtgsForm.narration || undefined,
                      priority: rtgsForm.priority,
                    })}
                    disabled={!rtgsForm.senderBankCode || !rtgsForm.receiverBankCode || !rtgsForm.amount || rtgsMutation.isPending}
                  >
                    {rtgsMutation.isPending ? "Initiating..." : "Initiate RTGS"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted border-b">
                    <tr>
                      {["Reference", "Sender Bank", "Receiver Bank", "Amount", "Priority", "Cycle", "Status", "CBN Ref", "Queued"].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rtgsLoading ? (
                      <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
                    ) : rtgsRows.length === 0 ? (
                      <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No RTGS transactions found</td></tr>
                    ) : rtgsRows.map((r: any) => (
                      <tr key={r.id} className="hover:bg-muted">
                        <td className="px-4 py-3 font-mono text-xs">{r.reference}</td>
                        <td className="px-4 py-3 text-xs">{r.sender_bank_code}</td>
                        <td className="px-4 py-3 text-xs">{r.receiver_bank_code}</td>
                        <td className="px-4 py-3 font-medium">{fmt(r.amount)}</td>
                        <td className="px-4 py-3">
                          <Badge className={r.priority === "critical" ? "bg-red-500/15 text-red-600 dark:text-red-400" : r.priority === "urgent" ? "bg-orange-500/15 text-orange-600 dark:text-orange-400" : "bg-muted text-foreground"}>
                            {r.priority}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium">{r.settlement_cycle || "—"}</td>
                        <td className="px-4 py-3">
                          <Badge className={STATUS_COLORS[r.status] || "bg-muted text-foreground"}>{r.status}</Badge>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{r.cbn_ref}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{r.queued_at ? new Date(r.queued_at).toLocaleString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(rtgsData?.total ?? 0) > 20 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <span className="text-sm text-muted-foreground">Page {rtgsPage} of {Math.ceil((rtgsData?.total ?? 0) / 20)}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={rtgsPage === 1} onClick={() => setRtgsPage(p => p - 1)}>Previous</Button>
                    <Button size="sm" variant="outline" disabled={rtgsPage * 20 >= (rtgsData?.total ?? 0)} onClick={() => setRtgsPage(p => p + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
