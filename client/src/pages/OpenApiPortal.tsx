import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Code2, Copy, Key, Globe, CheckCircle2, ChevronDown, ChevronRight, BookOpen } from "lucide-react";
const BASE_URL = window.location.origin;

const ENDPOINTS = [
  {
    group: "Authentication",
    color: "text-blue-400",
    endpoints: [
      { method: "GET", path: "/api/oauth/login", desc: "Initiate OAuth login flow", auth: false },
      { method: "GET", path: "/api/oauth/callback", desc: "OAuth callback handler", auth: false },
      { method: "POST", path: "/api/trpc/auth.logout", desc: "Logout current session", auth: true },
    ],
  },
  {
    group: "Organisations",
    color: "text-green-400",
    endpoints: [
      { method: "GET", path: "/api/trpc/organizations.list", desc: "List all registered organisations", auth: true, params: '{"json":{"limit":20,"offset":0}}' },
      { method: "GET", path: "/api/trpc/organizations.get", desc: "Get organisation by ID", auth: true, params: '{"json":{"id":1}}' },
      { method: "GET", path: "/api/trpc/organizations.getComplianceSummary", desc: "Get compliance summary for an org", auth: true, params: '{"json":{"orgId":1}}' },
    ],
  },
  {
    group: "Citizen Rights (DSAR)",
    color: "text-purple-400",
    endpoints: [
      { method: "POST", path: "/api/trpc/dsar.publicSubmit", desc: "Submit a DSAR (no auth required)", auth: false, body: '{"json":{"requestType":"access","citizenName":"Jane Doe","citizenEmail":"jane@example.com","description":"I request access to all personal data you hold about me."}}' },
      { method: "GET", path: "/api/trpc/dsar.publicTrack", desc: "Track a DSAR by reference + email", auth: false, params: '{"json":{"referenceNumber":"NDSEP-CR-000001","citizenEmail":"jane@example.com"}}' },
      { method: "GET", path: "/api/trpc/dsar.listWithDeadlines", desc: "List all DSARs with deadline tracking", auth: true },
    ],
  },
  {
    group: "DPCO",
    color: "text-cyan-600",
    endpoints: [
      { method: "GET", path: "/api/trpc/accreditation.publicListDpcos", desc: "List all accredited DPCOs (public)", auth: false },
      { method: "GET", path: "/api/trpc/accreditation.verifyDpcoCertificate", desc: "Verify a DPCO certificate by token", auth: false, params: '{"json":{"token":"CERT-TOKEN-HERE"}}' },
      { method: "GET", path: "/api/trpc/billing.getSubscriptionTiers", desc: "Get available DPCO subscription tiers", auth: false },
    ],
  },
  {
    group: "Enforcement",
    color: "text-red-400",
    endpoints: [
      { method: "GET", path: "/api/trpc/enforcement.listCases", desc: "List enforcement cases", auth: true },
      { method: "GET", path: "/api/trpc/enforcement.getCase", desc: "Get enforcement case by ID", auth: true, params: '{"json":{"id":1}}' },
    ],
  },
  {
    group: "Breach Notifications",
    color: "text-orange-400",
    endpoints: [
      { method: "GET", path: "/api/trpc/breach.list", desc: "List breach notifications", auth: true },
      { method: "POST", path: "/api/trpc/breach.submit", desc: "Submit a new breach notification", auth: true },
    ],
  },
  {
    group: "Webhooks",
    color: "text-yellow-400",
    endpoints: [
      { method: "GET", path: "/api/trpc/webhooks.eventTypes", desc: "List all available webhook event types", auth: false },
      { method: "GET", path: "/api/trpc/webhooks.listSubscriptions", desc: "List your webhook subscriptions", auth: true },
      { method: "POST", path: "/api/trpc/webhooks.createSubscription", desc: "Create a webhook subscription", auth: true },
    ],
  },
  {
    group: "Search",
    color: "text-pink-400",
    endpoints: [
      { method: "GET", path: "/api/trpc/search.global", desc: "Full-text search across all entities", auth: true, params: '{"json":{"query":"MTN","limit":10}}' },
    ],
  },
];

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-green-900/40 text-green-400 border border-green-800",
  POST: "bg-blue-900/40 text-blue-400 border border-blue-800",
  PUT: "bg-yellow-900/40 text-yellow-400 border border-yellow-800",
  DELETE: "bg-red-900/40 text-red-400 border border-red-800",
  PATCH: "bg-purple-900/40 text-purple-400 border border-purple-800",
};

