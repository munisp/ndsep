/**
 * OSIRIS Crypto Wallet Tracing Client (round 13, W3)
 * ==================================================
 * Ransomware / breach-enforcement wallet tracing via OSIRIS, which proxies
 * blockstream.info / Blockscout-style explorers:
 *
 *   traceWallet(address) → { chain, balance, txCount, recentTxs[],
 *                            ofacSanctioned, status }
 *
 * Defensive contract:
 *   - Endpoint assumed at GET {OSIRIS_URL}/api/osint/crypto?address=…; every
 *     plausible payload shape is parsed defensively and unknown fields are
 *     dropped, never invented.
 *   - Unreachable / non-OK → status 'unavailable', empty collections and
 *     ofacSanctioned=false **with unavailable surfaced** so callers must not
 *     present the wallet as cleared (fail-closed on the sanctions flag is
 *     handled by the caller checking status).
 *   - Chain is taken from the response when present, else inferred from the
 *     address format (btc / eth / tron / …) — inference is labelled, not
 *     treated as ground truth.
 *   - 15 min in-memory cache per address; 12s timeout. Mirrors
 *     server/osirisClient.ts conventions.
 */
import pino from "pino";

const logger = pino({ name: "osiris-crypto-client" });

const CACHE_TTL_MS = 15 * 60 * 1000;
const TRACE_TIMEOUT_MS = 12_000;
const MAX_RECENT_TXS = 25;

// ── Types ────────────────────────────────────────────────────────────────────

export interface CryptoTx {
  txid: string;
  timestamp?: string; // ISO
  amount?: number; // native units, as reported
  direction?: "in" | "out" | "unknown";
  counterparty?: string;
}

export interface WalletTraceResult {
  address: string;
  chain: string; // 'bitcoin' | 'ethereum' | 'tron' | … | 'unknown'
  chainInferred: boolean; // true when derived from address format, not the API
  balance: number | null; // native units; null when unknown
  txCount: number | null;
  recentTxs: CryptoTx[];
  ofacSanctioned: boolean;
  status: "ok" | "unavailable";
  reason?: string;
  tracedAt: string; // ISO
}

// ── Address validation / chain inference ─────────────────────────────────────

/** Loose, chain-agnostic wallet address shape (no whitespace, sane length). */
export const WALLET_ADDRESS_RE = /^[a-zA-Z0-9]{20,120}$/;

export function isPlausibleWalletAddress(address: string): boolean {
  return WALLET_ADDRESS_RE.test(address.trim());
}

