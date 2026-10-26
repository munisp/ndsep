/**
 * OSIRIS RECON Scanner Client (round 13, W3)
 * ==========================================
 * Infrastructure security posture primitives for registered controllers:
 *   - scanHost(host)        port/service/SSL scan via OSIRIS RECON
 *                           (GET /api/scanner, fallback /api/osint/scan;
 *                           requires the X-Scanner-Key header — env
 *                           OSIRIS_SCANNER_KEY)
 *   - cveForProduct(query)  NVD CVE lookup via /api/osint/cve?id=
 *   - kevFeed()             CISA KEV catalogue via the existing
 *                           cyber-threats feed (server/osirisClient)
 *
 * FAIL-CLOSED contract: without OSIRIS_SCANNER_KEY the scanner returns 503.
 * scanHost therefore short-circuits to status 'unavailable' when the key is
 * absent and maps ANY non-OK/unreachable response to 'unavailable' too. It
 * never fabricates ports, services or certificate data: an unavailable scan
 * carries empty collections plus scannerKeyPresent=false so callers can
 * record the outage instead of a phantom posture.
 *
 * Conventions mirror server/osirisClient.ts: 10s timeout, in-memory TTL
 * cache, graceful null/unavailable degradation. The scanner key is read at
 * call time (not import time) so tests and key rotation behave sanely.
 */
import pino from "pino";
import { getCyberThreats } from "../osirisClient";

const logger = pino({ name: "osiris-scanner-client" });

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min, mirrors osirisClient
const SCAN_TIMEOUT_MS = 15_000; // port scans are slower than feed lookups
const CVE_TIMEOUT_MS = 10_000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface ScannedPort {
  port: number;
  protocol: string; // 'tcp' | 'udp'
  state: string; // 'open' | 'closed' | 'filtered'
  service?: string;
  product?: string;
  version?: string;
}

export interface SslInfo {
  present: boolean;
  valid?: boolean;
  expired?: boolean;
  selfSigned?: boolean;
  issuer?: string;
  subject?: string;
  expiresAt?: string; // ISO
  daysRemaining?: number;
}

export interface HostScanResult {
  host: string;
  status: "ok" | "unavailable";
  scannerKeyPresent: boolean;
  reason?: string; // why unavailable (no key, 503, unreachable, ...)
  ports: ScannedPort[];
  ssl: SslInfo | null;
  scannedAt: string; // ISO
  raw?: unknown; // unparsed payload for evidence (debug)
}

export interface ProductCve {
  cveId: string;
  description?: string;
  severity?: string;
  cvssScore?: number;
  published?: string;
  references: string[];
  query: string; // product/service query that matched
}

export interface KevEntry {
  id: string;
  name?: string;
  vendor?: string;
  product?: string;
}

// ── Env / cache ──────────────────────────────────────────────────────────────

function osirisBase(): string {
  return process.env.OSIRIS_URL ?? "https://osirisai.live";
}

/** Read at call time: key rotation and tests must not require a reload. */
export function scannerKeyPresent(): boolean {
  return Boolean(process.env.OSIRIS_SCANNER_KEY && process.env.OSIRIS_SCANNER_KEY.trim());
}

interface CacheEntry<T> {
  data: T;
  expires: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

function cached<T>(key: string): T | null {
  const e = cache.get(key) as CacheEntry<T> | undefined;
  return e && Date.now() < e.expires ? e.data : null;
}
function setCache<T>(key: string, data: T, ttl = CACHE_TTL_MS): void {
  cache.set(key, { data, expires: Date.now() + ttl });
}
/** Test hook: drop all cached scanner responses. */
export function __clearScannerCache(): void {
  cache.clear();
}

// ── Defensive parsing ────────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (s === "true" || s === "yes") return true;
    if (s === "false" || s === "no") return false;
  }
  return undefined;
}

function parsePort(raw: unknown): ScannedPort | null {
  const r = asRecord(raw);
  if (!r) return null;
  const port = num(r.port ?? r.port_number ?? r.number);
  if (port === undefined || port < 1 || port > 65535) return null;
  return {
    port,
    protocol: str(r.protocol)?.toLowerCase() ?? "tcp",
    state: str(r.state)?.toLowerCase() ?? "open",
    service: str(r.service ?? r.name),
    product: str(r.product),
    version: str(r.version),
  };
}

function parseSsl(raw: unknown): SslInfo | null {
  const r = asRecord(raw);
  if (!r) return null;
  const expiresAt = str(r.expires_at ?? r.expiry ?? r.not_after ?? r.valid_to);
  let daysRemaining = num(r.days_remaining ?? r.days_to_expiry);
  if (daysRemaining === undefined && expiresAt) {
    const t = Date.parse(expiresAt);
    if (!Number.isNaN(t)) daysRemaining = Math.round((t - Date.now()) / 86_400_000);
  }
  const expired = bool(r.expired) ?? (daysRemaining !== undefined ? daysRemaining < 0 : undefined);
  return {
    present: bool(r.present) ?? true,
    valid: bool(r.valid) ?? (expired === undefined ? undefined : !expired),
    expired,
    selfSigned: bool(r.self_signed ?? r.selfSigned),
    issuer: str(r.issuer ?? r.issuer_org),
    subject: str(r.subject ?? r.cn),
    expiresAt,
    daysRemaining,
  };
}

