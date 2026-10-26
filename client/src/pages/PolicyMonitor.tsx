/**
 * Policy Monitor — regulatory-change monitoring console.
 * Wires the full `policyMonitor` router (17 procedures):
 * monitored-policy registry, version/diff feed, semantic-diff retry queue,
 * officer review-task workflow (assign/decide/escalate/close/notify).
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
import {
  BellRing, FileDiff, Loader2, MonitorCheck, Plus, RefreshCw, ScrollText, ShieldAlert,
} from "lucide-react";

const CLASSIFICATIONS = ["pending", "none", "minor", "material_neutral", "material_beneficial", "material_adverse"] as const;
const REVIEW_STATUSES = ["open", "assigned", "in_progress", "decided", "escalated", "closed"] as const;
const PRIORITIES = ["critical", "high", "medium", "low"] as const;

const CLASS_COLORS: Record<string, string> = {
  material_adverse: "bg-red-500/20 text-red-300 border-red-500/40",
  material_beneficial: "bg-green-500/20 text-green-300 border-green-500/40",
  material_neutral: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  minor: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  none: "bg-muted text-muted-foreground",
  pending: "bg-muted text-muted-foreground",
};
const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-300 border-red-500/40",
  high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  medium: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  low: "bg-muted text-muted-foreground",
};

function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

function ClassBadge({ value }: { value: unknown }) {
  const v = String(value ?? "pending");
  return <Badge variant="outline" className={CLASS_COLORS[v] ?? ""}>{v.replaceAll("_", " ")}</Badge>;
}

export default function PolicyMonitor() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isStaff = user?.role === "admin" || user?.role === "government_staff";

  const overview = trpc.policyMonitor.monitorOverview.useQuery();
  const refreshAll = () => utils.policyMonitor.invalidate();

  // ── Policies tab state ────────────────────────────────────────────────────
  const [enabledFilter, setEnabledFilter] = useState<string>("all");
  const [orgFilter, setOrgFilter] = useState("");
  const policies = trpc.policyMonitor.listPolicies.useQuery({
    ...(enabledFilter === "all" ? {} : { enabled: enabledFilter === "enabled" }),
    ...(orgFilter.trim() && Number.isInteger(Number(orgFilter)) ? { organizationId: Number(orgFilter) } : {}),
  });
  const [showRegister, setShowRegister] = useState(false);
  const [regForm, setRegForm] = useState({ controller_name: "", policy_url: "", check_interval_hours: 24, organization_id: "", notes: "" });
  const [detailId, setDetailId] = useState<number | null>(null);
  const policyDetail = trpc.policyMonitor.getPolicy.useQuery({ id: detailId ?? 0 }, { enabled: detailId != null });
  const [editPolicy, setEditPolicy] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ check_interval_hours: 24, notes: "" });

  // ── Changes tab state ─────────────────────────────────────────────────────
  const [selectedPolicyId, setSelectedPolicyId] = useState<number | null>(null);
  const [classFilter, setClassFilter] = useState<string>("all");
  const versions = trpc.policyMonitor.listVersions.useQuery(
    {
      policy_id: selectedPolicyId ?? 0,
      ...(classFilter === "all" ? {} : { classification: classFilter as (typeof CLASSIFICATIONS)[number] }),
      limit: 100,
    },
    { enabled: selectedPolicyId != null }
  );
  const [diffVersionId, setDiffVersionId] = useState<number | null>(null);
  const diffDetail = trpc.policyMonitor.getVersionDiff.useQuery(
    { version_id: diffVersionId ?? 0 },
    { enabled: diffVersionId != null }
  );
  const diffQueue = trpc.policyMonitor.listDiffQueue.useQuery();

  // ── Reviews tab state ─────────────────────────────────────────────────────
  const [reviewStatus, setReviewStatus] = useState<string>("all");
  const [reviewPriority, setReviewPriority] = useState<string>("all");
  const reviews = trpc.policyMonitor.listReviews.useQuery({
    ...(reviewStatus === "all" ? {} : { status: reviewStatus as (typeof REVIEW_STATUSES)[number] }),
    ...(reviewPriority === "all" ? {} : { priority: reviewPriority as (typeof PRIORITIES)[number] }),
    limit: 200,
  });
  const [reviewId, setReviewId] = useState<number | null>(null);
  const reviewDetail = trpc.policyMonitor.getReview.useQuery({ id: reviewId ?? 0 }, { enabled: reviewId != null });
  const [assignTo, setAssignTo] = useState("");
  const [assignPriority, setAssignPriority] = useState<string>("");
  const [decision, setDecision] = useState<"upheld" | "dismissed" | "referred">("upheld");
  const [decisionNotes, setDecisionNotes] = useState("");
  const [escalationReason, setEscalationReason] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [notifyChannel, setNotifyChannel] = useState<"in_app" | "email" | "letter">("in_app");
  const [notifyMessage, setNotifyMessage] = useState("");
  const [notifyRef, setNotifyRef] = useState("");

  // ── Mutations ─────────────────────────────────────────────────────────────
  const registerPolicy = trpc.policyMonitor.registerPolicy.useMutation({
    onSuccess: (row: any) => {
      toast.success(`Monitoring registered for ${row?.controller_name ?? "controller"}`);
      setShowRegister(false);
      setRegForm({ controller_name: "", policy_url: "", check_interval_hours: 24, organization_id: "", notes: "" });
      refreshAll();
    },
    onError: (err) => toast.error(err.message),
  });
  const updatePolicy = trpc.policyMonitor.updatePolicy.useMutation({
    onSuccess: () => { toast.success("Policy updated"); setEditPolicy(null); refreshAll(); },
    onError: (err) => toast.error(err.message),
  });
  const checkNow = trpc.policyMonitor.checkNow.useMutation({
    onSuccess: () => { toast.success("Check queued for next worker tick"); refreshAll(); },
    onError: (err) => toast.error(err.message),
  });
  const requeueDiff = trpc.policyMonitor.requeueDiff.useMutation({
    onSuccess: () => { toast.success("Version re-queued for semantic diff"); refreshAll(); },
    onError: (err) => toast.error(err.message),
  });
  const assignReview = trpc.policyMonitor.assignReview.useMutation({
    onSuccess: () => { toast.success("Review assigned"); setAssignTo(""); setAssignPriority(""); reviewDetail.refetch(); reviews.refetch(); overview.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const decideReview = trpc.policyMonitor.decideReview.useMutation({
    onSuccess: () => { toast.success("Decision recorded"); setDecisionNotes(""); reviewDetail.refetch(); reviews.refetch(); overview.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const escalateReview = trpc.policyMonitor.escalateReview.useMutation({
    onSuccess: (res: any) => {
      toast.success(res?.investigation_violation_id
        ? `Escalated — investigation violation #${res.investigation_violation_id} opened`
        : "Escalated — recorded on review + audit trail (no linked organization)");
      setEscalationReason(""); reviewDetail.refetch(); reviews.refetch(); overview.refetch();
    },
    onError: (err) => toast.error(err.message),
  });
  const closeReview = trpc.policyMonitor.closeReview.useMutation({
    onSuccess: () => { toast.success("Review closed"); setCloseNotes(""); reviewDetail.refetch(); reviews.refetch(); overview.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const notifyController = trpc.policyMonitor.notifyController.useMutation({
    onSuccess: (res: any) => { toast.success(`Controller notified (${res?.reference ?? notifyChannel})`); setNotifyMessage(""); setNotifyRef(""); reviewDetail.refetch(); reviews.refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const policyRows: any[] = (policies.data as any[]) ?? [];
  const reviewRows: any[] = (reviews.data as any[]) ?? [];
  const queueRows: any[] = (diffQueue.data as any[]) ?? [];
  const versionRows: any[] = (versions.data as any[]) ?? [];
  const rd: any = reviewDetail.data;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Policy Monitor" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MonitorCheck className="h-6 w-6" /> Policy Monitor</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Privacy-notice change monitoring (NDPA 2023 ss. 34–35) — detected changes, semantic diffs and officer review workflow.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={refreshAll}><RefreshCw className="h-4 w-4" /></Button>
          {isAdmin && (
            <Button onClick={() => setShowRegister((v) => !v)}>
              <Plus className="h-4 w-4 mr-2" /> Register policy
            </Button>
          )}
        </div>
      </div>

      {/* Overview rollup */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          ["Enabled policies", overview.data?.enabled_policies],
          ["Versions", overview.data?.total_versions],
          ["Material adverse", overview.data?.material_adverse_changes],
          ["Diff queue", overview.data?.diff_queue_depth],
          ["Open reviews", overview.data?.open_reviews],
          ["Escalated", overview.data?.escalated_reviews],
          ["Failing policies", overview.data?.failing_policies],
        ].map(([label, v]) => (
          <div key={String(label)} className="border rounded p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-mono font-bold">{overview.isLoading ? "…" : v == null ? "—" : String(v)}</p>
          </div>
        ))}
      </div>

      {showRegister && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Register monitored policy</CardTitle>
            <CardDescription>Add a controller privacy-notice URL to the monitoring registry.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <Label htmlFor="pm-reg-name">Controller name</Label>
              <Input id="pm-reg-name" value={regForm.controller_name} onChange={(e) => setRegForm({ ...regForm, controller_name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="pm-reg-url">Policy URL (https)</Label>
              <Input id="pm-reg-url" value={regForm.policy_url} onChange={(e) => setRegForm({ ...regForm, policy_url: e.target.value })} placeholder="https://…" />
            </div>
            <div>
              <Label htmlFor="pm-reg-interval">Check interval (hours)</Label>
              <Input id="pm-reg-interval" type="number" min={1} max={8760} value={regForm.check_interval_hours}
                onChange={(e) => setRegForm({ ...regForm, check_interval_hours: Number(e.target.value) })} />
            </div>
            <div>
              <Label htmlFor="pm-reg-org">Organization ID (optional)</Label>
              <Input id="pm-reg-org" type="number" value={regForm.organization_id} onChange={(e) => setRegForm({ ...regForm, organization_id: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="pm-reg-notes">Notes (optional)</Label>
              <Input id="pm-reg-notes" value={regForm.notes} onChange={(e) => setRegForm({ ...regForm, notes: e.target.value })} />
            </div>
            <div className="flex gap-2 md:col-span-3">
              <Button
                disabled={registerPolicy.isPending || regForm.controller_name.trim().length < 2 || !/^https?:\/\//i.test(regForm.policy_url)}
                onClick={() => registerPolicy.mutate({
                  controller_name: regForm.controller_name.trim(),
                  policy_url: regForm.policy_url.trim(),
                  check_interval_hours: regForm.check_interval_hours,
                  ...(regForm.organization_id ? { organization_id: Number(regForm.organization_id) } : {}),
                  ...(regForm.notes.trim() ? { notes: regForm.notes.trim() } : {}),
                })}
              >
                {registerPolicy.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Register
              </Button>
              <Button variant="ghost" onClick={() => setShowRegister(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="policies">
        <TabsList>
          <TabsTrigger value="policies">Tracked policies</TabsTrigger>
          <TabsTrigger value="changes">Detected changes</TabsTrigger>
          <TabsTrigger value="reviews">Review queue</TabsTrigger>
        </TabsList>

        {/* ── Policies ── */}
        <TabsContent value="policies" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Monitored policies</CardTitle>
              <CardDescription>Controller privacy notices under continuous monitoring.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <Label>Status</Label>
                  <Select value={enabledFilter} onValueChange={setEnabledFilter}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="enabled">Enabled</SelectItem>
                      <SelectItem value="disabled">Disabled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="pm-org-filter">Organization ID</Label>
                  <Input id="pm-org-filter" className="w-40" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)} placeholder="any" />
                </div>
              </div>
              {policies.isLoading ? <SkeletonTable rows={5} cols={6} /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Controller</TableHead>
                      <TableHead>Policy URL</TableHead>
                      <TableHead>Organization</TableHead>
                      <TableHead>Enabled</TableHead>
                      <TableHead className="text-right">Interval (h)</TableHead>
                      <TableHead className="text-right">Versions</TableHead>
                      <TableHead className="text-right">Open reviews</TableHead>
                      <TableHead>Next check</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {policyRows.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">
                          {p.controller_name}
                          {(p.consecutive_failures ?? 0) >= 3 && (
                            <Badge variant="outline" className="ml-2 bg-red-500/20 text-red-300 border-red-500/40">failing</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm max-w-[220px] truncate">
                          <a href={p.policy_url} target="_blank" rel="noreferrer" className="underline text-primary">{p.policy_url}</a>
                        </TableCell>
                        <TableCell className="text-sm">{p.organization_name ?? (p.organization_id ? `Org #${p.organization_id}` : "—")}</TableCell>
                        <TableCell>
                          {isAdmin ? (
                            <Button size="sm" variant="outline" disabled={updatePolicy.isPending}
                              onClick={() => updatePolicy.mutate({ id: p.id, enabled: !p.enabled })}>
                              {p.enabled ? "Enabled" : "Disabled"}
                            </Button>
                          ) : (
                            <Badge variant="outline">{p.enabled ? "enabled" : "disabled"}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">{p.check_interval_hours}</TableCell>
                        <TableCell className="text-right font-mono">{p.version_count ?? 0}</TableCell>
                        <TableCell className="text-right font-mono">{p.open_reviews ?? 0}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDate(p.next_check_at)}</TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button size="sm" variant="outline" onClick={() => setDetailId(p.id)}>View</Button>
                          <Button size="sm" variant="outline" onClick={() => setSelectedPolicyId(p.id)}>Changes</Button>
                          {isAdmin && (
                            <>
                              <Button size="sm" variant="outline" disabled={checkNow.isPending || !p.enabled}
                                onClick={() => checkNow.mutate({ id: p.id })}>Check now</Button>
                              <Button size="sm" variant="outline"
                                onClick={() => { setEditPolicy(p); setEditForm({ check_interval_hours: p.check_interval_hours ?? 24, notes: p.notes ?? "" }); }}>
                                Edit
                              </Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {policyRows.length === 0 && (
                      <TableRow><TableCell colSpan={9}>
                        <EmptyState title="No monitored policies" description="Register a controller privacy-notice URL to start monitoring for changes." />
                      </TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Changes ── */}
        <TabsContent value="changes" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><FileDiff className="h-5 w-5" /> Detected changes</CardTitle>
              <CardDescription>Version feed per policy with semantic-diff classification and effective dates.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <Label>Policy</Label>
                  <Select value={selectedPolicyId != null ? String(selectedPolicyId) : ""} onValueChange={(v) => setSelectedPolicyId(Number(v))}>
                    <SelectTrigger className="w-72"><SelectValue placeholder="Select a policy…" /></SelectTrigger>
                    <SelectContent>
                      {policyRows.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.controller_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Classification</Label>
                  <Select value={classFilter} onValueChange={setClassFilter}>
                    <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All classifications</SelectItem>
                      {CLASSIFICATIONS.map((c) => <SelectItem key={c} value={c}>{c.replaceAll("_", " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {selectedPolicyId == null ? (
                <EmptyState icon={ScrollText} title="No policy selected" description="Pick a tracked policy to inspect its version history and detected changes." />
              ) : versions.isLoading ? <SkeletonTable rows={5} cols={6} /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fetched</TableHead>
                      <TableHead className="text-right">HTTP</TableHead>
                      <TableHead>Classification</TableHead>
                      <TableHead>Diff status</TableHead>
                      <TableHead>Summary</TableHead>
                      <TableHead>Classifier</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {versionRows.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell className="text-sm">{fmtDate(v.fetched_at)}</TableCell>
                        <TableCell className="text-right font-mono">{v.http_status ?? "—"}</TableCell>
                        <TableCell><ClassBadge value={v.change_classification} /></TableCell>
                        <TableCell>
                          <Badge variant="outline" className={["UNCONFIGURED", "failed"].includes(String(v.diff_status)) ? "bg-orange-500/20 text-orange-300 border-orange-500/40" : ""}>
                            {String(v.diff_status ?? "—")}
                          </Badge>
                          {(v.retry_count ?? 0) > 0 && <span className="text-xs text-muted-foreground ml-1">×{v.retry_count}</span>}
                        </TableCell>
                        <TableCell className="text-sm max-w-[320px] truncate">{v.diff_summary ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{v.classifier ?? "—"}</TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button size="sm" variant="outline" onClick={() => setDiffVersionId(v.id)}>View diff</Button>
                          {isAdmin && v.diff_status !== "completed" && (
                            <Button size="sm" variant="outline" disabled={requeueDiff.isPending}
                              onClick={() => requeueDiff.mutate({ version_id: v.id })}>Requeue</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {versionRows.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No versions recorded for this policy yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Semantic-diff retry queue</CardTitle>
              <CardDescription>
                Versions whose semantic diff is UNCONFIGURED / failed / pending — visible so nothing is silently dropped while the LLM worker is down.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {diffQueue.isLoading ? <SkeletonTable rows={3} cols={6} /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Policy</TableHead>
                      <TableHead>Fetched</TableHead>
                      <TableHead>Diff status</TableHead>
                      <TableHead className="text-right">Retries</TableHead>
                      <TableHead>Next retry</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queueRows.map((q) => (
                      <TableRow key={q.id}>
                        <TableCell className="text-sm font-medium">{q.controller_name ?? `Policy #${q.policy_id}`}</TableCell>
                        <TableCell className="text-sm">{fmtDate(q.fetched_at)}</TableCell>
                        <TableCell><Badge variant="outline" className="bg-orange-500/20 text-orange-300 border-orange-500/40">{String(q.diff_status)}</Badge></TableCell>
                        <TableCell className="text-right font-mono">{q.retry_count ?? 0}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDate(q.next_retry_at)}</TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button size="sm" variant="outline" onClick={() => setDiffVersionId(q.id)}>View</Button>
                          {isAdmin && (
                            <Button size="sm" variant="outline" disabled={requeueDiff.isPending}
                              onClick={() => requeueDiff.mutate({ version_id: q.id })}>Requeue</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {queueRows.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Diff queue is empty — all semantic diffs are processed.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Reviews ── */}
        <TabsContent value="reviews" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><BellRing className="h-5 w-5" /> Officer review queue</CardTitle>
              <CardDescription>Review tasks for detected policy changes — assign, decide, escalate or notify the controller.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <Label>Status</Label>
                  <Select value={reviewStatus} onValueChange={setReviewStatus}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {REVIEW_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replaceAll("_", " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Priority</Label>
                  <Select value={reviewPriority} onValueChange={setReviewPriority}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All priorities</SelectItem>
                      {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {reviews.isLoading ? <SkeletonTable rows={5} cols={7} /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">#</TableHead>
                      <TableHead>Controller</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Change</TableHead>
                      <TableHead>Assigned to</TableHead>
                      <TableHead>Notified</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reviewRows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-right font-mono">{r.id}</TableCell>
                        <TableCell className="font-medium">{r.controller_name}</TableCell>
                        <TableCell><Badge variant="outline" className={PRIORITY_COLORS[String(r.priority)] ?? ""}>{r.priority}</Badge></TableCell>
                        <TableCell><Badge variant="outline">{String(r.status).replaceAll("_", " ")}</Badge></TableCell>
                        <TableCell><ClassBadge value={r.change_classification} /></TableCell>
                        <TableCell className="text-sm">{r.assigned_to ?? <span className="text-muted-foreground">unassigned</span>}</TableCell>
                        <TableCell className="text-sm">{r.controller_notified ? `${r.notification_channel ?? "yes"}` : "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDate(r.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => setReviewId(r.id)}>Open</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {reviewRows.length === 0 && (
                      <TableRow><TableCell colSpan={9}>
                        <EmptyState title="No review tasks" description="Review tasks are created automatically when material policy changes are detected." />
                      </TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Policy detail dialog */}
      <Dialog open={detailId != null} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Policy detail</DialogTitle>
            <DialogDescription>Full registry record for this monitored policy.</DialogDescription>
          </DialogHeader>
          {policyDetail.isLoading ? <SkeletonTable rows={4} cols={2} /> : policyDetail.data ? (
            <div className="space-y-2 text-sm max-h-[60vh] overflow-y-auto">
              {Object.entries(policyDetail.data as Record<string, unknown>).map(([k, v]) => (
                <div key={k} className="grid grid-cols-3 gap-2 border-b border-border/50 py-1">
                  <span className="text-muted-foreground">{k.replaceAll("_", " ")}</span>
                  <span className="col-span-2 font-mono text-xs break-all">{v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">Not found.</p>}
        </DialogContent>
      </Dialog>

      {/* Edit policy dialog */}
      <Dialog open={editPolicy != null} onOpenChange={(o) => !o && setEditPolicy(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit policy — {editPolicy?.controller_name}</DialogTitle>
            <DialogDescription>Update check cadence and officer notes.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="pm-edit-interval">Check interval (hours)</Label>
              <Input id="pm-edit-interval" type="number" min={1} max={8760} value={editForm.check_interval_hours}
                onChange={(e) => setEditForm({ ...editForm, check_interval_hours: Number(e.target.value) })} />
            </div>
            <div>
              <Label htmlFor="pm-edit-notes">Notes</Label>
              <Textarea id="pm-edit-notes" value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={3} />
            </div>
            <div className="flex gap-2">
              <Button disabled={updatePolicy.isPending}
                onClick={() => editPolicy && updatePolicy.mutate({
                  id: editPolicy.id,
                  check_interval_hours: editForm.check_interval_hours,
                  ...(editForm.notes.trim() ? { notes: editForm.notes.trim() } : {}),
                })}>
                {updatePolicy.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save
              </Button>
              <Button variant="ghost" onClick={() => setEditPolicy(null)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Version diff dialog */}
      <Dialog open={diffVersionId != null} onOpenChange={(o) => !o && setDiffVersionId(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Version diff</DialogTitle>
            <DialogDescription>
              {diffDetail.data?.version?.controller_name} — {diffDetail.data?.version?.policy_url}
            </DialogDescription>
          </DialogHeader>
          {diffDetail.isLoading ? <SkeletonTable rows={5} cols={2} /> : diffDetail.data ? (
            <div className="space-y-3 max-h-[65vh] overflow-y-auto">
              <div className="flex flex-wrap gap-2 items-center">
                <ClassBadge value={diffDetail.data.version?.change_classification} />
                <Badge variant="outline">{String(diffDetail.data.version?.diff_status ?? "—")}</Badge>
                <span className="text-xs text-muted-foreground">fetched {fmtDate(diffDetail.data.version?.fetched_at)}</span>
                {diffDetail.data.previous && (
                  <span className="text-xs text-muted-foreground">vs previous {fmtDate(diffDetail.data.previous.fetched_at)}</span>
                )}
              </div>
              {diffDetail.data.version?.diff_summary && (
                <div className="border rounded p-3">
                  <p className="text-xs text-muted-foreground mb-1">Diff summary</p>
                  <p className="text-sm whitespace-pre-wrap">{String(diffDetail.data.version.diff_summary)}</p>
                </div>
              )}
              {diffDetail.data.version?.diff_detail != null && (
                <div className="border rounded p-3">
                  <p className="text-xs text-muted-foreground mb-1">Diff detail</p>
                  <pre className="text-xs font-mono whitespace-pre-wrap">{typeof diffDetail.data.version.diff_detail === "string"
                    ? diffDetail.data.version.diff_detail
                    : JSON.stringify(diffDetail.data.version.diff_detail, null, 2)}</pre>
                </div>
              )}
              {diffDetail.data.previous?.content_text && (
                <details className="border rounded p-3">
                  <summary className="text-sm cursor-pointer">Previous version text (excerpt)</summary>
                  <pre className="text-xs font-mono whitespace-pre-wrap mt-2 max-h-64 overflow-y-auto">
                    {String(diffDetail.data.previous.content_text).slice(0, 5000)}
                  </pre>
                </details>
              )}
            </div>
          ) : <p className="text-sm text-muted-foreground">Not found.</p>}
        </DialogContent>
      </Dialog>

      {/* Review detail + workflow dialog */}
      <Dialog open={reviewId != null} onOpenChange={(o) => !o && setReviewId(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Review #{reviewId} — {rd?.controller_name ?? ""}</DialogTitle>
            <DialogDescription>{rd?.policy_url}</DialogDescription>
          </DialogHeader>
          {reviewDetail.isLoading ? <SkeletonTable rows={5} cols={2} /> : rd ? (
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              <div className="flex flex-wrap gap-2 items-center">
                <Badge variant="outline">{String(rd.status).replaceAll("_", " ")}</Badge>
                <Badge variant="outline" className={PRIORITY_COLORS[String(rd.priority)] ?? ""}>{rd.priority}</Badge>
                <ClassBadge value={rd.change_classification} />
                {rd.controller_notified ? (
                  <Badge variant="outline" className="bg-green-500/20 text-green-300 border-green-500/40">
                    controller notified{rd.notification_channel ? ` (${rd.notification_channel})` : ""}
                  </Badge>
                ) : null}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                <div><p className="text-xs text-muted-foreground">Assigned to</p><p>{rd.assigned_to ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Decided by</p><p>{rd.decided_by ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Decision</p><p>{rd.decision ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Created</p><p>{fmtDate(rd.created_at)}</p></div>
                <div><p className="text-xs text-muted-foreground">Escalated</p><p>{rd.escalated_to_investigation ? "yes" : "no"}</p></div>
                <div><p className="text-xs text-muted-foreground">Organization</p><p>{rd.organization_id ? `Org #${rd.organization_id}` : "not linked"}</p></div>
              </div>
              {rd.diff_summary && (
                <div className="border rounded p-3">
                  <p className="text-xs text-muted-foreground mb-1">Diff summary</p>
                  <p className="text-sm whitespace-pre-wrap">{String(rd.diff_summary)}</p>
                </div>
              )}
              {rd.decision_notes && (
                <div className="border rounded p-3">
                  <p className="text-xs text-muted-foreground mb-1">Decision notes</p>
                  <p className="text-sm whitespace-pre-wrap">{String(rd.decision_notes)}</p>
                </div>
              )}
              {rd.escalation_reason && (
                <div className="border rounded p-3">
                  <p className="text-xs text-muted-foreground mb-1">Escalation reason</p>
                  <p className="text-sm whitespace-pre-wrap">{String(rd.escalation_reason)}</p>
                </div>
              )}

              {/* Workflow actions */}
              {["open", "assigned", "in_progress"].includes(String(rd.status)) && (
                <div className="space-y-4 border-t pt-4">
                  {isAdmin && (
                    <div className="border rounded-lg p-3 space-y-2">
                      <p className="text-sm font-medium">Assign</p>
                      <div className="flex flex-wrap gap-2 items-end">
                        <div>
                          <Label htmlFor="pm-assign-to">Assignee</Label>
                          <Input id="pm-assign-to" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} placeholder="officer name" className="w-56" />
                        </div>
                        <div>
                          <Label>Priority (optional)</Label>
                          <Select value={assignPriority || "keep"} onValueChange={(v) => setAssignPriority(v === "keep" ? "" : v)}>
                            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="keep">Keep current</SelectItem>
                              {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button size="sm" disabled={assignReview.isPending || assignTo.trim().length < 2}
                          onClick={() => assignReview.mutate({ id: rd.id, assigned_to: assignTo.trim(), ...(assignPriority ? { priority: assignPriority as (typeof PRIORITIES)[number] } : {}) })}>
                          Assign
                        </Button>
                      </div>
                    </div>
                  )}
                  {isStaff && (
                    <div className="border rounded-lg p-3 space-y-2">
                      <p className="text-sm font-medium">Record decision</p>
                      <div className="flex flex-wrap gap-2 items-end">
                        <div>
                          <Label>Decision</Label>
                          <Select value={decision} onValueChange={(v) => setDecision(v as typeof decision)}>
                            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="upheld">upheld</SelectItem>
                              <SelectItem value="dismissed">dismissed</SelectItem>
                              <SelectItem value="referred">referred</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex-1 min-w-[240px]">
                          <Label htmlFor="pm-decision-notes">Decision notes (min 10 chars)</Label>
                          <Input id="pm-decision-notes" value={decisionNotes} onChange={(e) => setDecisionNotes(e.target.value)} />
                        </div>
                        <Button size="sm" disabled={decideReview.isPending || decisionNotes.trim().length < 10}
                          onClick={() => decideReview.mutate({ id: rd.id, decision, decision_notes: decisionNotes.trim() })}>
                          Decide
                        </Button>
                      </div>
                    </div>
                  )}
                  {isAdmin && (
                    <div className="border rounded-lg p-3 space-y-2">
                      <p className="text-sm font-medium flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> Escalate to investigation</p>
                      <div className="flex flex-wrap gap-2 items-end">
                        <div className="flex-1 min-w-[240px]">
                          <Label htmlFor="pm-escalation">Escalation reason (min 10 chars)</Label>
                          <Input id="pm-escalation" value={escalationReason} onChange={(e) => setEscalationReason(e.target.value)} />
                        </div>
                        <Button size="sm" variant="destructive" disabled={escalateReview.isPending || escalationReason.trim().length < 10}
                          onClick={() => escalateReview.mutate({ id: rd.id, escalation_reason: escalationReason.trim() })}>
                          Escalate
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {isAdmin && ["decided", "escalated"].includes(String(rd.status)) && (
                <div className="border rounded-lg p-3 space-y-2">
                  <p className="text-sm font-medium">Close review</p>
                  <div className="flex flex-wrap gap-2 items-end">
                    <div className="flex-1 min-w-[240px]">
                      <Label htmlFor="pm-close-notes">Closing notes (optional)</Label>
                      <Input id="pm-close-notes" value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} />
                    </div>
                    <Button size="sm" variant="outline" disabled={closeReview.isPending}
                      onClick={() => closeReview.mutate({ id: rd.id, ...(closeNotes.trim() ? { notes: closeNotes.trim() } : {}) })}>
                      Close
                    </Button>
                  </div>
                </div>
              )}

              {isAdmin && !rd.controller_notified && (
                <div className="border rounded-lg p-3 space-y-2">
                  <p className="text-sm font-medium">Notify controller</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                    <div>
                      <Label>Channel</Label>
                      <Select value={notifyChannel} onValueChange={(v) => setNotifyChannel(v as typeof notifyChannel)}>
                        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="in_app">in_app</SelectItem>
                          <SelectItem value="email">email</SelectItem>
                          <SelectItem value="letter">letter</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {notifyChannel !== "in_app" && (
                      <div className="md:col-span-2">
                        <Label htmlFor="pm-notify-ref">External reference (dispatch proof)</Label>
                        <Input id="pm-notify-ref" value={notifyRef} onChange={(e) => setNotifyRef(e.target.value)} placeholder="e.g. dispatch tracking no." />
                      </div>
                    )}
                    <div className="md:col-span-3">
                      <Label htmlFor="pm-notify-msg">Message (min 20 chars)</Label>
                      <Textarea id="pm-notify-msg" rows={3} value={notifyMessage} onChange={(e) => setNotifyMessage(e.target.value)} />
                    </div>
                  </div>
                  <Button size="sm" disabled={notifyController.isPending || notifyMessage.trim().length < 20 || (notifyChannel !== "in_app" && !notifyRef.trim())}
                    onClick={() => notifyController.mutate({
                      review_id: rd.id,
                      channel: notifyChannel,
                      message: notifyMessage.trim(),
                      ...(notifyChannel !== "in_app" ? { external_reference: notifyRef.trim() } : {}),
                    })}>
                    {notifyController.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Send notification
                  </Button>
                </div>
              )}
            </div>
          ) : <p className="text-sm text-muted-foreground">Review not found.</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
