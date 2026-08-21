import React, { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  Activity, Server, Database, Zap, Shield, Globe,
  BarChart3, Cpu, HardDrive, Network
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WorkerStatus {
  name: string;
  port: number;
  language: "Go" | "Rust" | "Python" | "Node";
  category: string;
  status: "healthy" | "degraded" | "down" | "unknown";
  latency?: number;
  lastCheck?: Date;
  description: string;
}

// ─── Worker Definitions ───────────────────────────────────────────────────────

const WORKERS: WorkerStatus[] = [
  // Go workers
  { name: "Dapr Bridge",        port: 8150, language: "Go",     category: "Messaging",  status: "unknown", description: "Dapr pub/sub sidecar bridge" },
  { name: "Fluvio Relay",       port: 8151, language: "Go",     category: "Streaming",  status: "unknown", description: "Fluvio event relay (publish)" },
  { name: "Mojaloop Adapter",   port: 8152, language: "Go",     category: "Payments",   status: "unknown", description: "ISO 20022 payment initiation" },
  { name: "APISIX Manager",     port: 8153, language: "Go",     category: "Gateway",    status: "unknown", description: "Dynamic API route management" },
  // Rust workers
  { name: "TigerBeetle Ledger", port: 8160, language: "Rust",   category: "Finance",    status: "unknown", description: "Double-entry accounting ledger" },
  { name: "OpenSearch Indexer", port: 8161, language: "Rust",   category: "Search",     status: "unknown", description: "Compliance document indexing" },
  { name: "Keycloak Validator", port: 8162, language: "Rust",   category: "Identity",   status: "unknown", description: "JWT token validation" },
  { name: "Lakehouse Ingest",   port: 8163, language: "Rust",   category: "Storage",    status: "unknown", description: "Apache Iceberg data lake ingest" },
  // Python workers
  { name: "Permify RBAC Sync",  port: 8164, language: "Python", category: "Access",     status: "unknown", description: "Fine-grained RBAC sync" },
  { name: "Fluvio Consumer",    port: 8165, language: "Python", category: "Streaming",  status: "unknown", description: "Fluvio event consumer" },
  { name: "OpenSearch Query",   port: 8166, language: "Python", category: "Search",     status: "unknown", description: "Full-text search service" },
  { name: "Dapr State Bridge",  port: 8167, language: "Python", category: "State",      status: "unknown", description: "Distributed state store" },
];

const MIDDLEWARE_SERVICES = [
  { name: "Kafka",        icon: <Zap className="h-4 w-4" />,      port: 9092, description: "Event streaming backbone" },
  { name: "Redis",        icon: <Database className="h-4 w-4" />, port: 6379, description: "Cache + rate limiting" },
  { name: "PostgreSQL",   icon: <Database className="h-4 w-4" />, port: 5432, description: "Temporal + NDSEP state" },
  { name: "OpenSearch",   icon: <BarChart3 className="h-4 w-4" />, port: 9200, description: "Full-text search engine" },
  { name: "Temporal",     icon: <Activity className="h-4 w-4" />, port: 7233, description: "Workflow orchestration" },
  { name: "Keycloak",     icon: <Shield className="h-4 w-4" />,   port: 8080, description: "Identity provider" },
  { name: "Permify",      icon: <Shield className="h-4 w-4" />,   port: 3476, description: "Fine-grained RBAC" },
  { name: "APISIX",       icon: <Globe className="h-4 w-4" />,    port: 9080, description: "API gateway" },
  { name: "TigerBeetle",  icon: <Cpu className="h-4 w-4" />,      port: 3000, description: "Financial ledger" },
  { name: "Fluvio",       icon: <Zap className="h-4 w-4" />,      port: 9003, description: "Real-time streaming" },
  { name: "Dapr",         icon: <Network className="h-4 w-4" />,  port: 3500, description: "Distributed runtime" },
  { name: "MinIO",        icon: <HardDrive className="h-4 w-4" />, port: 9000, description: "Object storage (Iceberg)" },
];

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: WorkerStatus["status"] }) {
  const config = {
    healthy:  { label: "Healthy",  className: "bg-green-500/15 text-green-600 dark:text-green-400",  icon: <CheckCircle2 className="h-3 w-3" /> },
    degraded: { label: "Degraded", className: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400", icon: <AlertTriangle className="h-3 w-3" /> },
    down:     { label: "Down",     className: "bg-red-500/15 text-red-600 dark:text-red-400",      icon: <XCircle className="h-3 w-3" /> },
    unknown:  { label: "Unknown",  className: "bg-muted text-muted-foreground",    icon: <RefreshCw className="h-3 w-3" /> },
  }[status];

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}>
      {config.icon}
      {config.label}
    </span>
  );
}

