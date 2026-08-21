/**
 * NDSEP ↔ SIGINT Integration Client
 * ====================================
 * Compound threat correlation: aircraft (ADS-B), AIS vessels, seismic (USGS),
 * fires (NASA FIRMS), weather (NOAA), GDELT events, tropical cyclones.
 * Docs: https://github.com/iiTONELOC/sigint
 */
import pino from "pino";

const logger = pino({ name: "sigint-client" });
const SIGINT_URL = process.env.SIGINT_URL ?? "http://sigint:3001";
const SIGINT_API_KEY = process.env.SIGINT_API_KEY ?? "";
const CACHE_TTL_MS = 5 * 60 * 1000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface SigintAircraft {
  hex: string;
  callsign: string;
  lat: number;
  lng: number;
  altitude: number;
  speed: number;
  heading: number;
  squawk?: string;
  type?: string;
  registration?: string;
  operator?: string;
  isMilitary: boolean;
  category: "commercial" | "private" | "military" | "cargo" | "helicopter" | "unknown";
  lastSeen: string;
}

export interface SigintVessel {
  mmsi: string;
  name: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  type: string;
  flag: string;
  lastSeen: string;
}

export interface SigintSeismicEvent {
  id: string;
  magnitude: number;
  depth: number;
  lat: number;
  lng: number;
  place: string;
  time: string;
  tsunami: boolean;
  significance: number;
  status: "reviewed" | "automatic";
}

export interface SigintFireHotspot {
  lat: number;
  lng: number;
  brightness: number;
  confidence: "high" | "nominal" | "low";
  frp: number;
  satellite: string;
  acqDate: string;
  dayNight: "D" | "N";
}

export interface SigintWeatherAlert {
  id: string;
  event: string;
  severity: "extreme" | "severe" | "moderate" | "minor" | "unknown";
  headline: string;
  areaDesc: string;
  onset: string;
  expires: string;
  senderName: string;
}

export interface SigintGdeltEvent {
  id: string;
  sourceUrl: string;
  title: string;
  tone: number;
  goldsteinScale: number;
  numArticles: number;
  eventCode: string;
  actor1Country: string;
  actor2Country: string;
  lat: number;
  lng: number;
  dateAdded: string;
}

export interface SigintCorrelation {
  id: string;
  score: number;
  sources: string[];
  description: string;
  lat: number;
  lng: number;
  radius_km: number;
  createdAt: string;
  events: Array<{ source: string; type: string; id: string; summary: string }>;
}

export interface SigintStats {
  trackedAircraft: number;
  militaryAircraft: number;
  trackedVessels: number;
  seismicEvents24h: number;
  fireHotspots24h: number;
  activeWeatherAlerts: number;
  gdeltEvents24h: number;
  activeCorrelations: number;
}

// ── Cache ────────────────────────────────────────────────────────────────────

const cache = new Map<string, { data: unknown; ts: number }>();

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return Promise.resolve(hit.data as T);
  return fn().then(d => { cache.set(key, { data: d, ts: Date.now() }); return d; })
    .catch(err => {
      logger.warn({ err: err instanceof Error ? err.message : String(err), key }, "SIGINT fetch failed");
      const stale = cache.get(key);
      if (stale) return stale.data as T;
      throw err;
    });
}

async function sigFetch<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { "Accept": "application/json" };
  if (SIGINT_API_KEY) headers["Authorization"] = `Bearer ${SIGINT_API_KEY}`;
  const res = await fetch(`${SIGINT_URL}${path}`, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`SIGINT ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getAircraft(opts?: { bbox?: string; militaryOnly?: boolean }) {
  const params = new URLSearchParams();
  if (opts?.bbox) params.set("bbox", opts.bbox);
  if (opts?.militaryOnly) params.set("military", "true");
  const qs = params.toString();
  return cached<SigintAircraft[]>(`aircraft:${qs}`, () => sigFetch(`/api/aircraft${qs ? `?${qs}` : ""}`));
}

export function getVessels(opts?: { bbox?: string }) {
  const params = new URLSearchParams();
  if (opts?.bbox) params.set("bbox", opts.bbox);
  const qs = params.toString();
  return cached<SigintVessel[]>(`vessels:${qs}`, () => sigFetch(`/api/vessels${qs ? `?${qs}` : ""}`));
}

export function getSeismicEvents(opts?: { minMagnitude?: number }) {
  const min = opts?.minMagnitude ?? 2.5;
  return cached<SigintSeismicEvent[]>(`seismic:${min}`, () => sigFetch(`/api/seismic?min_magnitude=${min}`));
}

export function getFireHotspots(opts?: { bbox?: string }) {
  const params = new URLSearchParams();
  if (opts?.bbox) params.set("bbox", opts.bbox);
  const qs = params.toString();
  return cached<SigintFireHotspot[]>(`fires:${qs}`, () => sigFetch(`/api/fires${qs ? `?${qs}` : ""}`));
}

export function getWeatherAlerts(opts?: { severity?: string }) {
  const params = new URLSearchParams();
  if (opts?.severity) params.set("severity", opts.severity);
  const qs = params.toString();
  return cached<SigintWeatherAlert[]>(`weather:${qs}`, () => sigFetch(`/api/weather/alerts${qs ? `?${qs}` : ""}`));
}

export function getGdeltEvents(opts?: { country?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (opts?.country) params.set("country", opts.country);
  params.set("limit", String(opts?.limit ?? 50));
  return cached<SigintGdeltEvent[]>(`gdelt:${params}`, () => sigFetch(`/api/gdelt?${params}`));
}

export function getCorrelations() {
  return cached<SigintCorrelation[]>("correlations", () => sigFetch("/api/correlations"));
}

export function getSigintStats() {
  return cached<SigintStats>("stats", () => sigFetch("/api/stats"));
}
