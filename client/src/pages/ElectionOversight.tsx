import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Vote, ShieldAlert, Flag, ArrowUpRight, Plus } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";

const STATUS_STYLES: Record<string, string> = {
  proclaimed: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  active: "bg-green-500/15 text-green-600 dark:text-green-400",
  concluded: "bg-muted text-muted-foreground",
  archived: "bg-muted text-muted-foreground",
};

function fmt(d?: string | null) {
  return d ? new Date(d).toLocaleDateString("en-NG", { year: "numeric", month: "short", day: "numeric" }) : "—";
}

export default function ElectionOversight() {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<"dashboard" | "periods" | "reports" | "referrals">("dashboard");
  const [showProclaim, setShowProclaim] = useState(false);
  const [proclaimForm, setProclaimForm] = useState({ name: "", description: "", startsAt: "", endsAt: "", heightenedScrutiny: true });
  const [referralForm, setReferralForm] = useState({ reportId: "", subject: "", summary: "" });

  const { data: agg } = trpc.electionOversight.dashboardAggregate.useQuery();
  const { data: periods = [] } = trpc.electionOversight.listPeriods.useQuery();
  const { data: complaints } = trpc.electionOversight.prioritizedComplaints.useQuery({ limit: 50 });
  const { data: reports = [] } = trpc.electionOversight.listMicrotargetingReports.useQuery({});
  const { data: referrals = [] } = trpc.electionOversight.listInecReferrals.useQuery({});

  const proclaimMutation = trpc.electionOversight.proclaimPeriod.useMutation({
    onSuccess: () => { toast.success("Election period proclaimed"); setShowProclaim(false); utils.electionOversight.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const updatePeriodMutation = trpc.electionOversight.updatePeriod.useMutation({
    onSuccess: () => { toast.success("Period updated"); utils.electionOversight.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const reviewReportMutation = trpc.electionOversight.reviewMicrotargetingReport.useMutation({
    onSuccess: () => { toast.success("Report updated"); utils.electionOversight.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const createReferralMutation = trpc.electionOversight.createInecReferral.useMutation({
    onSuccess: (r) => { toast.success(`INEC referral ${r.case_reference} created`); setReferralForm({ reportId: "", subject: "", summary: "" }); utils.electionOversight.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const updateReferralMutation = trpc.electionOversight.updateInecReferral.useMutation({
    onSuccess: () => { toast.success("Referral updated"); utils.electionOversight.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "periods", label: "Election Periods" },
    { id: "reports", label: `Microtargeting Reports (${reports.length})` },
    { id: "referrals", label: `INEC Referrals (${referrals.length})` },
  ] as const;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Compliance", href: "/compliance" }, { label: "Election Oversight" }]} className="mb-4" />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Vote className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Election-Period Oversight</h1>
            <p className="text-muted-foreground text-sm">Heightened scrutiny of political data processing & INEC liaison</p>
          </div>
        </div>
        <Button onClick={() => setShowProclaim(true)}><Plus className="h-4 w-4 mr-1" /> Proclaim election period</Button>
      </div>

      {agg?.heightenedScrutiny && (
        <div className="border border-yellow-500/40 bg-yellow-500/10 rounded-lg p-3 flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 text-yellow-500 shrink-0" />
          <p className="text-sm"><strong>Heightened-scrutiny mode active</strong> — {agg.activePeriod?.name}. Political-data complaints are priority-boosted and the microtargeting intake channel is open.</p>
        </div>
      )}

      <div className="flex gap-2 border-b border-border">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Political complaints by status</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {(agg?.politicalComplaintsByStatus ?? []).map((r: any) => (
                  <div key={r.status} className="flex justify-between text-sm"><span className="capitalize">{String(r.status).replace(/_/g, " ")}</span><span className="font-bold">{r.count}</span></div>
                ))}
                {(agg?.politicalComplaintsByStatus ?? []).length === 0 && <p className="text-sm text-muted-foreground">No political-data complaints recorded.</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Political complaints by region</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {(agg?.politicalComplaintsByRegion ?? []).map((r: any) => (
                  <div key={r.region} className="flex justify-between text-sm"><span>{r.region}</span><span className="font-bold">{r.count}</span></div>
                ))}
                {(agg?.politicalComplaintsByRegion ?? []).length === 0 && <p className="text-sm text-muted-foreground">No regional data.</p>}
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Priority queue — political-data complaints {complaints?.heightenedScrutiny ? "(priority boosted)" : ""}</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-muted-foreground text-left"><th className="pb-2 pr-3">Reference</th><th className="pb-2 pr-3">Org</th><th className="pb-2 pr-3">Region</th><th className="pb-2 pr-3">Status</th><th className="pb-2 pr-3">Submitted</th><th className="pb-2">Priority</th></tr></thead>
                  <tbody>
                    {(complaints?.data ?? []).map((c: any) => (
                      <tr key={c.id} className="border-b hover:bg-muted/30">
                        <td className="py-2 pr-3 font-mono text-xs">{c.reference_number}</td>
                        <td className="py-2 pr-3">{c.org_name ?? "—"}</td>
                        <td className="py-2 pr-3">{c.region ?? "—"}</td>
                        <td className="py-2 pr-3"><Badge variant="outline">{c.status}</Badge></td>
                        <td className="py-2 pr-3 text-xs">{fmt(c.submitted_at)}</td>
                        <td className="py-2">
                          {c.priority_boosted && <Badge className="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 mr-1"><ArrowUpRight className="h-3 w-3 mr-0.5" />boosted</Badge>}
                          {c.overdue && <Badge className="bg-red-500/15 text-red-600 dark:text-red-400">overdue</Badge>}
                        </td>
                      </tr>
                    ))}
                    {(complaints?.data ?? []).length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No political-data complaints.</td></tr>}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "periods" && (
        <div className="space-y-4">
          {showProclaim && (
            <Card>
              <CardHeader><CardTitle className="text-base">Proclaim election period</CardTitle></CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); proclaimMutation.mutate(proclaimForm); }}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div><Label>Name *</Label><Input required value={proclaimForm.name} onChange={(e) => setProclaimForm({ ...proclaimForm, name: e.target.value })} placeholder="2027 General Elections" /></div>
                    <div className="flex items-end gap-2 pb-1">
                      <input type="checkbox" id="hs" checked={proclaimForm.heightenedScrutiny} onChange={(e) => setProclaimForm({ ...proclaimForm, heightenedScrutiny: e.target.checked })} />
                      <Label htmlFor="hs">Enable heightened-scrutiny mode</Label>
                    </div>
                    <div><Label>Starts *</Label><Input required type="datetime-local" value={proclaimForm.startsAt} onChange={(e) => setProclaimForm({ ...proclaimForm, startsAt: e.target.value })} /></div>
                    <div><Label>Ends *</Label><Input required type="datetime-local" value={proclaimForm.endsAt} onChange={(e) => setProclaimForm({ ...proclaimForm, endsAt: e.target.value })} /></div>
                  </div>
                  <div><Label>Description</Label><Textarea rows={2} value={proclaimForm.description} onChange={(e) => setProclaimForm({ ...proclaimForm, description: e.target.value })} /></div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={proclaimMutation.isPending}>Proclaim</Button>
                    <Button type="button" variant="outline" onClick={() => setShowProclaim(false)}>Cancel</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {periods.map((p: any) => (
              <Card key={p.id}>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold">{p.name}</p>
                    <Badge className={STATUS_STYLES[p.status] ?? ""}>{p.status}</Badge>
                    {p.heightened_scrutiny && <Badge className="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400">heightened scrutiny</Badge>}
                    {p.is_current && <Badge className="bg-green-500/15 text-green-600 dark:text-green-400">current</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{fmt(p.starts_at)} → {fmt(p.ends_at)}</p>
                  {p.description && <p className="text-sm">{p.description}</p>}
                  <div className="flex gap-2 flex-wrap pt-1">
                    {p.status === "proclaimed" && <Button size="sm" variant="outline" onClick={() => updatePeriodMutation.mutate({ id: p.id, status: "active" })}>Activate</Button>}
                    {(p.status === "proclaimed" || p.status === "active") && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => updatePeriodMutation.mutate({ id: p.id, heightenedScrutiny: !p.heightened_scrutiny })}>
                          {p.heightened_scrutiny ? "Disable scrutiny" : "Enable scrutiny"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => updatePeriodMutation.mutate({ id: p.id, status: "concluded" })}>Conclude</Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
            {periods.length === 0 && <p className="text-muted-foreground text-sm">No election periods proclaimed yet.</p>}
          </div>
        </div>
      )}

      {tab === "reports" && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Refer a report to INEC</CardTitle></CardHeader>
            <CardContent>
              <form className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end" onSubmit={(e) => {
                e.preventDefault();
                createReferralMutation.mutate({
                  microtargetingReportId: referralForm.reportId ? Number(referralForm.reportId) : undefined,
                  subject: referralForm.subject, summary: referralForm.summary,
                });
              }}>
                <div><Label>Report ID (optional)</Label><Input value={referralForm.reportId} onChange={(e) => setReferralForm({ ...referralForm, reportId: e.target.value })} placeholder="e.g. 12" /></div>
                <div><Label>Subject *</Label><Input required value={referralForm.subject} onChange={(e) => setReferralForm({ ...referralForm, subject: e.target.value })} /></div>
                <div className="md:col-span-1"><Label>Summary *</Label><Input required value={referralForm.summary} onChange={(e) => setReferralForm({ ...referralForm, summary: e.target.value })} /></div>
                <Button type="submit" disabled={createReferralMutation.isPending}>Create referral</Button>
              </form>
            </CardContent>
          </Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-muted-foreground text-left"><th className="pb-2 pr-3">Ref</th><th className="pb-2 pr-3">Party / campaign</th><th className="pb-2 pr-3">Platform</th><th className="pb-2 pr-3">Region</th><th className="pb-2 pr-3">Submitted</th><th className="pb-2 pr-3">Status</th><th className="pb-2">Actions</th></tr></thead>
              <tbody>
                {reports.map((r: any) => (
                  <tr key={r.id} className="border-b hover:bg-muted/30">
                    <td className="py-2 pr-3 font-mono text-xs">{r.reference_number}</td>
                    <td className="py-2 pr-3">{r.party_or_campaign}</td>
                    <td className="py-2 pr-3 capitalize">{r.platform}</td>
                    <td className="py-2 pr-3">{r.region_state ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs">{fmt(r.submitted_at)}</td>
                    <td className="py-2 pr-3"><Badge variant="outline">{String(r.status).replace(/_/g, " ")}</Badge></td>
                    <td className="py-2">
                      {r.status === "received" && <Button size="sm" variant="outline" onClick={() => reviewReportMutation.mutate({ id: r.id, status: "under_review" })}>Review</Button>}
                      {r.status === "under_review" && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => reviewReportMutation.mutate({ id: r.id, status: "escalated" })}>Escalate</Button>
                          <Button size="sm" variant="outline" onClick={() => reviewReportMutation.mutate({ id: r.id, status: "dismissed" })}>Dismiss</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {reports.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No microtargeting reports.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "referrals" && (
        <div className="space-y-3">
          {referrals.map((r: any) => (
            <Card key={r.id}>
              <CardContent className="pt-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Flag className="h-4 w-4 text-primary" />
                  <span className="font-mono text-sm">{r.case_reference}</span>
                  <Badge variant="outline">{String(r.status).replace(/_/g, " ")}</Badge>
                  {r.pmr_reference && <span className="text-xs text-muted-foreground">← {r.pmr_reference}</span>}
                </div>
                <p className="font-medium">{r.subject}</p>
                <p className="text-sm text-muted-foreground">{r.summary}</p>
                {r.joint_action_notes && <p className="text-sm border-l-2 border-primary pl-2">{r.joint_action_notes}</p>}
                <div className="flex gap-2 flex-wrap pt-1">
                  {r.status === "referred" && <Button size="sm" variant="outline" onClick={() => updateReferralMutation.mutate({ id: r.id, status: "acknowledged" })}>Mark acknowledged</Button>}
                  {(r.status === "referred" || r.status === "acknowledged") && <Button size="sm" variant="outline" onClick={() => updateReferralMutation.mutate({ id: r.id, status: "joint_action" })}>Joint action</Button>}
                  {r.status === "joint_action" && <Button size="sm" variant="outline" onClick={() => updateReferralMutation.mutate({ id: r.id, status: "resolved" })}>Resolve</Button>}
                </div>
              </CardContent>
            </Card>
          ))}
          {referrals.length === 0 && <p className="text-muted-foreground text-sm">No INEC referrals yet.</p>}
        </div>
      )}
    </div>
  );
}
