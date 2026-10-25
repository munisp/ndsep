/**
 * Public complaint portal — pure domain logic (no DB / no I/O).
 *
 * Extracted from server/routers/publicComplaints.ts so the status machine,
 * reference-code formatting, SLA clock and rate-limit primitives are unit
 * testable in isolation (tests/round8/publicComplaints.test.ts,
 * tests/round9/*).
 */
import { createHash, createHmac } from "crypto";

// ─── Categories (NDPA 2023 complaint typology) ───────────────────────────────
export const COMPLAINT_CATEGORIES = [
  "consent",
  "breach",
  "cross_border",
  "dark_pattern",
  "excessive_collection",
  "minors",
  "other",
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

// ─── Status machine ──────────────────────────────────────────────────────────
export const COMPLAINT_STATUSES = [
  "received",
  "acknowledged",
  "under_review",
  "linked_to_case",
  "resolved",
  "closed",
] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

/**
 * Allowed forward transitions. There is deliberately no backward edge: the
 * complaint lifecycle is one-way (mirrors the audit-trail expectation that a
 * complaint never "un-acknowledges"). Re-opening is modeled as a new
 * complaint referencing the old one, not a status regression.
 */
export const STATUS_TRANSITIONS: Record<ComplaintStatus, readonly ComplaintStatus[]> = {
  received: ["acknowledged"],
  acknowledged: ["under_review"],
  under_review: ["linked_to_case", "resolved"],
  linked_to_case: ["resolved"],
  resolved: ["closed"],
  closed: [],
};

export function canTransition(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return (STATUS_TRANSITIONS[from] ?? []).includes(to);
}

/** Column stamped when a complaint enters a status (null = no stamp). */
export function statusTimestampColumn(status: ComplaintStatus): string | null {
  switch (status) {
    case "received": return "received_at";
    case "acknowledged": return "acknowledged_at";
    case "under_review": return "under_review_at";
    case "linked_to_case": return "linked_at";
    case "resolved": return "resolved_at";
    case "closed": return "closed_at";
    default: return null;
  }
}

// ─── Reference codes ─────────────────────────────────────────────────────────
/** NDPC-CMP-YYYY-NNNNNN — sequence value zero-padded to 6 digits. */
export function formatReferenceCode(seqValue: number, date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const n = String(Math.trunc(seqValue)).padStart(6, "0");
  return `NDPC-CMP-${year}-${n}`;
}

const REFERENCE_CODE_RE = /^NDPC-CMP-\d{4}-\d{6}$/;
export function isValidReferenceCode(code: string): boolean {
  return REFERENCE_CODE_RE.test(code.trim().toUpperCase());
}

// ─── SLA clock (acknowledgement within 72 hours) ────────────────────────────
export const ACK_SLA_HOURS = 72;

export function computeAckSlaDueAt(receivedAt: Date = new Date()): Date {
  return new Date(receivedAt.getTime() + ACK_SLA_HOURS * 60 * 60 * 1000);
}

export type SlaState = "met" | "within_sla" | "breached";

/**
 * Acknowledgement SLA state. A complaint acknowledged before its due time has
 * "met" the SLA; one still unacknowledged is "within_sla" until the due time
 * passes, then "breached".
 */
export function ackSlaState(
  row: { status?: unknown; acknowledged_at?: unknown; ack_sla_due_at?: unknown },
  now: Date = new Date(),
): SlaState {
  const due = new Date(row.ack_sla_due_at as string | Date);
  if (row.acknowledged_at) {
    return new Date(row.acknowledged_at as string | Date) <= due ? "met" : "breached";
  }
  return now <= due ? "within_sla" : "breached";
}

export function slaHoursRemaining(
  row: { ack_sla_due_at?: unknown },
  now: Date = new Date(),
): number {
  return Math.round(((new Date(row.ack_sla_due_at as string | Date).getTime() - now.getTime()) / 3600000) * 10) / 10;
}

// ─── Rate limiting by IP hash ────────────────────────────────────────────────
/**
 * Salted SHA-256 of the client IP. The raw IP is PII and is never persisted;
 * the salted hash is stable per (IP, salt) so the hourly submission cap can
 * be enforced without storing the address itself.
 */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}|${ip.trim()}`).digest("hex");
}

/**
 * Sliding-window check: has this IP hash already hit the per-window cap?
 * `recentCount` = submissions from the hash inside the current window.
 */
export function isRateLimited(recentCount: number, maxPerWindow: number): boolean {
  return recentCount >= maxPerWindow;
}

// ─── Public tracking view ────────────────────────────────────────────────────
/**
 * Fields safe to expose on the public tracking endpoint: lifecycle + SLA
 * only, never complainant identity, officer assignment, case linkage detail
 * or IP hash.
 */
export function toPublicTrackingView<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  return {
    reference_code: row.reference_code,
    category: row.category,
    subject: row.subject,
    status: row.status,
    state: row.state ?? null,
    lga: row.lga ?? null,
    received_at: row.received_at ?? null,
    acknowledged_at: row.acknowledged_at ?? null,
    under_review_at: row.under_review_at ?? null,
    resolved_at: row.resolved_at ?? null,
    closed_at: row.closed_at ?? null,
    ack_sla_due_at: row.ack_sla_due_at ?? null,
    is_anonymous: row.is_anonymous ?? true,
  };
}

// ─── Duplicate merge guard ───────────────────────────────────────────────────
/** A complaint can only absorb merges while it is not itself merged away or closed. */
export function canMergeInto(target: { status: string; merged_into_id: number | null }): boolean {
  return target.merged_into_id == null && target.status !== "closed";
}

export function canBeMerged(source: { status: string; merged_into_id: number | null }): boolean {
  return source.merged_into_id == null && source.status !== "closed";
}

// ─── Round 9: shared pure helpers ────────────────────────────────────────────

// ─── USSD → web category vocabulary mapping ─────────────────────────────────
/**
 * Explicit mapping from the USSD menu vocabulary (ussdStateMachine
 * USSD_CATEGORIES) onto the canonical web vocabulary (COMPLAINT_CATEGORIES,
 * migration 0081 CHECK constraint). Every USSD category MUST map to exactly
 * one web category — there is no pass-through of unmapped values.
 */
export const USSD_TO_WEB_CATEGORY: Record<string, ComplaintCategory> = {
  data_breach: "breach",
  unlawful_processing: "other",
  consent_violation: "consent",
  unauthorized_access: "breach",
  other: "other",
};

/**
 * Map a USSD category to the canonical web category. Returns null when the
 * USSD value is not in the mapping table (caller must NOT fall back to a
 * raw pass-through — reject or map to "other" explicitly).
 */
export function mapUssdCategoryToWeb(ussdCategory: string): ComplaintCategory | null {
  return USSD_TO_WEB_CATEGORY[ussdCategory] ?? null;
}

// ─── Keyed HMAC / hashing ───────────────────────────────────────────────────
/** Keyed HMAC-SHA256 hex digest (pseudonymous lookup keys for PII). */
export function hmacSha256Hex(key: string, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

/** Unkeyed SHA-256 hex digest — only for legacy backfill compatibility. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Resolve a mandatory HMAC key from env. In production (NODE_ENV=production)
 * a missing key FAILS CLOSED (throws). Outside production a loud deterministic
 * dev key derived from `devSeed` is used so dev/test environments keep working
 * without configuration; the dev key is NEVER derived from DATABASE_URL or any
 * other deployment-specific secret material.
 */
export function requireHmacKey(
  envValue: string | undefined | null,
  envName: string,
  opts: { nodeEnv?: string; devSeed?: string } = {},
): { key: string; mode: "env" | "dev-fallback" } {
  const nodeEnv = opts.nodeEnv ?? process.env.NODE_ENV ?? "development";
  if (envValue && envValue.length >= 16) return { key: envValue, mode: "env" };
  if (nodeEnv === "production") {
    throw new Error(`${envName} is not set (or shorter than 16 chars) — refusing to run in production without a dedicated HMAC key.`);
  }
  const devSeed = opts.devSeed ?? "ndsep-dev-only";
  return { key: sha256Hex(`ndsep-dev-hmac:${devSeed}`), mode: "dev-fallback" };
}

// ─── Trusted-proxy-aware client IP extraction ────────────────────────────────
/**
 * Extract the client IP from X-Forwarded-For honouring a trusted proxy count.
 *
 * `trustedProxyCount` = how many proxies sit in front of the app. Each proxy
 * appends the address of the peer IT saw, so the N trusted proxies account
 * for the N rightmost XFF entries... except the last proxy writes the
 * previous proxy's address, not its own: with N trusted proxies the client
 * IP is the entry at index (length - N). With trustedProxyCount = 0 the
 * socket address is authoritative and XFF is ignored (cannot be trusted).
 *
 * An attacker can only prepend fake entries to the LEFT of the chain; taking
 * the entry the outermost trusted proxy attests to makes spoofing require
 * compromising a trusted proxy.
 */
export function extractClientIp(
  headers: Record<string, unknown> | undefined,
  socketIp: string | undefined | null,
  trustedProxyCount: number = 0,
): string {
  const socket = (socketIp ?? "").trim();
  if (trustedProxyCount <= 0) return socket || "unknown";
  const fwd = headers?.["x-forwarded-for"];
  const chain = typeof fwd === "string"
    ? fwd.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (chain.length === 0) return socket || "unknown";
  const idx = chain.length - trustedProxyCount;
  if (idx < 0) {
    // Fewer XFF entries than trusted proxies: the request did not traverse the
    // expected infrastructure — distrust the header entirely.
    return socket || "unknown";
  }
  return chain[idx] || socket || "unknown";
}

/**
 * Mandatory salt for IP-hashing rate limiters. FAILS CLOSED in production
 * when unset (unsalted hashes of IPv4 addresses are trivially dictionary-
 * reversible); outside production a deterministic dev salt is used with the
 * understanding that it must never reach production.
 */
export function ipHashSalt(
  envValue: string | undefined | null = process.env.COMPLAINT_IP_HASH_SALT,
  nodeEnv: string = process.env.NODE_ENV ?? "development",
): string {
  if (envValue && envValue.length >= 8) return envValue;
  if (nodeEnv === "production") {
    throw new Error("COMPLAINT_IP_HASH_SALT is not set — refusing to hash client IPs in production without a dedicated salt.");
  }
  return "ndsep-dev-only-ip-salt";
}

// ─── Non-TOCTOU fixed-window rate-limit helpers (pure) ──────────────────────
/**
 * Fixed-window bucket start for a given instant. The DB counter upsert keys on
 * (limiter_key, window_start); increment-and-check in one atomic statement
 * removes the check-then-act race of SELECT COUNT + INSERT.
 */
export function fixedWindowStart(nowMs: number, windowMs: number): Date {
  return new Date(Math.floor(nowMs / windowMs) * windowMs);
}

/** Counter-based limit check: `countAfterIncrement` is the upsert RETURNING value. */
export function counterExceedsLimit(countAfterIncrement: number, maxPerWindow: number): boolean {
  return countAfterIncrement > maxPerWindow;
}

// ─── SSRF-safe outbound webhook URL validation ──────────────────────────────
export interface UrlValidationResult {
  ok: boolean;
  hostname?: string;
  reason?: string;
}

/** True when `ip` is loopback / RFC1918 / link-local / CGNAT / ULA / unspecified. */
export function isPrivateIpAddress(ip: string): boolean {
  const v4 = ip.trim();
  // IPv6 forms
  const lower = v4.toLowerCase();
  if (lower === "::1" || lower === "::" || lower === "0.0.0.0") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true; // link-local / ULA
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpAddress(mapped[1]);
  const m = v4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false; // not an IP literal — DNS check handles hostnames
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 0) return true; // 0.0.0.0/8
  if (a >= 224) return true; // multicast / reserved
  return false;
}

/**
 * Synchronous validation of an outbound ack/webhook endpoint URL:
 * https only, no userinfo, no IP-literal private hosts, no localhost names.
 * The caller MUST also run assertPublicHostname (DNS resolution check) before
 * dispatching, because a public-looking hostname can resolve to a private IP.
 */
export function validateOutboundUrl(rawUrl: string): UrlValidationResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "unparseable URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "only https:// endpoints are allowed" };
  if (url.username || url.password) return { ok: false, reason: "URL must not contain credentials" };
  const host = url.hostname.toLowerCase();
  if (!host) return { ok: false, reason: "empty hostname" };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "local hostnames are not allowed" };
  }
  const bare = host.replace(/^\[|\]$/g, "");
  if (isPrivateIpAddress(bare)) return { ok: false, reason: "private/loopback/link-local IP literals are not allowed" };
  return { ok: true, hostname: host };
}

export type DnsLookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

/**
 * DNS-resolution half of the SSRF check: resolve the hostname and reject when
 * ANY returned address is private/loopback/link-local (fail closed on DNS
 * errors — a failed resolution must not silently pass).
 */
export async function assertPublicHostname(hostname: string, lookup: DnsLookupFn): Promise<UrlValidationResult> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (isPrivateIpAddress(bare)) return { ok: false, reason: "private IP literal" };
  // If it already parses as a public IP literal, no DNS needed.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare) || bare.includes(":")) return { ok: true, hostname };
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname);
  } catch (err) {
    return { ok: false, reason: `DNS resolution failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!addresses || addresses.length === 0) return { ok: false, reason: "DNS resolution returned no addresses" };
  for (const a of addresses) {
    if (isPrivateIpAddress(a.address)) {
      return { ok: false, reason: `hostname resolves to a private address (${a.address})` };
    }
  }
  return { ok: true, hostname };
}

// ─── DSAR response-clock pause math (verification pending) ──────────────────
export interface ClockPauseInterval {
  pausedAtMs: number;
  resumedAtMs: number | null; // null = still paused
}

/** Total milliseconds the response clock was paused (open interval ends at nowMs). */
export function totalPausedMs(pauses: ClockPauseInterval[], nowMs: number): number {
  let total = 0;
  for (const p of pauses) {
    const end = p.resumedAtMs ?? nowMs;
    if (end > p.pausedAtMs) total += end - p.pausedAtMs;
  }
  return total;
}

/**
 * Effective DSAR response deadline: the original deadline pushed out by every
 * paused interval. When the clock is currently paused the deadline is computed
 * as if the pause ended right now (it can only move further out while paused).
 */
export function effectiveDeadline(baseDeadlineMs: number, pauses: ClockPauseInterval[], nowMs: number): number {
  return baseDeadlineMs + totalPausedMs(pauses, nowMs);
}
