import { Fragment, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useAuth } from "@/_core/hooks/useAuth";
import { Workflow, RefreshCw, Play, Trash2 } from "lucide-react";

/**
 * AutomationRules (Round-16 W4)
 * =============================
 * Admin console for six previously orphaned automation/rule-engine namespaces:
 *   - transferApprovalRules  (list / create / update / delete)
 *   - transferAutoApproval   (getRules / upsertRule / applyRules)
 *   - dsarAutomation         (getDeadlineAlerts / autoAssign / bulkExtend / getWorkflowStats)
 *   - breachLifecycle        (getTimeline / submitNotification / getComplianceStats)
 *   - retentionScheduler     (getStatus / getExpiredRecords)
 *   - onboardingAutomation   (getOrgProgress)
 */

function ErrText({ error }: { error: any }) {
  if (!error) return null;
  return <div className="text-xs text-red-400">{error.message ?? String(error)}</div>;
}

function asRows(data: any): any[] {
  return Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : [];
}

function fmtTs(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

function parseSectors(text: string): string[] {
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

const URGENCY_COLORS: Record<string, string> = {
  overdue: "bg-red-500/20 text-red-300 border-red-500/40",
  critical: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  warning: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  on_track: "bg-green-500/20 text-green-300 border-green-500/40",
};

// ── 1. Transfer Approval Rules (CRUD) ────────────────────────────────────────

function TransferApprovalRulesSection() {
  const rules = trpc.transferApprovalRules.list.useQuery();
  const [form, setForm] = useState({
    destinationCountry: "",
    sourceCountry: "",
    dataCategory: "",
    autoApproveThresholdMb: "0",
    maxVolumeGb: "",
    requiresDpa: true,
    requiresAdequacyDecision: false,
    autoApprove: false,
  });
  const create = trpc.transferApprovalRules.create.useMutation({
    onSuccess: () => {
      toast.success("Rule created");
      setForm({ destinationCountry: "", sourceCountry: "", dataCategory: "", autoApproveThresholdMb: "0", maxVolumeGb: "", requiresDpa: true, requiresAdequacyDecision: false, autoApprove: false });
      rules.refetch();
    },
    onError: (err) => toast.error(err.message),
  });
  const update = trpc.transferApprovalRules.update.useMutation({
    onSuccess: () => { toast.success("Rule updated"); rules.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const del = trpc.transferApprovalRules.delete.useMutation({
    onSuccess: () => { toast.success("Rule deleted"); rules.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const rows = asRows(rules.data);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Create rule</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div><Label>Destination country (ISO-2)</Label><Input maxLength={2} value={form.destinationCountry} onChange={(e) => setForm({ ...form, destinationCountry: e.target.value.toUpperCase() })} placeholder="GB" /></div>
            <div><Label>Source country (ISO-2, optional)</Label><Input maxLength={2} value={form.sourceCountry} onChange={(e) => setForm({ ...form, sourceCountry: e.target.value.toUpperCase() })} /></div>
            <div><Label>Data category</Label><Input value={form.dataCategory} onChange={(e) => setForm({ ...form, dataCategory: e.target.value })} /></div>
            <div><Label>Max volume (GB)</Label><Input type="number" min={0} value={form.maxVolumeGb} onChange={(e) => setForm({ ...form, maxVolumeGb: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div><Label>Auto-approve threshold (MB)</Label><Input type="number" min={0} value={form.autoApproveThresholdMb} onChange={(e) => setForm({ ...form, autoApproveThresholdMb: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.requiresDpa} onCheckedChange={(v) => setForm({ ...form, requiresDpa: v })} /> Requires DPA</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.requiresAdequacyDecision} onCheckedChange={(v) => setForm({ ...form, requiresAdequacyDecision: v })} /> Requires adequacy decision</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.autoApprove} onCheckedChange={(v) => setForm({ ...form, autoApprove: v })} /> Auto-approve</label>
          </div>
          <Button
            size="sm"
            disabled={form.destinationCountry.length !== 2 || create.isPending}
            onClick={() =>
              create.mutate({
                destinationCountry: form.destinationCountry,
                sourceCountry: form.sourceCountry.length === 2 ? form.sourceCountry : undefined,
                dataCategory: form.dataCategory || undefined,
                autoApproveThresholdMb: parseFloat(form.autoApproveThresholdMb) || 0,
                maxVolumeGb: form.maxVolumeGb ? parseFloat(form.maxVolumeGb) : undefined,
                requiresDpa: form.requiresDpa,
                requiresAdequacyDecision: form.requiresAdequacyDecision,
                autoApprove: form.autoApprove,
              })
            }
          >
            Create rule
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Rules ({rows.length})</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => rules.refetch()}><RefreshCw className="h-4 w-4" /></Button>
        </CardHeader>
        <CardContent>
          {rules.isError && <ErrText error={rules.error} />}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Destination</TableHead>
                <TableHead>Sectors</TableHead>
                <TableHead>Max GB</TableHead>
                <TableHead>DPA</TableHead>
                <TableHead>Adequacy</TableHead>
                <TableHead>Auto-approve</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.destination_country}</TableCell>
                  <TableCell className="text-xs">{Array.isArray(r.allowed_sectors) ? r.allowed_sectors.join(", ") : String(r.allowed_sectors ?? "—")}</TableCell>
                  <TableCell className="text-xs">
                    <Input
                      type="number"
                      className="h-7 w-24 text-xs"
                      defaultValue={r.max_volume_gb ?? ""}
                      placeholder="—"
                      onBlur={(e) => {
                        const v = e.target.value ? parseFloat(e.target.value) : undefined;
                        if (v !== (r.max_volume_gb ?? undefined)) update.mutate({ id: r.id, maxVolumeGb: v });
                      }}
                    />
                  </TableCell>
                  <TableCell><Switch checked={!!r.requires_dpa} onCheckedChange={(v) => update.mutate({ id: r.id, requiresDpa: v })} /></TableCell>
                  <TableCell><Switch checked={!!r.requires_adequacy_decision} onCheckedChange={(v) => update.mutate({ id: r.id, requiresAdequacyDecision: v })} /></TableCell>
                  <TableCell><Switch checked={!!r.auto_approve} onCheckedChange={(v) => update.mutate({ id: r.id, autoApprove: v })} /></TableCell>
                  <TableCell className="text-xs">{fmtTs(r.updated_at)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete rule ${r.id}`}
                      onClick={() => { if (window.confirm(`Delete rule for ${r.destination_country}?`)) del.mutate({ id: r.id }); }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-400" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && !rules.isLoading && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground text-sm">No rules configured</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── 2. Transfer Auto-Approval engine ─────────────────────────────────────────

function TransferAutoApprovalSection() {
  const rules = trpc.transferAutoApproval.getRules.useQuery();
  const [lastRun, setLastRun] = useState<any>(null);
  const [form, setForm] = useState({
    destinationCountry: "",
    allowedSectors: "",
    maxVolumeGb: "",
    requiresDpa: true,
    requiresAdequacyDecision: false,
    autoApprove: false,
  });
  const upsert = trpc.transferAutoApproval.upsertRule.useMutation({
    onSuccess: () => { toast.success("Rule upserted"); rules.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const apply = trpc.transferAutoApproval.applyRules.useMutation({
    onSuccess: (r: any) => {
      setLastRun({ at: new Date().toISOString(), ...r });
      toast.success(`Applied rules: ${r.autoApproved} approved, ${r.autoRejected} rejected of ${r.totalProcessed} pending`);
    },
    onError: (err) => toast.error(err.message),
  });

  const rows = asRows(rules.data);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Auto-approval engine</CardTitle>
            <CardDescription>Apply rules to all pending cross-border transfers</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => rules.refetch()}><RefreshCw className="h-4 w-4" /></Button>
            <Button size="sm" disabled={apply.isPending} onClick={() => { if (window.confirm("Apply auto-approval rules to ALL pending transfers?")) apply.mutate(); }}>
              <Play className="h-3.5 w-3.5 mr-1" /> {apply.isPending ? "Applying…" : "Run now"}
            </Button>
          </div>
        </CardHeader>
        {lastRun && (
          <CardContent className="pt-0">
            <div className="text-xs text-muted-foreground">
              Last run {fmtTs(lastRun.at)} — processed {lastRun.totalProcessed}, auto-approved {lastRun.autoApproved}, auto-rejected {lastRun.autoRejected}
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Upsert rule (keyed by destination country)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div><Label>Destination country</Label><Input value={form.destinationCountry} onChange={(e) => setForm({ ...form, destinationCountry: e.target.value })} placeholder="United Kingdom" /></div>
            <div><Label>Allowed sectors (comma separated)</Label><Input value={form.allowedSectors} onChange={(e) => setForm({ ...form, allowedSectors: e.target.value })} placeholder="finance, health" /></div>
            <div><Label>Max volume (GB)</Label><Input type="number" min={0} value={form.maxVolumeGb} onChange={(e) => setForm({ ...form, maxVolumeGb: e.target.value })} /></div>
          </div>
          <div className="flex gap-6 flex-wrap">
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.requiresDpa} onCheckedChange={(v) => setForm({ ...form, requiresDpa: v })} /> Requires DPA</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.requiresAdequacyDecision} onCheckedChange={(v) => setForm({ ...form, requiresAdequacyDecision: v })} /> Requires adequacy decision</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.autoApprove} onCheckedChange={(v) => setForm({ ...form, autoApprove: v })} /> Auto-approve</label>
          </div>
          <Button
            size="sm"
            disabled={form.destinationCountry.trim().length < 2 || upsert.isPending}
            onClick={() =>
              upsert.mutate({
                destinationCountry: form.destinationCountry.trim(),
                allowedSectors: parseSectors(form.allowedSectors),
                maxVolumeGb: form.maxVolumeGb ? parseFloat(form.maxVolumeGb) : undefined,
                requiresDpa: form.requiresDpa,
                requiresAdequacyDecision: form.requiresAdequacyDecision,
                autoApprove: form.autoApprove,
              })
            }
          >
            Upsert rule
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Active rules ({rows.length})</CardTitle></CardHeader>
        <CardContent>
          {rules.isError && <ErrText error={rules.error} />}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Destination</TableHead>
                <TableHead>Sectors</TableHead>
                <TableHead>Max GB</TableHead>
                <TableHead>DPA</TableHead>
                <TableHead>Adequacy</TableHead>
                <TableHead>Auto-approve</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs font-medium">{r.destination_country}</TableCell>
                  <TableCell className="text-xs">{Array.isArray(r.allowed_sectors) ? r.allowed_sectors.join(", ") : String(r.allowed_sectors ?? "—")}</TableCell>
                  <TableCell className="text-xs">{r.max_volume_gb ?? "—"}</TableCell>
                  <TableCell><Badge variant={r.requires_dpa ? "default" : "outline"}>{r.requires_dpa ? "yes" : "no"}</Badge></TableCell>
                  <TableCell><Badge variant={r.requires_adequacy_decision ? "default" : "outline"}>{r.requires_adequacy_decision ? "yes" : "no"}</Badge></TableCell>
                  <TableCell><Badge variant={r.auto_approve ? "default" : "outline"} className={r.auto_approve ? "border-green-500/40 text-green-300" : ""}>{r.auto_approve ? "on" : "off"}</Badge></TableCell>
                  <TableCell className="text-xs">{fmtTs(r.updated_at)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && !rules.isLoading && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground text-sm">No rules configured</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── 3. DSAR Automation ────────────────────────────────────────────────────────

function DsarAutomationSection() {
  const alerts = trpc.dsarAutomation.getDeadlineAlerts.useQuery();
  const stats = trpc.dsarAutomation.getWorkflowStats.useQuery();
  const refresh = () => { alerts.refetch(); stats.refetch(); };

  const [assignFor, setAssignFor] = useState<number | null>(null);
  const [assigneeId, setAssigneeId] = useState("");
  const autoAssign = trpc.dsarAutomation.autoAssign.useMutation({
    onSuccess: () => { toast.success("DSAR assigned"); setAssignFor(null); setAssigneeId(""); alerts.refetch(); stats.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [extDays, setExtDays] = useState("30");
  const [extReason, setExtReason] = useState("");
  const bulkExtend = trpc.dsarAutomation.bulkExtend.useMutation({
    onSuccess: (r: any) => { toast.success(`Extended ${r.extended} DSAR deadline(s)`); setChecked(new Set()); setExtReason(""); refresh(); },
    onError: (err) => toast.error(err.message),
  });

  const rows = asRows(alerts.data);
  const s: any = stats.data ?? {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          ["Pending", s.pending], ["In progress", s.in_progress], ["Completed", s.completed],
          ["Overdue", s.overdue], ["Due ≤ 7d", s.due_soon],
          ["Avg completion (d)", s.avg_completion_days != null ? Number(s.avg_completion_days).toFixed(1) : "—"],
        ].map(([label, val]) => (
          <Card key={String(label)}>
            <CardContent className="py-3 px-4">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-xl font-bold">{String(val ?? "—")}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Deadline alerts</CardTitle>
            <CardDescription>Open DSARs ordered by response deadline</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4" /></Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {alerts.isError && <ErrText error={alerts.error} />}

          {checked.size > 0 && (
            <div className="flex gap-2 items-end border border-border rounded-md p-3 bg-muted/30 flex-wrap">
              <span className="text-sm font-medium self-center">{checked.size} selected</span>
              <div className="w-28"><Label>Extend by (days)</Label><Input type="number" min={1} max={30} value={extDays} onChange={(e) => setExtDays(e.target.value)} /></div>
              <div className="flex-1 min-w-52"><Label>Reason (min 10 chars)</Label><Input value={extReason} onChange={(e) => setExtReason(e.target.value)} /></div>
              <Button
                size="sm"
                disabled={extReason.trim().length < 10 || bulkExtend.isPending}
                onClick={() => bulkExtend.mutate({ dsarIds: Array.from(checked), extensionDays: Math.min(30, Math.max(1, parseInt(extDays) || 30)), reason: extReason.trim() })}
              >
                Bulk extend
              </Button>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead></TableHead>
                <TableHead>ID</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Organisation</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Days left</TableHead>
                <TableHead>Urgency</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r: any) => (
                <Fragment key={r.id}>
                  <TableRow>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={checked.has(r.id)}
                        onChange={(e) => {
                          const next = new Set(checked);
                          if (e.target.checked) next.add(r.id); else next.delete(r.id);
                          setChecked(next);
                        }}
                        aria-label={`Select DSAR ${r.id}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">#{r.id}</TableCell>
                    <TableCell className="text-xs">{r.subject_name ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.request_type}</TableCell>
                    <TableCell className="text-xs">{r.org_name ?? "—"}</TableCell>
                    <TableCell className="text-xs">{fmtTs(r.deadline_at)}</TableCell>
                    <TableCell className="text-xs">{r.days_remaining != null ? Number(r.days_remaining).toFixed(1) : "—"}</TableCell>
                    <TableCell><Badge variant="outline" className={URGENCY_COLORS[r.urgency] ?? ""}>{r.urgency}</Badge></TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => setAssignFor(assignFor === r.id ? null : r.id)}>Assign</Button>
                    </TableCell>
                  </TableRow>
                  {assignFor === r.id && (
                    <TableRow>
                      <TableCell colSpan={9}>
                        <div className="flex gap-2 items-end py-1">
                          <div className="w-40"><Label>Assignee user ID</Label><Input type="number" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} /></div>
                          <Button
                            size="sm"
                            disabled={!assigneeId || autoAssign.isPending}
                            onClick={() => autoAssign.mutate({ dsarId: r.id, assigneeId: parseInt(assigneeId) })}
                          >
                            Auto-assign
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setAssignFor(null)}>Cancel</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
              {rows.length === 0 && !alerts.isLoading && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground text-sm">No open DSARs</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── 4. Breach Lifecycle ───────────────────────────────────────────────────────

function BreachLifecycleSection() {
  const stats = trpc.breachLifecycle.getComplianceStats.useQuery();
  const [breachId, setBreachId] = useState("");
  const timeline = trpc.breachLifecycle.getTimeline.useQuery(
    { breachId: parseInt(breachId) || 0 },
    { enabled: false },
  );

  const [notif, setNotif] = useState({
    notificationType: "72h_initial" as "72h_initial" | "30d_full_report" | "supplementary",
    notifiedAuthority: "NDPC",
    affectedDataSubjects: "0",
    dataCategories: "",
    mitigationMeasures: "",
  });
  const submitNotification = trpc.breachLifecycle.submitNotification.useMutation({
    onSuccess: () => {
      toast.success("Notification submitted");
      setNotif({ ...notif, mitigationMeasures: "", dataCategories: "" });
      timeline.refetch(); stats.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const s: any = stats.data ?? {};
  const t: any = timeline.data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          ["Total breaches", s.total], ["Notified", s.notified], ["Overdue 72h", s.overdue_notification],
          ["Closed", s.closed], ["Avg notify (h)", s.avg_notification_hours != null ? Number(s.avg_notification_hours).toFixed(1) : "—"],
        ].map(([label, val]) => (
          <Card key={String(label)}>
            <CardContent className="py-3 px-4">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-xl font-bold">{String(val ?? "—")}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Breach timeline & deadlines</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-end">
            <div className="w-40"><Label>Breach ID</Label><Input type="number" value={breachId} onChange={(e) => setBreachId(e.target.value)} /></div>
            <Button
              size="sm"
              disabled={!breachId || timeline.isFetching}
              onClick={() => timeline.refetch().then((r) => { if (r.isError) toast.error(r.error.message); })}
            >
              Load timeline
            </Button>
          </div>

          {t && (
            <>
              <div className="flex gap-2 flex-wrap items-center text-xs">
                <Badge variant="outline">{String(t.complianceStatus)}</Badge>
                <span className="text-muted-foreground">Detected {fmtTs(t.breach?.detected_at)} ({t.deadlines?.hours_since_detection}h ago)</span>
                <Badge variant="outline" className={t.deadlines?.notify_72h_overdue ? "border-red-500/40 text-red-300" : "border-green-500/40 text-green-300"}>
                  72h deadline {fmtTs(t.deadlines?.notify_72h)}{t.deadlines?.notify_72h_overdue ? " — OVERDUE" : ""}
                </Badge>
                <Badge variant="outline" className={t.deadlines?.notify_30d_overdue ? "border-red-500/40 text-red-300" : ""}>
                  30d report {fmtTs(t.deadlines?.notify_30d)}{t.deadlines?.notify_30d_overdue ? " — OVERDUE" : ""}
                </Badge>
              </div>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>When</TableHead><TableHead>Action</TableHead><TableHead>Actor</TableHead><TableHead>Notes</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {asRows(t.timeline).map((ev: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{fmtTs(ev.created_at)}</TableCell>
                      <TableCell className="text-xs font-mono">{ev.action}</TableCell>
                      <TableCell className="text-xs">{ev.actor}</TableCell>
                      <TableCell className="text-xs max-w-md truncate">{ev.notes}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="border border-border rounded-md p-3 space-y-3">
                <div className="text-sm font-medium">Submit notification</div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                  <div>
                    <Label>Type</Label>
                    <Select value={notif.notificationType} onValueChange={(v) => setNotif({ ...notif, notificationType: v as typeof notif.notificationType })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="72h_initial">72h initial</SelectItem>
                        <SelectItem value="30d_full_report">30d full report</SelectItem>
                        <SelectItem value="supplementary">Supplementary</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Authority</Label><Input value={notif.notifiedAuthority} onChange={(e) => setNotif({ ...notif, notifiedAuthority: e.target.value })} /></div>
                  <div><Label>Affected subjects</Label><Input type="number" min={0} value={notif.affectedDataSubjects} onChange={(e) => setNotif({ ...notif, affectedDataSubjects: e.target.value })} /></div>
                  <div><Label>Data categories (comma separated)</Label><Input value={notif.dataCategories} onChange={(e) => setNotif({ ...notif, dataCategories: e.target.value })} /></div>
                </div>
                <div>
                  <Label>Mitigation measures (min 20 chars)</Label>
                  <Textarea rows={2} value={notif.mitigationMeasures} onChange={(e) => setNotif({ ...notif, mitigationMeasures: e.target.value })} />
                </div>
                <Button
                  size="sm"
                  disabled={notif.mitigationMeasures.trim().length < 20 || submitNotification.isPending}
                  onClick={() =>
                    submitNotification.mutate({
                      breachId: parseInt(breachId),
                      notificationType: notif.notificationType,
                      notifiedAuthority: notif.notifiedAuthority || "NDPC",
                      affectedDataSubjects: Math.max(0, parseInt(notif.affectedDataSubjects) || 0),
                      dataCategories: parseSectors(notif.dataCategories),
                      mitigationMeasures: notif.mitigationMeasures.trim(),
                    })
                  }
                >
                  Submit notification
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── 5. Retention Scheduler ────────────────────────────────────────────────────

function RetentionSchedulerSection() {
  const status = trpc.retentionScheduler.getStatus.useQuery();
  const expired = trpc.retentionScheduler.getExpiredRecords.useQuery(undefined, { enabled: false });

  const policies = asRows(status.data);
  const expiredRows = asRows(expired.data);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Retention policy status</CardTitle>
            <CardDescription>Policy coverage per organisation and data category</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => status.refetch()}><RefreshCw className="h-4 w-4" /></Button>
        </CardHeader>
        <CardContent>
          {status.isError && <ErrText error={status.error} />}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organisation</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead>Data category</TableHead>
                <TableHead>Retention (days)</TableHead>
                <TableHead>Legal basis</TableHead>
                <TableHead>Records</TableHead>
                <TableHead>Oldest record</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {policies.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell className="text-xs">{p.org_name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{p.sector ?? "—"}</TableCell>
                  <TableCell className="text-xs font-medium">{p.data_category}</TableCell>
                  <TableCell className="text-xs">{p.retention_period_days}</TableCell>
                  <TableCell className="text-xs">{p.legal_basis ?? "—"}</TableCell>
                  <TableCell className="text-xs">{p.consent_records_count}</TableCell>
                  <TableCell className="text-xs">{fmtTs(p.oldest_record)}</TableCell>
                  <TableCell><Badge variant="outline">{p.status ?? "active"}</Badge></TableCell>
                </TableRow>
              ))}
              {policies.length === 0 && !status.isLoading && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground text-sm">No retention policies found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Expired records scan</CardTitle>
            <CardDescription>Records past their retention period, pending disposal (admin)</CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={expired.isFetching}
            onClick={() => expired.refetch().then((r) => { if (r.isError) toast.error(r.error.message); })}
          >
            <Play className="h-3.5 w-3.5 mr-1" /> {expired.isFetching ? "Scanning…" : "Run scan"}
          </Button>
        </CardHeader>
        <CardContent>
          {expired.isError && <ErrText error={expired.error} />}
          {expired.data !== undefined && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Record</TableHead>
                  <TableHead>Organisation</TableHead>
                  <TableHead>Data category</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Retention (days)</TableHead>
                  <TableHead>Expired on</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expiredRows.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">#{r.id}</TableCell>
                    <TableCell className="text-xs">{r.org_name}</TableCell>
                    <TableCell className="text-xs">{r.data_category}</TableCell>
                    <TableCell className="text-xs">{fmtTs(r.created_at)}</TableCell>
                    <TableCell className="text-xs">{r.retention_period_days}</TableCell>
                    <TableCell className="text-xs text-red-300">{fmtTs(r.expiry_date)}</TableCell>
                  </TableRow>
                ))}
                {expiredRows.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground text-sm">No expired records — all within retention</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── 6. Onboarding Automation ──────────────────────────────────────────────────

function OnboardingAutomationSection() {
  const [orgId, setOrgId] = useState("");
  const progress = trpc.onboardingAutomation.getOrgProgress.useQuery(
    orgId ? { orgId: parseInt(orgId) } : {},
    { enabled: false },
  );

  const d: any = progress.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Organisation onboarding progress</CardTitle>
        <CardDescription>Weighted checklist of mandatory NDPA onboarding steps</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 items-end">
          <div className="w-48"><Label>Organisation ID (blank = your org)</Label><Input type="number" value={orgId} onChange={(e) => setOrgId(e.target.value)} /></div>
          <Button
            size="sm"
            disabled={progress.isFetching}
            onClick={() => progress.refetch().then((r) => { if (r.isError) toast.error(r.error.message); })}
          >
            {progress.isFetching ? "Loading…" : "Check progress"}
          </Button>
        </div>
        {progress.isError && <ErrText error={progress.error} />}

        {d && (
          <>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${d.progressPct ?? 0}%` }} />
              </div>
              <span className="text-sm font-bold">{d.progressPct}%</span>
              <span className="text-xs text-muted-foreground">{d.completedCount}/{d.totalCount} steps</span>
            </div>
            {d.nextStep && (
              <div className="text-xs text-muted-foreground">
                Next step: <span className="text-foreground font-medium">{d.nextStep.label}</span>
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow><TableHead>Step</TableHead><TableHead>Weight</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {asRows(d.steps).map((st: any) => (
                  <TableRow key={st.key}>
                    <TableCell className="text-xs">{st.label}</TableCell>
                    <TableCell className="text-xs">{st.weight}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={st.completed ? "border-green-500/40 text-green-300" : "border-yellow-500/40 text-yellow-300"}>
                        {st.completed ? "complete" : "pending"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AutomationRules() {
  const { user } = useAuth();

  if (!user || user.role !== "admin") {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Breadcrumbs items={[{ label: "Automation Rules" }]} />
        <Card className="mt-4">
          <CardContent className="py-8 text-center text-muted-foreground">
            Admin access required to manage automation rule engines.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Automation Rules" }]} />
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Workflow className="h-6 w-6" /> Automation Rules
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Rule engines and automation jobs: cross-border transfer approvals, DSAR deadlines,
          breach notification lifecycle, retention enforcement and organisation onboarding.
        </p>
      </div>

      <Tabs defaultValue="transfer-rules">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="transfer-rules">Transfer rules</TabsTrigger>
          <TabsTrigger value="auto-approval">Auto-approval</TabsTrigger>
          <TabsTrigger value="dsar">DSAR automation</TabsTrigger>
          <TabsTrigger value="breach">Breach lifecycle</TabsTrigger>
          <TabsTrigger value="retention">Retention scheduler</TabsTrigger>
          <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
        </TabsList>

        <TabsContent value="transfer-rules" className="mt-4"><TransferApprovalRulesSection /></TabsContent>
        <TabsContent value="auto-approval" className="mt-4"><TransferAutoApprovalSection /></TabsContent>
        <TabsContent value="dsar" className="mt-4"><DsarAutomationSection /></TabsContent>
        <TabsContent value="breach" className="mt-4"><BreachLifecycleSection /></TabsContent>
        <TabsContent value="retention" className="mt-4"><RetentionSchedulerSection /></TabsContent>
        <TabsContent value="onboarding" className="mt-4"><OnboardingAutomationSection /></TabsContent>
      </Tabs>
    </div>
  );
}
