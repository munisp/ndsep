/**
 * Regulator Reconciliation — cross-regulator reconciliation console.
 * Wires the full `regulatorReconciliation` router (10 procedures):
 * dual-jurisdiction conflict records, MoU case-referral pipeline
 * (sent → acknowledged → accepted/declined → resolved), and
 * regulator-scoped / aggregate reconciliation dashboards.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonTable } from "@/components/Skeleton";
import { ArrowLeftRight, GitBranch, Loader2, RefreshCw, Scale, Send, ShieldAlert } from "lucide-react";

const REGULATOR_CODES = ["NDPC", "CBN", "NCC", "SEC", "NAICOM", "FCCPC", "NITDA", "NIMC"] as const;
type RegulatorCode = (typeof REGULATOR_CODES)[number];
const CONFLICT_TYPES = ["overlapping_mandate", "concurrent_investigation", "double_jeopardy_risk", "data_sharing_dispute", "enforcement_precedence"] as const;
const CONFLICT_STATUSES = ["raised", "under_review", "resolved", "escalated"] as const;
const REFERRAL_STATUSES = ["sent", "acknowledged", "accepted", "declined", "resolved"] as const;

const STATUS_COLORS: Record<string, string> = {
  raised: "bg-red-500/20 text-red-300 border-red-500/40",
  under_review: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  escalated: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  resolved: "bg-green-500/20 text-green-300 border-green-500/40",
  sent: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  acknowledged: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  accepted: "bg-green-500/20 text-green-300 border-green-500/40",
  declined: "bg-red-500/20 text-red-300 border-red-500/40",
};

function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

function StatusBadge({ value }: { value: unknown }) {
  const v = String(value ?? "");
  return <Badge variant="outline" className={STATUS_COLORS[v] ?? ""}>{v.replaceAll("_", " ") || "—"}</Badge>;
}

function parseRegulators(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p.map(String) : [v]; } catch { return [v]; }
  }
  return [];
}

export default function RegulatorReconciliation() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isStaff = ["admin", "government_staff", "regulator"].includes(user?.role ?? "");

  // ── Conflicts ─────────────────────────────────────────────────────────────
  const [conflictStatus, setConflictStatus] = useState<string>("all");
  const [conflictMatter, setConflictMatter] = useState("");
  const conflicts = trpc.regulatorReconciliation.listConflicts.useQuery({
    ...(conflictStatus === "all" ? {} : { status: conflictStatus as (typeof CONFLICT_STATUSES)[number] }),
    ...(conflictMatter.trim() ? { matterRef: conflictMatter.trim() } : {}),
    limit: 100,
  });
  const [showRaise, setShowRaise] = useState(false);
  const [raiseForm, setRaiseForm] = useState({ matterRef: "", regulators: [] as RegulatorCode[], conflictType: "overlapping_mandate" as (typeof CONFLICT_TYPES)[number], description: "" });
  const raiseConflict = trpc.regulatorReconciliation.raiseConflict.useMutation({
    onSuccess: (row: any) => { toast.success(`Conflict #${row?.id ?? ""} raised`); setShowRaise(false); setRaiseForm({ matterRef: "", regulators: [], conflictType: "overlapping_mandate", description: "" }); conflicts.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const [resolveTarget, setResolveTarget] = useState<any | null>(null);
  const [resolveForm, setResolveForm] = useState({ status: "resolved" as "under_review" | "resolved" | "escalated", precedenceDecision: "", leadRegulator: "" as string });
  const resolveConflict = trpc.regulatorReconciliation.resolveConflict.useMutation({
    onSuccess: () => { toast.success("Conflict updated"); setResolveTarget(null); setResolveForm({ status: "resolved", precedenceDecision: "", leadRegulator: "" }); conflicts.refetch(); aggregate.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  // ── Referrals ─────────────────────────────────────────────────────────────
  const [refRegulator, setRefRegulator] = useState<string>("all");
  const [refStatus, setRefStatus] = useState<string>("all");
  const referrals = trpc.regulatorReconciliation.listReferrals.useQuery({
    ...(refRegulator === "all" ? {} : { regulator: refRegulator as RegulatorCode }),
    ...(refStatus === "all" ? {} : { status: refStatus as (typeof REFERRAL_STATUSES)[number] }),
    limit: 100,
  });
  const [showSend, setShowSend] = useState(false);
  const [sendForm, setSendForm] = useState({ fromRegulator: "NDPC" as RegulatorCode, toRegulator: "CBN" as RegulatorCode, matterRef: "", casePayload: "{}", notes: "" });
  const sendReferral = trpc.regulatorReconciliation.sendReferral.useMutation({
    onSuccess: (row: any) => { toast.success(`Referral ${row?.referral_ref ?? ""} sent`); setShowSend(false); setSendForm({ ...sendForm, matterRef: "", casePayload: "{}", notes: "" }); referrals.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const acknowledgeReferral = trpc.regulatorReconciliation.acknowledgeReferral.useMutation({
    onSuccess: (row: any) => { toast.success(`Referral ${row?.referral_ref ?? ""} acknowledged`); referrals.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const respondReferral = trpc.regulatorReconciliation.respondReferral.useMutation({
    onSuccess: (row: any) => { toast.success(`Referral ${row?.referral_ref ?? ""} ${row?.status ?? "updated"}`); setRespondTarget(null); setRespondNotes(""); referrals.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const resolveReferral = trpc.regulatorReconciliation.resolveReferral.useMutation({
    onSuccess: (row: any) => { toast.success(`Referral ${row?.referral_ref ?? ""} resolved`); setResolveRefTarget(null); setResolveRefNotes(""); referrals.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const [respondTarget, setRespondTarget] = useState<{ ref: string; decision: "accepted" | "declined" } | null>(null);
  const [respondNotes, setRespondNotes] = useState("");
  const [resolveRefTarget, setResolveRefTarget] = useState<string | null>(null);
  const [resolveRefNotes, setResolveRefNotes] = useState("");

  // ── Dashboards ────────────────────────────────────────────────────────────
  const [dashRegulator, setDashRegulator] = useState<RegulatorCode>("NDPC");
  const dashboard = trpc.regulatorReconciliation.regulatorDashboard.useQuery(
    { regulator: dashRegulator },
    { retry: false }
  );
  const aggregate = trpc.regulatorReconciliation.regulatorAggregateStats.useQuery(undefined, { retry: false });

  const conflictRows: any[] = (conflicts.data as any[]) ?? [];
  const referralRows: any[] = (referrals.data as any[]) ?? [];

  const toggleRegulator = (code: RegulatorCode) => {
    setRaiseForm((f) => ({
      ...f,
      regulators: f.regulators.includes(code) ? f.regulators.filter((c) => c !== code) : [...f.regulators, code],
    }));
  };

  let payloadError: string | null = null;
  let parsedPayload: Record<string, unknown> = {};
  try {
    const p = JSON.parse(sendForm.casePayload || "{}");
    if (p && typeof p === "object" && !Array.isArray(p)) parsedPayload = p;
    else payloadError = "Payload must be a JSON object";
  } catch {
    payloadError = "Invalid JSON";
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Regulator Reconciliation" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Scale className="h-6 w-6" /> Regulator Reconciliation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Dual-jurisdiction conflicts and MoU-based case referrals across sector regulators (NDPC, CBN, NCC, SEC, NAICOM, FCCPC, NITDA, NIMC).
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => utils.regulatorReconciliation.invalidate()}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      <Tabs defaultValue="conflicts">
        <TabsList>
          <TabsTrigger value="conflicts">Jurisdiction conflicts</TabsTrigger>
          <TabsTrigger value="referrals">Case referrals</TabsTrigger>
          <TabsTrigger value="dashboards">Sync status &amp; dashboards</TabsTrigger>
        </TabsList>

        {/* ── Conflicts ── */}
        <TabsContent value="conflicts" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2"><GitBranch className="h-5 w-5" /> Dual-jurisdiction conflicts</CardTitle>
                  <CardDescription>Matters where two or more regulators' mandates overlap.</CardDescription>
                </div>
                {isStaff && <Button onClick={() => setShowRaise((v) => !v)}><ShieldAlert className="h-4 w-4 mr-2" /> Raise conflict</Button>}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {showRaise && isStaff && (
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="rr-matter">Matter reference</Label>
                      <Input id="rr-matter" value={raiseForm.matterRef} onChange={(e) => setRaiseForm({ ...raiseForm, matterRef: e.target.value })} placeholder="e.g. CASE-2025-0142" />
                    </div>
                    <div>
                      <Label>Conflict type</Label>
                      <Select value={raiseForm.conflictType} onValueChange={(v) => setRaiseForm({ ...raiseForm, conflictType: v as (typeof CONFLICT_TYPES)[number] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{CONFLICT_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replaceAll("_", " ")}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Regulators involved (select at least 2)</Label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {REGULATOR_CODES.map((c) => (
                        <Button key={c} type="button" size="sm" variant={raiseForm.regulators.includes(c) ? "default" : "outline"} onClick={() => toggleRegulator(c)}>
                          {c}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="rr-desc">Description (min 10 chars)</Label>
                    <Textarea id="rr-desc" rows={3} value={raiseForm.description} onChange={(e) => setRaiseForm({ ...raiseForm, description: e.target.value })} />
                  </div>
                  <div className="flex gap-2">
                    <Button disabled={raiseConflict.isPending || raiseForm.matterRef.trim().length < 3 || raiseForm.regulators.length < 2 || raiseForm.description.trim().length < 10}
                      onClick={() => raiseConflict.mutate({
                        matterRef: raiseForm.matterRef.trim(),
                        regulators: raiseForm.regulators,
                        conflictType: raiseForm.conflictType,
                        description: raiseForm.description.trim(),
                      })}>
                      {raiseConflict.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Raise conflict
                    </Button>
                    <Button variant="ghost" onClick={() => setShowRaise(false)}>Cancel</Button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <Label>Status</Label>
                  <Select value={conflictStatus} onValueChange={setConflictStatus}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {CONFLICT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replaceAll("_", " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="rr-matter-filter">Matter ref</Label>
                  <Input id="rr-matter-filter" className="w-48" value={conflictMatter} onChange={(e) => setConflictMatter(e.target.value)} placeholder="any" />
                </div>
              </div>
              {conflicts.isLoading ? <SkeletonTable rows={5} cols={6} /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">#</TableHead>
                      <TableHead>Matter</TableHead>
                      <TableHead>Regulators</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Lead</TableHead>
                      <TableHead>Raised</TableHead>
                      {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {conflictRows.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-right font-mono">{c.id}</TableCell>
                        <TableCell className="font-mono text-sm">{c.matter_ref}</TableCell>
                        <TableCell className="text-sm">{parseRegulators(c.regulators).join(", ")}</TableCell>
                        <TableCell><Badge variant="outline">{String(c.conflict_type ?? "").replaceAll("_", " ")}</Badge></TableCell>
                        <TableCell><StatusBadge value={c.status} /></TableCell>
                        <TableCell className="text-sm">{c.lead_regulator ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDate(c.created_at)}</TableCell>
                        {isAdmin && (
                          <TableCell className="text-right">
                            {c.status !== "resolved" && (
                              <Button size="sm" variant="outline" onClick={() => { setResolveTarget(c); setResolveForm({ status: "resolved", precedenceDecision: c.precedence_decision ?? "", leadRegulator: c.lead_regulator ?? "" }); }}>
                                Reconcile
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {conflictRows.length === 0 && (
                      <TableRow><TableCell colSpan={isAdmin ? 8 : 7}>
                        <EmptyState icon={GitBranch} title="No jurisdiction conflicts" description="Raise a conflict when a matter falls under two or more regulators' mandates." />
                      </TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Referrals ── */}
        <TabsContent value="referrals" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2"><ArrowLeftRight className="h-5 w-5" /> MoU case referrals</CardTitle>
                  <CardDescription>Referral pipeline: sent → acknowledged → accepted/declined → resolved.</CardDescription>
                </div>
                {isStaff && <Button onClick={() => setShowSend((v) => !v)}><Send className="h-4 w-4 mr-2" /> Send referral</Button>}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {showSend && isStaff && (
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <Label>From regulator</Label>
                      <Select value={sendForm.fromRegulator} onValueChange={(v) => setSendForm({ ...sendForm, fromRegulator: v as RegulatorCode })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{REGULATOR_CODES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>To regulator</Label>
                      <Select value={sendForm.toRegulator} onValueChange={(v) => setSendForm({ ...sendForm, toRegulator: v as RegulatorCode })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{REGULATOR_CODES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="rr-ref-matter">Matter ref (optional)</Label>
                      <Input id="rr-ref-matter" value={sendForm.matterRef} onChange={(e) => setSendForm({ ...sendForm, matterRef: e.target.value })} />
                    </div>
                    <div className="md:col-span-2">
                      <Label htmlFor="rr-ref-payload">Case payload (JSON object)</Label>
                      <Textarea id="rr-ref-payload" rows={3} className="font-mono text-xs" value={sendForm.casePayload} onChange={(e) => setSendForm({ ...sendForm, casePayload: e.target.value })} />
                      {payloadError && <p className="text-xs text-destructive mt-1">{payloadError}</p>}
                    </div>
                    <div>
                      <Label htmlFor="rr-ref-notes">Notes (optional)</Label>
                      <Textarea id="rr-ref-notes" rows={3} value={sendForm.notes} onChange={(e) => setSendForm({ ...sendForm, notes: e.target.value })} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button disabled={sendReferral.isPending || !!payloadError || sendForm.fromRegulator === sendForm.toRegulator}
                      onClick={() => sendReferral.mutate({
                        fromRegulator: sendForm.fromRegulator,
                        toRegulator: sendForm.toRegulator,
                        ...(sendForm.matterRef.trim() ? { matterRef: sendForm.matterRef.trim() } : {}),
                        casePayload: parsedPayload,
                        ...(sendForm.notes.trim() ? { notes: sendForm.notes.trim() } : {}),
                      })}>
                      {sendReferral.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Send referral
                    </Button>
                    <Button variant="ghost" onClick={() => setShowSend(false)}>Cancel</Button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <Label>Regulator</Label>
                  <Select value={refRegulator} onValueChange={setRefRegulator}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All regulators</SelectItem>
                      {REGULATOR_CODES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={refStatus} onValueChange={setRefStatus}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {REFERRAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {referrals.isLoading ? <SkeletonTable rows={5} cols={6} /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>From → To</TableHead>
                      <TableHead>Matter</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Responded by</TableHead>
                      <TableHead>Created</TableHead>
                      {isStaff && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {referralRows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-sm">{r.referral_ref}</TableCell>
                        <TableCell className="text-sm font-mono">{r.from_regulator} → {r.to_regulator}</TableCell>
                        <TableCell className="text-sm">{r.matter_ref ?? "—"}</TableCell>
                        <TableCell><StatusBadge value={r.status} /></TableCell>
                        <TableCell className="text-sm">{r.responded_by ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDate(r.created_at)}</TableCell>
                        {isStaff && (
                          <TableCell className="text-right space-x-1">
                            {r.status === "sent" && (
                              <Button size="sm" variant="outline" disabled={acknowledgeReferral.isPending}
                                onClick={() => acknowledgeReferral.mutate({ referralRef: r.referral_ref })}>Acknowledge</Button>
                            )}
                            {["sent", "acknowledged"].includes(String(r.status)) && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => { setRespondTarget({ ref: r.referral_ref, decision: "accepted" }); setRespondNotes(""); }}>Accept</Button>
                                <Button size="sm" variant="outline" onClick={() => { setRespondTarget({ ref: r.referral_ref, decision: "declined" }); setRespondNotes(""); }}>Decline</Button>
                              </>
                            )}
                            {r.status === "accepted" && (
                              <Button size="sm" variant="outline" onClick={() => { setResolveRefTarget(r.referral_ref); setResolveRefNotes(""); }}>Resolve</Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {referralRows.length === 0 && (
                      <TableRow><TableCell colSpan={isStaff ? 7 : 6}>
                        <EmptyState icon={ArrowLeftRight} title="No case referrals" description="Send a referral to hand a matter to another regulator under the MoU framework." />
                      </TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Dashboards / sync status ── */}
        <TabsContent value="dashboards" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Per-regulator reconciliation snapshot</CardTitle>
              <CardDescription>
                Conflict counts, referral pipeline and recent activity for one regulator. Requires the regulator role bound to the selected code (admins see all).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Regulator</Label>
                <Select value={dashRegulator} onValueChange={(v) => setDashRegulator(v as RegulatorCode)}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>{REGULATOR_CODES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {dashboard.isLoading ? <SkeletonTable rows={3} cols={4} /> : dashboard.error ? (
                <div className="border border-destructive/40 rounded-lg p-4 text-sm text-destructive">
                  {dashboard.error.message}
                </div>
              ) : dashboard.data ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                      ["Conflicts", dashboard.data.conflicts?.total_conflicts],
                      ["Raised", dashboard.data.conflicts?.raised],
                      ["Under review", dashboard.data.conflicts?.under_review],
                      ["Escalated", dashboard.data.conflicts?.escalated],
                      ["Resolved", dashboard.data.conflicts?.resolved],
                      ["Referrals sent", dashboard.data.referrals?.sent],
                      ["Received", dashboard.data.referrals?.received],
                      ["Awaiting ack", dashboard.data.referrals?.awaiting_acknowledgement],
                      ["Awaiting response", dashboard.data.referrals?.awaiting_response],
                      ["Active accepted", dashboard.data.referrals?.active_accepted],
                    ].map(([label, v]) => (
                      <div key={String(label)} className="border rounded p-3">
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className="text-xl font-mono font-bold">{v == null ? "—" : String(v)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium mb-2">Recent conflicts</p>
                      <Table>
                        <TableHeader>
                          <TableRow><TableHead>Matter</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Lead</TableHead></TableRow>
                        </TableHeader>
                        <TableBody>
                          {((dashboard.data.recentConflicts as any[]) ?? []).map((c) => (
                            <TableRow key={c.id}>
                              <TableCell className="font-mono text-sm">{c.matter_ref}</TableCell>
                              <TableCell className="text-sm">{String(c.conflict_type ?? "").replaceAll("_", " ")}</TableCell>
                              <TableCell><StatusBadge value={c.status} /></TableCell>
                              <TableCell className="text-sm">{c.lead_regulator ?? "—"}</TableCell>
                            </TableRow>
                          ))}
                          {((dashboard.data.recentConflicts as any[]) ?? []).length === 0 && (
                            <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No recent conflicts.</TableCell></TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    <div>
                      <p className="text-sm font-medium mb-2">Recent referrals</p>
                      <Table>
                        <TableHeader>
                          <TableRow><TableHead>Ref</TableHead><TableHead>From → To</TableHead><TableHead>Status</TableHead></TableRow>
                        </TableHeader>
                        <TableBody>
                          {((dashboard.data.recentReferrals as any[]) ?? []).map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="font-mono text-sm">{r.referral_ref}</TableCell>
                              <TableCell className="text-sm font-mono">{r.from_regulator} → {r.to_regulator}</TableCell>
                              <TableCell><StatusBadge value={r.status} /></TableCell>
                            </TableRow>
                          ))}
                          {((dashboard.data.recentReferrals as any[]) ?? []).length === 0 && (
                            <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No recent referrals.</TableCell></TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Cross-regulator workload (aggregate)</CardTitle>
              <CardDescription>Read-only aggregate across all regulators — oversight view.</CardDescription>
            </CardHeader>
            <CardContent>
              {aggregate.isLoading ? <SkeletonTable rows={3} cols={4} /> : aggregate.error ? (
                <div className="border border-destructive/40 rounded-lg p-4 text-sm text-destructive">{aggregate.error.message}</div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium mb-2">Conflicts by regulator</p>
                    <Table>
                      <TableHeader><TableRow><TableHead>Regulator</TableHead><TableHead className="text-right">Conflicts</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {((aggregate.data?.conflictsByRegulator as any[]) ?? []).map((r) => (
                          <TableRow key={r.regulator}><TableCell className="font-mono">{r.regulator}</TableCell><TableCell className="text-right font-mono">{r.conflicts}</TableCell></TableRow>
                        ))}
                        {((aggregate.data?.conflictsByRegulator as any[]) ?? []).length === 0 && (
                          <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No conflicts recorded.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">Referrals by regulator</p>
                    <Table>
                      <TableHeader><TableRow><TableHead>Regulator</TableHead><TableHead className="text-right">Sent</TableHead><TableHead className="text-right">Received</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {((aggregate.data?.referralsByRegulator as any[]) ?? []).map((r) => (
                          <TableRow key={r.regulator}>
                            <TableCell className="font-mono">{r.regulator}</TableCell>
                            <TableCell className="text-right font-mono">{r.sent}</TableCell>
                            <TableCell className="text-right font-mono">{r.received}</TableCell>
                          </TableRow>
                        ))}
                        {((aggregate.data?.referralsByRegulator as any[]) ?? []).length === 0 && (
                          <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No referrals recorded.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Resolve-conflict dialog */}
      <Dialog open={resolveTarget != null} onOpenChange={(o) => !o && setResolveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reconcile conflict #{resolveTarget?.id}</DialogTitle>
            <DialogDescription>Matter {resolveTarget?.matter_ref} — record the reconciliation outcome and precedence decision.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Outcome</Label>
              <Select value={resolveForm.status} onValueChange={(v) => setResolveForm({ ...resolveForm, status: v as typeof resolveForm.status })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="under_review">under review</SelectItem>
                  <SelectItem value="resolved">resolved</SelectItem>
                  <SelectItem value="escalated">escalated</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Lead regulator (optional)</Label>
              <Select value={resolveForm.leadRegulator || "none"} onValueChange={(v) => setResolveForm({ ...resolveForm, leadRegulator: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {REGULATOR_CODES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="rr-precedence">Precedence decision {resolveForm.status === "resolved" ? "(required, min 10 chars)" : "(optional)"}</Label>
              <Textarea id="rr-precedence" rows={3} value={resolveForm.precedenceDecision} onChange={(e) => setResolveForm({ ...resolveForm, precedenceDecision: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <Button disabled={resolveConflict.isPending || (resolveForm.status === "resolved" && resolveForm.precedenceDecision.trim().length < 10)}
                onClick={() => resolveTarget && resolveConflict.mutate({
                  conflictId: resolveTarget.id,
                  status: resolveForm.status,
                  ...(resolveForm.precedenceDecision.trim() ? { precedenceDecision: resolveForm.precedenceDecision.trim() } : {}),
                  ...(resolveForm.leadRegulator ? { leadRegulator: resolveForm.leadRegulator as RegulatorCode } : {}),
                })}>
                {resolveConflict.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save outcome
              </Button>
              <Button variant="ghost" onClick={() => setResolveTarget(null)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Respond-to-referral dialog */}
      <Dialog open={respondTarget != null} onOpenChange={(o) => !o && setRespondTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{respondTarget?.decision === "accepted" ? "Accept" : "Decline"} referral {respondTarget?.ref}</DialogTitle>
            <DialogDescription>The receiving regulator's response is recorded on the referral and the audit trail.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="rr-respond-notes">Notes (optional)</Label>
              <Textarea id="rr-respond-notes" rows={3} value={respondNotes} onChange={(e) => setRespondNotes(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button disabled={respondReferral.isPending}
                variant={respondTarget?.decision === "declined" ? "destructive" : "default"}
                onClick={() => respondTarget && respondReferral.mutate({
                  referralRef: respondTarget.ref,
                  decision: respondTarget.decision,
                  ...(respondNotes.trim() ? { notes: respondNotes.trim() } : {}),
                })}>
                {respondReferral.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Confirm {respondTarget?.decision}
              </Button>
              <Button variant="ghost" onClick={() => setRespondTarget(null)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Resolve-referral dialog */}
      <Dialog open={resolveRefTarget != null} onOpenChange={(o) => !o && setResolveRefTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve referral {resolveRefTarget}</DialogTitle>
            <DialogDescription>Close an accepted referral once the receiving regulator has resolved the matter.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="rr-resolve-notes">Resolution notes (optional)</Label>
              <Textarea id="rr-resolve-notes" rows={3} value={resolveRefNotes} onChange={(e) => setResolveRefNotes(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button disabled={resolveReferral.isPending}
                onClick={() => resolveRefTarget && resolveReferral.mutate({
                  referralRef: resolveRefTarget,
                  ...(resolveRefNotes.trim() ? { notes: resolveRefNotes.trim() } : {}),
                })}>
                {resolveReferral.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Mark resolved
              </Button>
              <Button variant="ghost" onClick={() => setResolveRefTarget(null)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
