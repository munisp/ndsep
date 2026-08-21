import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Layers, CheckCircle, XCircle, AlertTriangle, RefreshCw, Activity, Zap, Database, Shield, GitBranch, BarChart3, Cpu, Mail, Eye, Users, ShieldCheck, ShieldOff, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { toast } from "sonner";

const SERVICE_META: Record<string, { label: string; port: number; lang: string }> = {
  apiGateway:     { label: "API Gateway",      port: 8130, lang: "Go"     },
  iamService:     { label: "IAM / Keycloak",   port: 8150, lang: "Go"     },
  eventBus:       { label: "Event Bus",        port: 8160, lang: "Go"     },
  workflowEngine: { label: "Workflow Engine",  port: 8170, lang: "Go"     },
  mlPipeline:     { label: "ML Pipeline",      port: 8200, lang: "Python" },
  lakehouse:      { label: "Lakehouse",        port: 8210, lang: "Python" },
  daprBindings:   { label: "Dapr Bindings",    port: 8220, lang: "Python" },
  tigerBeetle:    { label: "TigerBeetle",      port: 8240, lang: "Go"     },
};
const MIDDLEWARE_META: Record<string, { label: string; port: number; lang: string; proto: string }> = {
  kafka:           { label: "Kafka",              port: 8082, lang: "Go",     proto: "Confluent REST Proxy v3"  },
  daprSidecar:     { label: "Dapr Sidecar",       port: 3500, lang: "Go",     proto: "Dapr HTTP API v1.0"       },
  fluvio:          { label: "Fluvio",             port: 9003, lang: "Rust",   proto: "Fluvio HTTP Producer"     },
  temporal:        { label: "Temporal",           port: 8233, lang: "Go",     proto: "Temporal Go SDK"          },
  keycloak:        { label: "Keycloak",           port: 8080, lang: "Go",     proto: "gocloak v13 REST"         },
  permify:         { label: "Permify",            port: 3476, lang: "Go",     proto: "Permify REST API"         },
  redis:           { label: "Redis",              port: 6379, lang: "Node",   proto: "ioredis v5"               },
  apisix:          { label: "APISIX",             port: 9180, lang: "Go",     proto: "APISIX Admin API v3"      },
  tigerBeetleHttp: { label: "TigerBeetle HTTP",   port: 3001, lang: "Rust",   proto: "TigerBeetle HTTP Proxy"   },
  icebergCatalog:  { label: "Iceberg Catalog",    port: 8181, lang: "Python", proto: "Iceberg REST Catalog v1"  },
};

const JOURNEYS = [
  { id: "J01", name: "Organisation Registration",       services: ["apiGateway","iamService","eventBus","lakehouse"] },
  { id: "J02", name: "Compliance Assessment",           services: ["mlPipeline","eventBus","lakehouse"] },
  { id: "J03", name: "Violation Detection",             services: ["eventBus","workflowEngine","lakehouse"] },
  { id: "J04", name: "Penalty Issuance",                services: ["tigerBeetle","eventBus","lakehouse"] },
  { id: "J05", name: "Penalty Payment",                 services: ["tigerBeetle","eventBus","lakehouse"] },
  { id: "J06", name: "Cross-Border Transfer Approval",  services: ["mlPipeline","iamService","workflowEngine","lakehouse"] },
  { id: "J07", name: "Network Traffic Blocking",        services: ["eventBus","daprBindings"] },
  { id: "J08", name: "BGP Hijack Response",             services: ["eventBus","workflowEngine"] },
  { id: "J09", name: "Threat Intelligence Ingestion",   services: ["eventBus","lakehouse","daprBindings"] },
  { id: "J10", name: "Incident Response Workflow",      services: ["workflowEngine","eventBus"] },
  { id: "J11", name: "Data Residency Audit",            services: ["mlPipeline","lakehouse"] },
  { id: "J12", name: "IPAM Allocation",                 services: ["apiGateway","daprBindings"] },
  { id: "J13", name: "Data Residency Violation",        services: ["workflowEngine","eventBus","lakehouse"] },
  { id: "J14", name: "ML Risk Score Update",            services: ["mlPipeline","eventBus","lakehouse"] },
  { id: "J15", name: "Compliance Audit Trail",          services: ["lakehouse","daprBindings"] },
  { id: "J16", name: "Regulatory Report Generation",    services: ["lakehouse","mlPipeline"] },
  { id: "J17", name: "Compliance Certificate Issuance", services: ["iamService","eventBus","lakehouse"] },
  { id: "J18", name: "Revenue Distribution",            services: ["tigerBeetle","eventBus"] },
  { id: "J19", name: "Temporal Workflow Execution",     services: ["workflowEngine","eventBus"] },
  { id: "J20", name: "Penalty Dispute (Escrow)",        services: ["tigerBeetle","workflowEngine"] },
  { id: "J21", name: "IXP Enforcement Action",          services: ["eventBus","daprBindings"] },
  { id: "J22", name: "Lakehouse Data Ingestion",        services: ["lakehouse","eventBus"] },
  { id: "J23", name: "Prometheus Metrics Scrape",       services: ["apiGateway","daprBindings"] },
  { id: "J24", name: "Arkime PCAP Capture",             services: ["eventBus","lakehouse"] },
  { id: "J25", name: "Financial Reconciliation",        services: ["tigerBeetle","lakehouse"] },
  { id: "J26", name: "Security Incident Escalation",    services: ["iamService","workflowEngine","eventBus"] },
  { id: "J27", name: "Streaming Event Processing",      services: ["eventBus","lakehouse","daprBindings"] },
  { id: "J28", name: "Violation Remediation",           services: ["workflowEngine","eventBus","lakehouse"] },
  { id: "J29", name: "SLA Breach Prediction",           services: ["mlPipeline","eventBus"] },
  { id: "J30", name: "Regulatory Submission",           services: ["apiGateway","iamService","lakehouse"] },
];

