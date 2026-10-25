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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AlertTriangle, Inbox, Loader2, Radar, RefreshCw } from "lucide-react";

const STATUSES = ["received", "acknowledged", "under_review", "linked_to_case", "resolved", "closed"] as const;
const STATUS_COLORS: Record<string, string> = {
  received: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  acknowledged: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
  under_review: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  linked_to_case: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  resolved: "bg-green-500/20 text-green-300 border-green-500/40",
  closed: "bg-muted text-muted-foreground border-border",
};
const SEVERITY_COLORS: Record<string, string> = {
  elevated: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  critical: "bg-red-500/20 text-red-300 border-red-500/40",
};

export default function ComplaintTriage() {
  const utils = trpc.useUtils();
  const stats = trpc.publicComplaints.stats.useQuery();
  const slaBreaches = trpc.publicComplaints.slaBreaches.useQuery({ limit: 50 });

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const queue = trpc.publicComplaints.list.useQuery({
    status: (statusFilter || undefined) as (typeof STATUSES)[number] | undefined,
    search: search || undefined,
    page,
    limit: 20,
  });

  const [selected, setSelected] = useState<number | null>(null);
  const detail = trpc.publicComplaints.get.useQuery({ id: selected ?? 0 }, { enabled: selected != null });

  const updateStatus = trpc.publicComplaints.updateStatus.useMutation({
    onSuccess: (r: any) => { toast.success(`${r.reference_code} → ${r.status}`); refreshAll(); },
    onError: (err) => toast.error(err.message),
  });
  const assign = trpc.publicComplaints.assign.useMutation({
    onSuccess: () => { toast.success("Officer assigned"); refreshAll(); setAssignOfficer(""); },
    onError: (err) => toast.error(err.message),
  });
  const linkToCase = trpc.publicComplaints.linkToCase.useMutation({
    onSuccess: () => { toast.success("Linked to enforcement case"); refreshAll(); setCaseId(""); },
    onError: (err) => toast.error(err.message),
  });
  const merge = trpc.publicComplaints.mergeDuplicates.useMutation({
    onSuccess: () => { toast.success("Duplicate merged"); refreshAll(); setMergeId(""); setMergeReason(""); },
    onError: (err) => toast.error(err.message),
  });

  const [nextStatus, setNextStatus] = useState<string>("acknowledged");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [assignOfficer, setAssignOfficer] = useState("");
  const [caseId, setCaseId] = useState("");
  const [mergeId, setMergeId] = useState("");
  const [mergeReason, setMergeReason] = useState("");

  // Surge alerts
  const [surgeStatus, setSurgeStatus] = useState<string>("open");
  const surges = trpc.complaintAnalytics.surgeAlerts.useQuery({ status: surgeStatus as "open" | "acknowledged" | "resolved", limit: 50 });
  const ackSurge = trpc.complaintAnalytics.acknowledgeSurgeAlert.useMutation({
    onSuccess: (r: any) => { toast.success(`Alert ${r.id} → ${r.status}`); surges.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const runDetection = trpc.complaintAnalytics.runSurgeDetection.useMutation({
    onSuccess: (res: any) => { toast.success(`Detection run complete — ${res.alerts?.length ?? 0} alert(s) raised, ${res.checked ?? 0} controller(s) checked`); surges.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const trends = trpc.complaintAnalytics.spikesAndTrends.useQuery({ scope: "category", topN: 10 });

  const refreshAll = () => {
    utils.publicComplaints.invalidate();
    detail.refetch();
  };

  const s: any = stats.data ?? {};
  const det: any = detail.data;
  const trendDaily: Array<{ d: string; n: number }> = (trends.data as any)?.daily ?? [];
  const maxN = Math.max(1, ...trendDaily.map((p) => p.n));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Complaint Triage" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Inbox className="h-6 w-6" /> Complaint Triage</h1>
        <Button variant="ghost" size="sm" onClick={() => { refreshAll(); surges.refetch(); }}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { label: "Total", value: s.total },
          { label: "Received", value: s.received },
          { label: "Under review", value: s.under_review },
          { label: "Resolved", value: s.resolved },
          { label: "Last 7 days", value: s.received_last_7d },
          { label: "ACK SLA breached", value: s.ack_sla_breached, danger: true },
        ].map((k) => (
          <Card key={k.label} className={k.danger && k.value ? "border-red-500/50" : ""}>
            <CardHeader className="pb-1 pt-3"><CardDescription>{k.label}</CardDescription></CardHeader>
            <CardContent className={`text-2xl font-mono font-bold ${k.danger && k.value ? "text-red-400" : ""}`}>{k.value ?? "—"}</CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Triage queue</TabsTrigger>
          <TabsTrigger value="sla">SLA breaches ({(slaBreaches.data as any[])?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="surge">Surge alerts</TabsTrigger>
          <TabsTrigger value="trends">Spikes &amp; trends</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="text-lg">Queue</CardTitle>
                <CardDescription>Sorted with SLA breaches first. Click a row to triage.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search ref / subject / controller" className="max-w-xs" />
                  <Select value={statusFilter || "all"} onValueChange={(v) => { setStatusFilter(v === "all" ? "" : v); setPage(1); }}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {STATUSES.map((st) => <SelectItem key={st} value={st}>{st.replaceAll("_", " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>ACK SLA</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {((queue.data as any)?.data ?? []).map((c: any) => (
                      <TableRow key={c.id} className={`cursor-pointer ${selected === c.id ? "bg-primary/10" : ""}`} onClick={() => setSelected(c.id)}>
                        <TableCell className="font-mono text-xs">{c.reference_code}</TableCell>
                        <TableCell className="max-w-[240px] truncate">{c.subject}</TableCell>
                        <TableCell><Badge variant="outline" className={STATUS_COLORS[c.status] ?? ""}>{String(c.status).replaceAll("_", " ")}</Badge></TableCell>
                        <TableCell>
                          <span className={c.ack_sla_state === "breached" ? "text-red-400" : "text-muted-foreground"}>{c.ack_sla_state}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                    {((queue.data as any)?.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Queue is empty.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
                <div className="flex justify-between items-center text-sm text-muted-foreground">
                  <span>{(queue.data as any)?.total ?? 0} complaint(s)</span>
                  <div className="space-x-2">
                    <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
                    <Button size="sm" variant="outline" disabled={page * 20 >= ((queue.data as any)?.total ?? 0)} onClick={() => setPage(page + 1)}>Next</Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg">Complaint detail</CardTitle>
                {det && <CardDescription className="font-mono">{det.reference_code}</CardDescription>}
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {!det ? (
                  <p className="text-muted-foreground">Select a complaint from the queue.</p>
                ) : (
                  <>
                    <div className="space-y-1">
                      <p className="font-medium">{det.subject}</p>
                      <p className="text-muted-foreground whitespace-pre-wrap">{det.description}</p>
                      <p className="text-muted-foreground">Controller: {det.controller_name ?? `ID ${det.controller_id ?? "?"}`} · {det.state ?? "state n/a"}</p>
                    </div>
                    {(det.attachments ?? []).length > 0 && (
                      <div>
                        <p className="font-medium mb-1">Attachments</p>
                        <ul className="space-y-1">
                          {det.attachments.map((a: any) => (
                            <li key={a.id} className="text-xs font-mono text-muted-foreground">
                              {a.filename} · sha256 {String(a.sha256).slice(0, 12)}… · vault: {a.vault_status}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(det.events ?? []).length > 0 && (
                      <div>
                        <p className="font-medium mb-1">Timeline</p>
                        <ul className="space-y-1 max-h-40 overflow-y-auto">
                          {det.events.map((e: any) => (
                            <li key={e.id} className="text-xs text-muted-foreground">
                              {new Date(e.created_at).toLocaleString()} — {e.event_type}{e.to_status ? ` → ${e.to_status}` : ""} ({e.actor})
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="border-t pt-3 space-y-3">
                      <div className="flex gap-2 items-end">
                        <div className="flex-1">
                          <Label>Move status to</Label>
                          <Select value={nextStatus} onValueChange={setNextStatus}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{STATUSES.map((st) => <SelectItem key={st} value={st}>{st.replaceAll("_", " ")}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <Button
                          disabled={updateStatus.isPending}
                          onClick={() => updateStatus.mutate({ id: det.id, status: nextStatus as (typeof STATUSES)[number], resolutionNotes: resolutionNotes || undefined })}
                        >Apply</Button>
                      </div>
                      <Textarea value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} placeholder="Resolution notes (optional)" rows={2} />
                      <div className="flex gap-2 items-end">
                        <div className="flex-1">
                          <Label htmlFor="ct-officer">Assign officer (user id)</Label>
                          <Input id="ct-officer" type="number" value={assignOfficer} onChange={(e) => setAssignOfficer(e.target.value)} />
                        </div>
                        <Button variant="secondary" disabled={assign.isPending || !assignOfficer} onClick={() => assign.mutate({ id: det.id, officerId: Number(assignOfficer) })}>Assign</Button>
                      </div>
                      <div className="flex gap-2 items-end">
                        <div className="flex-1">
                          <Label htmlFor="ct-case">Link enforcement case (id)</Label>
                          <Input id="ct-case" type="number" value={caseId} onChange={(e) => setCaseId(e.target.value)} />
                        </div>
                        <Button variant="secondary" disabled={linkToCase.isPending || !caseId} onClick={() => linkToCase.mutate({ id: det.id, enforcementCaseId: Number(caseId) })}>Link</Button>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="ct-merge">Merge duplicate (complaint id into this one)</Label>
                        <div className="flex gap-2">
                          <Input id="ct-merge" type="number" value={mergeId} onChange={(e) => setMergeId(e.target.value)} placeholder="duplicate id" />
                          <Input value={mergeReason} onChange={(e) => setMergeReason(e.target.value)} placeholder="reason (min 5 chars)" className="flex-1" />
                          <Button
                            variant="outline"
                            disabled={merge.isPending || !mergeId || mergeReason.trim().length < 5}
                            onClick={() => merge.mutate({ canonicalId: det.id, duplicateId: Number(mergeId), reason: mergeReason.trim() })}
                          >Merge</Button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="sla" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-red-400" /> Acknowledgement SLA breaches (72h)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead><TableHead>Subject</TableHead><TableHead>Controller</TableHead>
                    <TableHead>Received</TableHead><TableHead>SLA due</TableHead><TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((slaBreaches.data as any[]) ?? []).map((c: any) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.reference_code}</TableCell>
                      <TableCell className="max-w-[240px] truncate">{c.subject}</TableCell>
                      <TableCell>{c.controller_name ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{new Date(c.received_at).toLocaleString()}</TableCell>
                      <TableCell className="text-sm text-red-400">{new Date(c.ack_sla_due_at).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" onClick={() => updateStatus.mutate({ id: c.id, status: "acknowledged" })} disabled={updateStatus.isPending}>Acknowledge</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {((slaBreaches.data as any[]) ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No SLA breaches — all complaints acknowledged within 72h.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="surge" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Radar className="h-5 w-5" /> Complaint surge alerts</CardTitle>
              <CardDescription>Z-score + Bayesian change-point detection over per-controller daily complaint counts.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2 items-end">
                <div>
                  <Label>Status</Label>
                  <Select value={surgeStatus} onValueChange={setSurgeStatus}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["open", "acknowledged", "resolved"].map((st) => <SelectItem key={st} value={st}>{st}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="secondary" onClick={() => runDetection.mutate({ fullHistory: false })} disabled={runDetection.isPending}>
                  {runDetection.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Run surge detection now
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Controller</TableHead><TableHead>Severity</TableHead><TableHead className="text-right">Observed</TableHead>
                    <TableHead className="text-right">Baseline</TableHead><TableHead className="text-right">z-score</TableHead>
                    <TableHead>Raised</TableHead><TableHead>Status</TableHead><TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((surges.data as any)?.data ?? []).map((a: any) => (
                    <TableRow key={a.id}>
                      <TableCell className="max-w-[220px] truncate">{a.controller_key}</TableCell>
                      <TableCell><Badge variant="outline" className={SEVERITY_COLORS[a.severity] ?? ""}>{a.severity}</Badge></TableCell>
                      <TableCell className="text-right font-mono">{a.observed_count ?? a.observed ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{a.baseline_mean != null ? Number(a.baseline_mean).toFixed(2) : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{a.zscore != null ? Number(a.zscore).toFixed(2) : "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{a.created_at ? new Date(a.created_at).toLocaleString() : "—"}</TableCell>
                      <TableCell><Badge variant="outline">{a.status}</Badge></TableCell>
                      <TableCell className="text-right space-x-1">
                        {a.status === "open" && (
                          <Button size="sm" variant="outline" disabled={ackSurge.isPending} onClick={() => ackSurge.mutate({ id: a.id, resolve: false })}>Acknowledge</Button>
                        )}
                        {a.status !== "resolved" && (
                          <Button size="sm" variant="ghost" disabled={ackSurge.isPending} onClick={() => ackSurge.mutate({ id: a.id, resolve: true })}>Resolve</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {((surges.data as any)?.data ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No {surgeStatus} alerts.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Daily complaint volume (90 days, by category)</CardTitle>
              <CardDescription>
                {(trends.data as any)?.from} → {(trends.data as any)?.to}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-end gap-[2px] h-32">
                {trendDaily.map((p) => (
                  <div key={p.d} title={`${p.d}: ${p.n}`} className="flex-1 bg-teal-500/60 rounded-t" style={{ height: `${(p.n / maxN) * 100}%` }} />
                ))}
                {trendDaily.length === 0 && <p className="text-sm text-muted-foreground">No complaints in range.</p>}
              </div>
              <div>
                <p className="font-medium mb-2">Top categories</p>
                <div className="space-y-1">
                  {(((trends.data as any)?.topDimensions ?? []) as Array<{ dimension: string; total: number }>).map((d) => (
                    <div key={d.dimension} className="flex items-center gap-2 text-sm">
                      <span className="w-40 truncate">{d.dimension}</span>
                      <div className="flex-1 h-3 bg-muted rounded overflow-hidden">
                        <div className="h-full bg-teal-500/70" style={{ width: `${(d.total / Math.max(1, ...(((trends.data as any)?.topDimensions ?? []) as Array<{ total: number }>).map((x) => x.total))) * 100}%` }} />
                      </div>
                      <span className="font-mono text-xs w-10 text-right">{d.total}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
