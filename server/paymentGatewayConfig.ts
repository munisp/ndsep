import { getConfiguredIntegrationValue, type IntegrationField } from "./integrationSettingsRepository";

export type ConfiguredGatewayProvider = "paystack" | "flutterwave";
export type GatewayActivationStatus = { provider: ConfiguredGatewayProvider | null; callbackUrl: string | null; ready: boolean; reason: string | null };
export type VerifiedGatewayTransaction = { provider: ConfiguredGatewayProvider; providerTransactionId: string; reference: string; amountKobo: number; currency: string; paidAt: string | null };

export class GatewayProviderUnavailableError extends Error {
  constructor(message = "Gateway provider activation is incomplete. Configure the active provider, public HTTPS callback URL, and required provider credentials.") { super(message); }
}
export class GatewayTransactionVerificationError extends Error { constructor(message: string) { super(message); } }

function configured(field: IntegrationField) { return getConfiguredIntegrationValue(field)?.trim() ?? ""; }
function activeProvider(): ConfiguredGatewayProvider | null { const value = configured("PAYMENT_GATEWAY_ACTIVE_PROVIDER").toLowerCase(); return value === "paystack" || value === "flutterwave" ? value : null; }
function publicBaseUrl() {
  const raw = configured("PAYMENT_GATEWAY_PUBLIC_BASE_URL");
  if (!raw) return null;
  try { const url = new URL(raw); if (url.protocol !== "https:" || url.pathname !== "/" && url.pathname !== "") return null; return url.toString().replace(/\/$/, ""); } catch { return null; }
}
function paystackSecret() { return configured("PAYSTACK_SECRET_KEY") || process.env.PAYSTACK_WEBHOOK_SECRET?.trim() || ""; }
function flutterwaveWebhookSecret() { return configured("FLUTTERWAVE_WEBHOOK_SECRET_HASH"); }
function flutterwaveSecret() { return configured("FLUTTERWAVE_SECRET_KEY"); }

export function getGatewayActivationStatus(provider?: ConfiguredGatewayProvider): GatewayActivationStatus {
  const active = activeProvider(); const baseUrl = publicBaseUrl(); const target = provider ?? active;
  if (!target) return { provider: null, callbackUrl: null, ready: false, reason: "Choose paystack or flutterwave as PAYMENT_GATEWAY_ACTIVE_PROVIDER." };
  if (provider && active !== provider) return { provider, callbackUrl: null, ready: false, reason: `The active gateway is ${active ?? "not configured"}, not ${provider}.` };
  if (!baseUrl) return { provider: target, callbackUrl: null, ready: false, reason: "PAYMENT_GATEWAY_PUBLIC_BASE_URL must be a public HTTPS origin with no path." };
  const hasCredentials = target === "paystack" ? Boolean(paystackSecret()) : Boolean(flutterwaveWebhookSecret() && flutterwaveSecret());
  if (!hasCredentials) return { provider: target, callbackUrl: `${baseUrl}/api/gateway-webhooks/${target}`, ready: false, reason: target === "paystack" ? "PAYSTACK_SECRET_KEY is not configured." : "FLUTTERWAVE_WEBHOOK_SECRET_HASH and FLUTTERWAVE_SECRET_KEY are required." };
  return { provider: target, callbackUrl: `${baseUrl}/api/gateway-webhooks/${target}`, ready: true, reason: null };
}

export function getGatewayWebhookSecret(provider: ConfiguredGatewayProvider) {
  const activation = getGatewayActivationStatus(provider);
  if (!activation.ready) throw new GatewayProviderUnavailableError(activation.reason ?? undefined);
  const secret = provider === "paystack" ? paystackSecret() : flutterwaveWebhookSecret();
  if (!secret) throw new GatewayProviderUnavailableError();
  return secret;
}

function asRecord(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new GatewayTransactionVerificationError("The gateway verification response was malformed."); return value as Record<string, unknown>; }
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function finite(value: unknown) { const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN; return Number.isFinite(number) ? number : null; }
async function verifiedJson(url: string, secret: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new GatewayTransactionVerificationError(`Gateway transaction re-verification failed with HTTP ${response.status}.`);
  try { return asRecord(await response.json()); } catch { throw new GatewayTransactionVerificationError("Gateway transaction re-verification did not return valid JSON."); }
}

export async function reverifyGatewayTransaction(input: { provider: ConfiguredGatewayProvider; reference: string; providerTransactionId: string | null; expectedAmountKobo: number; expectedCurrency: "NGN" }): Promise<VerifiedGatewayTransaction> {
  const activation = getGatewayActivationStatus(input.provider);
  if (!activation.ready) throw new GatewayProviderUnavailableError(activation.reason ?? undefined);
  if (input.provider === "paystack") {
    const body = await verifiedJson(`https://api.paystack.co/transaction/verify/${encodeURIComponent(input.reference)}`, paystackSecret());
    const data = asRecord(body.data); const amount = finite(data.amount); const reference = text(data.reference); const currency = text(data.currency); const status = text(data.status); const transactionId = text(data.id);
    if (body.status !== true || status !== "success" || reference !== input.reference || currency !== input.expectedCurrency || amount !== input.expectedAmountKobo || !transactionId) throw new GatewayTransactionVerificationError("Paystack verification did not confirm the expected reference, success status, NGN currency, and exact amount.");
    return { provider: "paystack", providerTransactionId: transactionId, reference, amountKobo: amount, currency, paidAt: text(data.paid_at) ?? text(data.paidAt) };
  }
  if (!input.providerTransactionId) throw new GatewayTransactionVerificationError("Flutterwave webhook did not include a transaction identifier for re-verification.");
  const body = await verifiedJson(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(input.providerTransactionId)}/verify`, flutterwaveSecret());
  const data = asRecord(body.data); const amount = finite(data.amount); const reference = text(data.tx_ref) ?? text(data.reference); const currency = text(data.currency); const status = text(data.status); const transactionId = text(data.id);
  if (body.status !== "success" || status !== "successful" || reference !== input.reference || currency !== input.expectedCurrency || amount === null || Math.round(amount * 100) !== input.expectedAmountKobo || !transactionId) throw new GatewayTransactionVerificationError("Flutterwave verification did not confirm the expected reference, successful status, NGN currency, and exact amount.");
  return { provider: "flutterwave", providerTransactionId: transactionId, reference, amountKobo: Math.round(amount * 100), currency, paidAt: text(data.created_at) };
}