const ROLE_OPTIONS = ["user", "admin", "auditor", "org_admin"] as const;
const ROLE_COLORS: Record<string, string> = { admin: "#ef4444", auditor: "#f59e0b", org_admin: "#8b5cf6", user: "#10b981" };

function UserManagementTable() {
  const utils = trpc.useUtils();
  const { data: userList } = trpc.users.list.useQuery();
  const updateRole = trpc.users.updateRole.useMutation({
    onSuccess: () => { utils.users.list.invalidate(); toast.success("Role updated"); },
    onError: (e) => toast.error("Failed: " + (e instanceof Error ? e.message : String(e))),
  });
  if (!userList?.length) return <p className="text-xs text-muted-foreground p-4">No users found.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/60 bg-muted/30">
            {["ID", "Name", "Email", "Role", "Joined", "Action"].map(h => (
              <th key={h} className="text-left px-4 py-2 text-muted-foreground font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {userList.map((u: any) => (
            <tr key={u.id} className="border-b border-border/30 hover:bg-muted/20">
              <td className="px-4 py-2.5 mono text-muted-foreground">#{u.id}</td>
              <td className="px-4 py-2.5 font-medium">{u.name ?? "—"}</td>
              <td className="px-4 py-2.5 mono text-muted-foreground">{u.email ?? "—"}</td>
              <td className="px-4 py-2.5">
                <span className="mono text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ color: ROLE_COLORS[u.role] ?? "#6b7280", background: (ROLE_COLORS[u.role] ?? "#6b7280") + "20" }}>{u.role}</span>
              </td>
              <td className="px-4 py-2.5 mono text-muted-foreground">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Select
                    value={u.role}
                    onValueChange={(role) => updateRole.mutate({ userId: u.id, role: role as any })}
                  >
                    <SelectTrigger className="h-6 text-[10px] w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map(r => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {u.role === "admin" ? (
                    <button
                      title="Revoke Admin"
                      onClick={() => updateRole.mutate({ userId: u.id, role: "user" })}
                      disabled={updateRole.isPending}
                      className="p-1 rounded hover:bg-red-500/10 text-red-500 transition-colors disabled:opacity-50"
                    >
                      <ShieldOff className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      title="Make Admin"
                      onClick={() => updateRole.mutate({ userId: u.id, role: "admin" })}
                      disabled={updateRole.isPending}
                      className="p-1 rounded hover:bg-green-500/10 text-muted-foreground hover:text-green-600 transition-colors disabled:opacity-50"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "healthy")  return <CheckCircle  className="h-4 w-4 text-green-500" />;
  if (status === "degraded") return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  return <XCircle className="h-4 w-4 text-red-500" />;
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "healthy" ? "default" : status === "degraded" ? "secondary" : "destructive";
  return <Badge variant={variant as "default"|"secondary"|"destructive"} className="capitalize text-xs">{status}</Badge>;
}

export default function OrchestrationDashboard() {
  const [showDigestPreview, setShowDigestPreview] = useState(false);
  const [digestHtml, setDigestHtml] = useState<string | null>(null);
  const [digestOrgName, setDigestOrgName] = useState("");

  const sendDigest = trpc.system.sendDigest.useMutation({
    onSuccess: (r) => toast.success(`Digest sent: ${r.sent} delivered, ${r.failed} failed`),
    onError: (e) => toast.error("Send failed: " + (e instanceof Error ? e.message : String(e))),
  });

  const previewDigest = trpc.system.previewDigest.useMutation({
    onSuccess: (r) => {
      if (!r) { toast.error("No org data found for preview"); return; }
      setDigestHtml(r.html);
      setDigestOrgName(r.orgName);
      setShowDigestPreview(true);
    },
    onError: (e) => toast.error("Preview failed: " + (e instanceof Error ? e.message : String(e))),
  });

  const [tbOrgId, setTbOrgId] = useState("");
  const [ebTopic, setEbTopic] = useState("ndsep.compliance.check");
  const [ebPayload, setEbPayload] = useState('{"orgId":"test-001","type":"manual"}');
  const [apiGatewaySync, setApiGatewaySync] = useState<any>(null);

  const { data, isLoading, refetch } = trpc.orchestration.status.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const { data: mwData, isLoading: mwLoading, refetch: mwRefetch } = trpc.orchestration.middlewareHealth.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const services: Array<{ service: string; status: string; latencyMs?: number; url?: string }> = data?.services ?? [];
  const online   = data?.online ?? 0;
  const total    = data?.total  ?? 8;
  const pct      = data?.healthPercentage ?? 0;

  // New orchestration service status queries
  const { data: apiGwStatus } = trpc.orchestration.apiGatewayStatus.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: eventBusStatus } = trpc.orchestration.eventBusStatus.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: iamStatus } = trpc.orchestration.iamServiceStatus.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: tbStatus } = trpc.orchestration.tigerbeetleStatus.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: weStatus } = trpc.orchestration.workflowEngineStatus.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: daprStatus } = trpc.orchestration.daprBindingsStatus.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: lhStatus } = trpc.orchestration.lakehouseStatus.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: mlStatus } = trpc.orchestration.mlPipelineStatus.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: tbBalance } = trpc.orchestration.tigerbeetleBalance.useQuery(
    { orgId: tbOrgId },
    { enabled: tbOrgId.length > 0 }
  );

  // Action mutations
  const syncApiGateway = trpc.orchestration.apiGatewaySync.useMutation({
    onSuccess: (r) => { setApiGatewaySync(r); toast.success(r.success ? `Synced ${r.routesSynced ?? 0} routes` : `Sync failed: ${r.error}`); },
    onError: (e) => toast.error("Sync failed: " + (e instanceof Error ? e.message : String(e))),
  });
  const publishEvent = trpc.orchestration.eventBusPublish.useMutation({
    onSuccess: (r) => toast.success(r.success ? "Event published to " + ebTopic : "Publish failed: " + r.error),
    onError: (e) => toast.error("Publish failed: " + (e instanceof Error ? e.message : String(e))),
  });

  const serviceMap = Object.fromEntries(services.map((s) => [s.service, s]));
  const mwMap = Object.fromEntries((mwData?.middleware ?? []).map((m: any) => [m.service, m]));

  // Merge new status data into serviceMap overrides
  const svcStatusOverride: Record<string, string> = {
    apiGateway: (apiGwStatus as any)?.status === "ok" ? "healthy" : (apiGwStatus as any)?.status === "unreachable" ? "offline" : "healthy",
    eventBus: (eventBusStatus as any)?.status === "unreachable" ? "offline" : "healthy",
    iamService: (iamStatus as any)?.status === "unreachable" ? "offline" : "healthy",
    tigerBeetle: (tbStatus as any)?.status === "unreachable" ? "offline" : "healthy",
    workflowEngine: (weStatus as any)?.status === "unreachable" ? "offline" : "healthy",
    daprBindings: (daprStatus as any)?.status === "unreachable" ? "offline" : "healthy",
    lakehouse: (lhStatus as any)?.status === "unreachable" ? "offline" : "healthy",
    mlPipeline: (mlStatus as any)?.status === "unreachable" ? "offline" : "healthy",
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="h-6 w-6 text-primary" />
            Orchestration Layer
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Kafka · Dapr · Fluvio · Temporal · Keycloak · Permify · Redis · APISIX · TigerBeetle · Lakehouse
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Services Online</p>
          <p className="text-3xl font-bold text-green-500">{online}<span className="text-base text-muted-foreground">/{total}</span></p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Health</p>
          <p className={`text-3xl font-bold ${pct >= 80 ? "text-green-500" : pct >= 50 ? "text-amber-500" : "text-red-500"}`}>{pct}<span className="text-base text-muted-foreground">%</span></p>
          <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${pct}%` }} />
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Kafka Topics</p>
          <p className="text-3xl font-bold">30</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Stakeholder Journeys</p>
          <p className="text-3xl font-bold">30</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Microservice Health</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(SERVICE_META).map(([key, meta]) => {
              const svc = serviceMap[key];
              const status = svcStatusOverride[key] ?? svc?.status ?? "offline";
              const latency = svc?.latencyMs;
              return (
                <div key={key} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{meta.label}</p>
                    <p className="text-xs text-muted-foreground">:{meta.port} · {meta.lang}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <StatusBadge status={status} />
                      {latency !== undefined && <span className="text-xs text-muted-foreground">{latency}ms</span>}
                    </div>
                  </div>
                  <StatusIcon status={status} />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">30 Stakeholder Journeys</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium w-14">ID</th>
                  <th className="text-left py-2 pr-4 font-medium">Journey</th>
                  <th className="text-left py-2 font-medium">Services</th>
                  <th className="text-right py-2 font-medium w-20">Status</th>
                </tr>
              </thead>
              <tbody>
                {JOURNEYS.map((j) => {
                  const allHealthy = j.services.every((s) => (serviceMap[s]?.status ?? "offline") === "healthy");
                  const anyOnline  = j.services.some((s)  => (serviceMap[s]?.status ?? "offline") !== "offline");
                  const journeyStatus = allHealthy ? "healthy" : anyOnline ? "degraded" : "offline";
                  return (
                    <tr key={j.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 pr-4"><Badge variant="outline" className="font-mono text-xs">{j.id}</Badge></td>
                      <td className="py-2 pr-4 font-medium">{j.name}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {j.services.map((s) => (
                            <Badge key={s} variant="secondary" className="text-xs">{SERVICE_META[s]?.label ?? s}</Badge>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <StatusIcon status={journeyStatus} />
                          <span className="text-xs capitalize text-muted-foreground">{journeyStatus}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Orchestration Service Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* TigerBeetle Ledger */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              TigerBeetle Ledger
              <Badge variant={tbStatus && (tbStatus as any).status !== "unreachable" ? "default" : "destructive"} className="ml-auto text-xs">
                {tbStatus && (tbStatus as any).status !== "unreachable" ? `${(tbStatus as any).entryCount ?? 0} entries` : "offline"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {tbBalance && (
              <div className="p-2 rounded bg-muted/40 text-xs font-mono space-y-1">
                <p>Penalties Issued: <span className="text-foreground font-semibold">${((tbBalance as any).total_penalties_issued ?? 0).toLocaleString()}</span></p>
                <p>Penalties Paid: <span className="text-green-600 font-semibold">${((tbBalance as any).total_penalties_paid ?? 0).toLocaleString()}</span></p>
                <p>Escrow Held: <span className="text-amber-600 font-semibold">${((tbBalance as any).total_escrow_held ?? 0).toLocaleString()}</span></p>
              </div>
            )}
            <div className="flex gap-2">
              <input
                className="flex-1 h-8 px-2 text-xs rounded border border-border bg-background"
                placeholder="Org ID (e.g. org-001)"
                value={tbOrgId}
                onChange={(e) => setTbOrgId(e.target.value)}
              />
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setTbOrgId(tbOrgId)} disabled={!tbOrgId}>
                <BarChart3 className="h-3.5 w-3.5 mr-1" /> Query
              </Button>
            </div>
          </CardContent>
        </Card>
        {/* Event Bus Publisher */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Event Bus Publisher
              <Badge variant={eventBusStatus && (eventBusStatus as any).status !== "unreachable" ? "default" : "destructive"} className="ml-auto text-xs">
                {eventBusStatus && (eventBusStatus as any).status !== "unreachable" ? "online" : "offline"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <input
                className="w-full h-8 px-2 text-xs rounded border border-border bg-background font-mono"
                placeholder="Topic (e.g. ndsep.penalty.issued)"
                value={ebTopic}
                onChange={(e) => setEbTopic(e.target.value)}
              />
              <textarea
                className="w-full h-16 px-2 py-1 text-xs rounded border border-border bg-background font-mono resize-none"
                placeholder='{"key":"value"}'
                value={ebPayload}
                onChange={(e) => setEbPayload(e.target.value)}
              />
              <Button
                size="sm" className="w-full h-8 text-xs"
                onClick={() => {
                  try {
                    const parsed = JSON.parse(ebPayload);
                    publishEvent.mutate({ topic: ebTopic, event: parsed });
                  } catch { toast.error("Invalid JSON payload"); }
                }}
                disabled={publishEvent.isPending || !ebTopic}
              >
                <Zap className="h-3.5 w-3.5 mr-1" />
                {publishEvent.isPending ? "Publishing..." : "Publish Event"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* API Gateway Sync */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" />
            APISIX API Gateway Route Sync
            <Badge variant={apiGwStatus && (apiGwStatus as any).status !== "unreachable" ? "default" : "destructive"} className="ml-auto text-xs">
              {apiGwStatus && (apiGwStatus as any).status !== "unreachable" ? `${(apiGwStatus as any).routes ?? 0} routes` : "offline"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground flex-1">Syncs all 30 NDSEP journey routes to APISIX Admin API v3. Use this to re-sync after adding new routes or updating upstream URLs.</p>
            <Button
              size="sm" variant="outline" className="shrink-0 text-xs"
              onClick={() => syncApiGateway.mutate()}
              disabled={syncApiGateway.isPending}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncApiGateway.isPending ? "animate-spin" : ""}`} />
              {syncApiGateway.isPending ? "Syncing..." : "Sync Routes"}
            </Button>
          </div>
          {apiGatewaySync && (
            <div className="mt-3 p-2 rounded bg-muted/40 text-xs font-mono">
              {apiGatewaySync.success ? (
                <span className="text-green-600">✓ Synced {apiGatewaySync.routesSynced ?? 0} routes to APISIX</span>
              ) : (
                <span className="text-red-500">✗ {apiGatewaySync.error ?? "Sync failed"}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Middleware Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Middleware Connection Status
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {mwData ? `${mwData.online}/${mwData.total} online · ${mwData.healthPct}%` : "checking..."}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {Object.entries(MIDDLEWARE_META).map(([key, meta]) => {
              const svc = mwMap[key];
              const status = svc?.status ?? "offline";
              const latency = svc?.latencyMs;
              return (
                <div key={key} className={`flex flex-col gap-1 p-3 rounded-lg border ${
                  status === "healthy" ? "border-green-500/30 bg-green-500/5" :
                  status === "degraded" ? "border-yellow-500/30 bg-yellow-500/5" :
                  "border-red-500/20 bg-red-500/5"
                }`}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold truncate">{meta.label}</p>
                    <StatusIcon status={status} />
                  </div>
                  <p className="text-[10px] text-muted-foreground font-mono">{meta.proto}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusBadge status={status} />
                    {latency !== undefined && <span className="text-[10px] text-muted-foreground">{latency}ms</span>}
                  </div>
                  <p className="text-[10px] text-muted-foreground">{meta.lang} · :{meta.port}</p>
                </div>
              );
            })}
          </div>
          {mwLoading && <p className="text-xs text-muted-foreground mt-3 text-center">Probing middleware endpoints...</p>}
          <p className="text-[10px] text-muted-foreground mt-3">
            Services marked offline are expected in dev — they connect automatically when deployed with the full infrastructure stack.
          </p>
        </CardContent>
      </Card>

      {/* Weekly Digest Admin Controls */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            Weekly Compliance Digest
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">
            Sends a personalised compliance score summary to every registered organisation every Monday at 08:00 WAT.
            Use the controls below to preview the email template or trigger an immediate send.
          </p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="sm"
              className="font-mono text-xs"
              onClick={() => previewDigest.mutate({})}
              disabled={previewDigest.isPending}
            >
              <Eye className="h-3.5 w-3.5 mr-1.5" />
              {previewDigest.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Loading</> : "Preview Digest Email"}
            </Button>
            <Button
              size="sm"
              className="font-mono text-xs"
              onClick={() => sendDigest.mutate()}
              disabled={sendDigest.isPending}
            >
              <Mail className="h-3.5 w-3.5 mr-1.5" />
              {sendDigest.isPending ? "Sending..." : "Send Digest Now"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* User Management */}
      <Card className="border border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> User Management
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <UserManagementTable />
        </CardContent>
      </Card>

      {/* Digest Preview Modal */}
      <Dialog open={showDigestPreview} onOpenChange={setShowDigestPreview}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              <Eye className="inline h-4 w-4 mr-2 text-primary" />
              Digest Preview — {digestOrgName}
            </DialogTitle>
          </DialogHeader>
          {digestHtml && (
            <iframe
              srcDoc={digestHtml}
              title="Digest Preview"
              className="w-full rounded border border-border/40"
              style={{ height: "500px" }}
              sandbox="allow-same-origin"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
