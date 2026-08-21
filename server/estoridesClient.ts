/**
 * NDSEP ↔ Estorides Integration Client
 * =======================================
 * Palantir-style OSINT: knowledge graph, entity resolution, multi-source
 * correlation, LLM-assisted analysis.
 * Docs: https://github.com/grisuno/estorides
 */
import pino from "pino";

const logger = pino({ name: "estorides-client" });
const ESTORIDES_URL = process.env.ESTORIDES_URL ?? "http://estorides:8080";
const ESTORIDES_API_KEY = process.env.ESTORIDES_API_KEY ?? "";
const CACHE_TTL_MS = 10 * 60 * 1000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface EstoridesEntity {
  id: string;
  type: "person" | "organization" | "location" | "event" | "vessel" | "aircraft" | "ip_address" | "domain" | "email" | "phone" | "crypto_wallet" | "document";
  name: string;
  aliases: string[];
  properties: Record<string, string | number | boolean>;
  sources: string[];
  confidence: number;
  firstSeen: string;
  lastSeen: string;
  tags: string[];
}

export interface EstoridesRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: "owns" | "employs" | "funds" | "controls" | "communicates_with" | "located_at" | "travels_to" | "associated_with" | "member_of" | "alias_of";
  weight: number;
  evidence: string[];
  sources: string[];
  firstSeen: string;
  lastSeen: string;
}

export interface EstoridesGraph {
  entities: EstoridesEntity[];
  relationships: EstoridesRelationship[];
  metadata: { totalEntities: number; totalRelationships: number; queryTimeMs: number };
}

export interface EstoridesSearchResult {
  entity: EstoridesEntity;
  score: number;
  matchedFields: string[];
  relatedCount: number;
}

export interface EstoridesInvestigation {
  id: string;
  title: string;
  description: string;
  status: "active" | "closed" | "archived";
  entityCount: number;
  relationshipCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface EstoridesSource {
  id: string;
  name: string;
  type: "osint" | "comint" | "humint" | "sigint" | "geoint" | "finint" | "cybint";
  status: "active" | "error" | "disabled";
  lastIngested: string;
  entityCount: number;
  reliability: "A" | "B" | "C" | "D" | "E" | "F";
}

export interface EstoridesAnalysis {
  id: string;
  entityId: string;
  type: "risk_assessment" | "network_analysis" | "timeline" | "geospatial" | "financial_flow" | "sentiment";
  summary: string;
  confidence: number;
  findings: Array<{ label: string; value: string; severity?: "critical" | "high" | "medium" | "low" }>;
  generatedAt: string;
  model: string;
}

export interface EstoridesStats {
  totalEntities: number;
  totalRelationships: number;
  activeSources: number;
  activeInvestigations: number;
  entitiesByType: Record<string, number>;
  recentIngestions: number;
  graphDensity: number;
}

// ── Cache ────────────────────────────────────────────────────────────────────

const cache = new Map<string, { data: unknown; ts: number }>();

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return Promise.resolve(hit.data as T);
  return fn().then(d => { cache.set(key, { data: d, ts: Date.now() }); return d; })
    .catch(err => {
      logger.warn({ err: err instanceof Error ? err.message : String(err), key }, "Estorides fetch failed");
      const stale = cache.get(key);
      if (stale) return stale.data as T;
      throw err;
    });
}

async function esFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Accept": "application/json", "Content-Type": "application/json" };
  if (ESTORIDES_API_KEY) headers["X-API-Key"] = ESTORIDES_API_KEY;
  const res = await fetch(`${ESTORIDES_URL}${path}`, { ...opts, headers: { ...headers, ...(opts?.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Estorides ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function searchEntities(query: string, opts?: { type?: string; limit?: number }) {
  const params = new URLSearchParams({ q: query });
  if (opts?.type) params.set("type", opts.type);
  params.set("limit", String(opts?.limit ?? 25));
  return esFetch<EstoridesSearchResult[]>(`/api/entities/search?${params}`);
}

export function getEntity(id: string) {
  return cached<EstoridesEntity>(`entity:${id}`, () => esFetch(`/api/entities/${id}`));
}

export function getEntityGraph(id: string, opts?: { depth?: number }) {
  const depth = opts?.depth ?? 2;
  return cached<EstoridesGraph>(`graph:${id}:${depth}`, () =>
    esFetch(`/api/entities/${id}/graph?depth=${depth}`));
}

export function getInvestigations(opts?: { status?: string }) {
  const params = new URLSearchParams();
  if (opts?.status) params.set("status", opts.status);
  const qs = params.toString();
  return cached<EstoridesInvestigation[]>(`investigations:${qs}`, () =>
    esFetch(`/api/investigations${qs ? `?${qs}` : ""}`));
}

export function getSources() {
  return cached<EstoridesSource[]>("sources", () => esFetch("/api/sources"));
}

export function getEntityAnalysis(entityId: string, type?: string) {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  const qs = params.toString();
  return cached<EstoridesAnalysis[]>(`analysis:${entityId}:${qs}`, () =>
    esFetch(`/api/entities/${entityId}/analysis${qs ? `?${qs}` : ""}`));
}

export function getEstoridesStats() {
  return cached<EstoridesStats>("stats", () => esFetch("/api/stats"));
}

export function resolveEntity(name: string, type?: string) {
  return esFetch<EstoridesSearchResult[]>("/api/entities/resolve", {
    method: "POST",
    body: JSON.stringify({ name, type }),
  });
}
