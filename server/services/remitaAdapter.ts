/**
 * Remita payment gateway adapter (gap 12)
 *
 * Adapter pattern: `HttpRemitaGateway` implements the real Remita eChannels
 * RRR contract; `MockRemitaGateway` is a deterministic, offline double that is
 * ONLY available outside production behind an explicit REMITA_MOCK=true flag.
 *
 * ── REMITA CONTRACT (https://remita.net) ─────────────────────────────────────
 *   1. Generate RRR:  POST {base}/echannels-pg/portal/api/v2/rrr/generate
 *      headers:
 *        Content-Type: application/json
 *        Authorization: remitaConsumerKey={merchantId}:remitaConsumerSecret={sha512(merchantId+apiKey+requestId)}
 *      body:   { serviceTypeId, amount, orderId, payerName, payerEmail, payerPhone, description }
 *      reply:  { statuscode: "025", RRR: "...", statusmessage: "...", requestId? }
 *      (025 = RRR generated successfully; 040 = already exists for orderId)
 *   2. Status check:  GET {base}/echannels-pg/portal/api/v2/rrr/status/{rrr}
 *      headers: Authorization: remitaConsumerKey={merchantId}:remitaConsumerSecret={sha512(merchantId+apiKey+rrr)}
 *      reply:  { statuscode: "00"|"01"|..., RRR, amount, transactiontime }
 *      (00 = success/paid; 021 = pending; 012 = expired/invalid)
 *   3. Webhook: Remita POSTs a settlement notification signed with HMAC-SHA512
 *      over the raw body using the API key; verify with verifyGatewaySignature
 *      before acting on it.
 * Store secrets in the platform secret manager, never in env files committed
 * to the repo.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import { logger } from "../logger";

export interface RrrRequest {
  penaltyId: number;
  amount: number;
  currency: string;
  payerEmail?: string;
  description: string;
}

export interface RrrResult {
  rrr: string;
  gatewayRef: string;
  expiresAt: Date;
  signature: string;
}

export interface GatewayStatusResult {
  rrr: string;
  status: "pending" | "paid" | "expired";
  amount: number;
  paidAt?: Date;
}

export interface RemitaGateway {
  generateRRR(req: RrrRequest): Promise<RrrResult>;
  checkStatus(rrr: string): Promise<GatewayStatusResult>;
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const REMITA_SERVICE_TYPE_ID = process.env.REMITA_SERVICE_TYPE_ID;

// FAIL CLOSED: no hardcoded webhook-secret default. When REMITA_WEBHOOK_SECRET
// is unset, signature verification always fails and signing throws, so a
// misconfigured deployment rejects gateway webhooks instead of accepting
// attacker-forged settlements signed with a known dev secret.
const WEBHOOK_SECRET = process.env.REMITA_WEBHOOK_SECRET;

if (!WEBHOOK_SECRET) {
  logger.error(
    "[remita] REMITA_WEBHOOK_SECRET is not configured — gateway webhook verification fails closed (all signatures rejected)",
  );
}

/** HMAC-SHA256 signature over a payload (mock scheme; PROD webhooks use HMAC-SHA512 — see header). */
export function signGatewayPayload(payload: string, secret?: string): string {
  const key = secret ?? WEBHOOK_SECRET;
  if (!key) {
    throw new Error("REMITA_WEBHOOK_SECRET is not configured; refusing to sign gateway payloads");
  }
  return createHmac("sha256", key).update(payload).digest("hex");
}

