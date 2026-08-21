import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Activity, AlertTriangle, CheckCircle, Circle, Cpu, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

import { Breadcrumbs } from "@/components/Breadcrumbs";
const LANG_COLORS: Record<string, string> = {
  Go: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  Python: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  Rust: "bg-orange-500/15 text-orange-400 border-orange-500/30",
};

const LAYER_COLORS: Record<string, string> = {
  "L1": "bg-blue-500/10 text-blue-400",
  "L2": "bg-purple-500/10 text-purple-400",
  "L3": "bg-green-500/10 text-green-400",
  "L4": "bg-red-500/10 text-red-400",
  "L5": "bg-orange-500/10 text-orange-400",
  "L6": "bg-pink-500/10 text-pink-400",
  "FIN": "bg-emerald-500/10 text-emerald-400",
  "Streaming": "bg-indigo-500/10 text-indigo-400",
  "SYS": "bg-muted0/10 text-muted-foreground",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "running") return <CheckCircle className="h-4 w-4 text-green-400" />;
  if (status === "offline") return <XCircle className="h-4 w-4 text-red-400" />;
  return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
}

function MetricRow({ label, value }: { label: string; value: string | number | undefined }) {
  if (value === undefined || value === null) return null;
  return (
    <div className="flex justify-between items-center text-xs py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{String(value)}</span>
    </div>
  );
}
function WorkerCard({ worker, onRestart }: { worker: any; onRestart: (id: string) => void }) {
  const metrics = worker.metrics ?? {};
  const isRunning = worker.status === "running";

  const metricEntries = Object.entries(metrics)
    .filter(([k]) => !["/metrics", "status", "version", "uptime_seconds"].includes(k))
    .slice(0, 8);

  return (
    <Card className={`border transition-all ${isRunning ? "border-border" : "border-destructive/30 opacity-70"}`}>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <StatusIcon status={worker.status} />
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold truncate">{worker.name}</CardTitle>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">:{worker.port}</p>
            </div></div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border font-mono ${LANG_COLORS[worker.lang] ?? "bg-muted text-muted-foreground"}`}>
              {worker.lang}
            </span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded font-mono ${LAYER_COLORS[worker.layer] ?? "bg-muted text-muted-foreground"}`}>
              {worker.layer}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
              title="Restart worker"
              onClick={() => onRestart(worker.id)}
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4">
        <div className="flex items-center gap-1.5 mb-3">
          <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
            isRunning
              ? "bg-green-500/10 text-green-400"
              : worker.status === "offline"
              ? "bg-red-500/10 text-red-400"
              : "bg-yellow-500/10 text-yellow-400"
          }`}>
            <Circle className={`h-1.5 w-1.5 fill-current ${isRunning ? "animate-pulse" : ""}`} />
            {worker.status.toUpperCase()}
          </span>
          {metrics.uptime_seconds !== undefined && (
            <span className="text-[10px] text-muted-foreground font-mono">
              up {Math.floor(Number(metrics.uptime_seconds) / 60)}m
            </span>
          )}
        </div>

        {metricEntries.length > 0 ? (
          <div className="space-y-0.5">
            {metricEntries.map(([key, val]) => (
              <MetricRow
                key={key}
                label={key.replace(/_/g, " ")}
                value={typeof val === "number" ? val.toLocaleString() : String(val)}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No metrics available</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function WorkerProcesses() {
  const [refetchKey, setRefetchKey] = useState(0);
  const { data: workers, isLoading, refetch } = trpc.workers.status.useQuery(undefined, {
    refetchInterval: 15000,
    staleTime: 10000,
  });

  const restartMutation = trpc.workers.restart.useMutation({
    onSuccess: (data) => {
      toast.success(`Worker ${data.workerId} restart signal sent`);
      setTimeout(() => refetch(), 3000);
    },
    onError: (err) => {
      toast.error(`Restart failed: ${err.message}`);
    },
  });

  const handleRestart = (workerId: string) => {
    restartMutation.mutate({ workerId });
  };

  const runningCount = workers?.filter((w: any) => w.status === "running").length ?? 0;
  const totalCount = workers?.length ?? 0;
  const goWorkers = workers?.filter((w: any) => w.lang === "Go") ?? [];
  const pythonWorkers = workers?.filter((w: any) => w.lang === "Python") ?? [];
  const rustWorkers = workers?.filter((w: any) => w.lang === "Rust") ?? [];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Worker Processes" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="h-6 w-6 text-primary" />
            Worker Processes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time status of all 10 background microservices across Go, Python, and Rust runtimes.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { refetch(); setRefetchKey(k => k + 1); }}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-green-500/5 border-green-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-green-400" />
              <span className="text-sm font-medium">Running</span>
            </div>
            <p className="text-2xl font-bold mt-1 text-green-400">{runningCount}<span className="text-sm text-muted-foreground font-normal">/{totalCount}</span></p>
          </CardContent>
        </Card>
        <Card className="bg-cyan-500/5 border-cyan-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-cyan-400 font-mono">Go</span>
              <span className="text-sm font-medium">Workers</span>
            </div>
            <p className="text-2xl font-bold mt-1 text-cyan-400">{goWorkers.filter((w: any) => w.status === "running").length}<span className="text-sm text-muted-foreground font-normal">/{goWorkers.length}</span></p>
          </CardContent>
        </Card>
        <Card className="bg-yellow-500/5 border-yellow-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-yellow-400 font-mono">Py</span>
              <span className="text-sm font-medium">Workers</span>
            </div>
            <p className="text-2xl font-bold mt-1 text-yellow-400">{pythonWorkers.filter((w: any) => w.status === "running").length}<span className="text-sm text-muted-foreground font-normal">/{pythonWorkers.length}</span></p>
          </CardContent>
        </Card>
        <Card className="bg-orange-500/5 border-orange-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-orange-400 font-mono">Rs</span>
              <span className="text-sm font-medium">Workers</span>
            </div>
            <p className="text-2xl font-bold mt-1 text-orange-400">{rustWorkers.filter((w: any) => w.status === "running").length}<span className="text-sm text-muted-foreground font-normal">/{rustWorkers.length}</span></p>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="h-4 bg-muted rounded w-3/4" />
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="space-y-2">
                  <div className="h-3 bg-muted rounded w-1/2" />
                  <div className="h-3 bg-muted rounded w-2/3" />
                  <div className="h-3 bg-muted rounded w-1/3" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Go Workers */}
          {goWorkers.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-bold text-cyan-400 font-mono bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">Go</span>
                <span className="text-sm font-medium text-muted-foreground">Runtime — {goWorkers.filter((w: any) => w.status === "running").length}/{goWorkers.length} running</span>
                <Separator className="flex-1" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-4">
                {goWorkers.map((w: any) => <WorkerCard key={w.id} worker={w} onRestart={handleRestart} />)}
              </div>
            </div>
          )}

          {/* Python Workers */}
          {pythonWorkers.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-bold text-yellow-400 font-mono bg-yellow-500/10 px-2 py-0.5 rounded border border-yellow-500/20">Python</span>
                <span className="text-sm font-medium text-muted-foreground">Runtime — {pythonWorkers.filter((w: any) => w.status === "running").length}/{pythonWorkers.length} running</span>
                <Separator className="flex-1" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {pythonWorkers.map((w: any) => <WorkerCard key={w.id} worker={w} onRestart={handleRestart} />)}
              </div>
            </div>
          )}

          {/* Rust Workers */}
          {rustWorkers.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-bold text-orange-400 font-mono bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">Rust</span>
                <span className="text-sm font-medium text-muted-foreground">Runtime — {rustWorkers.filter((w: any) => w.status === "running").length}/{rustWorkers.length} running</span>
                <Separator className="flex-1" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {rustWorkers.map((w: any) => <WorkerCard key={w.id} worker={w} onRestart={handleRestart} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
