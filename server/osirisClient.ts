/**
 * NDSEP ↔ Osiris OSINT Integration Client
 * =========================================
 * Consumes intelligence feeds from Osiris (https://github.com/simplifaisoul/osiris)
 * for enhanced threat awareness, sanctions enrichment, and conflict zone data.
 *
 * Integration points:
 *   - Sanctions/OFAC: Enriches NDSEP banking AML with real-time SDN data
 *   - Cyber Threats: CISA KEV + Shadowserver for NOC threat awareness
 *   - Conflict Zones: Geopolitical risk for cross-border data transfer decisions
 *   - OSINT Tools: DNS, WHOIS, IP intel, CVE lookup for network intelligence
 *
 * All calls are fire-and-forget with graceful degradation and in-memory caching.
 */
import pino from "pino";

const logger = pino({ name: "osiris-client" });

const OSIRIS_URL = process.env.OSIRIS_URL ?? "https://osirisai.live";
const OSIRIS_SCANNER_KEY = process.env.OSIRIS_SCANNER_KEY ?? "";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min cache

// ── Types ────────────────────────────────────────────────────────────────────

export interface OsirisSanctionEntity {
  id: string;
  caption: string;
  schema: "Person" | "Organization" | "Company" | "Vessel" | "Airplane" | "LegalEntity";
  countries: string[];
  identifiers: string[];
  aliases: string[];
  birth_date?: string;
  addresses: string[];
  sanctions_program: string;
  source_url: string;
  first_seen?: string;
  last_seen?: string;
}

export interface OsirisCyberThreat {
  id: string;
  name: string;
  vendor?: string;
  product?: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  date: string;
  due?: string;
  source: string;
}

export interface OsirisConflictZone {
  name: string;
  region: string;
  severity: "active_war" | "high_tension" | "elevated";
  lat: number;
  lng: number;
  countries: string[];
  description: string;
}

export interface OsirisWhoisResult {
  domain: string;
  registrar?: string;
  creation_date?: string;
  expiry_date?: string;
  registrant_org?: string;
  registrant_country?: string;
  nameservers: string[];
  sanctions_alert?: boolean;
}

export interface OsirisDnsResult {
  domain: string;
  records: Array<{ type: string; value: string; ttl?: number }>;
}

export interface OsirisIpIntel {
  ip: string;
  country?: string;
  city?: string;
  asn?: string;
  org?: string;
  is_vpn?: boolean;
  is_proxy?: boolean;
  is_tor?: boolean;
  threat_score?: number;
  sanctions_alert?: boolean;
}

export interface OsirisCveResult {
  cve_id: string;
  description: string;
  severity: string;
  cvss_score?: number;
  published: string;
  references: string[];
  affected_products: string[];
}

export interface OsirisCountryRisk {
  country: string;
  iso_code: string;
  risk_score: number;
  risk_level: "critical" | "high" | "medium" | "low";
  factors: string[];
  conflict_active: boolean;
  sanctions_regime: boolean;
  last_updated: string;
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cached<T>(key: string, ttl = CACHE_TTL_MS): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && Date.now() < entry.expires) return entry.data;
  return null;
}

function setCache<T>(key: string, data: T, ttl = CACHE_TTL_MS): void {
  cache.set(key, { data, expires: Date.now() + ttl });
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

async function osirisGet<T>(path: string, params?: Record<string, string>): Promise<T | null> {
  const url = new URL(path, OSIRIS_URL);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (OSIRIS_SCANNER_KEY) headers["X-Scanner-Key"] = OSIRIS_SCANNER_KEY;

    const res = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, path }, "Osiris API non-OK response");
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    logger.debug({ err: e instanceof Error ? e.message : String(e), path }, "Osiris API unreachable — degrading gracefully");
    return null;
  }
}

// ── Sanctions Search ─────────────────────────────────────────────────────────

export async function searchSanctions(
  query: string,
  opts?: { schema?: string; limit?: number }
): Promise<OsirisSanctionEntity[]> {
  const cacheKey = `sanctions:${query}:${opts?.schema ?? ""}`;
  const hit = cached<OsirisSanctionEntity[]>(cacheKey);
  if (hit) return hit;

  const params: Record<string, string> = { query };
  if (opts?.schema) params.schema = opts.schema;
  if (opts?.limit) params.limit = String(opts.limit);

  const result = await osirisGet<{ results: OsirisSanctionEntity[] }>("/api/osint/sanctions", params);
  const entities = result?.results ?? [];
  setCache(cacheKey, entities);
  return entities;
}