/** Accept several plausible scanner payload shapes; never invent data. */
function parseScanPayload(host: string, payload: unknown, scannerKey: boolean): HostScanResult {
  const root = asRecord(payload) ?? {};
  const portsRaw = Array.isArray(root.ports)
    ? root.ports
    : Array.isArray(root.open_ports)
      ? root.open_ports
      : Array.isArray(root.results)
        ? root.results
        : [];
  const ports = portsRaw.map(parsePort).filter((p): p is ScannedPort => p !== null);
  const ssl = parseSsl(root.ssl ?? root.tls ?? root.certificate);
  return {
    host,
    status: "ok",
    scannerKeyPresent: scannerKey,
    ports,
    ssl,
    scannedAt: str(root.scanned_at ?? root.timestamp) ?? new Date().toISOString(),
    raw: payload,
  };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

async function scannerGet(path: string, params: Record<string, string>, timeoutMs: number): Promise<{ status: number; body: unknown } | null> {
  const url = new URL(path, osirisBase());
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = process.env.OSIRIS_SCANNER_KEY?.trim();
  if (key) headers["X-Scanner-Key"] = key;
  try {
    const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(timeoutMs) });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (e) {
    logger.debug({ err: e instanceof Error ? e.message : String(e), path }, "OSIRIS scanner unreachable");
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Port/service/SSL scan of one host. FAIL-CLOSED: when OSIRIS_SCANNER_KEY is
 * unset the scanner would answer 503, so we return status 'unavailable'
 * without fabricating anything; a real 503/unreachable endpoint degrades the
 * same way. Results are cached per host for CACHE_TTL_MS.
 */
export async function scanHost(host: string): Promise<HostScanResult> {
  const normalizedHost = host.trim().toLowerCase();
  const keyPresent = scannerKeyPresent();
  const unavailable = (reason: string): HostScanResult => ({
    host: normalizedHost,
    status: "unavailable",
    scannerKeyPresent: keyPresent,
    reason,
    ports: [],
    ssl: null,
    scannedAt: new Date().toISOString(),
  });

  if (!normalizedHost) return unavailable("empty host");
  if (!keyPresent) {
    logger.warn({ host: normalizedHost }, "OSIRIS_SCANNER_KEY unset — scanner would 503; failing closed");
    return unavailable("scanner key not configured (OSIRIS_SCANNER_KEY)");
  }

  const cacheKey = `scan:${normalizedHost}`;
  const hit = cached<HostScanResult>(cacheKey);
  if (hit) return hit;

  // Primary endpoint per OSIRIS RECON contract; legacy alias as fallback.
  for (const path of ["/api/scanner", "/api/osint/scan"]) {
    const res = await scannerGet(path, { host: normalizedHost }, SCAN_TIMEOUT_MS);
    if (!res) continue; // unreachable — try the alias
    if (res.status === 503) return unavailable("scanner reported 503 unavailable");
    if (res.status === 401 || res.status === 403) return unavailable(`scanner rejected key (HTTP ${res.status})`);
    if (res.status < 200 || res.status >= 300) {
      logger.warn({ status: res.status, path }, "OSIRIS scanner non-OK response");
      continue;
    }
    const parsed = parseScanPayload(normalizedHost, res.body, keyPresent);
    setCache(cacheKey, parsed);
    return parsed;
  }
  return unavailable("scanner endpoints unreachable");
}

/**
 * NVD CVE lookup for a product/service string (or an explicit CVE id) via
 * /api/osint/cve?id=. Accepts a single object or a list payload; returns []
 * when the feed is unreachable — never fabricated entries.
 */
export async function cveForProduct(query: string): Promise<ProductCve[]> {
  const q = query.trim();
  if (!q) return [];
  const cacheKey = `cve-q:${q.toLowerCase()}`;
  const hit = cached<ProductCve[]>(cacheKey);
  if (hit) return hit;

  const res = await scannerGet("/api/osint/cve", { id: q }, CVE_TIMEOUT_MS);
  if (!res || res.status < 200 || res.status >= 300) return [];

  const root = asRecord(res.body);
  const listRaw: unknown[] = Array.isArray(res.body)
    ? res.body
    : Array.isArray(root?.results)
      ? (root!.results as unknown[])
      : Array.isArray(root?.cves)
        ? (root!.cves as unknown[])
        : root
          ? [root]
          : [];

  const out: ProductCve[] = [];
  for (const item of listRaw) {
    const r = asRecord(item);
    if (!r) continue;
    const cveId = str(r.cve_id ?? r.id ?? r.cveId ?? r.cve);
    if (!cveId) continue;
    out.push({
      cveId,
      description: str(r.description ?? r.summary),
      severity: str(r.severity),
      cvssScore: num(r.cvss_score ?? r.cvss ?? r.cvssScore),
      published: str(r.published ?? r.published_date),
      references: Array.isArray(r.references) ? (r.references as unknown[]).filter((x): x is string => typeof x === "string") : [],
      query: q,
    });
  }
  setCache(cacheKey, out, 60 * 60 * 1000);
  return out;
}

/**
 * CISA KEV catalogue via the existing cyber-threats feed (server/osirisClient
 * getCyberThreats — cached, graceful). Returns [] when the feed is down.
 */
export async function kevFeed(): Promise<KevEntry[]> {
  const data = await getCyberThreats();
  return (data.threats ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    vendor: t.vendor,
    product: t.product,
  }));
}
