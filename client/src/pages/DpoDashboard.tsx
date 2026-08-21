import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { ShieldCheck, AlertTriangle, FileText, Users, RefreshCw, Clock, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";

export default function DpoDashboard() {
  const [tab, setTab] = useState<"overview" | "dsar" | "ropa" | "notices" | "decisions">("overview");
  const utils = trpc.useUtils();
  const requestReviewMutation = trpc.automatedDecisions.requestReview.useMutation({
    onSuccess: () => { toast.success("Human review requested"); utils.automatedDecisions.list.invalidate().catch(() => {}); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const dsarQuery = trpc.dsar.listWithDeadlines.useQuery({ overdue: true, limit: 20 });
  const ropaQuery = trpc.ropa.list.useQuery({ limit: 10 });
  const noticesQuery = trpc.privacyNotices.list.useQuery({ limit: 10 });
  const decisionsQuery = trpc.automatedDecisions.list.useQuery({ limit: 10 });

  const overdueDsars = (dsarQuery.data as any)?.requests ?? dsarQuery.data ?? [];
  const ropaRecords = (ropaQuery.data as any)?.records ?? ropaQuery.data ?? [];
  const notices = (noticesQuery.data as any)?.notices ?? noticesQuery.data ?? [];
  const decisions = (decisionsQuery.data as any)?.decisions ?? decisionsQuery.data ?? [];

  const expiringNotices = (Array.isArray(notices) ? notices : []).filter((n: any) => {
    if (!n.expiresAt && !n.expires_at) return false;
    const exp = new Date(n.expiresAt ?? n.expires_at);
    const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return exp <= in30;
  });

  const pendingDecisions = (Array.isArray(decisions) ? decisions : []).filter((d: any) => d.status === "pending" || d.reviewStatus === "pending");

  const refetchAll = () => {
    dsarQuery.refetch();
    ropaQuery.refetch();
    noticesQuery.refetch();
    decisionsQuery.refetch();
  };

  const stats = [
    { label: "Overdue DSARs", value: overdueDsars.length, icon: AlertTriangle, color: "text-red-400", href: "/dsar-tracker" },
    { label: "ROPA Records", value: Array.isArray(ropaRecords) ? ropaRecords.length : 0, icon: FileText, color: "text-blue-400", href: "/ropa" },
    { label: "Expiring Notices (30d)", value: expiringNotices.length, icon: Clock, color: "text-amber-400", href: "/privacy-notices" },
    { label: "Pending AI Reviews", value: pendingDecisions.length, icon: ShieldCheck, color: "text-purple-400", href: "/automated-decisions" },
  ];

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShieldCheck className="h-7 w-7 text-primary" />
              DPO Workbench
            </h1>
            <p className="text-muted-foreground mt-1">
              Data Protection Officer dashboard — DSAR deadlines, ROPA, privacy notices, and automated decision reviews
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refetchAll}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <Link key={s.label} href={s.href}>
                <Card className="cursor-pointer hover:bg-muted/30 transition-colors border-border">
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-3">
                      <Icon className={`h-6 w-6 ${s.color}`} />
                      <div>
                        <div className="text-2xl font-bold">{s.value}</div>
                        <div className="text-xs text-muted-foreground">{s.label}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>

        {/* Tab Nav */}
        <div className="flex gap-1 border-b">
          {(["overview", "dsar", "ropa", "notices", "decisions"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
                tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "dsar" ? "DSAR Deadlines" : t === "ropa" ? "ROPA" : t === "notices" ? "Privacy Notices" : t === "decisions" ? "AI Decisions" : "Overview"}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Overdue DSARs */}
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-400" /> Overdue DSARs
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dsarQuery.isLoading ? (
                  <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                ) : overdueDsars.length === 0 ? (
                  <div className="flex items-center gap-2 py-4 text-emerald-400 text-sm">
                    <CheckCircle className="h-4 w-4" /> No overdue DSARs
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(Array.isArray(overdueDsars) ? overdueDsars : []).slice(0, 5).map((r: any) => (
                      <div key={r.id} className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                        <div>
                          <div className="text-sm font-medium">{r.referenceNumber ?? r.reference_number}</div>
                          <div className="text-xs text-muted-foreground">{r.requestType ?? r.request_type} · {r.citizenName ?? r.citizen_name}</div>
                        </div>
                        <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">Overdue</Badge>
                      </div>
                    ))}
                    {overdueDsars.length > 5 && (
                      <Link href="/dsar-tracker">
                        <Button variant="ghost" size="sm" className="w-full text-xs mt-1">View all {overdueDsars.length} →</Button>
                      </Link>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Expiring Privacy Notices */}
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-400" /> Expiring Privacy Notices (30d)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {noticesQuery.isLoading ? (
                  <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                ) : expiringNotices.length === 0 ? (
                  <div className="flex items-center gap-2 py-4 text-emerald-400 text-sm">
                    <CheckCircle className="h-4 w-4" /> No notices expiring soon
                  </div>
                ) : (
                  <div className="space-y-2">
                    {expiringNotices.slice(0, 5).map((n: any) => (
                      <div key={n.id} className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                        <div>
                          <div className="text-sm font-medium">{n.title}</div>
                          <div className="text-xs text-muted-foreground">Expires {new Date(n.expiresAt ?? n.expires_at).toLocaleDateString()}</div>
                        </div>
                        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">Expiring</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Pending AI Decision Reviews */}
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-purple-400" /> Pending AI Decision Reviews
                </CardTitle>
              </CardHeader>
              <CardContent>
                {decisionsQuery.isLoading ? (
                  <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                ) : pendingDecisions.length === 0 ? (
                  <div className="flex items-center gap-2 py-4 text-emerald-400 text-sm">
                    <CheckCircle className="h-4 w-4" /> No pending reviews
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pendingDecisions.slice(0, 5).map((d: any) => (
                      <div key={d.id} className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                        <div>
                          <div className="text-sm font-medium">{d.title ?? d.decisionType ?? d.decision_type}</div>
                          <div className="text-xs text-muted-foreground">{d.description?.slice(0, 60) ?? "—"}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">Pending</Badge>
                          <Button size="sm" variant="outline" className="text-xs h-6 px-2" disabled={requestReviewMutation.isPending} onClick={() => requestReviewMutation.mutate({ id: d.id })}>Request Review</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ROPA Summary */}
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4 text-blue-400" /> Recent ROPA Entries
                </CardTitle>
              </CardHeader>
              <CardContent>
                {ropaQuery.isLoading ? (
                  <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                ) : (Array.isArray(ropaRecords) ? ropaRecords : []).length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground text-sm">No ROPA records yet.</div>
                ) : (
                  <div className="space-y-2">
                    {(Array.isArray(ropaRecords) ? ropaRecords : []).slice(0, 5).map((r: any) => (
                      <div key={r.id} className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                        <div>
                          <div className="text-sm font-medium">{r.processingActivity ?? r.processing_activity ?? r.title}</div>
                          <div className="text-xs text-muted-foreground">{r.legalBasis ?? r.legal_basis ?? "—"}</div>
                        </div>
                        <Badge variant="outline" className="text-xs">{r.status ?? "active"}</Badge>
                      </div>
                    ))}
                    <Link href="/ropa">
                      <Button variant="ghost" size="sm" className="w-full text-xs mt-1">View all ROPA records →</Button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {tab === "dsar" && (
          <Card className="border-border">
            <CardHeader>
              <CardTitle>DSAR Deadline Tracker</CardTitle>
            </CardHeader>
            <CardContent>
              {dsarQuery.isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : overdueDsars.length === 0 ? (
                <div className="text-center py-8 text-emerald-400">No overdue DSARs — all requests are within deadline.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="pb-2 pr-4">Reference</th>
                        <th className="pb-2 pr-4">Type</th>
                        <th className="pb-2 pr-4">Citizen</th>
                        <th className="pb-2 pr-4">Deadline</th>
                        <th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Array.isArray(overdueDsars) ? overdueDsars : []).map((r: any) => (
                        <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-2 pr-4 font-mono text-xs">{r.referenceNumber ?? r.reference_number}</td>
                          <td className="py-2 pr-4 text-xs capitalize">{(r.requestType ?? r.request_type ?? "").replace(/_/g, " ")}</td>
                          <td className="py-2 pr-4">{r.citizenName ?? r.citizen_name}</td>
                          <td className="py-2 pr-4 text-xs text-red-400">
                            {r.responseDeadline ?? r.response_deadline ? new Date(r.responseDeadline ?? r.response_deadline).toLocaleDateString() : "—"}
                          </td>
                          <td className="py-2">
                            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">{r.status ?? "overdue"}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {tab === "ropa" && (
          <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Record of Processing Activities</CardTitle>
              <Link href="/ropa">
                <Button size="sm" variant="outline">Open Full ROPA Register →</Button>
              </Link>
            </CardHeader>
            <CardContent>
              {ropaQuery.isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : (Array.isArray(ropaRecords) ? ropaRecords : []).length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No ROPA records. Add them via the ROPA Register.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="pb-2 pr-4">Activity</th>
                        <th className="pb-2 pr-4">Legal Basis</th>
                        <th className="pb-2 pr-4">Data Categories</th>
                        <th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Array.isArray(ropaRecords) ? ropaRecords : []).map((r: any) => (
                        <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-2 pr-4 font-medium">{r.processingActivity ?? r.processing_activity ?? r.title}</td>
                          <td className="py-2 pr-4 text-xs">{r.legalBasis ?? r.legal_basis ?? "—"}</td>
                          <td className="py-2 pr-4 text-xs">{r.dataCategories ?? r.data_categories ?? "—"}</td>
                          <td className="py-2">
                            <Badge variant="outline" className="text-xs">{r.status ?? "active"}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {tab === "notices" && (
          <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Privacy Notices</CardTitle>
              <Link href="/privacy-notices">
                <Button size="sm" variant="outline">Manage Notices →</Button>
              </Link>
            </CardHeader>
            <CardContent>
              {noticesQuery.isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : (Array.isArray(notices) ? notices : []).length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No privacy notices yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="pb-2 pr-4">Title</th>
                        <th className="pb-2 pr-4">Version</th>
                        <th className="pb-2 pr-4">Expires</th>
                        <th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Array.isArray(notices) ? notices : []).map((n: any) => {
                        const exp = n.expiresAt ?? n.expires_at;
                        const isExpiring = exp && new Date(exp) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                        return (
                          <tr key={n.id} className="border-b border-border/50 hover:bg-muted/30">
                            <td className="py-2 pr-4 font-medium">{n.title}</td>
                            <td className="py-2 pr-4 text-xs font-mono">{n.version ?? "—"}</td>
                            <td className={`py-2 pr-4 text-xs ${isExpiring ? "text-amber-400" : "text-muted-foreground"}`}>
                              {exp ? new Date(exp).toLocaleDateString() : "—"}
                            </td>
                            <td className="py-2">
                              {isExpiring
                                ? <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">Expiring</Badge>
                                : <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">Active</Badge>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {tab === "decisions" && (
          <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Automated Decision Reviews</CardTitle>
              <Link href="/automated-decisions">
                <Button size="sm" variant="outline">Manage Decisions →</Button>
              </Link>
            </CardHeader>
            <CardContent>
              {decisionsQuery.isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : (Array.isArray(decisions) ? decisions : []).length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No automated decisions recorded.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="pb-2 pr-4">Decision</th>
                        <th className="pb-2 pr-4">Type</th>
                        <th className="pb-2 pr-4">Date</th>
                        <th className="pb-2">Review Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Array.isArray(decisions) ? decisions : []).map((d: any) => (
                        <tr key={d.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-2 pr-4 font-medium">{d.title ?? d.decisionType ?? d.decision_type}</td>
                          <td className="py-2 pr-4 text-xs capitalize">{(d.decisionType ?? d.decision_type ?? "—").replace(/_/g, " ")}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">
                            {d.createdAt ?? d.created_at ? new Date(d.createdAt ?? d.created_at).toLocaleDateString() : "—"}
                          </td>
                          <td className="py-2">
                            {(d.status === "pending" || d.reviewStatus === "pending")
                              ? <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">Pending</Badge>
                              : <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">Reviewed</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
