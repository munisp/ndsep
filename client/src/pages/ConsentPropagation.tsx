import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useRbac } from "@/hooks/useRbac";
import { GitBranch, RefreshCw, ShieldCheck, Timer, KeyRound, Send } from "lucide-react";

/**
 * Consent Withdrawal Propagation Console (Round-16 W2).
 * Wires the full consentPropagation router (16 procedures).
 *
 * PRIVACY: subject references are keyed-HMAC pseudonyms on the platform. This
 * UI NEVER renders raw subject identifiers — only truncated HMAC hashes.
 */
function maskHash(h?: string | null): string {
  if (!h) return "—";
  const s = String(h);
  return s.length <= 16 ? s : `${s.slice(0, 8)}…${s.slice(-6)}`;
}

const PROP_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  notified: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  acknowledged: "bg-green-500/20 text-green-300 border-green-500/40",
  failed: "bg-red-500/20 text-red-300 border-red-500/40",
  overdue: "bg-orange-500/20 text-orange-300 border-orange-500/40",
};

function fmtTs(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Hours remaining until the ack SLA deadline; negative = overdue. */
function slaHoursRemaining(notifiedAt?: string | null, slaHours?: number | null): number | null {
  if (!notifiedAt || !slaHours) return null;
  const deadline = new Date(notifiedAt).getTime() + slaHours * 3_600_000;
  if (Number.isNaN(deadline)) return null;
  return Math.round((deadline - Date.now()) / 3_600_000);
}

export default function ConsentPropagation() {
  const { isAdmin } = useRbac();
  const [orgIdInput, setOrgIdInput] = useState("");
  const orgId = Number(orgIdInput);
  const orgValid = Number.isInteger(orgId) && orgId > 0;
  const [selectedPurposeId, setSelectedPurposeId] = useState<number | null>(null);
  const [activeOnly, setActiveOnly] = useState(true);

  // ── Queries ────────────────────────────────────────────────────────────────
  const purposes = trpc.consentPropagation.listPurposes.useQuery(
    { organizationId: orgId, activeOnly },
    { enabled: orgValid }
  );
  const processors = trpc.consentPropagation.listProcessors.useQuery(
    { purposeId: selectedPurposeId as number },
    { enabled: selectedPurposeId != null }
  );
  const [withdrawalFilterPurpose, setWithdrawalFilterPurpose] = useState<number | null>(null);
  const withdrawals = trpc.consentPropagation.listWithdrawals.useQuery(
    {
      purposeId: withdrawalFilterPurpose ?? undefined,
      organizationId: orgValid ? orgId : undefined,
    }
  );
  const [propStatus, setPropStatus] = useState<string>("");
  const [propEventId, setPropEventId] = useState<number | null>(null);
  const propagation = trpc.consentPropagation.listPropagationRecords.useQuery({
    withdrawalEventId: propEventId ?? undefined,
    status: propStatus || undefined,
  });
  const overdueReport = trpc.consentPropagation.overdueAckReport.useQuery();

  const refreshAll = () => {
    purposes.refetch(); processors.refetch(); withdrawals.refetch();
    propagation.refetch(); overdueReport.refetch();
  };

  // ── Mutations ──────────────────────────────────────────────────────────────
  const [purposeForm, setPurposeForm] = useState({ purposeKey: "", name: "", description: "" });
  const createPurpose = trpc.consentPropagation.createPurpose.useMutation({
    onSuccess: () => { toast.success("Purpose registered"); setPurposeForm({ purposeKey: "", name: "", description: "" }); purposes.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const deactivatePurpose = trpc.consentPropagation.deactivatePurpose.useMutation({
    onSuccess: () => { toast.success("Purpose deactivated"); purposes.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const [procForm, setProcForm] = useState({ processorName: "", contactEmail: "", ackEndpointUrl: "", slaHours: "72" });
  const registerProcessor = trpc.consentPropagation.registerProcessor.useMutation({
    onSuccess: () => { toast.success("Processor registered"); setProcForm({ processorName: "", contactEmail: "", ackEndpointUrl: "", slaHours: "72" }); processors.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const [wdForm, setWdForm] = useState({ purposeId: "", subjectRef: "", consentRecordId: "", reason: "", initiatedBy: "subject" as "subject" | "org" | "regulator" });
  const [lastAckTokens, setLastAckTokens] = useState<Array<{ processorId: number; processorName: string; ackToken: string }> | null>(null);
  const recordWithdrawal = trpc.consentPropagation.recordWithdrawal.useMutation({
    onSuccess: (r: any) => {
      toast.success(`Withdrawal recorded — ${r.processorsNotified ?? 0} downstream processor(s) fanned out${r.idempotent ? " (idempotent replay)" : ""}`);
      setLastAckTokens(r.ackTokens ?? []);
      setWdForm({ purposeId: "", subjectRef: "", consentRecordId: "", reason: "", initiatedBy: "subject" });
      withdrawals.refetch(); propagation.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const [notifyChannel, setNotifyChannel] = useState<Record<number, "email" | "webhook" | "manual">>({});
  const markNotified = trpc.consentPropagation.markNotified.useMutation({
    onSuccess: (r: any) => {
      if (r?.status === "failed") toast.error(`Dispatch failed: ${r.dispatchNote ?? "unknown"}`);
      else toast.success("Processor notified — SLA clock started");
      propagation.refetch(); overdueReport.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const retryFailed = trpc.consentPropagation.retryFailedDispatches.useMutation({
    onSuccess: (r: any) => { toast.success(`Retry sweep: ${r.attempted ?? 0} attempted, ${r.notified ?? 0} notified, ${r.stillFailed ?? 0} still failed`); propagation.refetch(); overdueReport.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const [ackForm, setAckForm] = useState({ ackToken: "", proofRef: "" });
  const acknowledgeByToken = trpc.consentPropagation.acknowledgeByToken.useMutation({
    onSuccess: () => { toast.success("Acknowledgement recorded with proof reference"); setAckForm({ ackToken: "", proofRef: "" }); propagation.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const reissueAckToken = trpc.consentPropagation.reissueAckToken.useMutation({
    onSuccess: (r: any) => { toast.success(`New ack token issued (shown once): ${r.ackToken}`, { duration: 30000 }); propagation.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const [linkForm, setLinkForm] = useState({ consentRecordId: "", ttlHours: "72" });
  const createWithdrawalLink = trpc.consentPropagation.createWithdrawalLink.useMutation({
    onSuccess: (r: any) => { toast.success(`Withdrawal link token (shown once, valid ${r.expiresInHours}h): ${r.token}`, { duration: 30000 }); },
    onError: (err) => toast.error(err.message),
  });

  const [selfService, setSelfService] = useState({ token: "", reason: "" });
  const withdrawByToken = trpc.consentPropagation.withdrawByToken.useMutation({
    onSuccess: (r: any) => { toast.success(`Consent withdrawn for record #${r.consentRecordId}${r.alreadyWithdrawn ? " (already withdrawn)" : ""}`); setSelfService({ token: "", reason: "" }); withdrawals.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const flagOverdue = trpc.consentPropagation.flagOverdue.useMutation({
    onSuccess: (r: any) => { toast.success(`Flagged ${r.flagged ?? 0} overdue propagation record(s)`); propagation.refetch(); overdueReport.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const purposeRows: any[] = useMemo(() => (purposes.data as any[]) ?? [], [purposes.data]);
  const processorRows: any[] = useMemo(() => (processors.data as any[]) ?? [], [processors.data]);
  const withdrawalRows: any[] = useMemo(() => (withdrawals.data as any[]) ?? [], [withdrawals.data]);
  const propRows: any[] = useMemo(() => (propagation.data as any[]) ?? [], [propagation.data]);
  const reportData: any = overdueReport.data;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Consent Propagation" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><GitBranch className="h-6 w-6" /> Consent Withdrawal Propagation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            NDPA s.35 withdrawal parity — fan-out to downstream controllers/processors, SLA-tracked acknowledgements.
            Subject identities are pseudonymised (keyed HMAC refs); raw identifiers are never displayed.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={refreshAll}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {/* Org scope selector — required for purpose registry + org-scoped mutations */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Organisation scope</CardTitle>
          <CardDescription>Purpose registry and withdrawals are org-scoped (org_admin callers are confined to their own org).</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3 items-end flex-wrap">
          <div>
            <Label>Organisation ID</Label>
            <Input className="w-40" value={orgIdInput} onChange={(e) => setOrgIdInput(e.target.value)} placeholder="e.g. 12" inputMode="numeric" />
          </div>
          <div className="flex items-center gap-2 pb-1">
            <input id="activeOnly" type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} className="h-4 w-4" />
            <Label htmlFor="activeOnly">Active purposes only</Label>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="purposes">
        <TabsList className="flex-wrap">
          <TabsTrigger value="purposes">Purposes &amp; processors</TabsTrigger>
          <TabsTrigger value="withdrawals">Withdrawals</TabsTrigger>
          <TabsTrigger value="propagation">Propagation &amp; SLA</TabsTrigger>
          <TabsTrigger value="tokens">Tokens &amp; self-service</TabsTrigger>
          <TabsTrigger value="report">Overdue report</TabsTrigger>
        </TabsList>

        {/* ── Purposes & processors ─────────────────────────────────────── */}
        <TabsContent value="purposes" className="mt-4 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Register purpose</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>Purpose key (lowercase snake_case)</Label>
                  <Input value={purposeForm.purposeKey} onChange={(e) => setPurposeForm({ ...purposeForm, purposeKey: e.target.value })} placeholder="marketing_analytics" />
                </div>
                <div>
                  <Label>Name</Label>
                  <Input value={purposeForm.name} onChange={(e) => setPurposeForm({ ...purposeForm, name: e.target.value })} placeholder="Marketing analytics" />
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea value={purposeForm.description} onChange={(e) => setPurposeForm({ ...purposeForm, description: e.target.value })} rows={2} />
                </div>
                <Button
                  disabled={!orgValid || !purposeForm.purposeKey || !purposeForm.name || createPurpose.isPending}
                  onClick={() => createPurpose.mutate({ organizationId: orgId, purposeKey: purposeForm.purposeKey, name: purposeForm.name, description: purposeForm.description || undefined })}
                >Register purpose</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Register downstream processor</CardTitle>
                <CardDescription>Ack endpoints are SSRF-validated (https + public hostname, DNS-checked) at registration and dispatch.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>Purpose</Label>
                  <Select value={selectedPurposeId != null ? String(selectedPurposeId) : ""} onValueChange={(v) => setSelectedPurposeId(Number(v))}>
                    <SelectTrigger><SelectValue placeholder="Select purpose" /></SelectTrigger>
                    <SelectContent>
                      {purposeRows.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name} ({p.purpose_key})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Processor name</Label>
                  <Input value={procForm.processorName} onChange={(e) => setProcForm({ ...procForm, processorName: e.target.value })} />
                </div>
                <div>
                  <Label>Contact email</Label>
                  <Input type="email" value={procForm.contactEmail} onChange={(e) => setProcForm({ ...procForm, contactEmail: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Ack endpoint URL (optional)</Label>
                    <Input value={procForm.ackEndpointUrl} onChange={(e) => setProcForm({ ...procForm, ackEndpointUrl: e.target.value })} placeholder="https://…" />
                  </div>
                  <div>
                    <Label>SLA hours</Label>
                    <Input inputMode="numeric" value={procForm.slaHours} onChange={(e) => setProcForm({ ...procForm, slaHours: e.target.value })} />
                  </div>
                </div>
                <Button
                  disabled={selectedPurposeId == null || !procForm.processorName || !procForm.contactEmail || registerProcessor.isPending}
                  onClick={() => registerProcessor.mutate({
                    purposeId: selectedPurposeId as number,
                    processorName: procForm.processorName,
                    contactEmail: procForm.contactEmail,
                    ackEndpointUrl: procForm.ackEndpointUrl || undefined,
                    slaHours: Number(procForm.slaHours) || 72,
                  })}
                >Register processor</Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Consent purposes</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead><TableHead>Name</TableHead><TableHead>Active</TableHead>
                    <TableHead>Processors</TableHead><TableHead>Withdrawals</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purposeRows.map((p) => (
                    <TableRow key={p.id} className={selectedPurposeId === p.id ? "bg-muted/50" : ""}>
                      <TableCell className="font-mono text-xs">{p.purpose_key}</TableCell>
                      <TableCell>{p.name}</TableCell>
                      <TableCell><Badge variant="outline" className={p.is_active ? "bg-green-500/20 text-green-300 border-green-500/40" : "bg-muted text-muted-foreground border-border"}>{p.is_active ? "active" : "inactive"}</Badge></TableCell>
                      <TableCell>{p.processor_count ?? 0}</TableCell>
                      <TableCell>{p.withdrawal_count ?? 0}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button size="sm" variant="outline" onClick={() => setSelectedPurposeId(p.id)}>Processors</Button>
                        {p.is_active && (
                          <Button size="sm" variant="destructive" disabled={deactivatePurpose.isPending} onClick={() => deactivatePurpose.mutate({ id: p.id })}>Deactivate</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {orgValid && purposeRows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No purposes found for this organisation.</TableCell></TableRow>}
                  {!orgValid && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Enter an organisation ID above to load purposes.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {selectedPurposeId != null && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Downstream processors — purpose #{selectedPurposeId}</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Ack endpoint</TableHead>
                      <TableHead>SLA (h)</TableHead><TableHead>Active</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processorRows.map((dp) => (
                      <TableRow key={dp.id}>
                        <TableCell>{dp.processor_name}</TableCell>
                        <TableCell className="text-xs">{dp.contact_email}</TableCell>
                        <TableCell className="font-mono text-xs max-w-[240px] truncate">{dp.ack_endpoint_url ?? "— (manual/email)"}</TableCell>
                        <TableCell>{dp.sla_hours}</TableCell>
                        <TableCell>{dp.is_active ? "yes" : "no"}</TableCell>
                      </TableRow>
                    ))}
                    {processorRows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No processors registered for this purpose.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Withdrawals ───────────────────────────────────────────────── */}
        <TabsContent value="withdrawals" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Record withdrawal</CardTitle>
              <CardDescription>
                Fans out to every active processor of the purpose in one transaction. Ack tokens are shown ONCE — deliver them to processors out-of-band.
                The subject reference is stored encrypted; only its keyed HMAC is used for lookups.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <Label>Purpose</Label>
                  <Select value={wdForm.purposeId} onValueChange={(v) => setWdForm({ ...wdForm, purposeId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select purpose" /></SelectTrigger>
                    <SelectContent>
                      {purposeRows.filter((p) => p.is_active).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name} ({p.purpose_key})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Subject reference (Pseudonymised server-side — never stored raw)</Label>
                  <Input value={wdForm.subjectRef} onChange={(e) => setWdForm({ ...wdForm, subjectRef: e.target.value })} placeholder="Opaque subject ref / tracking id" />
                </div>
                <div>
                  <Label>Consent record ID (optional)</Label>
                  <Input inputMode="numeric" value={wdForm.consentRecordId} onChange={(e) => setWdForm({ ...wdForm, consentRecordId: e.target.value })} />
                </div>
                <div>
                  <Label>Initiated by</Label>
                  <Select value={wdForm.initiatedBy} onValueChange={(v) => setWdForm({ ...wdForm, initiatedBy: v as typeof wdForm.initiatedBy })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["subject", "org", "regulator"] as const).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Reason (optional)</Label>
                <Textarea rows={2} value={wdForm.reason} onChange={(e) => setWdForm({ ...wdForm, reason: e.target.value })} />
              </div>
              <Button
                disabled={!wdForm.purposeId || !wdForm.subjectRef || recordWithdrawal.isPending}
                onClick={() => recordWithdrawal.mutate({
                  purposeId: Number(wdForm.purposeId),
                  subjectRef: wdForm.subjectRef,
                  consentRecordId: wdForm.consentRecordId ? Number(wdForm.consentRecordId) : undefined,
                  reason: wdForm.reason || undefined,
                  initiatedBy: wdForm.initiatedBy,
                })}
              >Record withdrawal &amp; fan out</Button>
              {lastAckTokens && lastAckTokens.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
                  <p className="text-sm font-medium flex items-center gap-2"><KeyRound className="h-4 w-4" /> One-time ack tokens (copy now — never shown again):</p>
                  {lastAckTokens.map((t) => (
                    <p key={t.processorId} className="font-mono text-xs break-all">{t.processorName}: {t.ackToken}</p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Withdrawal events (audit trail)</CardTitle>
                <Select value={withdrawalFilterPurpose != null ? String(withdrawalFilterPurpose) : "all"} onValueChange={(v) => setWithdrawalFilterPurpose(v === "all" ? null : Number(v))}>
                  <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All purposes</SelectItem>
                    {purposeRows.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead><TableHead>Purpose</TableHead><TableHead>Subject ref (HMAC)</TableHead>
                    <TableHead>Initiated by</TableHead><TableHead>Withdrawn at</TableHead><TableHead>Propagation</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {withdrawalRows.map((we) => (
                    <TableRow key={we.id}>
                      <TableCell className="font-mono text-xs">#{we.id}</TableCell>
                      <TableCell className="text-xs">{we.purpose_name ?? we.purpose_key}</TableCell>
                      <TableCell className="font-mono text-xs" title="Keyed HMAC pseudonym — raw identifiers are never displayed">{maskHash(we.subject_ref_hash)}</TableCell>
                      <TableCell><Badge variant="outline">{we.initiated_by}</Badge></TableCell>
                      <TableCell className="text-xs">{fmtTs(we.withdrawn_at)}</TableCell>
                      <TableCell className="text-xs">{we.propagation_acked ?? 0}/{we.propagation_total ?? 0} acked</TableCell>
                      <TableCell><Button size="sm" variant="outline" onClick={() => { setPropEventId(we.id); }}>View propagation</Button></TableCell>
                    </TableRow>
                  ))}
                  {withdrawalRows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No withdrawal events.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Propagation & SLA ─────────────────────────────────────────── */}
        <TabsContent value="propagation" className="mt-4 space-y-4">
          <div className="flex gap-2 items-end flex-wrap">
            <div>
              <Label>Status</Label>
              <Select value={propStatus || "all"} onValueChange={(v) => setPropStatus(v === "all" ? "" : v)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {["pending", "notified", "acknowledged", "failed", "overdue"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Withdrawal event</Label>
              <Input className="w-40" inputMode="numeric" value={propEventId != null ? String(propEventId) : ""} onChange={(e) => setPropEventId(e.target.value ? Number(e.target.value) : null)} placeholder="All events" />
            </div>
            {isAdmin && (
              <>
                <Button variant="outline" disabled={retryFailed.isPending} onClick={() => retryFailed.mutate({ limit: 25 })}>
                  <Send className="h-4 w-4 mr-1" /> Retry failed dispatches
                </Button>
                <Button variant="outline" disabled={flagOverdue.isPending} onClick={() => flagOverdue.mutate()}>
                  <Timer className="h-4 w-4 mr-1" /> Flag overdue
                </Button>
              </>
            )}
          </div>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Propagation records</CardTitle>
              <CardDescription>Downstream notify/ack status per processor. SLA countdown runs from confirmed dispatch (notified_at + processor SLA hours).</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead><TableHead>Event</TableHead><TableHead>Processor</TableHead>
                    <TableHead>Status</TableHead><TableHead>Channel</TableHead><TableHead>Notified</TableHead>
                    <TableHead>SLA countdown</TableHead><TableHead>Acked / proof</TableHead><TableHead>Retries</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {propRows.map((pr) => {
                    const remaining = slaHoursRemaining(pr.notified_at, pr.sla_hours);
                    const canNotify = ["pending", "failed"].includes(pr.status);
                    const canReissue = isAdmin && ["pending", "notified", "overdue", "failed"].includes(pr.status);
                    return (
                      <TableRow key={pr.id}>
                        <TableCell className="font-mono text-xs">#{pr.id}</TableCell>
                        <TableCell className="font-mono text-xs">#{pr.withdrawal_event_id}</TableCell>
                        <TableCell>
                          <div className="text-sm">{pr.processor_name}</div>
                          <div className="text-xs text-muted-foreground">{pr.contact_email}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={PROP_STATUS_COLORS[pr.status] ?? ""}>{pr.status}</Badge>
                          {pr.ack_overdue === true && <Badge variant="outline" className="ml-1 bg-orange-500/20 text-orange-300 border-orange-500/40">overdue</Badge>}
                        </TableCell>
                        <TableCell className="text-xs">{pr.notification_channel ?? "—"}</TableCell>
                        <TableCell className="text-xs">{fmtTs(pr.notified_at)}</TableCell>
                        <TableCell className="text-xs">
                          {pr.status === "acknowledged" ? "—"
                            : remaining == null ? (pr.status === "pending" || pr.status === "failed" ? "not dispatched" : "—")
                            : remaining >= 0 ? <span className="text-green-400">{remaining}h left</span>
                            : <span className="text-orange-400">{Math.abs(remaining)}h overdue</span>}
                        </TableCell>
                        <TableCell className="text-xs max-w-[180px]">
                          {pr.acked_at ? <div>{fmtTs(pr.acked_at)}</div> : "—"}
                          {pr.proof_ref ? <div className="font-mono truncate" title={pr.proof_ref}>{pr.proof_ref}</div> : null}
                        </TableCell>
                        <TableCell className="text-xs">{pr.retry_count ?? 0}{pr.next_retry_at ? <div className="text-muted-foreground">next {fmtTs(pr.next_retry_at)}</div> : null}</TableCell>
                        <TableCell className="text-right space-y-1">
                          {canNotify && (
                            <div className="flex gap-1 justify-end">
                              <Select value={notifyChannel[pr.id] ?? "webhook"} onValueChange={(v) => setNotifyChannel({ ...notifyChannel, [pr.id]: v as "email" | "webhook" | "manual" })}>
                                <SelectTrigger className="w-24 h-8"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {(["webhook", "email", "manual"] as const).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                </SelectContent>
                              </Select>
                              <Button size="sm" disabled={markNotified.isPending} onClick={() => markNotified.mutate({ id: pr.id, channel: notifyChannel[pr.id] ?? "webhook" })}>Dispatch</Button>
                            </div>
                          )}
                          {canReissue && (
                            <Button size="sm" variant="ghost" disabled={reissueAckToken.isPending} onClick={() => reissueAckToken.mutate({ propagationRecordId: pr.id })}>Reissue ack token</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {propRows.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">No propagation records match the filter.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tokens & self-service ─────────────────────────────────────── */}
        <TabsContent value="tokens" className="mt-4 space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Processor acknowledgement</CardTitle>
                <CardDescription>Public token endpoint — a processor acknowledges cessation with a proof reference.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>Ack token</Label>
                  <Input value={ackForm.ackToken} onChange={(e) => setAckForm({ ...ackForm, ackToken: e.target.value })} placeholder="One-time token delivered out-of-band" />
                </div>
                <div>
                  <Label>Proof reference</Label>
                  <Input value={ackForm.proofRef} onChange={(e) => setAckForm({ ...ackForm, proofRef: e.target.value })} placeholder="Deletion/cessation proof ref" />
                </div>
                <Button
                  disabled={ackForm.ackToken.length < 32 || ackForm.proofRef.length < 4 || acknowledgeByToken.isPending}
                  onClick={() => acknowledgeByToken.mutate({ ackToken: ackForm.ackToken, proofRef: ackForm.proofRef })}
                ><ShieldCheck className="h-4 w-4 mr-1" /> Acknowledge</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Create self-service withdrawal link</CardTitle>
                <CardDescription>Staff-side: mint a signed one-time link token for a consent record. Raw token shown once.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>Consent record ID</Label>
                  <Input inputMode="numeric" value={linkForm.consentRecordId} onChange={(e) => setLinkForm({ ...linkForm, consentRecordId: e.target.value })} />
                </div>
                <div>
                  <Label>TTL (hours)</Label>
                  <Input inputMode="numeric" value={linkForm.ttlHours} onChange={(e) => setLinkForm({ ...linkForm, ttlHours: e.target.value })} />
                </div>
                <Button
                  disabled={!linkForm.consentRecordId || createWithdrawalLink.isPending}
                  onClick={() => createWithdrawalLink.mutate({ consentRecordId: Number(linkForm.consentRecordId), ttlHours: Number(linkForm.ttlHours) || 72 })}
                >Create link token</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Self-service withdrawal</CardTitle>
                <CardDescription>Public: data subject withdraws consent with their one-time token (NDPA s.35 parity).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>Withdrawal token</Label>
                  <Input value={selfService.token} onChange={(e) => setSelfService({ ...selfService, token: e.target.value })} />
                </div>
                <div>
                  <Label>Reason (optional)</Label>
                  <Textarea rows={2} value={selfService.reason} onChange={(e) => setSelfService({ ...selfService, reason: e.target.value })} />
                </div>
                <Button
                  disabled={selfService.token.length < 20 || withdrawByToken.isPending}
                  onClick={() => withdrawByToken.mutate({ token: selfService.token, reason: selfService.reason || undefined })}
                >Withdraw consent</Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Overdue report ────────────────────────────────────────────── */}
        <TabsContent value="report" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Acknowledged", value: reportData?.totals?.acknowledged },
              { label: "In flight", value: reportData?.totals?.in_flight },
              { label: "Failed", value: reportData?.totals?.failed },
              { label: "Overdue", value: reportData?.totals?.overdue },
            ].map((kpi) => (
              <Card key={kpi.label}>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold">{kpi.value ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{kpi.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Overdue acknowledgements by processor (escalation report)</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Processor</TableHead><TableHead>Purpose</TableHead><TableHead>Organisation</TableHead>
                    <TableHead>SLA (h)</TableHead><TableHead>Overdue count</TableHead><TableHead>Oldest notification</TableHead><TableHead>Max hours overdue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((reportData?.byProcessor as any[]) ?? []).map((r: any) => (
                    <TableRow key={r.processor_id}>
                      <TableCell>
                        <div className="text-sm">{r.processor_name}</div>
                        <div className="text-xs text-muted-foreground">{r.contact_email}</div>
                      </TableCell>
                      <TableCell className="text-xs">{r.purpose_name} <span className="font-mono">({r.purpose_key})</span></TableCell>
                      <TableCell className="text-xs">{r.org_name}</TableCell>
                      <TableCell>{r.sla_hours}</TableCell>
                      <TableCell><Badge variant="outline" className="bg-orange-500/20 text-orange-300 border-orange-500/40">{r.overdue_count}</Badge></TableCell>
                      <TableCell className="text-xs">{fmtTs(r.oldest_notification)}</TableCell>
                      <TableCell className="text-orange-400">{r.max_hours_overdue ?? "—"}h</TableCell>
                    </TableRow>
                  ))}
                  {((reportData?.byProcessor as any[]) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No overdue acknowledgements — all processors within SLA.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