/** Best-effort chain hint from address format. Labelled inference only. */
export function inferChain(address: string): string {
  const a = address.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return "ethereum";
  if (/^(bc1[a-z0-9]{25,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(a)) return "bitcoin";
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return "tron";
  if (/^ltc1[a-z0-9]{25,60}$|^[LM][a-km-zA-HJ-NP-Z1-9]{26,33}$/.test(a)) return "litecoin";
  if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(a)) return "ripple";
  if (/^addr1[a-z0-9]{50,110}$/.test(a)) return "cardano";
  return "unknown";
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expires: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

function cached<T>(key: string): T | null {
  const e = cache.get(key) as CacheEntry<T> | undefined;
  return e && Date.now() < e.expires ? e.data : null;
}
function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}
/** Test hook. */
export function __clearCryptoCache(): void {
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
function truthy(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return ["true", "yes", "1", "sanctioned", "hit"].includes(v.toLowerCase());
  return false;
}

function parseTx(raw: unknown): CryptoTx | null {
  const r = asRecord(raw);
  if (!r) return null;
  const txid = str(r.txid ?? r.hash ?? r.tx_hash ?? r.transaction_hash);
  if (!txid) return null;
  const ts = num(r.timestamp ?? r.time ?? r.block_time);
  const dirRaw = str(r.direction ?? r.type)?.toLowerCase();
  return {
    txid,
    timestamp: str(r.timestamp_iso ?? r.datetime) ?? (ts !== undefined ? new Date(ts * (ts > 1e12 ? 1 : 1000)).toISOString() : undefined),
    amount: num(r.amount ?? r.value ?? r.amount_native),
    direction: dirRaw === "in" || dirRaw === "incoming" ? "in" : dirRaw === "out" || dirRaw === "outgoing" ? "out" : "unknown",
    counterparty: str(r.counterparty ?? r.to ?? r.from),
  };
}

/** Extract an OFAC/sanctions hit from any of the shapes the proxy may use. */
export function extractOfacFlag(root: Record<string, unknown>): boolean {
  if (truthy(root.ofac_sanctioned ?? root.ofacSanctioned ?? root.ofac)) return true;
  if (truthy(root.sanctioned ?? root.is_sanctioned)) return true;
  const s = asRecord(root.sanctions);
  if (s && (truthy(s.ofac) || truthy(s.hit) || truthy(s.listed) || truthy(s.sanctioned))) return true;
  const labels = root.labels ?? root.tags;
  if (Array.isArray(labels) && labels.some((l) => typeof l === "string" && /ofac|sdn|sanction/i.test(l))) return true;
  return false;
}

function parseTracePayload(address: string, payload: unknown): WalletTraceResult {
  const root = asRecord(payload) ?? {};
  const chainFromApi = str(root.chain ?? root.network ?? root.blockchain)?.toLowerCase();
  const inferred = inferChain(address);
  const txsRaw = Array.isArray(root.recent_txs)
    ? root.recent_txs
    : Array.isArray(root.txs)
      ? root.txs
      : Array.isArray(root.transactions)
        ? root.transactions
        : [];
  const recentTxs = txsRaw.map(parseTx).filter((t): t is CryptoTx => t !== null).slice(0, MAX_RECENT_TXS);
  return {
    address,
    chain: chainFromApi ?? inferred,
    chainInferred: chainFromApi === undefined,
    balance: num(root.balance ?? root.balance_native ?? root.final_balance) ?? null,
    txCount: num(root.tx_count ?? root.txCount ?? root.n_tx ?? root.transaction_count) ?? recentTxs.length,
    recentTxs,
    ofacSanctioned: extractOfacFlag(root),
    status: "ok",
    tracedAt: str(root.traced_at ?? root.timestamp) ?? new Date().toISOString(),
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Trace one wallet address through the OSIRIS crypto OSINT proxy. Never
 * throws for upstream problems: unreachable/non-OK → status 'unavailable'.
 */
export async function traceWallet(address: string): Promise<WalletTraceResult> {
  const a = address.trim();
  const unavailable = (reason: string): WalletTraceResult => ({
    address: a,
    chain: inferChain(a),
    chainInferred: true,
    balance: null,
    txCount: null,
    recentTxs: [],
    ofacSanctioned: false,
    status: "unavailable",
    reason,
    tracedAt: new Date().toISOString(),
  });

  if (!isPlausibleWalletAddress(a)) return unavailable("malformed wallet address");

  const cacheKey = `crypto:${a}`;
  const hit = cached<WalletTraceResult>(cacheKey);
  if (hit) return hit;

  const base = process.env.OSIRIS_URL ?? "https://osirisai.live";
  const url = new URL("/api/osint/crypto", base);
  url.searchParams.set("address", a);
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = process.env.OSIRIS_SCANNER_KEY?.trim();
  if (key) headers["X-Scanner-Key"] = key;

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(TRACE_TIMEOUT_MS) });
  } catch (e) {
    logger.debug({ err: e instanceof Error ? e.message : String(e) }, "OSIRIS crypto endpoint unreachable");
    return unavailable("crypto trace endpoint unreachable");
  }
  if (!res.ok) {
    logger.warn({ status: res.status }, "OSIRIS crypto endpoint non-OK");
    return unavailable(`crypto trace endpoint HTTP ${res.status}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return unavailable("crypto trace endpoint returned non-JSON");
  }
  const parsed = parseTracePayload(a, body);
  setCache(cacheKey, parsed);
  return parsed;
}
