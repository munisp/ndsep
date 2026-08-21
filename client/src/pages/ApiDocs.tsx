import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  BookOpen, Search, ChevronDown, ChevronRight, Globe, Lock, Zap,
  Database, Shield, Award, BarChart3, FileText, Network, DollarSign,
  Copy, CheckCircle2
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

type Endpoint = {
  method: "GET" | "POST" | "QUERY" | "MUTATION";
  path: string;
  description: string;
  auth: boolean;
  params?: { name: string; type: string; required: boolean; description: string }[];
  response: string;
  example?: string;
};

type Category = {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  description: string;
  endpoints: Endpoint[];
};

const CATEGORIES: Category[] = [
  {
    id: "leaderboard",
    label: "Compliance Leaderboard",
    icon: <Award className="h-4 w-4" />,
    color: "text-yellow-500",
    description: "Public compliance rankings for all registered organisations.",
    endpoints: [
      {
        method: "QUERY",
        path: "trpc/leaderboard.list",
        description: "Retrieve the ranked list of organisations by compliance score.",
        auth: false,
        params: [
          { name: "sector", type: "string", required: false, description: "Filter by sector (bank, telecom, healthcare, etc.)" },
          { name: "limit", type: "number", required: false, description: "Maximum results to return (default: 50)" },
          { name: "anonymise", type: "boolean", required: false, description: "Replace org names with anonymised IDs (default: false)" },
        ],
        response: `[{ id, name, sector, country, complianceScore, complianceStatus, riskScore, agentInstalled }]`,
        example: `fetch('/api/trpc/leaderboard.list?input={"sector":"bank","limit":10}')`,
      },
      {
        method: "QUERY",
        path: "trpc/leaderboard.stats",
        description: "Aggregate statistics for the leaderboard (sector breakdown, avg score, etc.).",
        auth: false,
        params: [
          { name: "sector", type: "string", required: false, description: "Filter stats by sector" },
        ],
        response: `{ totalOrgs, avgScore, compliantCount, sectorBreakdown: [{sector, count, avgScore}] }`,
        example: `fetch('/api/trpc/leaderboard.stats?input={}')`,
      },
    ],
  },
  {
    id: "verify",
    label: "Certificate Verification",
    icon: <Shield className="h-4 w-4" />,
    color: "text-green-500",
    description: "Verify NDSEP compliance certificates in real time.",
    endpoints: [
      {
        method: "QUERY",
        path: "trpc/verify.certificate",
        description: "Verify a compliance certificate by its unique token. Returns validity, org details, and certification date.",
        auth: false,
        params: [
          { name: "token", type: "string", required: true, description: "The unique certificate token issued by NDSEP" },
        ],
        response: `{ valid: boolean, orgName, orgSector, orgCountry, certifiedAt, complianceScore, token, message }`,
        example: `fetch('/api/trpc/verify.certificate?input={"token":"NDSEP-2026-XXXXXXXX"}')`,
      },
    ],
  },
  {
    id: "portal",
    label: "Organisation Portal",
    icon: <FileText className="h-4 w-4" />,
    color: "text-blue-500",
    description: "Submit and track organisation compliance registrations.",
    endpoints: [
      {
        method: "MUTATION",
        path: "trpc/portal.submit",
        description: "Submit a new organisation for NDSEP compliance registration.",
        auth: false,
        params: [
          { name: "orgName", type: "string", required: true, description: "Legal name of the organisation" },
          { name: "orgSector", type: "string", required: true, description: "Sector (bank, telecom, healthcare, fintech, energy, govt)" },
          { name: "orgCountry", type: "string", required: true, description: "Country of incorporation" },
          { name: "contactEmail", type: "string", required: true, description: "Primary compliance contact email" },
          { name: "assets", type: "array", required: true, description: "Array of asset declarations" },
          { name: "datasets", type: "array", required: true, description: "Array of dataset declarations" },
          { name: "selfAssessmentScore", type: "number", required: true, description: "Self-assessment score (0–100)" },
        ],
        response: `{ id, submissionToken, currentPhase, createdAt }`,
        example: `POST /api/trpc/portal.submit\n{ "orgName": "Zenith Bank Plc", "orgSector": "bank", ... }`,
      },
      {
        method: "QUERY",
        path: "trpc/portal.get",
        description: "Retrieve submission status by token.",
        auth: false,
        params: [
          { name: "token", type: "string", required: true, description: "Submission token returned on registration" },
        ],
        response: `{ id, orgName, currentPhase, complianceScore, certifiedAt, submissionToken }`,
        example: `fetch('/api/trpc/portal.get?input={"token":"NDSEP-SUB-XXXXXXXX"}')`,
      },
      {
        method: "MUTATION",
        path: "trpc/portal.submitAppeal",
        description: "Submit a penalty appeal for review.",
        auth: false,
        params: [
          { name: "penaltyId", type: "number", required: true, description: "NDSEP penalty reference ID" },
          { name: "organizationId", type: "number", required: true, description: "Organisation ID" },
          { name: "submittedBy", type: "string", required: true, description: "Name of legal representative" },
          { name: "contactEmail", type: "string", required: true, description: "Contact email for updates" },
          { name: "groundsForAppeal", type: "string", required: true, description: "Grounds for appeal (min 20 chars)" },
          { name: "requestedOutcome", type: "string", required: false, description: "full_waiver | reduction | payment_plan | extension" },
        ],
        response: `{ id, status, createdAt }`,
        example: `POST /api/trpc/portal.submitAppeal\n{ "penaltyId": 1042, "organizationId": 7, ... }`,
      },
    ],
  },
  {
    id: "financial",
    label: "Financial Enforcement",
    icon: <DollarSign className="h-4 w-4" />,
    color: "text-red-500",
    description: "Penalty register, payment submission, and financial statistics.",
    endpoints: [
      {
        method: "QUERY",
        path: "trpc/financial.penalties",
        description: "List all active compliance penalties.",
        auth: false,
        params: [
          { name: "limit", type: "number", required: false, description: "Max results (default: 50)" },
        ],
        response: `[{ id, organizationId, amount, currency, status, description, dueDate, createdAt }]`,
        example: `fetch('/api/trpc/financial.penalties?input={"limit":20}')`,
      },
      {
        method: "QUERY",
        path: "trpc/financial.summary",
        description: "Aggregate penalty statistics (total issued, collected, pending).",
        auth: false,
        params: [],
        response: `{ totalIssued, totalCollected, totalPending, overdueCount, avgPenaltyAmount }`,
        example: `fetch('/api/trpc/financial.summary?input={}')`,
      },
      {
        method: "MUTATION",
        path: "trpc/financial.payPenalty",
        description: "Submit a payment reference for a compliance penalty. Updates status to 'processing' and fires a TigerBeetle ledger event.",
        auth: false,
        params: [
          { name: "penaltyId", type: "number", required: true, description: "NDSEP penalty ID" },
          { name: "orgId", type: "number", required: true, description: "Organisation ID" },
          { name: "paymentMethod", type: "string", required: true, description: "bank_transfer | card | ussd | crypto | other" },
          { name: "paymentRef", type: "string", required: true, description: "Bank/card transaction reference (min 4 chars)" },
          { name: "contactEmail", type: "string", required: false, description: "Email for payment confirmation" },
        ],
        response: `{ success: boolean, status: "processing" }`,
        example: `POST /api/trpc/financial.payPenalty\n{ "penaltyId": 1042, "orgId": 7, "paymentMethod": "bank_transfer", "paymentRef": "TXN-2026-ABC123" }`,
      },
    ],
  },
  {
    id: "dashboard",
    label: "Dashboard & Analytics",
    icon: <BarChart3 className="h-4 w-4" />,
    color: "text-purple-500",
    description: "Platform-wide compliance and enforcement statistics.",
    endpoints: [
      {
        method: "QUERY",
        path: "trpc/dashboard.stats",
        description: "Top-level platform statistics (organisations, violations, alerts, penalties).",
        auth: false,
        params: [],
        response: `{ orgStats, violationStats, alertStats, penaltyStats, assetStats }`,
        example: `fetch('/api/trpc/dashboard.stats?input={}')`,
      },
      {
        method: "QUERY",
        path: "trpc/dashboard.violationTrend",
        description: "Weekly violation count trend for the past 12 weeks.",
        auth: false,
        params: [],
        response: `[{ week: "2026-W01", count: number }]`,
        example: `fetch('/api/trpc/dashboard.violationTrend?input={}')`,
      },
      {
        method: "QUERY",
        path: "trpc/dashboard.orgRiskScores",
        description: "Distribution of organisation risk scores by band.",
        auth: false,
        params: [],
        response: `[{ band: "0-20", count: number }]`,
        example: `fetch('/api/trpc/dashboard.orgRiskScores?input={}')`,
      },
    ],
  },
  {
    id: "network",
    label: "Network & DPI",
    icon: <Network className="h-4 w-4" />,
    color: "text-cyan-500",
    description: "Network traffic, IXP enforcement, and DPI statistics.",
    endpoints: [
      {
        method: "QUERY",
        path: "trpc/network.events",
        description: "List recent network events captured by the DPI engine.",
        auth: false,
        params: [
          { name: "limit", type: "number", required: false, description: "Max results (default: 50)" },
          { name: "crossBorderOnly", type: "boolean", required: false, description: "Filter to cross-border events only" },
        ],
        response: `[{ id, sourceIp, destIp, protocol, port, dataVolumeMb, isCrossBorder, ixpSite, createdAt }]`,
        example: `fetch('/api/trpc/network.events?input={"crossBorderOnly":true}')`,
      },
      {
        method: "QUERY",
        path: "trpc/network.trafficByHour",
        description: "Hourly network traffic volume for the past 24 hours.",
        auth: false,
        params: [],
        response: `[{ hour: "14:00", volumeMb: number, eventCount: number }]`,
        example: `fetch('/api/trpc/network.trafficByHour?input={}')`,
      },
    ],
  },
  {
    id: "orgs",
    label: "Organisations",
    icon: <Database className="h-4 w-4" />,
    color: "text-orange-500",
    description: "Organisation registry and compliance profiles.",
    endpoints: [
      {
        method: "QUERY",
        path: "trpc/orgs.list",
        description: "List all registered organisations with compliance status.",
        auth: false,
        params: [
          { name: "limit", type: "number", required: false, description: "Max results (default: 50)" },
          { name: "sector", type: "string", required: false, description: "Filter by sector" },
          { name: "status", type: "string", required: false, description: "Filter by compliance status" },
        ],
        response: `[{ id, name, sector, country, complianceScore, complianceStatus, riskScore, agentInstalled }]`,
        example: `fetch('/api/trpc/orgs.list?input={"sector":"telecom","limit":10}')`,
      },
    ],
  },
];

