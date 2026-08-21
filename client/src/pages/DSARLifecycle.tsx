import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, AlertTriangle, CheckCircle2, Clock, Zap } from "lucide-react";


function DaysRemaining({ days }: { days: number }) {
  if (days < 0) return <Badge variant="destructive">Overdue by {Math.abs(Math.round(days))}d</Badge>;
  if (days <= 3) return <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20">{Math.round(days)}d left</Badge>;
  if (days <= 7) return <Badge className="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/20">{Math.round(days)}d left</Badge>;
  return <Badge variant="outline">{Math.round(days)}d left</Badge>;
}

export default function DSARLifecycle() {
  
  const { data: alerts, refetch: refetchAlerts } = trpc.dsarLifecycle.getDeadlineAlerts.useQuery();
  const { data: stats } = trpc.dsarLifecycle.getStats.useQuery();

  const autoEscalate = trpc.dsarLifecycle.autoEscalate.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.escalated} DSAR(s) escalated`);
      refetchAlerts();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="h-6 w-6 text-blue-600" />
              DSAR Lifecycle Management
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Data Subject Access Request deadline tracking — NDPA 2023 Section 35 (30-day limit)
            </p>
          </div>
          <Button
            onClick={() => autoEscalate.mutate()}
            disabled={autoEscalate.isPending}
            variant="destructive"
            className="gap-2"
          >
            <Zap className="h-4 w-4" />
            Auto-Escalate Overdue
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          {[
            { label: "Total DSARs", value: stats?.total_dsar ?? 0, icon: FileText, color: "text-blue-600" },
            { label: "Pending", value: stats?.pending ?? 0, icon: Clock, color: "text-yellow-600" },
            { label: "Completed", value: stats?.completed ?? 0, icon: CheckCircle2, color: "text-green-600" },
            { label: "Escalated", value: stats?.escalated ?? 0, icon: AlertTriangle, color: "text-orange-600" },
            { label: "Overdue", value: stats?.overdue ?? 0, icon: AlertTriangle, color: "text-red-600" },
            { label: "Avg Resolution", value: stats?.avg_resolution_days ? `${Number(stats.avg_resolution_days).toFixed(1)}d` : "N/A", icon: Clock, color: "text-purple-600" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <s.icon className={`h-4 w-4 ${s.color}`} />
                  <span className="text-xs text-muted-foreground">{s.label}</span>
                </div>
                <div className={`text-2xl font-bold mt-1 ${s.color}`}>{String(s.value)}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Deadline Alerts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              DSARs Approaching or Past Deadline
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!alerts || alerts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-green-500 opacity-50" />
                <p>No DSARs approaching their deadline. All requests are on track.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 font-medium">ID</th>
                      <th className="text-left py-2 pr-4 font-medium">Organisation</th>
                      <th className="text-left py-2 pr-4 font-medium">Type</th>
                      <th className="text-left py-2 pr-4 font-medium">Status</th>
                      <th className="text-left py-2 pr-4 font-medium">Submitted</th>
                      <th className="text-left py-2 pr-4 font-medium">Deadline</th>
                      <th className="text-right py-2 font-medium">Time Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((a: any) => (
                      <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2 pr-4 font-mono text-xs">#{a.id}</td>
                        <td className="py-2 pr-4">{a.org_name ?? "—"}</td>
                        <td className="py-2 pr-4 capitalize">{a.request_type}</td>
                        <td className="py-2 pr-4">
                          <Badge variant="outline" className="capitalize">{a.status}</Badge>
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {new Date(a.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {new Date(a.deadline).toLocaleDateString()}
                        </td>
                        <td className="py-2 text-right">
                          <DaysRemaining days={Number(a.days_remaining)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* NDPA Compliance Note */}
        <Card className="border-blue-500/20 bg-blue-50/50">
          <CardContent className="pt-4">
            <div className="flex gap-3">
              <FileText className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold text-blue-800">NDPA 2023 — Section 35: Data Subject Rights</p>
                <p className="text-blue-700 mt-1">
                  Data controllers must respond to Data Subject Access Requests within <strong>30 days</strong> of receipt.
                  Failure to respond may result in enforcement action under Section 48 and financial penalties up to ₦2,000,000
                  or 2% of annual gross revenue, whichever is higher.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
