/**
 * OSIRIS RECON client — evidence gathering for hosting-declaration
 * verification (Round-13 P0.2).
 * ===================================================================
 * Sibling of server/osirisClient.ts (which is NOT modified): that client
 * covers sanctions/threat/conflict feeds; this one covers the RECON
 * toolkit used to independently verify that declared in-Nigeria hosting
 * actually resolves to Nigerian prefixes:
 *
 *   resolveDns(domain)   OSIRIS GET /api/osint/dns?domain=  -> A/AAAA records
 *   ipIntel(ipOrDomain)  OSIRIS GET /api/osint/ip?ip=       -> country, ASN, org, threat flags
 *   sslInspect(domain)   OSIRIS GET /api/osint/ssl?domain=  -> TLS cert summary
 *                        (falls back to a LOCAL TLS handshake when OSIRIS has
 *                        no SSL endpoint — still real evidence, gathered
 *                        directly from the host)
 *
 * FAIL-CLOSED contract:
 *   Every function returns null (never throws, never fabricates) when
 *   evidence cannot be obtained. The verdict layer (server/services/
 *   hostingVerification.ts) maps missing evidence to 'unverified' —
 *   NEVER to a compliant verdict.
 *
 *   The LOCAL DNS fallback (node dns.promises) is used ONLY to obtain
 *   A/AAAA records so the IP-intel step can proceed when the OSIRIS DNS
 *   endpoint is down. Local DNS proves resolution, NOT geography: the
 *   geo/ASN verdict still requires OSIRIS IP-intel or the seeded
 *   Nigerian prefix/ASN tables.
 *
 * Conventions mirror osirisClient.ts: OSIRIS_URL env base URL, optional
 * X-Scanner-Key, 10s AbortSignal timeout, 15min in-memory cache,
 * graceful null on failure.
 */
import dns from "node:dns";
import tls from "node:tls";
import pino from "pino";

const logger = pino({ name: "osiris-recon-client" });

const OSIRIS_URL = process.env.OSIRIS_URL ?? "https://osirisai.live";
const OSIRIS_SCANNER_KEY = process.env.OSIRIS_SCANNER_KEY ?? "";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min, matches osirisClient.ts
const HTTP_TIMEOUT_MS = 10_000;
const TLS_TIMEOUT_MS = 8_000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReconDnsRecord {
  type: string; // 'A' | 'AAAA' | 'CNAME' | ...
  value: string;
  ttl?: number;
}

export interface ReconDnsResult {
  domain: string;
  records: ReconDnsRecord[];
  /** 'osiris' | 'local_dns_fallback' — fallback proves resolution only. */
  source: "osiris" | "local_dns_fallback";
}

export interface ReconIpIntel {
  ip: string;
  country?: string; // ISO-3166 alpha-2, upper-cased
  asn?: number | null;
  org?: string;
  is_vpn?: boolean;
  is_proxy?: boolean;
  is_tor?: boolean;
  threat_score?: number;
  sanctions_alert?: boolean;
  source: "osiris";
}

export interface ReconSslResult {
  domain: string;
  subject?: string;
  issuer?: string;
  valid_from?: string;
  valid_to?: string;
  days_to_expiry?: number;
  expired?: boolean;
  hostname_match?: boolean;
  san?: string[];
  /** 'osiris' | 'local_tls' */
  source: "osiris" | "local_tls";
}

// ── Cache (same shape as osirisClient.ts) ────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cached<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && Date.now() < entry.expires) return entry.data;
  return null;
}

function setCache<T>(key: string, data: T, ttl = CACHE_TTL_MS): void {
  cache.set(key, { data, expires: Date.now() + ttl });
}

/** Test hook: flush the module cache. */
export function __clearReconCache(): void {
  cache.clear();
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
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, path }, "OSIRIS RECON non-OK response");
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    logger.debug(
      { err: e instanceof Error ? e.message : String(e), path },
      "OSIRIS RECON unreachable — degrading gracefully"
    );
    return null;
  }
}

// ── Defensive payload normalisers (schema drift tolerance) ───────────────────

