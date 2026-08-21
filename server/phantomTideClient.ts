/**
 * NDSEP ↔ Phantom Tide Integration Client
 * =========================================
 * Maritime intelligence: AIS vessel tracking, sanctions screening,
 * anomaly detection, convergence zones — focused on Gulf of Guinea / Niger Delta.
 * Docs: https://github.com/tg12/phantomtide
 */
import pino from "pino";

const logger = pino({ name: "phantom-tide-client" });
const PT_URL = process.env.PHANTOM_TIDE_URL ?? "http://phantomtide:5000";
const PT_API_KEY = process.env.PHANTOM_TIDE_API_KEY ?? "";
const CACHE_TTL_MS = 5 * 60 * 1000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface PtVessel {
  mmsi: string;
  imo?: string;
  name: string;
  callsign?: string;
  type: "cargo" | "tanker" | "fishing" | "military" | "passenger" | "tug" | "other";
  flag: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  destination?: string;
  eta?: string;
  lastUpdate: string;
  sanctioned: boolean;
  riskScore: number;
}

export interface PtSanctionAlert {
  vesselName: string;
  mmsi: string;
  imo?: string;
  flag: string;
  sanctionsList: string;
  reason: string;
  detectedAt: string;
  lat: number;
  lng: number;
  severity: "critical" | "high" | "medium";
}

export interface PtAnomaly {
  id: string;
  type: "ais_gap" | "speed_anomaly" | "route_deviation" | "dark_vessel" | "spoofing" | "sts_transfer";
  vesselName: string;
  mmsi: string;
  lat: number;
  lng: number;
  description: string;
  confidence: number;
  detectedAt: string;
  resolved: boolean;
}

export interface PtConvergenceZone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_nm: number;
  vesselCount: number;
  anomalyCount: number;
  riskLevel: "critical" | "high" | "medium" | "low";
  sources: string[];
  lastUpdated: string;
}

export interface PtPortActivity {
  portName: string;
  lat: number;
  lng: number;
  country: string;
  arrivals24h: number;
  departures24h: number;
  anchorage: number;
  avgDwell_hours: number;
  sanctionedVessels: number;
}

export interface PtMaritimeStats {
  totalVessels: number;
  sanctionedVessels: number;
  activeAnomalies: number;
  convergenceZones: number;
  moniteredPorts: number;
  aisGaps24h: number;
  avgRiskScore: number;
}

// ── Cache ────────────────────────────────────────────────────────────────────

const cache = new Map<string, { data: unknown; ts: number }>();

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return Promise.resolve(hit.data as T);
  return fn().then(d => { cache.set(key, { data: d, ts: Date.now() }); return d; })
    .catch(err => {
      logger.warn({ err: err instanceof Error ? err.message : String(err), key }, "Phantom Tide fetch failed");
      const stale = cache.get(key);
      if (stale) return stale.data as T;
      throw err;
    });
}

async function ptFetch<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { "Accept": "application/json" };
  if (PT_API_KEY) headers["X-API-Key"] = PT_API_KEY;
  const res = await fetch(`${PT_URL}${path}`, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`PhantomTide ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getVessels(opts?: { bbox?: string; type?: string; flagOnly?: string }) {
  const params = new URLSearchParams();
  if (opts?.bbox) params.set("bbox", opts.bbox);
  if (opts?.type) params.set("type", opts.type);
  if (opts?.flagOnly) params.set("flag", opts.flagOnly);
  const qs = params.toString();
  return cached<PtVessel[]>(`vessels:${qs}`, () => ptFetch(`/api/vessels${qs ? `?${qs}` : ""}`));
}

export function getSanctionAlerts() {
  return cached<PtSanctionAlert[]>("sanctions", () => ptFetch("/api/sanctions/alerts"));
}

export function getAnomalies(opts?: { resolved?: boolean }) {
  const params = new URLSearchParams();
  if (opts?.resolved !== undefined) params.set("resolved", String(opts.resolved));
  const qs = params.toString();
  return cached<PtAnomaly[]>(`anomalies:${qs}`, () => ptFetch(`/api/anomalies${qs ? `?${qs}` : ""}`));
}

export function getConvergenceZones() {
  return cached<PtConvergenceZone[]>("convergence", () => ptFetch("/api/convergence-zones"));
}

export function getPortActivity(opts?: { country?: string }) {
  const params = new URLSearchParams();
  if (opts?.country) params.set("country", opts.country);
  const qs = params.toString();
  return cached<PtPortActivity[]>(`ports:${qs}`, () => ptFetch(`/api/ports/activity${qs ? `?${qs}` : ""}`));
}

export function getMaritimeStats() {
  return cached<PtMaritimeStats>("stats", () => ptFetch("/api/stats"));
}

export function lookupVessel(query: string) {
  return ptFetch<PtVessel[]>(`/api/vessels/search?q=${encodeURIComponent(query)}`);
}
