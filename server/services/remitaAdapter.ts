/**
 * Remita-style payment gateway adapter (gap 12)
 *
 * Adapter pattern so a real Remita integration drops in without touching the
 * router: swap `MockRemitaGateway` for `HttpRemitaGateway` by setting
 * REMITA_BASE_URL / REMITA_API_KEY / REMITA_MERCHANT_ID in production.
 *
 * ── PROD INTEGRATION NOTES ──────────────────────────────────────────────────
 * Real Remita flow (https://remita.net):
 *   1. Generate RRR:  POST {base}/echannels-pg/portal/api/v2/rrr/generate
 *      headers: Authorization: remitaConsumerKey={merchantId}:remitaConsumerSecret={sha512(merchantId+apiKey+requestId)}
 *      body: { serviceTypeId, amount, orderId, payerName, payerEmail, payerPhone, description }
 *   2. Status check:  GET {base}/echannels-pg/portal/api/v2/rrr/status/{rrr}
 *      with the same Authorization scheme.
 *   3. Webhook: Remita POSTs a settlement notification signed with HMAC-SHA512
 *      over the raw body using the API key; verify with verifyGatewaySignature
 *      before acting on it.
 * Store secrets in the platform secret manager, never in env files committed
 * to the repo. The mock below is deterministic so tests are reproducible.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createHash, createHmac, timingSafeEqual } from "crypto";
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

/** HMAC-SHA256 signature over a payload (mock scheme; PROD uses HMAC-SHA512 — see header). */
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
 * Deterministic mock gateway: the RRR is derived from a SHA-256 hash of the
 * request so repeated generation for the same penalty yields distinct but
 * reproducible codes (unique suffix from request id). No network calls.
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
    logger.info({ rrr, penaltyId: req.penaltyId, amount: req.amount }, "[remita-mock] RRR generated");
    return { rrr, gatewayRef, expiresAt, signature };
  }

  async checkStatus(rrr: string): Promise<GatewayStatusResult> {
    // The mock is status-less; the router is the source of truth and overrides
    // this with the payment_rrr_codes row. PROD: call Remita status endpoint.
    return { rrr, status: "pending", amount: 0 };
  }
}

/**
 * Real Remita HTTP gateway — intentionally a thin skeleton. Fill in per the
 * PROD INTEGRATION NOTES in the file header, then set REMITA_BASE_URL to
 * activate. Keeping it a class preserves the drop-in adapter contract.
 */
export class HttpRemitaGateway implements RemitaGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly merchantId: string,
  ) {}

  async generateRRR(_req: RrrRequest): Promise<RrrResult> {
    // PROD: POST {baseUrl}/echannels-pg/portal/api/v2/rrr/generate
    // with sha512(merchantId+apiKey+requestId) Authorization header (see header).
    throw new Error(
      `HttpRemitaGateway not configured (base=${this.baseUrl}, merchant=${this.merchantId}). ` +
      `Complete the PROD integration per server/services/remitaAdapter.ts header before enabling REMITA_BASE_URL.`,
    );
  }

  async checkStatus(_rrr: string): Promise<GatewayStatusResult> {
    throw new Error("HttpRemitaGateway not configured — see server/services/remitaAdapter.ts header.");
  }
}

let _gateway: RemitaGateway | null = null;

/** Factory: mock by default; real HTTP gateway when REMITA_BASE_URL is set. */
export function getRemitaGateway(): RemitaGateway {
  if (_gateway) return _gateway;
  const baseUrl = process.env.REMITA_BASE_URL;
  if (baseUrl && process.env.REMITA_API_KEY && process.env.REMITA_MERCHANT_ID) {
    _gateway = new HttpRemitaGateway(baseUrl, process.env.REMITA_API_KEY, process.env.REMITA_MERCHANT_ID);
    logger.info("[remita] Using HttpRemitaGateway (production mode)");
  } else {
    _gateway = new MockRemitaGateway();
    logger.info("[remita] Using MockRemitaGateway (no REMITA_BASE_URL configured)");
  }
  return _gateway;
}