// ── Cyber Threats (CISA KEV + Shadowserver) ──────────────────────────────────

export async function getCyberThreats(): Promise<{
  threats: OsirisCyberThreat[];
  stats: Record<string, unknown>;
}> {
  const cacheKey = "cyber-threats";
  const hit = cached<{ threats: OsirisCyberThreat[]; stats: Record<string, unknown> }>(cacheKey);
  if (hit) return hit;

  const result = await osirisGet<{ threats: OsirisCyberThreat[]; stats: Record<string, unknown> }>("/api/cyber-threats");
  const data = result ?? { threats: [], stats: {} };
  setCache(cacheKey, data);
  return data;
}

// ── Conflict Zones ───────────────────────────────────────────────────────────

const CONFLICT_ZONES: OsirisConflictZone[] = [
  { name: "Ukraine", region: "Eastern Europe", severity: "active_war", lat: 48.38, lng: 31.17, countries: ["UA", "RU"], description: "Russia-Ukraine conflict since Feb 2022" },
  { name: "Gaza", region: "Middle East", severity: "active_war", lat: 31.35, lng: 34.31, countries: ["PS", "IL"], description: "Israel-Gaza conflict escalated Oct 2023" },
  { name: "Sudan", region: "East Africa", severity: "active_war", lat: 15.5, lng: 32.5, countries: ["SD"], description: "RSF-SAF civil war since Apr 2023" },
  { name: "Myanmar", region: "Southeast Asia", severity: "active_war", lat: 19.76, lng: 96.07, countries: ["MM"], description: "Post-coup civil war since 2021" },
  { name: "DRC", region: "Central Africa", severity: "active_war", lat: -1.68, lng: 29.22, countries: ["CD", "RW"], description: "M23 and armed group conflict in eastern DRC" },
  { name: "Yemen", region: "Middle East", severity: "active_war", lat: 15.55, lng: 48.52, countries: ["YE"], description: "Houthi conflict + Red Sea maritime disruption" },
  { name: "Syria", region: "Middle East", severity: "high_tension", lat: 34.8, lng: 38.99, countries: ["SY"], description: "Multi-faction conflict, ISIS remnants" },
  { name: "Lebanon", region: "Middle East", severity: "high_tension", lat: 33.85, lng: 35.86, countries: ["LB"], description: "Hezbollah-Israel border tensions" },
  { name: "Sahel", region: "West Africa", severity: "high_tension", lat: 14.0, lng: 2.0, countries: ["ML", "BF", "NE"], description: "Jihadist insurgency across Sahel states" },
  { name: "Somalia", region: "East Africa", severity: "high_tension", lat: 5.15, lng: 46.2, countries: ["SO"], description: "Al-Shabaab insurgency" },
  { name: "Red Sea", region: "Maritime", severity: "high_tension", lat: 14.5, lng: 42.5, countries: ["YE", "DJ", "ER"], description: "Houthi attacks on commercial shipping" },
  { name: "Taiwan Strait", region: "East Asia", severity: "elevated", lat: 24.0, lng: 119.5, countries: ["TW", "CN"], description: "PRC-Taiwan cross-strait tensions" },
  { name: "Korean DMZ", region: "East Asia", severity: "elevated", lat: 38.0, lng: 127.0, countries: ["KP", "KR"], description: "North-South Korea standoff" },
];

export function getConflictZones(): OsirisConflictZone[] {
  return CONFLICT_ZONES;
}

export function isConflictCountry(isoCode: string): OsirisConflictZone | null {
  const upper = isoCode.toUpperCase();
  return CONFLICT_ZONES.find(z => z.countries.includes(upper)) ?? null;
}

export function getConflictRiskLevel(isoCode: string): "critical" | "high" | "elevated" | "none" {
  const zone = isConflictCountry(isoCode);
  if (!zone) return "none";
  if (zone.severity === "active_war") return "critical";
  if (zone.severity === "high_tension") return "high";
  return "elevated";
}

// ── Country Risk Assessment ──────────────────────────────────────────────────

