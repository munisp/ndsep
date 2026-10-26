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
import { Lock, MessageSquare, RefreshCw, ShieldAlert, Trophy, KeyRound, EyeOff } from "lucide-react";

/**
 * Whistleblower Secure Channel — Officer Console (Round-16 W2).
 * Wires the full whistleblowerChannel router (15 procedures).
 *
 * This is the STAFF console for the pseudonymous two-way channel — distinct
 * from the public submit portal (/whistleblower). Reporter identity stays
 * pseudonymous: only report_refs (WBR-YYYY-NNNNN) are displayed, never
 * reporter emails except on protection flags where the admin view legitimately
 * decrypts them server-side.
 */
function fmtTs(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

const FLAG_STATUS_COLORS: Record<string, string> = {
  open: "bg-red-500/20 text-red-300 border-red-500/40",
  under_review: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  protective_measures: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  closed: "bg-green-500/20 text-green-300 border-green-500/40",
};
const REWARD_STATUS_COLORS: Record<string, string> = {
  nominated: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  approved: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  paid: "bg-green-500/20 text-green-300 border-green-500/40",
  declined: "bg-muted text-muted-foreground border-border",
};
const CATEGORIES = ["data_breach", "unlawful_processing", "consent_violation", "cross_border", "bribery"] as const;

export default function WhistleblowerChannel() {
  const { isAdmin } = useRbac();

  // ── Case inbox / officer thread ────────────────────────────────────────────
  const [reportRefInput, setReportRefInput] = useState("");
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const thread = trpc.whistleblowerChannel.getThreadForOfficer.useQuery(
    { reportRef: selectedRef as string },
    { enabled: !!selectedRef }
  );
  const [officerReply, setOfficerReply] = useState("");
  const postOfficerMessage = trpc.whistleblowerChannel.postOfficerMessage.useMutation({
    onSuccess: () => { toast.success("Reply sent to reporter"); setOfficerReply(""); thread.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  // ── Intake with channel provisioning (public proc, staff-assisted) ─────────
  const [intake, setIntake] = useState({
    category: "data_breach" as (typeof CATEGORIES)[number],
    orgId: "", description: "", isAnonymous: true, reporterEmail: "", evidenceUrls: "",
  });
  const [issuedToken, setIssuedToken] = useState<{ reportRef: string; accessToken: string } | null>(null);
  const submitWithChannel = trpc.whistleblowerChannel.submitWithChannel.useMutation({
    onSuccess: (r: any) => {
      toast.success(`Report ${r.reportRef} submitted with secure channel`);
      setIssuedToken({ reportRef: r.reportRef, accessToken: r.accessToken });
      setIntake({ ...intake, description: "", reporterEmail: "", evidenceUrls: "" });
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Token lifecycle (admin) ────────────────────────────────────────────────
  const [tokenRef, setTokenRef] = useState("");
  const issueChannelToken = trpc.whistleblowerChannel.issueChannelToken.useMutation({
    onSuccess: (r: any) => {
      toast.success(`Channel token issued for ${r.reportRef} — shown once`, { duration: 30000 });
      setIssuedToken({ reportRef: r.reportRef, accessToken: r.accessToken });
    },
    onError: (err) => toast.error(err.message),
  });
  const revokeChannelToken = trpc.whistleblowerChannel.revokeChannelToken.useMutation({
    onSuccess: (r: any) => toast.success(`Revoked ${r.revoked} active channel token(s)`),
    onError: (err) => toast.error(err.message),
  });

  // ── Protection flags (admin) ───────────────────────────────────────────────
  const [flagStatus, setFlagStatus] = useState<string>("");
  const flags = trpc.whistleblowerChannel.listProtectionFlags.useQuery(
    { status: (flagStatus || undefined) as "open" | "under_review" | "protective_measures" | "closed" | undefined },
    { enabled: isAdmin }
  );
  const [flagUpdate, setFlagUpdate] = useState<{ flagId: number | null; status: "open" | "under_review" | "protective_measures" | "closed"; measures: string }>({ flagId: null, status: "under_review", measures: "" });
  const updateProtectionFlag = trpc.whistleblowerChannel.updateProtectionFlag.useMutation({
    onSuccess: () => { toast.success("Protection flag updated"); setFlagUpdate({ flagId: null, status: "under_review", measures: "" }); flags.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  // ── Rewards (admin) ────────────────────────────────────────────────────────
  const [rewardStatus, setRewardStatus] = useState<string>("");
  const rewards = trpc.whistleblowerChannel.listRewards.useQuery(
    { status: (rewardStatus || undefined) as "nominated" | "approved" | "paid" | "declined" | undefined },
    { enabled: isAdmin }
  );
  const [nomForm, setNomForm] = useState({ reportRef: "", rewardType: "recognition" as "recognition" | "monetary" | "commendation", amount: "", citation: "" });
  const nominateReward = trpc.whistleblowerChannel.nominateReward.useMutation({
    onSuccess: (r: any) => { toast.success(`Reward nominated (id ${r.rewardId})`); setNomForm({ reportRef: "", rewardType: "recognition", amount: "", citation: "" }); rewards.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const decideReward = trpc.whistleblowerChannel.decideReward.useMutation({
    onSuccess: (r: any) => { toast.success(`Reward ${r.id} → ${r.status}`); rewards.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  // ── Reporter channel (token-auth public endpoints) ─────────────────────────
  const [reporterToken, setReporterToken] = useState("");
  const [reporterTokenActive, setReporterTokenActive] = useState<string | null>(null);
  const reporterThread = trpc.whistleblowerChannel.getChannelMessages.useQuery(
    { accessToken: reporterTokenActive as string },
    { enabled: !!reporterTokenActive, retry: false }
  );
  const reporterRewards = trpc.whistleblowerChannel.getMyRewardStatus.useQuery(
    { accessToken: reporterTokenActive as string },
    { enabled: !!reporterTokenActive, retry: false }
  );
  const [reporterReply, setReporterReply] = useState("");
  const postReporterMessage = trpc.whistleblowerChannel.postReporterMessage.useMutation({
    onSuccess: () => { toast.success("Reporter message posted"); setReporterReply(""); reporterThread.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const markRead = trpc.whistleblowerChannel.markRead.useMutation({
    onSuccess: (r: any) => { toast.success(`Marked ${r.markedRead} officer message(s) read`); reporterThread.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const [retaliation, setRetaliation] = useState({ employerName: "", retaliationType: "other" as "dismissal" | "demotion" | "harassment" | "threats" | "blacklisting" | "other", description: "", reporterEmail: "" });
  const reportRetaliation = trpc.whistleblowerChannel.reportRetaliation.useMutation({
    onSuccess: (r: any) => { toast.success(`Retaliation flag #${r.flagId} raised — NDPC will review urgently`); setRetaliation({ employerName: "", retaliationType: "other", description: "", reporterEmail: "" }); flags.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  // Inbox quick-picks: report refs surfaced by protection flags / rewards.
  const knownRefs = useMemo(() => {
    const refs = new Set<string>();
    ((flags.data as any[]) ?? []).forEach((f) => f.report_ref && refs.add(f.report_ref));
    ((rewards.data as any[]) ?? []).forEach((r) => r.report_ref && refs.add(r.report_ref));
    if (issuedToken?.reportRef) refs.add(issuedToken.reportRef);
    return Array.from(refs).sort();
  }, [flags.data, rewards.data, issuedToken]);

  const threadReport: any = thread.data?.report;
  const threadMessages: any[] = (thread.data?.messages as any[]) ?? [];
  const reporterMessages: any[] = (reporterThread.data?.messages as any[]) ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Whistleblower Channel" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MessageSquare className="h-6 w-6" /> Whistleblower Secure Channel — Officer Console</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pseudonymous two-way channel. Reporters are identified only by anonymous report refs (WBR-YYYY-NNNNN);
            messages are encrypted at rest; reporter access is via one-time tokens (SHA-256 hashed, never stored raw).
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { thread.refetch(); flags.refetch(); rewards.refetch(); }}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {/* Anonymity-integrity indicators */}
      <div className="flex gap-2 flex-wrap">
        <Badge variant="outline" className="bg-green-500/20 text-green-300 border-green-500/40"><EyeOff className="h-3 w-3 mr-1" /> Pseudonymous refs only</Badge>
        <Badge variant="outline" className="bg-green-500/20 text-green-300 border-green-500/40"><Lock className="h-3 w-3 mr-1" /> Messages encrypted at rest</Badge>
        <Badge variant="outline" className="bg-green-500/20 text-green-300 border-green-500/40"><KeyRound className="h-3 w-3 mr-1" /> One-time tokens — hash-only at rest</Badge>
        <Badge variant="outline" className="bg-blue-500/20 text-blue-300 border-blue-500/40"><ShieldAlert className="h-3 w-3 mr-1" /> Retaliation protection workflow</Badge>
      </div>

      <Tabs defaultValue="inbox">
        <TabsList className="flex-wrap">
          <TabsTrigger value="inbox">Case inbox &amp; thread</TabsTrigger>
          <TabsTrigger value="intake">Intake + channel</TabsTrigger>
          <TabsTrigger value="protection">Protection flags</TabsTrigger>
          <TabsTrigger value="rewards">Rewards</TabsTrigger>
          <TabsTrigger value="tokens">Tokens</TabsTrigger>
          <TabsTrigger value="reporter">Reporter channel (token)</TabsTrigger>
        </TabsList>

        {/* ── Case inbox & two-way thread ───────────────────────────────── */}
        <TabsContent value="inbox" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Case inbox</CardTitle>
              <CardDescription>Open a thread by anonymous report ref. Refs surfaced by protection flags, rewards and recent intake appear as quick picks.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input className="w-64 font-mono" placeholder="WBR-2026-00001" value={reportRefInput} onChange={(e) => setReportRefInput(e.target.value)} />
                <Button onClick={() => reportRefInput.trim().length >= 4 && setSelectedRef(reportRefInput.trim())}>Open thread</Button>
              </div>
              {knownRefs.length > 0 && (
                <div className="flex gap-1.5 flex-wrap items-center">
                  <span className="text-xs text-muted-foreground mr-1">Known refs:</span>
                  {knownRefs.map((ref) => (
                    <Badge key={ref} variant="outline" className={`cursor-pointer font-mono ${selectedRef === ref ? "bg-primary/20 border-primary/50" : ""}`} onClick={() => { setSelectedRef(ref); setReportRefInput(ref); }}>
                      {ref}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {selectedRef && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-base font-mono">{selectedRef}</CardTitle>
                  <div className="flex gap-2 items-center">
                    {threadReport?.category && <Badge variant="outline">{threadReport.category}</Badge>}
                    {threadReport?.status && <Badge variant="outline" className="bg-blue-500/20 text-blue-300 border-blue-500/40">{threadReport.status}</Badge>}
                    <Badge variant="outline" className="bg-green-500/20 text-green-300 border-green-500/40"><EyeOff className="h-3 w-3 mr-1" /> anonymous</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                  {threadMessages.map((m) => (
                    <div key={m.id} className={`rounded-md border p-3 max-w-[80%] ${m.sender === "case_officer" ? "ml-auto bg-primary/10 border-primary/30" : "bg-muted/40 border-border"}`}>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-xs font-medium">{m.sender === "case_officer" ? "Case officer" : "Reporter (pseudonymous)"}</span>
                        <span className="text-xs text-muted-foreground">{fmtTs(m.created_at)}{m.sender === "case_officer" && m.read_at ? " · read" : ""}</span>
                      </div>
                      <p className="text-sm mt-1 whitespace-pre-wrap break-words">{m.body}</p>
                    </div>
                  ))}
                  {threadMessages.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      {thread.isLoading ? "Loading thread…" : "No messages yet — start the conversation below."}
                    </p>
                  )}
                </div>
                <div className="space-y-2 border-t pt-3">
                  <Label>Officer reply</Label>
                  <Textarea rows={3} value={officerReply} onChange={(e) => setOfficerReply(e.target.value)} placeholder="Reply to the reporter through the secure channel…" />
                  <Button
                    disabled={!officerReply.trim() || postOfficerMessage.isPending}
                    onClick={() => postOfficerMessage.mutate({ reportRef: selectedRef, body: officerReply.trim() })}
                  >Send officer reply</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Intake with channel provisioning ──────────────────────────── */}
        <TabsContent value="intake" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">New intake with secure channel</CardTitle>
              <CardDescription>Staff-assisted submission that provisions a follow-up channel. The reporter access token is shown ONCE — deliver it securely.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <Label>Category</Label>
                  <Select value={intake.category} onValueChange={(v) => setIntake({ ...intake, category: v as typeof intake.category })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Organisation ID (optional)</Label>
                  <Input inputMode="numeric" value={intake.orgId} onChange={(e) => setIntake({ ...intake, orgId: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Description (min 50 chars)</Label>
                <Textarea rows={4} value={intake.description} onChange={(e) => setIntake({ ...intake, description: e.target.value })} />
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="flex items-center gap-2 pt-5">
                  <input id="wb-anon" type="checkbox" checked={intake.isAnonymous} onChange={(e) => setIntake({ ...intake, isAnonymous: e.target.checked })} className="h-4 w-4" />
                  <Label htmlFor="wb-anon">Anonymous report</Label>
                </div>
                {!intake.isAnonymous && (
                  <div>
                    <Label>Reporter email (stored encrypted)</Label>
                    <Input type="email" value={intake.reporterEmail} onChange={(e) => setIntake({ ...intake, reporterEmail: e.target.value })} />
                  </div>
                )}
              </div>
              <div>
                <Label>Evidence URLs (one per line, max 10)</Label>
                <Textarea rows={2} value={intake.evidenceUrls} onChange={(e) => setIntake({ ...intake, evidenceUrls: e.target.value })} placeholder="https://…" />
              </div>
              <Button
                disabled={intake.description.trim().length < 50 || submitWithChannel.isPending}
                onClick={() => {
                  const evidenceUrls = intake.evidenceUrls.split("\n").map((u) => u.trim()).filter(Boolean).slice(0, 10);
                  submitWithChannel.mutate({
                    category: intake.category,
                    orgId: intake.orgId ? Number(intake.orgId) : undefined,
                    description: intake.description.trim(),
                    isAnonymous: intake.isAnonymous,
                    reporterEmail: !intake.isAnonymous && intake.reporterEmail ? intake.reporterEmail : undefined,
                    evidenceUrls,
                  });
                }}
              >Submit with channel</Button>
              {issuedToken && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
                  <p className="text-sm font-medium flex items-center gap-2"><KeyRound className="h-4 w-4" /> Access token for {issuedToken.reportRef} (shown ONCE):</p>
                  <p className="font-mono text-xs break-all">{issuedToken.accessToken}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Protection flags ──────────────────────────────────────────── */}
        <TabsContent value="protection" className="mt-4 space-y-4">
          {!isAdmin && <p className="text-sm text-muted-foreground">Protection flags are admin-only.</p>}
          {isAdmin && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> Retaliation protection flags</CardTitle>
                  <Select value={flagStatus || "all"} onValueChange={(v) => setFlagStatus(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {["open", "under_review", "protective_measures", "closed"].map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Flag</TableHead><TableHead>Report ref</TableHead><TableHead>Type</TableHead>
                      <TableHead>Employer</TableHead><TableHead>Priority</TableHead><TableHead>Status</TableHead>
                      <TableHead>Assigned to</TableHead><TableHead>Created</TableHead><TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {((flags.data as any[]) ?? []).map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="font-mono text-xs">#{f.id}</TableCell>
                        <TableCell className="font-mono text-xs cursor-pointer underline" onClick={() => { if (f.report_ref) { setSelectedRef(f.report_ref); setReportRefInput(f.report_ref); } }}>{f.report_ref ?? "—"}</TableCell>
                        <TableCell><Badge variant="outline">{f.retaliation_type}</Badge></TableCell>
                        <TableCell className="text-xs">{f.employer_name ?? "—"}</TableCell>
                        <TableCell><Badge variant="outline" className="bg-red-500/20 text-red-300 border-red-500/40">{f.priority}</Badge></TableCell>
                        <TableCell><Badge variant="outline" className={FLAG_STATUS_COLORS[f.status] ?? ""}>{f.status?.replace("_", " ")}</Badge></TableCell>
                        <TableCell className="text-xs">{f.assigned_to ?? "—"}</TableCell>
                        <TableCell className="text-xs">{fmtTs(f.created_at)}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => setFlagUpdate({ flagId: f.id, status: f.status ?? "under_review", measures: f.protective_measures ?? "" })}>Advance</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {((flags.data as any[]) ?? []).length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">No protection flags.</TableCell></TableRow>}
                  </TableBody>
                </Table>

                {flagUpdate.flagId != null && (
                  <div className="mt-4 rounded-md border p-4 space-y-3">
                    <p className="text-sm font-medium">Advance flag #{flagUpdate.flagId}</p>
                    <div className="grid md:grid-cols-2 gap-3">
                      <div>
                        <Label>New status</Label>
                        <Select value={flagUpdate.status} onValueChange={(v) => setFlagUpdate({ ...flagUpdate, status: v as typeof flagUpdate.status })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["open", "under_review", "protective_measures", "closed"].map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Protective measures (optional)</Label>
                        <Input value={flagUpdate.measures} onChange={(e) => setFlagUpdate({ ...flagUpdate, measures: e.target.value })} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={updateProtectionFlag.isPending} onClick={() => updateProtectionFlag.mutate({ flagId: flagUpdate.flagId as number, status: flagUpdate.status, protectiveMeasures: flagUpdate.measures || undefined })}>Apply</Button>
                      <Button size="sm" variant="ghost" onClick={() => setFlagUpdate({ flagId: null, status: "under_review", measures: "" })}>Cancel</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Rewards ───────────────────────────────────────────────────── */}
        <TabsContent value="rewards" className="mt-4 space-y-4">
          {!isAdmin && <p className="text-sm text-muted-foreground">Reward decisions are admin-only.</p>}
          {isAdmin && (
            <>
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Trophy className="h-4 w-4" /> Nominate reward / recognition</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid md:grid-cols-2 gap-3">
                    <div>
                      <Label>Report ref</Label>
                      <Input className="font-mono" value={nomForm.reportRef} onChange={(e) => setNomForm({ ...nomForm, reportRef: e.target.value })} placeholder="WBR-2026-00001" />
                    </div>
                    <div>
                      <Label>Reward type</Label>
                      <Select value={nomForm.rewardType} onValueChange={(v) => setNomForm({ ...nomForm, rewardType: v as typeof nomForm.rewardType })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{["recognition", "monetary", "commendation"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    {nomForm.rewardType === "monetary" && (
                      <div>
                        <Label>Amount (NGN)</Label>
                        <Input inputMode="decimal" value={nomForm.amount} onChange={(e) => setNomForm({ ...nomForm, amount: e.target.value })} />
                      </div>
                    )}
                    <div>
                      <Label>Citation (optional)</Label>
                      <Input value={nomForm.citation} onChange={(e) => setNomForm({ ...nomForm, citation: e.target.value })} />
                    </div>
                  </div>
                  <Button
                    disabled={nomForm.reportRef.trim().length < 4 || nominateReward.isPending}
                    onClick={() => nominateReward.mutate({
                      reportRef: nomForm.reportRef.trim(),
                      rewardType: nomForm.rewardType,
                      amount: nomForm.rewardType === "monetary" ? Number(nomForm.amount) : undefined,
                      citation: nomForm.citation || undefined,
                    })}
                  >Nominate</Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Reward decisions</CardTitle>
                    <Select value={rewardStatus || "all"} onValueChange={(v) => setRewardStatus(v === "all" ? "" : v)}>
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        {["nominated", "approved", "paid", "declined"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reward</TableHead><TableHead>Report ref</TableHead><TableHead>Type</TableHead>
                        <TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Decided by</TableHead><TableHead>Created</TableHead><TableHead>Decide</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {((rewards.data as any[]) ?? []).map((r) => {
                        const decidable = ["nominated", "approved"].includes(r.status);
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="font-mono text-xs">#{r.id}</TableCell>
                            <TableCell className="font-mono text-xs cursor-pointer underline" onClick={() => { if (r.report_ref) { setSelectedRef(r.report_ref); setReportRefInput(r.report_ref); } }}>{r.report_ref}</TableCell>
                            <TableCell><Badge variant="outline">{r.reward_type}</Badge></TableCell>
                            <TableCell className="text-xs">{r.amount != null ? `₦${Number(r.amount).toLocaleString()}` : "—"}</TableCell>
                            <TableCell><Badge variant="outline" className={REWARD_STATUS_COLORS[r.status] ?? ""}>{r.status}</Badge></TableCell>
                            <TableCell className="text-xs">{r.decided_by ?? "—"}</TableCell>
                            <TableCell className="text-xs">{fmtTs(r.created_at)}</TableCell>
                            <TableCell>
                              {decidable && (
                                <div className="flex gap-1">
                                  {r.status === "nominated" && (
                                    <Button size="sm" variant="outline" disabled={decideReward.isPending} onClick={() => decideReward.mutate({ rewardId: r.id, status: "approved" })}>Approve</Button>
                                  )}
                                  {r.reward_type === "monetary" && (
                                    <Button size="sm" variant="outline" disabled={decideReward.isPending} onClick={() => decideReward.mutate({ rewardId: r.id, status: "paid" })}>Mark paid</Button>
                                  )}
                                  <Button size="sm" variant="ghost" disabled={decideReward.isPending} onClick={() => decideReward.mutate({ rewardId: r.id, status: "declined" })}>Decline</Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {((rewards.data as any[]) ?? []).length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No rewards.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── Token lifecycle ───────────────────────────────────────────── */}
        <TabsContent value="tokens" className="mt-4">
          {!isAdmin && <p className="text-sm text-muted-foreground">Channel token lifecycle management is admin-only.</p>}
          {isAdmin && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Channel token lifecycle</CardTitle>
                <CardDescription>Issue a token for a pre-channel report, or revoke a compromised token. Raw tokens are shown once; only SHA-256 hashes persist.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>Report ref</Label>
                  <Input className="w-64 font-mono" value={tokenRef} onChange={(e) => setTokenRef(e.target.value)} placeholder="WBR-2026-00001" />
                </div>
                <div className="flex gap-2">
                  <Button disabled={tokenRef.trim().length < 4 || issueChannelToken.isPending} onClick={() => issueChannelToken.mutate({ reportRef: tokenRef.trim() })}>Issue channel token</Button>
                  <Button variant="destructive" disabled={tokenRef.trim().length < 4 || revokeChannelToken.isPending} onClick={() => revokeChannelToken.mutate({ reportRef: tokenRef.trim() })}>Revoke active token(s)</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Reporter channel (token-auth) ─────────────────────────────── */}
        <TabsContent value="reporter" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Reporter channel view (token-auth)</CardTitle>
              <CardDescription>
                Exercise the public token-authenticated endpoints exactly as a reporter would — read the thread,
                reply pseudonymously, mark officer messages read, check reward status, and flag retaliation.
                Public endpoints are per-IP rate limited.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input className="font-mono" placeholder="Reporter access token" value={reporterToken} onChange={(e) => setReporterToken(e.target.value)} />
                <Button disabled={reporterToken.trim().length < 20} onClick={() => setReporterTokenActive(reporterToken.trim())}>Open channel</Button>
                {reporterTokenActive && <Button variant="ghost" onClick={() => { setReporterTokenActive(null); setReporterToken(""); }}>Close</Button>}
              </div>
            </CardContent>
          </Card>

          {reporterTokenActive && (
            <>
              {reporterThread.error && <p className="text-sm text-red-400">{reporterThread.error.message}</p>}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-mono">{reporterThread.data?.reportRef ?? "…"}</CardTitle>
                    <Button size="sm" variant="outline" disabled={markRead.isPending} onClick={() => markRead.mutate({ accessToken: reporterTokenActive })}>Mark officer messages read</Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                    {reporterMessages.map((m) => (
                      <div key={m.id} className={`rounded-md border p-3 max-w-[80%] ${m.sender === "reporter" ? "ml-auto bg-primary/10 border-primary/30" : "bg-muted/40 border-border"}`}>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-xs font-medium">{m.sender === "reporter" ? "Reporter" : "Case officer"}</span>
                          <span className="text-xs text-muted-foreground">{fmtTs(m.created_at)}{m.sender === "case_officer" && m.read_at ? " · read" : ""}</span>
                        </div>
                        <p className="text-sm mt-1 whitespace-pre-wrap break-words">{m.body}</p>
                      </div>
                    ))}
                    {reporterMessages.length === 0 && !reporterThread.isLoading && <p className="text-sm text-muted-foreground text-center py-4">No messages in this channel yet.</p>}
                  </div>
                  <div className="space-y-2 border-t pt-3">
                    <Label>Reporter reply</Label>
                    <Textarea rows={3} value={reporterReply} onChange={(e) => setReporterReply(e.target.value)} />
                    <Button disabled={!reporterReply.trim() || postReporterMessage.isPending} onClick={() => postReporterMessage.mutate({ accessToken: reporterTokenActive, body: reporterReply.trim() })}>Post reporter message</Button>
                  </div>
                </CardContent>
              </Card>

              <div className="grid md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base">My reward status</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Citation</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {((reporterRewards.data as any[]) ?? []).map((r) => (
                          <TableRow key={r.id}>
                            <TableCell><Badge variant="outline">{r.reward_type}</Badge></TableCell>
                            <TableCell><Badge variant="outline" className={REWARD_STATUS_COLORS[r.status] ?? ""}>{r.status}</Badge></TableCell>
                            <TableCell className="text-xs">{r.citation ?? "—"}</TableCell>
                            <TableCell className="text-xs">{fmtTs(r.created_at)}</TableCell>
                          </TableRow>
                        ))}
                        {((reporterRewards.data as any[]) ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No reward nominations for this report.</TableCell></TableRow>}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> Flag employer retaliation</CardTitle>
                    <CardDescription>Requires the channel token — anonymous unauthenticated flags are rejected.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Employer (optional)</Label>
                        <Input value={retaliation.employerName} onChange={(e) => setRetaliation({ ...retaliation, employerName: e.target.value })} />
                      </div>
                      <div>
                        <Label>Retaliation type</Label>
                        <Select value={retaliation.retaliationType} onValueChange={(v) => setRetaliation({ ...retaliation, retaliationType: v as typeof retaliation.retaliationType })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{["dismissal", "demotion", "harassment", "threats", "blacklisting", "other"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label>Contact email (optional, stored encrypted)</Label>
                      <Input type="email" value={retaliation.reporterEmail} onChange={(e) => setRetaliation({ ...retaliation, reporterEmail: e.target.value })} />
                    </div>
                    <div>
                      <Label>Description (min 20 chars)</Label>
                      <Textarea rows={3} value={retaliation.description} onChange={(e) => setRetaliation({ ...retaliation, description: e.target.value })} />
                    </div>
                    <Button
                      variant="destructive"
                      disabled={retaliation.description.trim().length < 20 || reportRetaliation.isPending}
                      onClick={() => reportRetaliation.mutate({
                        accessToken: reporterTokenActive,
                        employerName: retaliation.employerName || undefined,
                        retaliationType: retaliation.retaliationType,
                        description: retaliation.description.trim(),
                        reporterEmail: retaliation.reporterEmail || undefined,
                      })}
                    >Raise protection flag</Button>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
