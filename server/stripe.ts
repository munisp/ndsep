/**
 * NDSEP Stripe Integration
 * ========================
 * Stripe client singleton + Checkout session creation for:
 *   1. DPCO invoice payments (one-time)
 *   2. DPCO platform subscription upgrades (recurring monthly)
 *
 * Credentials are injected from the platform (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET).
 * Test card: 4242 4242 4242 4242 (any future date, any CVC)
 */
import Stripe from "stripe";
import { logger } from "./logger";

// ─── Client singleton ─────────────────────────────────────────────────────────
const STRIPE_SECRET_KEY =
  process.env.STRIPE_SECRET_KEY ?? "";

const STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET ?? "";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!STRIPE_SECRET_KEY) {
      throw new Error(
        "STRIPE_SECRET_KEY is not configured. Set it in Settings → Payment."
      );
    }
    _stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2025-03-31.basil",
      typescript: true,
    });
  }
  return _stripe;
}

export { STRIPE_WEBHOOK_SECRET };

// ─── Subscription tier definitions ───────────────────────────────────────────
/**
 * Canonical tier definitions used across the billing system.
 * Amounts are in NGN (zero-decimal currency for Stripe — no kobo subdivision).
 */
export const SUBSCRIPTION_TIERS: Record<
  string,
  {
    name: string;
    amountNGN: number;
    platformFeeRate: number;
    maxClients: number;
    maxAuditsPerMonth: number;
    features: string[];
  }
> = {
  starter: {
    name: "Starter",
    amountNGN: 150_000,
    platformFeeRate: 0.15,
    maxClients: 10,
    maxAuditsPerMonth: 5,
    features: ["invoice_management", "client_portal", "basic_audit_workspace"],
  },
  professional: {
    name: "Professional",
    amountNGN: 450_000,
    platformFeeRate: 0.10,
    maxClients: 50,
    maxAuditsPerMonth: 20,
    features: [
      "invoice_management",
      "client_portal",
      "basic_audit_workspace",
      "ai_gap_analysis",
      "car_narrative_generator",
      "risk_prediction",
      "policy_hub",
      "evidence_vault",
    ],
  },
  enterprise: {
    name: "Enterprise",
    amountNGN: 900_000,
    platformFeeRate: 0.07,
    maxClients: 999,
    maxAuditsPerMonth: 999,
    features: [
      "invoice_management",
      "client_portal",
      "basic_audit_workspace",
      "ai_gap_analysis",
      "car_narrative_generator",
      "risk_prediction",
      "policy_hub",
      "evidence_vault",
      "custom_reporting",
      "api_access",
      "dedicated_support",
      "white_label",
    ],
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────
export interface CreateInvoiceCheckoutParams {
  invoiceId: number;
  invoiceNumber: string;
  clientName: string;
  dpcoOrgName: string;
  serviceType: string;
  totalAmountNGN: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string | null;
}

export interface CreateSubscriptionCheckoutParams {
  dpcoOrgId: number;
  dpcoOrgName: string;
  tier: "starter" | "professional" | "enterprise";
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

// ─── Invoice checkout session ─────────────────────────────────────────────────
export async function createInvoiceCheckoutSession(
  params: CreateInvoiceCheckoutParams
): Promise<CheckoutSessionResult> {
  const stripe = getStripe();

  // NGN is a zero-decimal currency in Stripe — amount = NGN value directly.
  const amount = Math.round(params.totalAmountNGN);

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    customer_email: params.customerEmail ?? undefined,
    line_items: [
      {
        price_data: {
          currency: params.currency.toLowerCase(),
          unit_amount: amount,
          product_data: {
            name: `Invoice ${params.invoiceNumber} — ${params.dpcoOrgName}`,
            description: `${serviceTypeLabel(params.serviceType)} for ${params.clientName}`,
            metadata: {
              invoice_id: params.invoiceId.toString(),
              invoice_number: params.invoiceNumber,
              dpco_org: params.dpcoOrgName,
            },
          },
        },
        quantity: 1,
      },
    ],
    client_reference_id: params.invoiceId.toString(),
    metadata: {
      invoice_id: params.invoiceId.toString(),
      invoice_number: params.invoiceNumber,
      dpco_org: params.dpcoOrgName,
      client_name: params.clientName,
      type: "invoice_payment",
    },
    allow_promotion_codes: false,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }

  logger.info(
    { sessionId: session.id, invoiceId: params.invoiceId },
    "[stripe] Invoice checkout session created"
  );

  return { sessionId: session.id, url: session.url };
}

// ─── Subscription checkout session ───────────────────────────────────────────
export async function createSubscriptionCheckoutSession(
  params: CreateSubscriptionCheckoutParams
): Promise<CheckoutSessionResult> {
  const stripe = getStripe();
  const tierDef = SUBSCRIPTION_TIERS[params.tier];
  if (!tierDef) throw new Error(`Unknown subscription tier: ${params.tier}`);

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "subscription",
    customer_email: params.customerEmail ?? undefined,
    line_items: [
      {
        price_data: {
          currency: "ngn",
          unit_amount: tierDef.amountNGN,
          recurring: { interval: "month" },
          product_data: {
            name: `NDSEP DPCO ${tierDef.name} Plan`,
            description:
              `Monthly DPCO platform subscription — ${tierDef.name} tier. ` +
              `Up to ${tierDef.maxClients === 999 ? "unlimited" : tierDef.maxClients} clients, ` +
              `${tierDef.maxAuditsPerMonth === 999 ? "unlimited" : tierDef.maxAuditsPerMonth} audits/month, ` +
              `${(tierDef.platformFeeRate * 100).toFixed(0)}% platform fee on invoices.`,
            metadata: {
              dpco_org_id: params.dpcoOrgId.toString(),
              tier: params.tier,
            },
          },
        },
        quantity: 1,
      },
    ],
    client_reference_id: `dpco-sub-${params.dpcoOrgId}-${params.tier}`,
    metadata: {
      dpco_org_id: params.dpcoOrgId.toString(),
      dpco_org_name: params.dpcoOrgName,
      tier: params.tier,
      type: "subscription_upgrade",
    },
    subscription_data: {
      metadata: {
        dpco_org_id: params.dpcoOrgId.toString(),
        tier: params.tier,
      },
    },
    allow_promotion_codes: true,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");

  logger.info(
    { sessionId: session.id, dpcoOrgId: params.dpcoOrgId, tier: params.tier },
    "[stripe] Subscription checkout session created"
  );

  return { sessionId: session.id, url: session.url };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function serviceTypeLabel(s: string): string {
  const map: Record<string, string> = {
    compliance_audit: "Compliance Audit",
    dpia_assessment: "DPIA Assessment",
    training_session: "Training Session",
    policy_drafting: "Policy & Contract Drafting",
    dpo_retainer: "DPO Retainer Service",
    retainer_monthly: "Monthly DPO Retainer",
    breach_support: "Breach Incident Support",
    due_diligence: "Due Diligence Assessment",
  };
  return map[s] ?? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