function asRecordArray(payload: unknown): ReconDnsRecord[] {
  // Accept {records:[...]}, {answers:[...]}, or a bare array.
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.records)
      ? (payload as any).records
      : Array.isArray((payload as any)?.answers)
        ? (payload as any).answers
        : [];
  const out: ReconDnsRecord[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const type = String((r as any).type ?? "").toUpperCase();
    const value = String((r as any).value ?? (r as any).data ?? (r as any).address ?? "");
    if (!type || !value) continue;
    out.push({ type, value, ttl: typeof (r as any).ttl === "number" ? (r as any).ttl : undefined });
  }
  return out;
}

function parseAsn(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  const m = String(raw).match(/(\d{1,10})/);
  return m ? parseInt(m[1], 10) : null;
}

// ── Local DNS fallback (A/AAAA only — resolution evidence, NOT geography) ────

async function localDnsFallback(domain: string): Promise<ReconDnsResult | null> {
  const records: ReconDnsRecord[] = [];
  try {
    const a = await dns.promises.resolve4(domain);
    for (const value of a) records.push({ type: "A", value });
  } catch {
    /* ENOTFOUND / ENODATA — fall through to AAAA */
  }
  try {
    const aaaa = await dns.promises.resolve6(domain);
    for (const value of aaaa) records.push({ type: "AAAA", value });
  } catch {
    /* ignore */
  }
  if (!records.length) return null;
  logger.info({ domain, count: records.length }, "OSIRIS DNS down — used local DNS fallback for A/AAAA records only");
  return { domain, records, source: "local_dns_fallback" };
}

// ── resolveDns ───────────────────────────────────────────────────────────────

/**
 * Resolve a domain via OSIRIS DNS recon. When OSIRIS is unreachable, falls
 * back to local node DNS for A/AAAA records ONLY (source is stamped so the
 * verdict layer knows the geo evidence still has to come from elsewhere).
 * Returns null when neither path yields any record.
 */
export async function resolveDns(domain: string): Promise<ReconDnsResult | null> {
  const clean = domain.trim().toLowerCase();
  if (!clean) return null;
  const cacheKey = `recon:dns:${clean}`;
  const hit = cached<ReconDnsResult>(cacheKey);
  if (hit) return hit;

  const payload = await osirisGet<unknown>("/api/osint/dns", { domain: clean });
  const records = asRecordArray(payload);
  if (payload && records.length) {
    const result: ReconDnsResult = { domain: clean, records, source: "osiris" };
    setCache(cacheKey, result);
    return result;
  }

  const fallback = await localDnsFallback(clean);
  if (fallback) setCache(cacheKey, fallback, 5 * 60 * 1000); // shorter TTL for fallback data
  return fallback;
}

// ── ipIntel ──────────────────────────────────────────────────────────────────

/**
 * IP geolocation / ASN / threat intel via OSIRIS. NO local fallback exists
 * for geography — returns null when OSIRIS cannot answer (fail-closed: the
 * caller must treat null as 'unverified', never as domestic).
 */
export async function ipIntel(ipOrDomain: string): Promise<ReconIpIntel | null> {
  const clean = ipOrDomain.trim();
  if (!clean) return null;
  const cacheKey = `recon:ip:${clean}`;
  const hit = cached<ReconIpIntel>(cacheKey);
  if (hit) return hit;

  const payload = await osirisGet<Record<string, unknown>>("/api/osint/ip", { ip: clean });
  if (!payload || typeof payload !== "object") return null;

  const country = typeof payload.country === "string" && payload.country
    ? payload.country.toUpperCase()
    : undefined;
  const result: ReconIpIntel = {
    ip: String(payload.ip ?? clean),
    country,
    asn: parseAsn(payload.asn),
    org: typeof payload.org === "string" ? payload.org : undefined,
    is_vpn: Boolean(payload.is_vpn),
    is_proxy: Boolean(payload.is_proxy),
    is_tor: Boolean(payload.is_tor),
    threat_score: typeof payload.threat_score === "number" ? payload.threat_score : undefined,
    sanctions_alert: Boolean(payload.sanctions_alert),
    source: "osiris",
  };
  setCache(cacheKey, result);
  return result;
}

// ── sslInspect ───────────────────────────────────────────────────────────────

function hostnameMatches(cert: tls.PeerCertificate, domain: string): boolean {
  const san = String(cert.subjectaltname ?? "");
  const names = san
    .split(",")
    .map((s) => s.trim().replace(/^DNS:/i, "").toLowerCase())
    .filter(Boolean);
  const target = domain.toLowerCase();
  return names.some((n) => {
    if (n.startsWith("*.")) {
      const suffix = n.slice(1); // '.example.com'
      return target.endsWith(suffix) && target.indexOf(".") === target.length - suffix.length;
    }
    return n === target;
  });
}