export async function getCountryRisk(country: string): Promise<OsirisCountryRisk | null> {
  const cacheKey = `country-risk:${country}`;
  const hit = cached<OsirisCountryRisk>(cacheKey, 60 * 60 * 1000);
  if (hit) return hit;

  const result = await osirisGet<OsirisCountryRisk>("/api/country-risk", { country });
  if (result) setCache(cacheKey, result, 60 * 60 * 1000);
  return result;
}

// ── OSINT: WHOIS ─────────────────────────────────────────────────────────────

export async function whoisLookup(domain: string): Promise<OsirisWhoisResult | null> {
  const cacheKey = `whois:${domain}`;
  const hit = cached<OsirisWhoisResult>(cacheKey, 30 * 60 * 1000);
  if (hit) return hit;

  const result = await osirisGet<OsirisWhoisResult>("/api/osint/whois", { domain });
  if (result) setCache(cacheKey, result, 30 * 60 * 1000);
  return result;
}

// ── OSINT: DNS ───────────────────────────────────────────────────────────────

export async function dnsLookup(domain: string): Promise<OsirisDnsResult | null> {
  const cacheKey = `dns:${domain}`;
  const hit = cached<OsirisDnsResult>(cacheKey, 10 * 60 * 1000);
  if (hit) return hit;

  const result = await osirisGet<OsirisDnsResult>("/api/osint/dns", { domain });
  if (result) setCache(cacheKey, result, 10 * 60 * 1000);
  return result;
}

// ── OSINT: IP Intelligence ───────────────────────────────────────────────────

export async function ipIntelLookup(ip: string): Promise<OsirisIpIntel | null> {
  const cacheKey = `ip-intel:${ip}`;
  const hit = cached<OsirisIpIntel>(cacheKey, 30 * 60 * 1000);
  if (hit) return hit;

  const result = await osirisGet<OsirisIpIntel>("/api/osint/ip", { ip });
  if (result) setCache(cacheKey, result, 30 * 60 * 1000);
  return result;
}

// ── OSINT: CVE Lookup ────────────────────────────────────────────────────────

export async function cveLookup(cveId: string): Promise<OsirisCveResult | null> {
  const cacheKey = `cve:${cveId}`;
  const hit = cached<OsirisCveResult>(cacheKey, 60 * 60 * 1000);
  if (hit) return hit;

  const result = await osirisGet<OsirisCveResult>("/api/osint/cve", { id: cveId });
  if (result) setCache(cacheKey, result, 60 * 60 * 1000);
  return result;
}

// ── Aggregate: Enriched Sanctions Check ──────────────────────────────────────

export interface EnrichedSanctionsResult {
  matches: OsirisSanctionEntity[];
  conflictZone: OsirisConflictZone | null;
  riskLevel: "critical" | "high" | "elevated" | "none";
  recommendation: string;
}

export async function enrichedSanctionsCheck(
  name: string,
  countryIso?: string,
): Promise<EnrichedSanctionsResult> {
  const [matches, conflictZone] = await Promise.all([
    searchSanctions(name.length >= 4 ? name : ""),
    Promise.resolve(countryIso ? isConflictCountry(countryIso) : null),
  ]);

  const hasSanctions = matches.length > 0;
  const hasConflict = conflictZone !== null;

  let riskLevel: EnrichedSanctionsResult["riskLevel"] = "none";
  if (hasSanctions && hasConflict) riskLevel = "critical";
  else if (hasSanctions) riskLevel = "high";
  else if (hasConflict) riskLevel = conflictZone!.severity === "active_war" ? "high" : "elevated";

  let recommendation = "No sanctions or conflict zone concerns.";
  if (riskLevel === "critical") recommendation = "BLOCK: Entity matches OFAC SDN and is in an active conflict zone. Escalate to compliance officer immediately.";
  else if (riskLevel === "high" && hasSanctions) recommendation = "BLOCK: Entity matches OFAC SDN sanctions list. Manual review required.";
  else if (riskLevel === "high") recommendation = "FLAG: Entity is in an active war zone. Enhanced due diligence required.";
  else if (riskLevel === "elevated") recommendation = "MONITOR: Entity is in a region with elevated geopolitical tensions.";

  return { matches, conflictZone, riskLevel, recommendation };
}
