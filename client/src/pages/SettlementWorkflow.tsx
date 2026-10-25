import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Handshake, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";

const STATUSES = ["proposal", "counter", "agreement", "approval", "active", "fulfilled", "defaulted", "void"] as const;
const STATUS_COLORS: Record<string, string> = {
  proposal: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  counter: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  agreement: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
  approval: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  active: "bg-green-500/20 text-green-300 border-green-500/40",
  fulfilled: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  defaulted: "bg-red-500/20 text-red-300 border-red-500/40",
  void: "bg-muted text-muted-foreground border-border",
};

type Instalment = { seq: number; dueDate: string; amount: number };

type TermsForm = {
  monetaryAmount: string;
  currency: string;
  obligations: string;
  instalments: Instalment[];
  confidentialityFlag: boolean;
  transparencyRationale: string;
};

const emptyTerms: TermsForm = { monetaryAmount: "", currency: "NGN", obligations: "", instalments: [], confidentialityFlag: false, transparencyRationale: "" };

function TermsEditor({ value, onChange }: { value: TermsForm; onChange: (t: TermsForm) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Monetary amount</Label>
          <Input type="number" min="0" value={value.monetaryAmount} onChange={(e) => onChange({ ...value, monetaryAmount: e.target.value })} />
        </div>
        <div>
          <Label>Currency (ISO 4217)</Label>
          <Input value={value.currency} maxLength={3} onChange={(e) => onChange({ ...value, currency: e.target.value.toUpperCase() })} />
        </div>
      </div>
      <div>
        <Label>Non-monetary obligations (one per line)</Label>
        <Textarea value={value.obligations} onChange={(e) => onChange({ ...value, obligations: e.target.value })} rows={2} placeholder="e.g. Publish a remediation notice within 30 days" />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label>Instalment schedule</Label>
          <Button
            type="button" size="sm" variant="outline"
            onClick={() => onChange({ ...value, instalments: [...value.instalments, { seq: value.instalments.length + 1, dueDate: "", amount: 0 }] })}
          ><Plus className="h-3 w-3 mr-1" /> Add instalment</Button>
        </div>
        {value.instalments.map((inst, i) => (
          <div key={i} className="flex gap-2 items-center mb-1">
            <span className="text-xs font-mono w-6">#{inst.seq}</span>
            <Input type="date" value={inst.dueDate} onChange={(e) => onChange({ ...value, instalments: value.instalments.map((x, j) => j === i ? { ...x, dueDate: e.target.value } : x) })} />
            <Input type="number" min="0" placeholder="amount" value={inst.amount || ""} onChange={(e) => onChange({ ...value, instalments: value.instalments.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x) })} />
            <button type="button" className="text-red-400" onClick={() => onChange({ ...value, instalments: value.instalments.filter((_, j) => j !== i).map((x, j) => ({ ...x, seq: j + 1 })) })}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={value.confidentialityFlag} onCheckedChange={(c) => onChange({ ...value, confidentialityFlag: c === true })} />
        Confidential settlement (requires transparency rationale)
      </label>
      {value.confidentialityFlag && (
        <Textarea value={value.transparencyRationale} onChange={(e) => onChange({ ...value, transparencyRationale: e.target.value })} rows={2} placeholder="Transparency rationale for confidentiality" />
      )}
    </div>
  );
}

function toTermsPayload(t: TermsForm) {
  return {
    monetaryAmount: Number(t.monetaryAmount || 0),
    currency: t.currency,
    nonMonetaryObligations: t.obligations.split("\n").map((s) => s.trim()).filter(Boolean),
    instalmentSchedule: t.instalments.filter((i) => i.dueDate && i.amount > 0),
    confidentialityFlag: t.confidentialityFlag,
    transparencyRationale: t.transparencyRationale,
  };
}

export default function SettlementWorkflow() {
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const list = trpc.settlementWorkflow.listSettlements.useQuery({
    status: (statusFilter || undefined) as (typeof STATUSES)[number] | undefined,
  });
  const reconQueue = trpc.settlementWorkflow.ledgerReconciliationQueue.useQuery({ limit: 50 });

  const [selected, setSelected] = useState<number | null>(null);
  const detail = trpc.settlementWorkflow.getSettlement.useQuery({ settlementId: selected ?? 0 }, { enabled: selected != null });

  const refresh = () => { list.refetch(); reconQueue.refetch(); if (selected) detail.refetch(); };

  // Propose
  const [propCase, setPropCase] = useState("");
  const [propFine, setPropFine] = useState("");
  const [propName, setPropName] = useState("");
  const [propEmail, setPropEmail] = useState("");
  const [propTerms, setPropTerms] = useState<TermsForm>(emptyTerms);
  const propose = trpc.settlementWorkflow.proposeSettlement.useMutation({
    onSuccess: (res: any) => {
      toast.success(`Settlement ${res.settlementRef} opened`);
      setPropCase(""); setPropFine(""); setPropName(""); setPropEmail(""); setPropTerms(emptyTerms);
      refresh(); setSelected(res.settlementId);
    },
    onError: (err) => toast.error(err.message),
  });

  // Actions on selected settlement
  const [counterTerms, setCounterTerms] = useState<TermsForm>(emptyTerms);
  const [showCounter, setShowCounter] = useState(false);
  const counter = trpc.settlementWorkflow.counterPropose.useMutation({
    onSuccess: () => { toast.success("Counter-proposal recorded"); setShowCounter(false); refresh(); },
    onError: (err) => toast.error(err.message),
  });
  const accept = trpc.settlementWorkflow.acceptTerms.useMutation({
    onSuccess: () => { toast.success("Terms accepted — settlement in agreement"); refresh(); },
    onError: (err) => toast.error(err.message),
  });
  const submitApproval = trpc.settlementWorkflow.submitForApproval.useMutation({
    onSuccess: () => { toast.success("Submitted for approval"); refresh(); },
    onError: (err) => toast.error(err.message),
  });
  const [approveReason, setApproveReason] = useState("");
  const approve = trpc.settlementWorkflow.approveSettlement.useMutation({
    onSuccess: () => { toast.success("Settlement approved — now active"); refresh(); },
    onError: (err) => toast.error(err.message),
  });
  const [rejectReason, setRejectReason] = useState("");
  const reject = trpc.settlementWorkflow.rejectSettlement.useMutation({
    onSuccess: () => { toast.success("Settlement rejected (void)"); setRejectReason(""); refresh(); },
    onError: (err) => toast.error(err.message),
  });

  // Instalment payment
  const [paySeq, setPaySeq] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payRef, setPayRef] = useState("");
  const recordPayment = trpc.settlementWorkflow.recordInstalmentPayment.useMutation({
    onSuccess: (res: any) => {
      toast.success(`Payment recorded (ledger: ${res.ledger?.status ?? res.ledgerPostStatus ?? "recorded"})`);
      setPaySeq(""); setPayAmount(""); setPayRef("");
      refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const detectDefaults = trpc.settlementWorkflow.detectDefaults.useMutation({
    onSuccess: (res: any) => { toast.success(`Default scan complete — ${res.defaulted?.length ?? res.defaultedCount ?? 0} defaulted`); refresh(); },
    onError: (err) => toast.error(err.message),
  });

  // Waiver (dual control)
  const [waiverAmount, setWaiverAmount] = useState("");
  const [waiverBasis, setWaiverBasis] = useState("");
  const requestWaiver = trpc.settlementWorkflow.requestWaiver.useMutation({
    onSuccess: (res: any) => { toast.success(`Waiver queued for dual control (request ${res.dualControlRequestId})`); setWaiverAmount(""); setWaiverBasis(""); refresh(); },
    onError: (err) => toast.error(err.message),
  });
  const [execWaiverId, setExecWaiverId] = useState("");
  const executeWaiver = trpc.settlementWorkflow.executeWaiver.useMutation({
    onSuccess: () => { toast.success("Waiver executed"); setExecWaiverId(""); refresh(); },
    onError: (err) => toast.error(err.message),
  });

  const s: any = detail.data?.settlement;
  const terms: any[] = detail.data?.terms ?? [];
  const instalments: any[] = detail.data?.instalments ?? [];
  const approvals: any[] = detail.data?.approvals ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Settlement Workflow" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Handshake className="h-6 w-6" /> Settlement Workflow</h1>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4" /></Button>
          <Button variant="secondary" onClick={() => detectDefaults.mutate({})} disabled={detectDefaults.isPending}>
            {detectDefaults.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Detect defaults
          </Button>
        </div>
      </div>

      {/* Propose new settlement */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Propose a settlement</CardTitle>
          <CardDescription>One live settlement per enforcement case/fine.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label htmlFor="sw-case">Case reference</Label>
              <Input id="sw-case" value={propCase} onChange={(e) => setPropCase(e.target.value)} placeholder="ENF-2026-0001" />
            </div>
            <div>
              <Label htmlFor="sw-fine">Fine reference (optional)</Label>
              <Input id="sw-fine" value={propFine} onChange={(e) => setPropFine(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sw-name">Respondent name</Label>
              <Input id="sw-name" value={propName} onChange={(e) => setPropName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sw-email">Respondent email</Label>
              <Input id="sw-email" type="email" value={propEmail} onChange={(e) => setPropEmail(e.target.value)} />
            </div>
          </div>
          <TermsEditor value={propTerms} onChange={setPropTerms} />
          <Button
            disabled={propose.isPending || !propCase.trim() || propTerms.monetaryAmount === ""}
            onClick={() => propose.mutate({
              caseRef: propCase.trim(),
              fineReference: propFine || undefined,
              respondentName: propName || undefined,
              respondentEmail: propEmail || undefined,
              terms: toTermsPayload(propTerms),
            })}
          >
            {propose.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Open negotiation
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* List */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Settlements</CardTitle>
            <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
              <SelectTrigger className="w-44 mt-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUSES.map((st) => <SelectItem key={st} value={st}>{st}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="space-y-2">
            {(list.data?.rows ?? []).map((row: any) => (
              <button
                key={row.id}
                onClick={() => setSelected(row.id)}
                className={`w-full text-left border rounded px-3 py-2 text-sm ${selected === row.id ? "border-primary" : "border-border"}`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium font-mono text-xs">{row.settlement_ref}</span>
                  <Badge variant="outline" className={STATUS_COLORS[row.status] ?? ""}>{row.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {row.case_ref}{row.original_amount != null ? ` · original ${row.original_amount}` : ""}
                </p>
              </button>
            ))}
            {(list.data?.rows ?? []).length === 0 && <p className="text-sm text-muted-foreground">No settlements.</p>}
          </CardContent>
        </Card>

        {/* Detail */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-lg">Settlement detail</CardTitle>
            {s && <CardDescription className="font-mono">{s.settlement_ref} · {s.case_ref}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-4">
            {!s ? (
              <p className="text-sm text-muted-foreground">Select a settlement to manage its lifecycle.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {["proposal", "counter"].includes(s.status) && (
                    <>
                      <Button size="sm" onClick={() => accept.mutate({ settlementId: s.id })} disabled={accept.isPending}>Accept terms</Button>
                      <Button size="sm" variant="outline" onClick={() => setShowCounter(!showCounter)}>Counter-propose</Button>
                    </>
                  )}
                  {s.status === "agreement" && (
                    <Button size="sm" onClick={() => submitApproval.mutate({ settlementId: s.id })} disabled={submitApproval.isPending}>Submit for approval</Button>
                  )}
                  {s.status === "approval" && (
                    <Button size="sm" onClick={() => approve.mutate({ settlementId: s.id, reason: approveReason })} disabled={approve.isPending}>Approve (activate)</Button>
                  )}
                </div>

                {showCounter && (
                  <div className="border rounded-lg p-4 space-y-3">
                    <h3 className="font-medium">Counter-proposal (new terms version)</h3>
                    <TermsEditor value={counterTerms} onChange={setCounterTerms} />
                    <Button
                      size="sm"
                      disabled={counter.isPending || counterTerms.monetaryAmount === ""}
                      onClick={() => counter.mutate({ settlementId: s.id, terms: toTermsPayload(counterTerms) })}
                    >Submit counter</Button>
                  </div>
                )}

                {s.status === "approval" && (
                  <div className="border rounded-lg p-4 space-y-2">
                    <Label htmlFor="sw-approve-reason">Approval reason (optional)</Label>
                    <Input id="sw-approve-reason" value={approveReason} onChange={(e) => setApproveReason(e.target.value)} />
                    <div className="border-t pt-2 mt-2 flex gap-2 items-end">
                      <div className="flex-1">
                        <Label htmlFor="sw-reject-reason" className="text-red-400">Reject (void) — reason required (min 5 chars)</Label>
                        <Input id="sw-reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                      </div>
                      <Button variant="destructive" size="sm" disabled={reject.isPending || rejectReason.trim().length < 5} onClick={() => reject.mutate({ settlementId: s.id, reason: rejectReason.trim() })}>Reject</Button>
                    </div>
                  </div>
                )}

                {/* Terms history */}
                <div>
                  <h3 className="font-medium mb-2">Terms versions</h3>
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead className="text-right">v</TableHead><TableHead>Amount</TableHead><TableHead>Type</TableHead><TableHead>By</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {terms.map((t: any) => (
                        <TableRow key={t.version}>
                          <TableCell className="text-right font-mono">{t.version}</TableCell>
                          <TableCell className="font-mono">{t.currency} {Number(t.monetary_amount).toLocaleString()}</TableCell>
                          <TableCell>{t.is_counter ? "counter" : "initial"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{t.proposed_by}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Instalments */}
                <div>
                  <h3 className="font-medium mb-2">Instalments</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">Seq</TableHead><TableHead>Due</TableHead><TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Paid</TableHead><TableHead>Status</TableHead><TableHead>Ledger</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {instalments.map((i: any) => (
                        <TableRow key={i.seq}>
                          <TableCell className="text-right font-mono">{i.seq}</TableCell>
                          <TableCell className="text-sm">{String(i.due_date).slice(0, 10)}</TableCell>
                          <TableCell className="text-right font-mono">{i.currency} {Number(i.amount).toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono">{Number(i.amount_paid ?? 0).toLocaleString()}</TableCell>
                          <TableCell><Badge variant="outline">{i.status}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{i.ledger_post_status ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                      {instalments.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No instalments — single payment terms.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                  {s.status === "active" && (
                    <div className="border rounded-lg p-4 mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
                      <div>
                        <Label>Seq</Label>
                        <Input type="number" value={paySeq} onChange={(e) => setPaySeq(e.target.value)} />
                      </div>
                      <div>
                        <Label>Amount</Label>
                        <Input type="number" min="0" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                      </div>
                      <div className="md:col-span-2">
                        <Label>Payment reference</Label>
                        <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="bank transfer ref" />
                      </div>
                      <Button
                        size="sm"
                        disabled={recordPayment.isPending || !paySeq || !payAmount || payRef.trim().length < 3}
                        onClick={() => recordPayment.mutate({ settlementId: s.id, seq: Number(paySeq), amount: Number(payAmount), paymentReference: payRef.trim() })}
                      >Record payment</Button>
                    </div>
                  )}
                </div>

                {/* Approvals */}
                {approvals.length > 0 && (
                  <div>
                    <h3 className="font-medium mb-2">Approval decisions</h3>
                    <ul className="text-sm space-y-1">
                      {approvals.map((a: any, i: number) => (
                        <li key={i} className="text-muted-foreground">
                          {new Date(a.decided_at).toLocaleString()} — {a.approver} (level {a.approval_level}): <span className="text-foreground">{a.decision}</span>{a.reason ? ` — ${a.reason}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Waiver */}
                {["active", "defaulted"].includes(s.status) && (
                  <div className="border rounded-lg p-4 space-y-2">
                    <h3 className="font-medium">Waiver / reduction (dual control)</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                      <div>
                        <Label>Reduction amount</Label>
                        <Input type="number" min="0" value={waiverAmount} onChange={(e) => setWaiverAmount(e.target.value)} />
                      </div>
                      <div className="md:col-span-2">
                        <Label>Legal basis</Label>
                        <Input value={waiverBasis} onChange={(e) => setWaiverBasis(e.target.value)} />
                      </div>
                    </div>
                    <Button
                      size="sm" variant="secondary"
                      disabled={requestWaiver.isPending || !waiverAmount || !waiverBasis.trim()}
                      onClick={() => requestWaiver.mutate({ settlementId: s.id, reductionAmount: Number(waiverAmount), legalBasis: waiverBasis.trim() })}
                    >Request waiver</Button>
                    <div className="border-t pt-2 mt-2 flex gap-2 items-end">
                      <div className="flex-1">
                        <Label htmlFor="sw-exec-waiver">Execute waiver (admin) — dual-control request id</Label>
                        <Input id="sw-exec-waiver" type="number" value={execWaiverId} onChange={(e) => setExecWaiverId(e.target.value)} />
                      </div>
                      <Button
                        size="sm" variant="outline"
                        disabled={executeWaiver.isPending || !execWaiverId}
                        onClick={() => executeWaiver.mutate({ settlementId: s.id, dualControlRequestId: Number(execWaiverId) })}
                      >Execute</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Ledger reconciliation queue */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Ledger reconciliation queue</CardTitle>
          <CardDescription>Instalments recorded but not posted to the ledger (unconfigured bridge, failure, or non-USD currency) — manual reconciliation required.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Settlement</TableHead><TableHead className="text-right">Seq</TableHead><TableHead>Due</TableHead>
                <TableHead className="text-right">Amount</TableHead><TableHead>Ledger status</TableHead><TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(reconQueue.data?.rows ?? []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.settlement_ref} · {r.case_ref}</TableCell>
                  <TableCell className="text-right font-mono">{r.seq}</TableCell>
                  <TableCell className="text-sm">{String(r.due_date).slice(0, 10)}</TableCell>
                  <TableCell className="text-right font-mono">{r.currency} {Number(r.amount).toLocaleString()}</TableCell>
                  <TableCell><Badge variant="outline" className="bg-yellow-500/20 text-yellow-300 border-yellow-500/40">{r.ledger_post_status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">{r.ledger_error ?? "—"}</TableCell>
                </TableRow>
              ))}
              {(reconQueue.data?.rows ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Queue empty — all instalments posted.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
