import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const STATUS_COLORS: Record<string, string> = {
  running: "bg-green-500/15 text-green-600 dark:text-green-400",
  stopped: "bg-red-500/15 text-red-600 dark:text-red-400",
  starting: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
  healthy: "bg-green-500/15 text-green-600 dark:text-green-400",
  degraded: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  down: "bg-red-500/15 text-red-600 dark:text-red-400",
};

function StatusDot({ status }: { status: string }) {
  const color = status === "running" || status === "healthy" ? "bg-green-500" :
    status === "starting" || status === "degraded" ? "bg-yellow-500" : "bg-red-500";
  return <span className={`inline-block w-2 h-2 rounded-full ${color} mr-2`} />;
}

export default function SystemHealthDashboard() {
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const workers = trpc.workers.status.useQuery(undefined, { refetchInterval: 15000 });
  const health = trpc.workers.status.useQuery(undefined, { refetchInterval: 15000 });

  useEffect(() => {
    const interval = setInterval(() => setLastRefresh(new Date()), 15000);
    return () => clearInterval(interval);
  }, []);

  const workerList: any[] = workers.data ?? [];
  const runningCount = workerList.filter(w => w.status === "running").length;
  const stoppedCount = workerList.filter(w => w.status === "stopped" || w.status === "error").length;
  const healthData: any = health.data ?? {};

  // Group workers by category
  const workerGroups: Record<string, any[]> = {};
  for (const w of workerList) {
    const cat = w.category ?? "General";
    if (!workerGroups[cat]) workerGroups[cat] = [];
    workerGroups[cat].push(w);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">System Health Dashboard</h1>
          <p className="text-muted-foreground mt-1">Live status of all platform services and workers</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Last refresh: {lastRefresh.toLocaleTimeString()}</span>
          <Button variant="outline" size="sm" onClick={() => { workers.refetch(); health.refetch(); setLastRefresh(new Date()); }}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Core Services */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <StatusDot status={healthData.database ?? "healthy"} />
            <span className="font-semibold">Database</span>
            <div className="mt-1">
              <Badge className={STATUS_COLORS[healthData.database ?? "healthy"]}>{healthData.database ?? "healthy"}</Badge>
            </div>
            {healthData.dbLatencyMs && <p className="text-xs text-muted-foreground mt-1">{healthData.dbLatencyMs}ms latency</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <StatusDot status={healthData.redis ?? "healthy"} />
            <span className="font-semibold">Redis / Cache</span>
            <div className="mt-1">
              <Badge className={STATUS_COLORS[healthData.redis ?? "healthy"]}>{healthData.redis ?? "healthy"}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <StatusDot status={healthData.kafka ?? "healthy"} />
            <span className="font-semibold">Kafka / Events</span>
            <div className="mt-1">
              <Badge className={STATUS_COLORS[healthData.kafka ?? "healthy"]}>{healthData.kafka ?? "healthy"}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <StatusDot status="healthy" />
            <span className="font-semibold">API Server</span>
            <div className="mt-1">
              <Badge className={STATUS_COLORS["healthy"]}>healthy</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Uptime: {healthData.uptimeSeconds ? Math.floor(healthData.uptimeSeconds / 3600) + "h" : "—"}</p>
          </CardContent>
        </Card>
      </div>

      {/* Worker Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-600">{runningCount}</div>
            <div className="text-sm text-muted-foreground">Workers Running</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-red-600">{stoppedCount}</div>
            <div className="text-sm text-muted-foreground">Workers Stopped/Error</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{workerList.length}</div>
            <div className="text-sm text-muted-foreground">Total Workers</div>
          </CardContent>
        </Card>
      </div>

      {/* Worker health bar */}
      {workerList.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Worker Health</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={workerList.length > 0 ? (runningCount / workerList.length) * 100 : 0} className="h-3" />
            <p className="text-xs text-muted-foreground mt-1">{runningCount}/{workerList.length} workers healthy</p>
          </CardContent>
        </Card>
      )}

      {/* Workers by Category */}
      {workers.isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading worker status...</div>
      ) : (
        Object.entries(workerGroups).map(([category, categoryWorkers]) => (
          <Card key={category}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{category}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {categoryWorkers.map((w: any) => (
                  <div key={w.id} className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusDot status={w.status ?? "stopped"} />
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{w.name}</p>
                        {w.port && <p className="text-xs text-muted-foreground">Port {w.port}</p>}
                      </div>
                    </div>
                    <Badge className={STATUS_COLORS[w.status ?? "stopped"] ?? "bg-muted text-foreground"}>
                      {w.status ?? "stopped"}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))
      )}

      {/* System Metrics */}
      {healthData.memoryUsageMb && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">System Metrics</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Memory Usage</p>
              <p className="text-lg font-semibold">{healthData.memoryUsageMb} MB</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">CPU Load</p>
              <p className="text-lg font-semibold">{healthData.cpuLoad ?? "—"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Active Connections</p>
              <p className="text-lg font-semibold">{healthData.activeConnections ?? "—"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Queue Depth</p>
              <p className="text-lg font-semibold">{healthData.queueDepth ?? "—"}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