/** Direct TLS handshake inspection — real evidence gathered from the host itself. */
async function localTlsInspect(domain: string): Promise<ReconSslResult | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: ReconSslResult | null) => {
      if (!done) { done = true; resolve(v); }
    };
    try {
      const socket = tls.connect(
        { host: domain, port: 443, servername: domain, rejectUnauthorized: false, timeout: TLS_TIMEOUT_MS },
        () => {
          try {
            const cert = socket.getPeerCertificate();
            socket.end();
            if (!cert || !cert.valid_to) return finish(null);
            const validTo = new Date(cert.valid_to);
            const daysToExpiry = Math.floor((validTo.getTime() - Date.now()) / 86_400_000);
            const san = String(cert.subjectaltname ?? "")
              .split(",").map((s) => s.trim().replace(/^DNS:/i, "")).filter(Boolean);
            finish({
              domain,
              subject: typeof cert.subject === "object" ? (cert.subject as any).CN : String(cert.subject ?? ""),
              issuer: typeof cert.issuer === "object" ? ((cert.issuer as any).O ?? (cert.issuer as any).CN) : String(cert.issuer ?? ""),
              valid_from: cert.valid_from,
              valid_to: cert.valid_to,
              days_to_expiry: daysToExpiry,
              expired: validTo.getTime() < Date.now(),
              hostname_match: hostnameMatches(cert, domain),
              san,
              source: "local_tls",
            });
          } catch {
            finish(null);
          }
        }
      );
      socket.on("timeout", () => { socket.destroy(); finish(null); });
      socket.on("error", () => finish(null));
    } catch {
      finish(null);
    }
  });
}

function normaliseOsirisSsl(payload: Record<string, unknown>, domain: string): ReconSslResult | null {
  // Defensive: accept flat or {certificate:{...}} shapes.
  const cert = (payload.certificate && typeof payload.certificate === "object"
    ? payload.certificate
    : payload) as Record<string, unknown>;
  const validTo = (cert.valid_to ?? cert.not_after ?? cert.expiry) as string | undefined;
  if (!validTo) return null;
  const validToDate = new Date(validTo);
  if (Number.isNaN(validToDate.getTime())) return null;
  const san = Array.isArray(cert.san) ? cert.san.map(String) : Array.isArray(cert.subject_alt_names) ? cert.subject_alt_names.map(String) : undefined;
  return {
    domain,
    subject: typeof cert.subject === "string" ? cert.subject : undefined,
    issuer: typeof cert.issuer === "string" ? cert.issuer : undefined,
    valid_from: (cert.valid_from ?? cert.not_before) as string | undefined,
    valid_to: validTo,
    days_to_expiry: Math.floor((validToDate.getTime() - Date.now()) / 86_400_000),
    expired: typeof cert.expired === "boolean" ? cert.expired : validToDate.getTime() < Date.now(),
    hostname_match: typeof cert.hostname_match === "boolean" ? cert.hostname_match : undefined,
    san,
    source: "osiris",
  };
}

/**
 * TLS certificate inspection. Prefers the OSIRIS SSL endpoint when present;
 * falls back to a direct local TLS handshake (the certificate is fetched
 * from the host itself, so this is genuine evidence, not a stub). Returns
 * null when no certificate evidence can be obtained.
 */
export async function sslInspect(domain: string): Promise<ReconSslResult | null> {
  const clean = domain.trim().toLowerCase();
  if (!clean) return null;
  const cacheKey = `recon:ssl:${clean}`;
  const hit = cached<ReconSslResult>(cacheKey);
  if (hit) return hit;

  const payload = await osirisGet<Record<string, unknown>>("/api/osint/ssl", { domain: clean });
  const fromOsiris = payload ? normaliseOsirisSsl(payload, clean) : null;
  if (fromOsiris) {
    setCache(cacheKey, fromOsiris);
    return fromOsiris;
  }

  const local = await localTlsInspect(clean);
  if (local) setCache(cacheKey, local, 60 * 60 * 1000); // certs rotate slowly
  return local;
}