const METHOD_COLORS: Record<string, string> = {
  QUERY: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  MUTATION: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  GET: "bg-green-500/10 text-green-400 border-green-500/30",
  POST: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
};

export default function ApiDocs() {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const toggle = (key: string) => setExpanded(e => ({ ...e, [key]: !e[key] }));

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const filtered = CATEGORIES.map(cat => ({
    ...cat,
    endpoints: cat.endpoints.filter(ep =>
      ep.path.toLowerCase().includes(search.toLowerCase()) ||
      ep.description.toLowerCase().includes(search.toLowerCase()) ||
      cat.label.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter(cat => cat.endpoints.length > 0);

  return (
    <div className="min-h-screen bg-background">
      <Breadcrumbs items={[{ label: "Developer", href: "/" }, { label: "API Documentation" }]} className="mb-4" />
      {/* Header */}
      <div className="border-b bg-card/50 backdrop-blur sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <BookOpen className="h-4 w-4 text-primary" />
            </div>
            <div>
              <span className="font-bold text-sm text-foreground">NDSEP</span>
              <span className="text-xs text-muted-foreground ml-2">Public API Documentation</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs font-mono">v1.0</Badge>
            <Badge className="text-xs bg-green-500/10 text-green-400 border-green-500/30">tRPC + REST</Badge>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Hero */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">NDSEP Public API</h1>
          <p className="text-muted-foreground max-w-2xl text-sm mb-4">
            The National Data Sovereignty Enforcement Platform exposes a public tRPC API for third-party integration.
            Banks, auditors, investors, and regulators can verify compliance certificates, query the leaderboard,
            and access enforcement statistics in real time.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            <div className="bg-muted/30 rounded-lg p-3 flex items-start gap-2">
              <Globe className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-foreground">Base URL</p>
                <p className="text-xs text-muted-foreground font-mono">https://ndsep.gov.ng/api</p>
              </div>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 flex items-start gap-2">
              <Zap className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-foreground">Protocol</p>
                <p className="text-xs text-muted-foreground">tRPC over HTTP (JSON)</p>
              </div>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 flex items-start gap-2">
              <Lock className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-foreground">Auth</p>
                <p className="text-xs text-muted-foreground">Public endpoints: none. Protected: Bearer JWT</p>
              </div>
            </div>
          </div>
          {/* Search */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search endpoints..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-muted/30"
            />
          </div>
        </div>

        {/* Quick reference table */}
        <Card className="mb-8">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Quick Reference</CardTitle>
            <CardDescription className="text-xs">All public endpoints at a glance</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/20">
                    <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Endpoint</th>
                    <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Type</th>
                    <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Auth</th>
                    <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {CATEGORIES.flatMap(cat => cat.endpoints.map((ep, i) => (
                    <tr key={`${cat.id}-${i}`} className="border-b hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-2 font-mono text-primary">{ep.path}</td>
                      <td className="px-4 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-xs border font-mono ${METHOD_COLORS[ep.method]}`}>{ep.method}</span>
                      </td>
                      <td className="px-4 py-2">
                        {ep.auth ? <Lock className="h-3 w-3 text-yellow-500" /> : <Globe className="h-3 w-3 text-green-500" />}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{ep.description}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Endpoint categories */}
        <div className="space-y-4">
          {filtered.map(cat => (
            <Card key={cat.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className={cat.color}>{cat.icon}</span>
                  {cat.label}
                  <Badge variant="outline" className="text-xs ml-auto">{cat.endpoints.length} endpoint{cat.endpoints.length !== 1 ? "s" : ""}</Badge>
                </CardTitle>
                <CardDescription className="text-xs">{cat.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {cat.endpoints.map((ep, i) => {
                  const key = `${cat.id}-${i}`;
                  const isOpen = expanded[key];
                  return (
                    <div key={key} className="border rounded-lg overflow-hidden">
                      <button
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
                        onClick={() => toggle(key)}
                      >
                        <span className={`px-2 py-0.5 rounded text-xs border font-mono shrink-0 ${METHOD_COLORS[ep.method]}`}>{ep.method}</span>
                        <span className="font-mono text-sm text-primary font-medium">{ep.path}</span>
                        {ep.auth && <Lock className="h-3 w-3 text-yellow-500 shrink-0" />}
                        <span className="text-xs text-muted-foreground ml-2 flex-1 truncate">{ep.description}</span>
                        {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                      </button>
                      {isOpen && (
                        <div className="border-t bg-muted/10 px-4 py-4 space-y-4">
                          <p className="text-sm text-muted-foreground">{ep.description}</p>
                          {ep.params && ep.params.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-foreground mb-2">Parameters</p>
                              <div className="space-y-1.5">
                                {ep.params.map(p => (
                                  <div key={p.name} className="flex items-start gap-2 text-xs">
                                    <span className="font-mono text-primary w-32 shrink-0">{p.name}</span>
                                    <span className="font-mono text-muted-foreground w-16 shrink-0">{p.type}</span>
                                    <span className={`shrink-0 ${p.required ? "text-destructive" : "text-muted-foreground"}`}>{p.required ? "required" : "optional"}</span>
                                    <span className="text-muted-foreground">{p.description}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <div>
                            <p className="text-xs font-semibold text-foreground mb-1.5">Response Schema</p>
                            <pre className="bg-muted/40 rounded p-3 text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap">{ep.response}</pre>
                          </div>
                          {ep.example && (
                            <div>
                              <div className="flex items-center justify-between mb-1.5">
                                <p className="text-xs font-semibold text-foreground">Example</p>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => copyToClipboard(ep.example!, key + "-ex")}
                                >
                                  {copied === key + "-ex" ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                                  <span className="ml-1">{copied === key + "-ex" ? "Copied" : "Copy"}</span>
                                </Button>
                              </div>
                              <pre className="bg-muted/40 rounded p-3 text-xs font-mono text-green-400 overflow-x-auto whitespace-pre-wrap">{ep.example}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-8 border-t pt-6 text-center text-xs text-muted-foreground">
          <p>NDSEP Public API — National Information Technology Development Agency (NITDA) · Federal Republic of Nigeria</p>
          <p className="mt-1">For integration support, contact <span className="text-primary">api-support@ndsep.gov.ng</span></p>
        </div>
      </div>
    </div>
  );
}
