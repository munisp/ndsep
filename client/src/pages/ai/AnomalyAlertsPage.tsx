import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Zap, ArrowLeft, AlertTriangle, CheckCircle, Search } from "lucide-react";
import { Link } from "wouter";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { toast } from "sonner";

const SEV_COLORS: Record<string, string> = {
  critical: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20",
  high: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/20",
  medium: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
  low: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20",
};

export default function AnomalyAlertsPage() {
  const { data: health } = trpc.aiAnomalyAlerts.health.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: alerts, refetch } = trpc.aiAnomalyAlerts.getActive.useQuery();
  const scanM = trpc.aiAnomalyAlerts.triggerScan.useMutation({
    onSuccess: () => { toast.success("Anomaly scan triggered"); refetch(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const ackM = trpc.aiAnomalyAlerts.acknowledge.useMutation({
    onSuccess: () => { toast.success("Alert acknowledged"); refetch(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const activeAlerts = alerts?.alerts ?? [];
  const criticalCount = activeAlerts.filter((a: { severity?: string }) => a.severity === "critical").length;
  const highCount = activeAlerts.filter((a: { severity?: string }) => a.severity === "high").length;

  return (
    <div className="p-6 space-y-6">
        <Breadcrumbs items={[{ label: "AI Hub", href: "/ai/hub" }, { label: "Anomaly Alerts" }]} />
      <div className="flex items-center gap-3">
        <Link href="/ai/hub"><Button variant="ghost" size="icon" aria-label="Go back"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <Zap className="h-7 w-7 text-pink-500" />
        <div>
          <h1 className="text-2xl font-bold">Anomaly Alerts</h1>
          <p className="text-muted-foreground text-sm">Real-time compliance score anomaly detection using Isolation Forest</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">Source: {alerts?.source ?? "—"}</Badge>
          <Badge variant={health?.error ? "destructive" : "default"}>
            {health?.error ? "Dispatcher Offline" : "Connected"}
          </Badge>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-500" />Active Alerts</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{activeAlerts.length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Critical</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold text-red-600">{criticalCount}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">High</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold text-orange-600">{highCount}</p></CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <Button onClick={() => scanM.mutate()} disabled={scanM.isPending} className="w-full">
              <Search className={`h-4 w-4 mr-2 ${scanM.isPending ? "animate-spin" : ""}`} />
              {scanM.isPending ? "Scanning..." : "Run Anomaly Scan"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Alert List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open Alerts</CardTitle>
          <CardDescription>{activeAlerts.length} active compliance anomaly alerts</CardDescription>
        </CardHeader>
        <CardContent>
          {activeAlerts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No active anomaly alerts — all clear</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeAlerts.map((alert: { id?: string; title?: string; description?: string; severity?: string; status?: string; created_at?: string; organization_id?: string }) => (
                <div key={alert.id} className="flex items-start gap-3 border rounded-lg p-3 hover:bg-muted/30">
                  <AlertTriangle className={`h-4 w-4 mt-0.5 ${alert.severity === "critical" ? "text-red-500" : alert.severity === "high" ? "text-orange-500" : "text-yellow-500"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{alert.title ?? `Alert ${alert.id}`}</span>
                      <Badge className={`text-xs ${SEV_COLORS[alert.severity ?? "medium"] ?? SEV_COLORS.medium}`}>{alert.severity}</Badge>
                      {alert.organization_id && <span className="text-xs text-muted-foreground">Org #{alert.organization_id}</span>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{alert.description ?? "Compliance score anomaly detected"}</p>
                    <p className="text-xs text-muted-foreground mt-1">{alert.created_at ? new Date(alert.created_at).toLocaleString() : ""}</p>
                  </div>
                  <Button variant="outline" size="sm" className="text-xs shrink-0"
                    disabled={ackM.isPending}
                    onClick={() => alert.id && ackM.mutate({ alertId: alert.id })}>
                    Acknowledge
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
