import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Clock, AlertTriangle, Play, RefreshCw, Calendar } from "lucide-react";

export default function RetentionEnforcement() {
  const [dryRun, setDryRun] = useState(true);

  const { data: schedule = [], refetch: refetchSchedule } = trpc.retentionEnforcement.getSchedule.useQuery();
  const { data: stats } = trpc.retentionEnforcement.getStats.useQuery();
  const runMut = trpc.retentionEnforcement.runEnforcement.useMutation({
    onSuccess: (d) => { toast.success(d.message); refetchSchedule(); },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const statCards = [
    { label: "Total Policies", value: String(stats?.total_policies ?? 0), color: "text-blue-400", icon: Calendar },
    { label: "Active", value: String(stats?.active ?? 0), color: "text-green-400", icon: RefreshCw },
    { label: "Overdue", value: String(stats?.overdue ?? 0), color: "text-red-400", icon: AlertTriangle },
    { label: "Due Soon (7d)", value: String(stats?.due_soon ?? 0), color: "text-yellow-400", icon: Clock },
  ];

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Clock className="w-6 h-6 text-orange-400" /> Data Retention Enforcement</h1>
            <p className="text-muted-foreground text-sm mt-1">NDPA Section 26 — Automated retention policy monitoring and enforcement</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} className="accent-orange-500" />
              Dry Run
            </label>
            <Button className={dryRun ? "bg-muted hover:bg-muted0" : "bg-orange-600 hover:bg-orange-700"} onClick={() => runMut.mutate({ dryRun })} disabled={runMut.isPending}>
              <Play className="w-4 h-4 mr-2" /> {runMut.isPending ? "Running..." : dryRun ? "Preview Enforcement" : "Run Enforcement"}
            </Button>
          </div>
        </div>

        {!dryRun && (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4">
            <p className="text-orange-400 font-medium">⚠ Live Enforcement Mode</p>
            <p className="text-orange-300 text-sm mt-1">This will update the status of all overdue retention policies. Disable Dry Run to proceed.</p>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {statCards.map(s => (
            <Card key={s.label} className="bg-card border-border">
              <CardContent className="p-4 flex items-center gap-3">
                <s.icon className={`w-8 h-8 ${s.color}`} />
                <div><p className={`text-2xl font-bold ${s.color}`}>{s.value}</p><p className="text-xs text-muted-foreground">{s.label}</p></div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="bg-card border-border">
          <CardHeader><CardTitle className="text-foreground">Retention Policy Schedule</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Organization</th><th className="text-left py-2 px-3">Data Category</th>
                  <th className="text-left py-2 px-3">Retention Period</th><th className="text-left py-2 px-3">Next Review</th>
                  <th className="text-left py-2 px-3">Status</th>
                </tr></thead>
                <tbody>
                  {(schedule as any[]).length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No retention policies found</td></tr>
                  ) : (schedule as any[]).map((p: any) => {
                    const isOverdue = p.next_review_date && new Date(String(p.next_review_date)) < new Date();
                    const daysOverdue = isOverdue ? Math.floor((Date.now() - new Date(String(p.next_review_date)).getTime()) / 86400000) : 0;
                    return (
                      <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-2 px-3 text-foreground font-medium">{p.org_name ?? "—"}</td>
                        <td className="py-2 px-3 text-muted-foreground">{p.data_category ?? p.data_type ?? "—"}</td>
                        <td className="py-2 px-3 text-muted-foreground">{p.retention_period_days ?? p.retention_months ?? "—"} {p.retention_period_days ? "days" : "months"}</td>
                        <td className="py-2 px-3 text-muted-foreground">{p.next_review_date ? new Date(String(p.next_review_date)).toLocaleDateString("en-NG") : "—"}</td>
                        <td className="py-2 px-3">
                          {isOverdue ? (
                            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 flex items-center gap-1 w-fit">
                              <AlertTriangle className="w-3 h-3" /> {daysOverdue}d overdue
                            </Badge>
                          ) : (
                            <Badge className="bg-green-500/20 text-green-400 border-green-500/30">{String(p.status ?? "active")}</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