/** Constant-time verification of a gateway webhook signature. Fails closed when unconfigured. */
export function verifyGatewaySignature(payload: string, signature: string, secret?: string): boolean {
  const key = secret ?? WEBHOOK_SECRET;
  if (!key) {
    logger.error("[remita] REMITA_WEBHOOK_SECRET unset — rejecting webhook signature (fail closed)");
    return false;
  }
  const expected = signGatewayPayload(payload, key);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature ?? "", "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Deterministic mock gateway — TEST/DEV ONLY. The RRR is derived from a
 * SHA-256 hash of the request so repeated generation for the same penalty
 * yields distinct but reproducible codes. No network calls. Instantiated only
 * when REMITA_MOCK=true and NODE_ENV !== 'production'.
 */
export class MockRemitaGateway implements RemitaGateway {
  private requestCounter = 0;

  async generateRRR(req: RrrRequest): Promise<RrrResult> {
    const requestId = `${req.penaltyId}:${Date.now()}:${++this.requestCounter}`;
    // Remita RRRs are 12 digits; derive 12 digits deterministically from the hash.
    const digest = createHash("sha256").update(`ndsep-rrr:${requestId}`).digest("hex");
    let digits = "";
    for (let i = 0; i < digest.length && digits.length < 12; i += 2) {
      digits += String(parseInt(digest.slice(i, i + 2), 16) % 10);
    }
    const rrr = digits.padEnd(12, "0");
    const gatewayRef = `MOCK-${digest.slice(0, 16).toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h validity, per Remita convention
    const signature = signGatewayPayload(`${rrr}|${req.amount}|${req.currency}`);
    logger.warn({ rrr, penaltyId: req.penaltyId, amount: req.amount }, "[remita-mock] RRR generated by MOCK gateway (REMITA_MOCK=true) — no real payment instrument exists");
    return { rrr, gatewayRef, expiresAt, signature };
  }

  async checkStatus(rrr: string): Promise<GatewayStatusResult> {
    // The mock is status-less; the router is the source of truth and overrides
    // this with the payment_rrr_codes row.
    return { rrr, status: "pending", amount: 0 };
  }
}

/** Real Remita eChannels HTTP gateway. */
export class HttpRemitaGateway implements RemitaGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly merchantId: string,
  ) {}

  /** sha512(merchantId + apiKey + requestContext), per the Remita auth scheme. */
  private authHeader(requestContext: string): string {
    const secret = createHash("sha512")
      .update(`${this.merchantId}${this.apiKey}${requestContext}`)
      .digest("hex");
    return `remitaConsumerKey=${this.merchantId}:remitaConsumerSecret=${secret}`;
  }

  async generateRRR(req: RrrRequest): Promise<RrrResult> {
    const requestId = randomUUID();
    const orderId = `NDSEP-PEN-${String(req.penaltyId).padStart(6, "0")}-${requestId.slice(0, 8)}`;
    const res = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}/echannels-pg/portal/api/v2/rrr/generate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.authHeader(requestId),
        },
        body: JSON.stringify({
          serviceTypeId: REMITA_SERVICE_TYPE_ID,
          amount: req.amount,
          orderId,
          payerName: req.description.slice(0, 100),
          payerEmail: req.payerEmail ?? "",
          payerPhone: "",
          description: req.description,
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) {
      throw new Error(`[remita] RRR generation failed: HTTP ${res.status}`);
    }
    const body = (await res.json().catch(() => null)) as
      | { statuscode?: string; RRR?: string; statusmessage?: string }
      | null;
    if (!body || (body.statuscode !== "025" && body.statuscode !== "040") || !body.RRR) {
      throw new Error(
        `[remita] RRR generation rejected: ${body?.statusmessage ?? "malformed response"} (code ${body?.statuscode ?? "?"})`,
      );
    }
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h validity, per Remita convention
    const signature = signGatewayPayload(`${body.RRR}|${req.amount}|${req.currency}`);
    logger.info({ rrr: body.RRR, penaltyId: req.penaltyId, amount: req.amount, orderId }, "[remita] RRR generated");
    return { rrr: body.RRR, gatewayRef: orderId, expiresAt, signature };
  }

  async checkStatus(rrr: string): Promise<GatewayStatusResult> {
    const res = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}/echannels-pg/portal/api/v2/rrr/status/${encodeURIComponent(rrr)}`,
      {
        headers: { Authorization: this.authHeader(rrr) },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) {
      throw new Error(`[remita] status check failed for ${rrr}: HTTP ${res.status}`);
    }
    const body = (await res.json().catch(() => null)) as
      | { statuscode?: string; amount?: string | number; transactiontime?: string }
      | null;
    if (!body) throw new Error(`[remita] status check for ${rrr}: malformed response`);
    const status: GatewayStatusResult["status"] =
      body.statuscode === "00" ? "paid"
      : body.statuscode === "012" ? "expired"
      : "pending";
    return {
      rrr,
      status,
      amount: Number(body.amount ?? 0),
      paidAt: body.transactiontime ? new Date(body.transactiontime) : undefined,
    };
  }
}

let _gateway: RemitaGateway | null = null;

/**
 * Factory.
 *  - REMITA_BASE_URL + REMITA_API_KEY + REMITA_MERCHANT_ID set → real HTTP gateway.
 *  - Otherwise: in production this FAILS LOUD (RRR generation disabled); in
 *    non-production a deterministic mock is available ONLY behind the explicit
 *    REMITA_MOCK=true flag, so a misconfigured deployment can never silently
 *    mint fake payment instruments.
 */
export function getRemitaGateway(): RemitaGateway {
  if (_gateway) return _gateway;
  const baseUrl = process.env.REMITA_BASE_URL;
  if (baseUrl && process.env.REMITA_API_KEY && process.env.REMITA_MERCHANT_ID) {
    _gateway = new HttpRemitaGateway(baseUrl, process.env.REMITA_API_KEY, process.env.REMITA_MERCHANT_ID);
    logger.info("[remita] Using HttpRemitaGateway (production mode)");
    return _gateway;
  }
  if (IS_PRODUCTION) {
    throw new Error(
      "[remita] REMITA_BASE_URL/REMITA_API_KEY/REMITA_MERCHANT_ID are not configured — " +
      "RRR generation is DISABLED in production (no mock fallback).",
    );
  }
  if (process.env.REMITA_MOCK === "true") {
    _gateway = new MockRemitaGateway();
    logger.warn("[remita] Using MockRemitaGateway (REMITA_MOCK=true, non-production only)");
    return _gateway;
  }
  throw new Error(
    "[remita] Remita gateway unconfigured: set REMITA_BASE_URL/REMITA_API_KEY/REMITA_MERCHANT_ID, " +
    "or REMITA_MOCK=true for offline development/testing.",
  );
}

/** Test hook: reset the cached gateway between test cases. */
export function _resetRemitaGatewayForTests(): void {
  _gateway = null;
}
