/**
 * NDSEP ↔ SOCint Integration Client
 * ===================================
 * Consumes SOCint's unified CTI platform (indicators, detection rules,
 * dark web tracking, case management) for NDSEP's NOC and compliance modules.
 *
 * SOCint replaces OpenCTI + MISP + TheHive + Cortex in a single deployment.
 * Docs: https://github.com/diagonalciso/SOCint
 */
import pino from "pino";

const logger = pino({ name: "socint-client" });

const SOCINT_URL = process.env.SOCINT_URL ?? "http://socint:8000";
const SOCINT_API_KEY = process.env.SOCINT_API_KEY ?? "";
const CACHE_TTL_MS = 10 * 60 * 1000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface SocintIndicator {
  id: string;
  type: "ipv4-addr" | "domain-name" | "url" | "file" | "email-addr" | "mutex" | "registry-key";
  value: string;
  confidence: number;
  tlp: "WHITE" | "GREEN" | "AMBER" | "RED";
  source: string;
  firstSeen: string;
  lastSeen: string;
  tags: string[];
  malwareFamily?: string;
  mitreTechniques: string[];
}

export interface SocintDetectionRule {
  id: string;
  name: string;
  type: "sigma" | "yara" | "snort" | "suricata" | "stix-pattern";
  severity: "critical" | "high" | "medium" | "low" | "informational";
  description: string;
  mitreTactic: string;
  mitreTechnique: string;
  source: string;
  lastUpdated: string;
  enabled: boolean;
}

export interface SocintDarkWebHit {
  id: string;
  source: "tor" | "telegram" | "paste" | "forum";
  title: string;
  snippet: string;
  matchedKeywords: string[];
  url?: string;
  timestamp: string;
  threatLevel: "critical" | "high" | "medium" | "low";
  actorGroup?: string;
}

export interface SocintCase {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  status: "new" | "in_progress" | "resolved" | "closed";
  assignee?: string;
  observableCount: number;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface SocintRansomwareGroup {
  name: string;
  aliases: string[];
  victimCount: number;
  lastActive: string;
  targetSectors: string[];
  targetCountries: string[];
  knownTtps: string[];
}

export interface SocintCveEntry {
  cveId: string;
  description: string;
  cvssScore: number;
  epssScore: number;
  severity: "critical" | "high" | "medium" | "low";
  exploitedInWild: boolean;
  publishedDate: string;
  affectedProducts: string[];
}

export interface SocintConnectorStatus {
  name: string;
  type: "ingest" | "enrichment" | "export";
  status: "active" | "error" | "disabled";
  lastRun: string;
  nextRun: string;
  recordsProcessed: number;
}

// ── Cache ────────────────────────────────────────────────────────────────────

const cache = new Map<string, { data: unknown; ts: number }>();

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return Promise.resolve(hit.data as T);
  return fn().then(d => { cache.set(key, { data: d, ts: Date.now() }); return d; })
    .catch(err => {
      logger.warn({ err: err instanceof Error ? err.message : String(err), key }, "SOCint fetch failed");
      const stale = cache.get(key);
      if (stale) return stale.data as T;
      throw err;
    });
}

async function socintFetch<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { "Accept": "application/json" };
  if (SOCINT_API_KEY) headers["Authorization"] = `Bearer ${SOCINT_API_KEY}`;
  const res = await fetch(`${SOCINT_URL}${path}`, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`SOCint ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getIndicators(opts?: { type?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (opts?.type) params.set("type", opts.type);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return cached<SocintIndicator[]>(`indicators:${qs}`, () =>
    socintFetch(`/api/indicators${qs ? `?${qs}` : ""}`));
}

export function getDetectionRules(opts?: { type?: string; severity?: string }) {
  const params = new URLSearchParams();
  if (opts?.type) params.set("type", opts.type);
  if (opts?.severity) params.set("severity", opts.severity);
  const qs = params.toString();
  return cached<SocintDetectionRule[]>(`rules:${qs}`, () =>
    socintFetch(`/api/detection-rules${qs ? `?${qs}` : ""}`));
}

export function getDarkWebHits(opts?: { limit?: number }) {
  const limit = opts?.limit ?? 50;
  return cached<SocintDarkWebHit[]>(`darkweb:${limit}`, () =>
    socintFetch(`/api/dark-web/hits?limit=${limit}`));
}

export function getCases(opts?: { status?: string }) {
  const params = new URLSearchParams();
  if (opts?.status) params.set("status", opts.status);
  const qs = params.toString();
  return cached<SocintCase[]>(`cases:${qs}`, () =>
    socintFetch(`/api/cases${qs ? `?${qs}` : ""}`));
}

export function getRansomwareGroups() {
  return cached<SocintRansomwareGroup[]>("ransomware", () =>
    socintFetch("/api/ransomware/groups"));
}

export function getCveDatabase(opts?: { severity?: string; exploitedOnly?: boolean }) {
  const params = new URLSearchParams();
  if (opts?.severity) params.set("severity", opts.severity);
  if (opts?.exploitedOnly) params.set("exploited", "true");
  const qs = params.toString();
  return cached<SocintCveEntry[]>(`cves:${qs}`, () =>
    socintFetch(`/api/cves${qs ? `?${qs}` : ""}`));
}

export function getConnectorStatus() {
  return cached<SocintConnectorStatus[]>("connectors", () =>
    socintFetch("/api/connectors/status"));
}

export function searchIndicator(value: string) {
  return socintFetch<SocintIndicator[]>(`/api/indicators/search?q=${encodeURIComponent(value)}`);
}