function LanguageBadge({ language }: { language: WorkerStatus["language"] }) {
  const colors: Record<string, string> = {
    Go:     "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
    Rust:   "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    Python: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    Node:   "bg-green-500/15 text-green-600 dark:text-green-400",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-mono font-medium ${colors[language] ?? "bg-muted text-muted-foreground"}`}>
      {language}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HealthDashboard() {
  const [workers, setWorkers] = useState<WorkerStatus[]>(WORKERS);
  const [checking, setChecking] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const utils = trpc.useUtils();
  const checkHealth = async () => {
    setChecking(true);
    try {
      // Server-side proxy: avoids CORS/localhost issues in production
      const result = await utils.system.workerHealth.fetch(undefined);
      if (result) {
        const updated: WorkerStatus[] = result.map((w: any) => ({
          name: w.name,
          port: w.port,
          language: (w.lang ?? "Go") as "Go" | "Rust" | "Python" | "Node",
          category: WORKERS.find(x => x.port === w.port)?.category ?? "Worker",
          status: w.status as "healthy" | "degraded" | "down" | "unknown",
          latency: w.latency ?? undefined,
          lastCheck: new Date(),
          description: WORKERS.find(x => x.port === w.port)?.description ?? w.name,
        }));
        setWorkers(updated);
        setLastRefresh(new Date());
      }
    } catch (err) {
      console.error("[HealthDashboard] Worker health check failed:", err);
    } finally {
      setChecking(false);
    }
  };

  // Auto-check on mount
  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30_000);
    return () => clearInterval(interval);
  }, []);

  const healthyCnt = workers.filter((w) => w.status === "healthy").length;
  const degradedCnt = workers.filter((w) => w.status === "degraded").length;
  const downCnt = workers.filter((w) => w.status === "down").length;
  const unknownCnt = workers.filter((w) => w.status === "unknown").length;

  const byCategory = workers.reduce<Record<string, WorkerStatus[]>>((acc, w) => {
    if (!acc[w.category]) acc[w.category] = [];
    acc[w.category].push(w);
    return acc;
  }, {});

  return (
    <div className="space-y-6 p-6">
      <Breadcrumbs items={[{ label: "Sectors", href: "/compliance" }, { label: "Healthcare Dashboard" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">System Health Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Real-time status of all NDSEP middleware workers and services
            {lastRefresh && (
              <span className="ml-2 text-xs">
                · Last checked: {lastRefresh.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={checkHealth}
          disabled={checking}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Checking…" : "Refresh"}
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <div>
                <div className="text-2xl font-bold text-green-600">{healthyCnt}</div>
                <div className="text-xs text-muted-foreground">Healthy</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              <div>
                <div className="text-2xl font-bold text-yellow-600">{degradedCnt}</div>
                <div className="text-xs text-muted-foreground">Degraded</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-500" />
              <div>
                <div className="text-2xl font-bold text-red-600">{downCnt}</div>
                <div className="text-xs text-muted-foreground">Down</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold">{workers.length}</div>
                <div className="text-xs text-muted-foreground">Total Workers</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Workers by category */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Middleware Workers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Object.entries(byCategory).map(([category, categoryWorkers]) => (
              <div key={category}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {category}
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {categoryWorkers.map((worker) => (
                    <div
                      key={worker.port}
                      className="flex items-center justify-between rounded-md border border-border p-3"
                    >
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium">
                            {worker.name}
                            <LanguageBadge language={worker.language} />
                          </div>
                          <div className="text-xs text-muted-foreground">
                            :{worker.port} · {worker.description}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {worker.latency !== undefined && (
                          <span className="text-xs text-muted-foreground">
                            {worker.latency}ms
                          </span>
                        )}
                        <StatusBadge status={worker.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Middleware services */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Infrastructure Services</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {MIDDLEWARE_SERVICES.map((svc) => (
              <div
                key={svc.name}
                className="flex items-center gap-2 rounded-md border border-border p-3"
              >
                <span className="text-muted-foreground">{svc.icon}</span>
                <div>
                  <div className="text-sm font-medium">{svc.name}</div>
                  <div className="text-xs text-muted-foreground">:{svc.port}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Infrastructure services are managed via Docker Compose.
            Run <code className="rounded bg-muted px-1">docker compose -f docker-compose.middleware.yml up -d</code> to start.
          </p>
        </CardContent>
      </Card>

      {/* Worker language breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Worker Language Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {(["Go", "Rust", "Python"] as const).map((lang) => {
              const count = workers.filter((w) => w.language === lang).length;
              return (
                <div key={lang} className="flex items-center gap-2">
                  <LanguageBadge language={lang} />
                  <span className="text-sm font-medium">{count} workers</span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 text-xs text-muted-foreground">
            Workers communicate via HTTP REST APIs on dedicated ports (8150–8167).
            Each worker exposes a <code className="rounded bg-muted px-1">/health</code> endpoint
            and <code className="rounded bg-muted px-1">/metrics</code> for Prometheus scraping.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