export default function OpenApiPortal() {
  const [expanded, setExpanded] = useState<string | null>("Citizen Rights (DSAR)");
  const [tryUrl, setTryUrl] = useState("");
  const [tryBody, setTryBody] = useState("");
  const [tryResult, setTryResult] = useState<string | null>(null);
  const [tryLoading, setTryLoading] = useState(false);

  const { data: apiKey } = trpc.openApi.getApiKey.useQuery();
  const generateKeyMutation = trpc.openApi.generateApiKey.useMutation({
    onSuccess: () => { toast.success("New API key generated"); },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const tryEndpoint = async () => {
    if (!tryUrl) return;
    setTryLoading(true);
    setTryResult(null);
    try {
      const isGet = !tryBody;
      const url = tryUrl.startsWith("http") ? tryUrl : `${BASE_URL}${tryUrl}`;
      const fullUrl = isGet && tryBody ? `${url}?input=${encodeURIComponent(tryBody)}` : url;
      const resp = await fetch(fullUrl, {
        method: isGet ? "GET" : "POST",
        headers: { "Content-Type": "application/json" },
        body: isGet ? undefined : tryBody || undefined,
        credentials: "include",
      });
      const data = await resp.json();
      setTryResult(JSON.stringify(data, null, 2));
    } catch (e: unknown) {
      setTryResult(`Error: ${(e instanceof Error ? e.message : String(e))}`);
    } finally {
      setTryLoading(false);
    }
  };

  return (
    <>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <BookOpen className="w-7 h-7 text-indigo-400" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Developer API Portal</h1>
            <p className="text-sm text-muted-foreground">NDSEP tRPC API reference and interactive explorer</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* API Key */}
          <div className="lg:col-span-2 bg-background border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Key className="w-4 h-4 text-yellow-400" />
              <span className="font-medium text-foreground">Your API Key</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-card text-green-400 px-3 py-2 rounded-lg text-sm font-mono truncate">
                {(apiKey as any)?.key ?? "No API key generated yet"}
              </code>
              {(apiKey as any)?.key && (
                <Button size="sm" variant="outline" onClick={() => copyToClipboard((apiKey as any).key)} className="border-border text-muted-foreground">
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              )}
              <Button size="sm" onClick={() => generateKeyMutation.mutate()} disabled={generateKeyMutation.isPending} className="bg-indigo-600 hover:bg-indigo-700 text-xs">
                {generateKeyMutation.isPending ? "..." : (apiKey as any)?.key ? "Rotate" : "Generate"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Pass as <code className="text-muted-foreground">Authorization: Bearer &lt;key&gt;</code> header on all authenticated requests.</p>
          </div>
          {/* Base URL */}
          <div className="bg-background border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-4 h-4 text-blue-400" />
              <span className="font-medium text-foreground">Base URL</span>
            </div>
            <code className="block bg-card text-blue-400 px-3 py-2 rounded-lg text-xs font-mono break-all">{BASE_URL}</code>
            <p className="text-xs text-muted-foreground mt-2">All tRPC endpoints are under <code className="text-muted-foreground">/api/trpc/</code></p>
          </div>
        </div>

        {/* Interactive tester */}
        <div className="bg-background border border-border rounded-xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Code2 className="w-4 h-4 text-green-400" />
            <span className="font-medium text-foreground">Interactive Explorer</span>
          </div>
          <div className="flex gap-2 mb-3">
            <Input value={tryUrl} onChange={e => setTryUrl(e.target.value)} className="bg-card border-border text-foreground font-mono text-sm flex-1" placeholder="/api/trpc/accreditation.publicListDpcos" />
            <Button onClick={tryEndpoint} disabled={tryLoading || !tryUrl} className="bg-green-600 hover:bg-green-700">
              {tryLoading ? "..." : "Send"}
            </Button>
          </div>
          <Input value={tryBody} onChange={e => setTryBody(e.target.value)} className="bg-card border-border text-foreground font-mono text-sm mb-3" placeholder='POST body or GET ?input= e.g. {"json":{"limit":5}}' />
          {tryResult && (
            <div className="relative">
              <pre className="bg-background text-green-300 text-xs p-4 rounded-lg overflow-x-auto max-h-64 font-mono">{tryResult}</pre>
              <Button size="sm" variant="outline" onClick={() => copyToClipboard(tryResult)} className="absolute top-2 right-2 border-border text-muted-foreground text-xs h-6">
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          )}
        </div>

        {/* Endpoint reference */}
        <div className="space-y-3">
          {ENDPOINTS.map((group) => (
            <div key={group.group} className="bg-background border border-border rounded-xl overflow-hidden">
              <button
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-card/50 transition-all"
                onClick={() => setExpanded(expanded === group.group ? null : group.group)}
              >
                <div className="flex items-center gap-2">
                  {expanded === group.group ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  <span className={`font-medium ${group.color}`}>{group.group}</span>
                  <span className="text-xs text-muted-foreground">{group.endpoints.length} endpoints</span>
                </div>
              </button>
              {expanded === group.group && (
                <div className="divide-y divide-gray-800 border-t border-border">
                  {group.endpoints.map((ep, i) => (
                    <div key={i} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono ${METHOD_COLORS[ep.method] ?? "bg-card text-muted-foreground"}`}>{ep.method}</span>
                          <code className="text-muted-foreground text-sm font-mono">{ep.path}</code>
                          {!ep.auth && <span className="px-1.5 py-0.5 rounded text-xs bg-card text-muted-foreground">Public</span>}
                          {ep.auth && <span className="px-1.5 py-0.5 rounded text-xs bg-yellow-900/30 text-yellow-400">Auth required</span>}
                        </div>
                        <div className="flex gap-1.5 flex-shrink-0">
                          <Button size="sm" variant="outline" onClick={() => { setTryUrl(ep.path); setTryBody(ep.body ?? ep.params ?? ""); }} className="border-border text-muted-foreground text-xs h-6 px-2">Try</Button>
                          <Button size="sm" variant="outline" onClick={() => copyToClipboard(`${BASE_URL}${ep.path}${ep.params ? `?input=${encodeURIComponent(ep.params)}` : ""}`)} className="border-border text-muted-foreground text-xs h-6 px-2">
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-muted-foreground text-sm">{ep.desc}</p>
                      {(ep.params || ep.body) && (
                        <pre className="mt-2 bg-background text-muted-foreground text-xs p-2 rounded font-mono overflow-x-auto">{ep.params ?? ep.body}</pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
