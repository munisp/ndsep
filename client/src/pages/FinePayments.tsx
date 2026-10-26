/**
 * Fine Payments (Round-12 W3 unification)
 * ========================================
 * Unified fine-payments surface. The payment lifecycle now uses the canonical
 * `finePayments` router (Remita-style RRR flow):
 *   - finePayments.generateRrr            — issue an RRR for an outstanding fine
 *   - finePayments.getRrrStatus           — RRR status check
 *   - finePayments.simulateRrrSettlement  — DEV settlement simulator
 *   - finePayments.runReconciliationBatch — daily reconciliation batch trigger
 *   - finePayments.reconciliationQueue / reconciliationHistory
 *   - finePayments.requestRefund / listRefunds / decideRefund — refund workflow
 *   - finePayments.listReceipts / getReceipt / resendReceipt
 *
 * Fine issuance/listing/waiving still use phase12.fines.* because the
 * finePayments router deliberately does not duplicate the fine register
 * (it operates on enforcement_fines via penaltyId). The phase12.fines
 * payment-initiation path is DEPRECATED in favour of generateRrr (see the
 * deprecation note in server/routers/phase12Features.ts).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreditCard, Plus, AlertCircle, CheckCircle, Copy, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const statusColors: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  paid: "bg-green-500/20 text-green-400",
  partial: "bg-blue-500/20 text-blue-400",
  outstanding: "bg-yellow-500/20 text-yellow-400",
  overdue: "bg-red-500/20 text-red-400",
  waived: "bg-muted0/20 text-muted-foreground",
  appealing: "bg-blue-500/20 text-blue-400",
};

const EMPTY_FORM = {
  orgId: "",
  violationType: "data_breach",
  fineAmountNgn: 10000000,
  description: "",
  ndpcRef: "",
};

const formatNGN = (amount: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);

// ─── Fines register tab ─────────────────────────────────────────────────────

function FinesTab() {
  const [showIssue, setShowIssue] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [rrrFor, setRrrFor] = useState<any>(null);
  const [payerEmail, setPayerEmail] = useState("");
  const [rrrResult, setRrrResult] = useState<any>(null);

  // Fine register listing/stats: phase12.fines reads enforcement_fines (the
  // finePayments router intentionally has no duplicate fine-list procedure).
  const { data: fines, refetch } = trpc.phase12.fines.listFines.useQuery({});
  const { data: stats } = trpc.phase12.fines.getStats.useQuery();
  const { data: orgs } = trpc.organizations.list.useQuery({ limit: 100 });

  const issueFine = trpc.phase12.fines.issueFine.useMutation({
    onSuccess: () => { refetch(); setShowIssue(false); setForm(EMPTY_FORM); toast.success("Fine issued"); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const waiveFine = trpc.phase12.fines.waiveFine.useMutation({
    onSuccess: () => { refetch(); toast.success("Fine waived"); },
  });

  // Canonical payment path: Remita RRR via the finePayments router.
  const generateRrr = trpc.finePayments.generateRrr.useMutation({
    onSuccess: (data: any) => {
      setRrrResult(data);
      toast.success(data.reused ? "Existing live RRR returned" : "RRR generated");
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const simulate = trpc.finePayments.simulateRrrSettlement.useMutation({
    onSuccess: (data: any) => {
      toast.success(`Settlement simulated — receipt ${data.receiptNumber ?? "n/a"}`);
      refetch();
      setRrrResult(null); setRrrFor(null);
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-emerald-400" /> NDPA Fine Payments
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Regulatory fines under NDPA Section 48 — payment via Remita RRR (finePayments router)
          </p>
        </div>
        <Button onClick={() => setShowIssue(true)} className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="w-4 h-4 mr-2" /> Issue Fine
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Total Fines Issued</p>
            <p className="text-2xl font-bold text-foreground">{stats?.total ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-red-900/20 border-red-700/40">
          <CardContent className="p-4">
            <p className="text-red-400 text-xs">Total Outstanding</p>
            <p className="text-lg font-bold text-red-300">{formatNGN(stats?.totalOutstanding ?? 0)}</p>
          </CardContent>
        </Card>
        <Card className="bg-green-900/20 border-green-700/40">
          <CardContent className="p-4">
            <p className="text-green-400 text-xs">Total Collected</p>
            <p className="text-lg font-bold text-green-300">{formatNGN(stats?.totalCollected ?? 0)}</p>
          </CardContent>
        </Card>
        <Card className="bg-yellow-900/20 border-yellow-700/40">
          <CardContent className="p-4">
            <p className="text-yellow-400 text-xs">Overdue</p>
            <p className="text-2xl font-bold text-yellow-300">{stats?.overdue ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Fines Table */}
      <Card className="bg-card/50 border-border">
        <CardHeader><CardTitle className="text-foreground text-base">Fine Register</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="text-muted-foreground">Fine Ref</TableHead>
                <TableHead className="text-muted-foreground">Organisation</TableHead>
                <TableHead className="text-muted-foreground">Violation</TableHead>
                <TableHead className="text-muted-foreground">Amount</TableHead>
                <TableHead className="text-muted-foreground">NDPC Ref</TableHead>
                <TableHead className="text-muted-foreground">Due Date</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fines?.map((f: any) => (
                <TableRow key={f.id} className="border-border">
                  <TableCell className="text-foreground font-mono text-xs">{f.fine_ref}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{f.org_name ?? `Org #${f.org_id}`}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-border text-muted-foreground capitalize text-xs">
                      {String(f.violation_type ?? "").replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-foreground font-medium">{formatNGN(f.fine_amount_ngn ?? 0)}</TableCell>
                  <TableCell className="text-muted-foreground text-xs font-mono">{f.ndpc_ref ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {f.due_date ? new Date(f.due_date).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge className={statusColors[f.payment_status ?? "pending"] ?? ""}>{f.payment_status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {["pending", "overdue", "partial", "outstanding"].includes(f.payment_status) && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-emerald-400"
                          title="Generate RRR (payment code)"
                          onClick={() => { setRrrFor(f); setRrrResult(null); setPayerEmail(""); }}>
                          <CreditCard className="w-3 h-3" />
                        </Button>
                      )}
                      {f.payment_status === "pending" && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground"
                          title="Waive fine"
                          onClick={() => waiveFine.mutate({ fineId: f.id, reason: "Regulatory discretion" })}>
                          <CheckCircle className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Issue Fine Dialog */}
      <Dialog open={showIssue} onOpenChange={setShowIssue}>
        <DialogContent className="bg-card border-border text-foreground max-w-lg">
          <DialogHeader><DialogTitle>Issue NDPA Fine</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-muted-foreground text-sm">Organisation</Label>
              <Select value={form.orgId} onValueChange={v => setForm(f => ({ ...f, orgId: v }))}>
                <SelectTrigger className="mt-1 bg-muted border-border text-foreground"><SelectValue placeholder="Select organisation" /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {orgs?.map((o: any) => (
                    <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">Violation Type</Label>
              <Select value={form.violationType} onValueChange={v => setForm(f => ({ ...f, violationType: v }))}>
                <SelectTrigger className="mt-1 bg-muted border-border text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="data_breach">Data Breach (Section 40)</SelectItem>
                  <SelectItem value="unlawful_processing">Unlawful Processing (Section 25)</SelectItem>
                  <SelectItem value="cross_border_violation">Cross-Border Violation (Section 43)</SelectItem>
                  <SelectItem value="consent_violation">Consent Violation (Section 26)</SelectItem>
                  <SelectItem value="dpo_failure">DPO Failure (Section 32)</SelectItem>
                  <SelectItem value="dpia_failure">DPIA Failure (Section 30)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">Fine Amount (₦)</Label>
              <Input type="number" className="mt-1 bg-muted border-border text-foreground"
                value={form.fineAmountNgn}
                onChange={e => setForm(f => ({ ...f, fineAmountNgn: parseInt(e.target.value) || 0 }))} />
              <p className="text-muted-foreground text-xs mt-1">Max: ₦10,000,000 or 2% of annual turnover</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">NDPC Decision Reference</Label>
              <Input className="mt-1 bg-muted border-border text-foreground font-mono" value={form.ndpcRef}
                placeholder="NDPC/DEC/2026/XXXX"
                onChange={e => setForm(f => ({ ...f, ndpcRef: e.target.value }))} />
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">Description</Label>
              <Input className="mt-1 bg-muted border-border text-foreground" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground" onClick={() => setShowIssue(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!form.orgId || !form.fineAmountNgn || issueFine.isPending}
              onClick={() => issueFine.mutate({
                orgId: parseInt(form.orgId),
                violationType: form.violationType as any,
                fineAmountNgn: form.fineAmountNgn,
                description: form.description,
                ndpcRef: form.ndpcRef || undefined,
              })}>
              Issue Fine
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RRR Dialog */}
      <Dialog open={rrrFor != null} onOpenChange={(open) => { if (!open) { setRrrFor(null); setRrrResult(null); } }}>
        <DialogContent className="bg-card border-border text-foreground max-w-lg">
          <DialogHeader><DialogTitle>Collect fine {rrrFor?.fine_ref} via RRR</DialogTitle></DialogHeader>
          {rrrResult ? (
            <div className="space-y-4">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Remita Retrieval Reference (RRR)</p>
                <p className="text-2xl font-mono font-bold text-emerald-300 flex items-center justify-center gap-2">
                  {rrrResult.rrr}
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { navigator.clipboard?.writeText(rrrResult.rrr); toast.success("RRR copied"); }}>
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </p>
                <p className="text-sm mt-1">{formatNGN(Number(rrrResult.amount))} {rrrResult.currency ?? "NGN"}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Status: {rrrResult.status} · expires {rrrResult.expires_at ? new Date(rrrResult.expires_at).toLocaleString() : "—"}
                  {rrrResult.reused ? " · existing live RRR reused" : ""}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                The payer settles this RRR at any bank or via the Remita gateway. Settlement flips the fine to
                paid and issues an NDPC receipt automatically.
              </p>
              <DialogFooter>
                <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setRrrFor(null); setRrrResult(null); }}>Close</Button>
                <Button variant="secondary" disabled={simulate.isPending}
                  title="DEV only — exercises the production webhook path"
                  onClick={() => simulate.mutate({ rrr: rrrResult.rrr, payerEmail: payerEmail || undefined })}>
                  {simulate.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Simulate settlement (dev)
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label className="text-muted-foreground text-sm">Payer email (receipt delivery, optional)</Label>
                <Input type="email" className="mt-1 bg-muted border-border text-foreground" value={payerEmail}
                  placeholder="accounts@organisation.ng" onChange={e => setPayerEmail(e.target.value)} />
              </div>
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 flex gap-2">
                <AlertCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-300">
                  At most one live RRR exists per fine (72h validity). Outstanding balance is charged, not the
                  full fine. Collection is suspended automatically if an appeal stay is active.
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" className="border-border text-muted-foreground" onClick={() => setRrrFor(null)}>Cancel</Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={generateRrr.isPending}
                  onClick={() => generateRrr.mutate({ penaltyId: rrrFor.id, payerEmail: payerEmail || undefined })}>
                  {generateRrr.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Generate RRR
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Reconciliation tab ─────────────────────────────────────────────────────

function ReconciliationTab() {
  const [batchDate, setBatchDate] = useState("");
  const queue = trpc.finePayments.reconciliationQueue.useQuery({});
  const history = trpc.finePayments.reconciliationHistory.useQuery();
  const runBatch = trpc.finePayments.runReconciliationBatch.useMutation({
    onSuccess: (res: any) => {
      toast.success(`Batch ${res.batchDate}: ${res.matched} matched, ${res.partial} partial, ${res.unmatched} unmatched`);
      queue.refetch(); history.refetch();
    },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  return (
    <div className="space-y-4">
      <Card className="bg-card/50 border-border">
        <CardHeader>
          <CardTitle className="text-foreground text-base flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Reconciliation batch</CardTitle>
          <CardDescription>Match paid RRR payments to penalties. Mismatches and expired-RRR payments land in the unmatched queue.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 items-end">
          <div>
            <Label className="text-muted-foreground text-sm">Batch date (defaults to today)</Label>
            <Input type="date" value={batchDate} onChange={(e) => setBatchDate(e.target.value)} className="bg-muted border-border text-foreground w-48" />
          </div>
          <Button onClick={() => runBatch.mutate({ batchDate: batchDate || undefined })} disabled={runBatch.isPending}>
            {runBatch.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Run reconciliation batch
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border">
        <CardHeader><CardTitle className="text-foreground text-base">Unmatched / partial queue</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="text-muted-foreground">RRR</TableHead>
                <TableHead className="text-muted-foreground">Penalty</TableHead>
                <TableHead className="text-muted-foreground">Amount</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Batch</TableHead>
                <TableHead className="text-muted-foreground">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(queue.data ?? []).map((r: any) => (
                <TableRow key={r.id} className="border-border">
                  <TableCell className="font-mono text-xs">{r.rrr}</TableCell>
                  <TableCell className="font-mono text-xs">{r.penalty_id ?? "—"}</TableCell>
                  <TableCell>{r.matched_amount != null ? formatNGN(Number(r.matched_amount)) : "—"}</TableCell>
                  <TableCell><Badge className={r.match_status === "unmatched" ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"}>{r.match_status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.batch_date ? String(r.batch_date).slice(0, 10) : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate">{r.notes ?? "—"}</TableCell>
                </TableRow>
              ))}
              {(queue.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Queue is empty.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border">
        <CardHeader><CardTitle className="text-foreground text-base">Batch history (90 days)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="text-muted-foreground">Batch date</TableHead>
                <TableHead className="text-muted-foreground text-right">Processed</TableHead>
                <TableHead className="text-muted-foreground text-right">Matched</TableHead>
                <TableHead className="text-muted-foreground text-right">Partial</TableHead>
                <TableHead className="text-muted-foreground text-right">Unmatched</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(history.data ?? []).map((h: any) => (
                <TableRow key={String(h.batch_date)} className="border-border">
                  <TableCell className="font-mono text-xs">{String(h.batch_date).slice(0, 10)}</TableCell>
                  <TableCell className="text-right">{h.processed}</TableCell>
                  <TableCell className="text-right text-green-400">{h.matched}</TableCell>
                  <TableCell className="text-right text-yellow-400">{h.partial}</TableCell>
                  <TableCell className="text-right text-red-400">{h.unmatched}</TableCell>
                </TableRow>
              ))}
              {(history.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No batches run yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Refunds tab ────────────────────────────────────────────────────────────

function RefundsTab() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [form, setForm] = useState({ rrr: "", penaltyId: "", amount: "", reason: "" });
  const refunds = trpc.finePayments.listRefunds.useQuery({
    status: (statusFilter || undefined) as "requested" | "approved" | "rejected" | "processed" | undefined,
  });
  const requestRefund = trpc.finePayments.requestRefund.useMutation({
    onSuccess: (row: any) => { toast.success(`Refund requested — ${row.refund_ref}`); refunds.refetch(); setForm({ rrr: "", penaltyId: "", amount: "", reason: "" }); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });
  const decideRefund = trpc.finePayments.decideRefund.useMutation({
    onSuccess: (row: any) => { toast.success(`Refund ${row.refund_ref} → ${row.status}`); refunds.refetch(); },
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  return (
    <div className="space-y-4">
      <Card className="bg-card/50 border-border">
        <CardHeader>
          <CardTitle className="text-foreground text-base flex items-center gap-2"><RotateCcw className="w-4 h-4" /> Request refund</CardTitle>
          <CardDescription>Refunds follow requested → approved/rejected → processed. The fine is only reverted once the payout is confirmed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-muted-foreground text-sm">RRR</Label>
              <Input value={form.rrr} onChange={(e) => setForm((f) => ({ ...f, rrr: e.target.value }))} className="bg-muted border-border text-foreground font-mono" placeholder="or penalty id →" />
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">Penalty ID</Label>
              <Input type="number" value={form.penaltyId} onChange={(e) => setForm((f) => ({ ...f, penaltyId: e.target.value }))} className="bg-muted border-border text-foreground" />
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">Amount (₦)</Label>
              <Input type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="bg-muted border-border text-foreground" />
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">Reason (min 10 chars)</Label>
              <Input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} className="bg-muted border-border text-foreground" />
            </div>
          </div>
          <Button
            disabled={requestRefund.isPending || (!form.rrr.trim() && !form.penaltyId) || !Number(form.amount) || form.reason.trim().length < 10}
            onClick={() => requestRefund.mutate({
              rrr: form.rrr.trim() || undefined,
              penaltyId: form.penaltyId ? Number(form.penaltyId) : undefined,
              amount: Number(form.amount),
              reason: form.reason.trim(),
            })}>
            {requestRefund.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Submit refund request
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-foreground text-base">Refund register</CardTitle>
          <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-40 bg-muted border-border text-foreground"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="all">All</SelectItem>
              {["requested", "approved", "rejected", "processed"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="text-muted-foreground">Refund ref</TableHead>
                <TableHead className="text-muted-foreground">RRR / Penalty</TableHead>
                <TableHead className="text-muted-foreground">Amount</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Requested by</TableHead>
                <TableHead className="text-muted-foreground text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(refunds.data ?? []).map((r: any) => (
                <TableRow key={r.id} className="border-border">
                  <TableCell className="font-mono text-xs">{r.refund_ref}</TableCell>
                  <TableCell className="font-mono text-xs">{r.rrr ?? r.penalty_id ?? "—"}</TableCell>
                  <TableCell>{formatNGN(Number(r.amount))}</TableCell>
                  <TableCell>
                    <Badge className={
                      r.status === "approved" ? "bg-blue-500/20 text-blue-400"
                      : r.status === "processed" ? "bg-green-500/20 text-green-400"
                      : r.status === "rejected" ? "bg-red-500/20 text-red-400"
                      : "bg-yellow-500/20 text-yellow-400"
                    }>{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.requested_by ?? "—"}</TableCell>
                  <TableCell className="text-right space-x-1">
                    {r.status === "requested" && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={decideRefund.isPending}
                          onClick={() => decideRefund.mutate({ refundRef: r.refund_ref, decision: "approved" })}>Approve</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400" disabled={decideRefund.isPending}
                          onClick={() => decideRefund.mutate({ refundRef: r.refund_ref, decision: "rejected" })}>Reject</Button>
                      </>
                    )}
                    {r.status === "approved" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={decideRefund.isPending}
                        title="Confirms the payout and reverts the fine"
                        onClick={() => decideRefund.mutate({ refundRef: r.refund_ref, decision: "processed" })}>Confirm payout</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(refunds.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No refund requests.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Receipts tab ───────────────────────────────────────────────────────────

function ReceiptsTab() {
  const receipts = trpc.finePayments.listReceipts.useQuery({});
  const [resendTo, setResendTo] = useState("");
  const resend = trpc.finePayments.resendReceipt.useMutation({
    onSuccess: (res: any) => toast.success(res.sent ? "Receipt re-sent" : "Receipt email queued"),
    onError: (e: any) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  return (
    <Card className="bg-card/50 border-border">
      <CardHeader><CardTitle className="text-foreground text-base">Issued receipts</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="text-muted-foreground">Receipt no.</TableHead>
              <TableHead className="text-muted-foreground">RRR</TableHead>
              <TableHead className="text-muted-foreground">Penalty</TableHead>
              <TableHead className="text-muted-foreground">Amount</TableHead>
              <TableHead className="text-muted-foreground">Payer email</TableHead>
              <TableHead className="text-muted-foreground">Issued</TableHead>
              <TableHead className="text-muted-foreground text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(receipts.data ?? []).map((r: any) => (
              <TableRow key={r.id} className="border-border">
                <TableCell className="font-mono text-xs">{r.receipt_number}</TableCell>
                <TableCell className="font-mono text-xs">{r.rrr ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{r.penalty_id ?? "—"}</TableCell>
                <TableCell>{formatNGN(Number(r.amount))}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.payer_email ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.issued_at ? new Date(r.issued_at).toLocaleString() : "—"}</TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end items-center">
                    <Input value={resendTo} onChange={(e) => setResendTo(e.target.value)} placeholder="override email" className="h-7 w-40 text-xs bg-muted border-border" />
                    <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={resend.isPending}
                      onClick={() => resend.mutate({ receiptNumber: r.receipt_number, to: resendTo.trim() || undefined })}>
                      Resend
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {(receipts.data ?? []).length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No receipts issued yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Page shell ─────────────────────────────────────────────────────────────

export default function FinePayments() {
  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Banking", href: "/financial" }, { label: "Fine Payments" }]} className="mb-4" />
      <Tabs defaultValue="fines">
        <TabsList>
          <TabsTrigger value="fines">Fine register & RRR</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
          <TabsTrigger value="refunds">Refunds</TabsTrigger>
          <TabsTrigger value="receipts">Receipts</TabsTrigger>
        </TabsList>
        <TabsContent value="fines" className="mt-4"><FinesTab /></TabsContent>
        <TabsContent value="reconciliation" className="mt-4"><ReconciliationTab /></TabsContent>
        <TabsContent value="refunds" className="mt-4"><RefundsTab /></TabsContent>
        <TabsContent value="receipts" className="mt-4"><ReceiptsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
