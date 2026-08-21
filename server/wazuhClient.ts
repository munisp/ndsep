/**
 * NDSEP ↔ Wazuh Integration Client
 * ==================================
 * SIEM + XDR: log analysis, file integrity monitoring, vulnerability detection,
 * compliance auditing (PCI, GDPR, HIPAA → NDPA/NDPR for Nigeria).
 * Docs: https://github.com/wazuh/wazuh
 */
import pino from "pino";

const logger = pino({ name: "wazuh-client" });
const WAZUH_URL = process.env.WAZUH_URL ?? "https://wazuh:55000";
const WAZUH_USER = process.env.WAZUH_USER ?? "wazuh-wui";
const WAZUH_PASS = process.env.WAZUH_PASSWORD ?? "";
const CACHE_TTL_MS = 5 * 60 * 1000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface WazuhAlert {
  id: string;
  timestamp: string;
  rule: { id: string; description: string; level: number; groups: string[]; mitreTactic?: string; mitreTechnique?: string };
  agent: { id: string; name: string; ip: string; os?: string };
  data?: Record<string, string>;
  severity: "critical" | "high" | "medium" | "low";
}

export interface WazuhAgent {
  id: string;
  name: string;
  ip: string;
  os: string;
  version: string;
  status: "active" | "disconnected" | "never_connected" | "pending";
  lastKeepAlive: string;
  group: string[];
  complianceScore?: number;
}

export interface WazuhVulnerability {
  cveId: string;
  name: string;
  severity: "critical" | "high" | "medium" | "low";
  cvssScore: number;
  affectedPackage: string;
  fixAvailable: boolean;
  agentId: string;
  agentName: string;
  detectedAt: string;
}

export interface WazuhComplianceCheck {
  id: string;
  framework: "ndpa" | "ndpr" | "pci_dss" | "gdpr" | "hipaa" | "nist_800_53" | "iso_27001";
  requirement: string;
  description: string;
  status: "passed" | "failed" | "not_applicable";
  agentId: string;
  agentName: string;
  lastChecked: string;
}

export interface WazuhFimEvent {
  timestamp: string;
  agentId: string;
  agentName: string;
  path: string;
  event: "added" | "modified" | "deleted";
  md5Before?: string;
  md5After?: string;
  sizeChange?: number;
  userId?: string;
}

export interface WazuhStats {
  totalAgents: number;
  activeAgents: number;
  disconnectedAgents: number;
  criticalAlerts24h: number;
  highAlerts24h: number;
  totalVulnerabilities: number;
  criticalVulnerabilities: number;
  compliancePassRate: number;
  fimEvents24h: number;
}

// ── Cache + Auth ─────────────────────────────────────────────────────────────

const cache = new Map<string, { data: unknown; ts: number }>();
let authToken: string | null = null;
let tokenExpiry = 0;

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return Promise.resolve(hit.data as T);
  return fn().then(d => { cache.set(key, { data: d, ts: Date.now() }); return d; })
    .catch(err => {
      logger.warn({ err: err instanceof Error ? err.message : String(err), key }, "Wazuh fetch failed");
      const stale = cache.get(key);
      if (stale) return stale.data as T;
      throw err;
    });
}

async function getToken(): Promise<string> {
  if (authToken && Date.now() < tokenExpiry) return authToken;
  const res = await fetch(`${WAZUH_URL}/security/user/authenticate`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${Buffer.from(`${WAZUH_USER}:${WAZUH_PASS}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Wazuh auth: ${res.status}`);
  const body = await res.json() as { data: { token: string } };
  authToken = body.data.token;
  tokenExpiry = Date.now() + 890_000; // ~15 min
  return authToken;
}

async function wazuhFetch<T>(path: string): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${WAZUH_URL}${path}`, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Wazuh ${path}: ${res.status}`);
  const body = await res.json() as { data: T };
  return body.data;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getAlerts(opts?: { level?: number; limit?: number }) {
  const params = new URLSearchParams();
  if (opts?.level) params.set("level", String(opts.level));
  params.set("limit", String(opts?.limit ?? 50));
  return cached<WazuhAlert[]>(`alerts:${params}`, () => wazuhFetch(`/alerts?${params}`));
}

export function getAgents() {
  return cached<WazuhAgent[]>("agents", () => wazuhFetch("/agents?limit=500"));
}

export function getVulnerabilities(opts?: { agentId?: string; severity?: string }) {
  const params = new URLSearchParams();
  if (opts?.agentId) params.set("agent_id", opts.agentId);
  if (opts?.severity) params.set("severity", opts.severity);
  return cached<WazuhVulnerability[]>(`vulns:${params}`, () =>
    wazuhFetch(`/vulnerability?${params}`));
}

export function getComplianceChecks(opts?: { framework?: string; agentId?: string }) {
  const params = new URLSearchParams();
  if (opts?.framework) params.set("framework", opts.framework);
  if (opts?.agentId) params.set("agent_id", opts.agentId);
  return cached<WazuhComplianceCheck[]>(`compliance:${params}`, () =>
    wazuhFetch(`/sca?${params}`));
}

export function getFimEvents(opts?: { agentId?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (opts?.agentId) params.set("agent_id", opts.agentId);
  params.set("limit", String(opts?.limit ?? 50));
  return cached<WazuhFimEvent[]>(`fim:${params}`, () => wazuhFetch(`/syscheck?${params}`));
}

export function getWazuhStats() {
  return cached<WazuhStats>("stats", () => wazuhFetch("/manager/stats/summary"));
}
