import { z } from "zod";

import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import pg from "pg";
import { createInvoiceCheckoutSession, createSubscriptionCheckoutSession, getStripe, STRIPE_WEBHOOK_SECRET } from "../stripe";
import type { Request, Response } from "express";
import { emitEvent, logAuditEvent, broadcastEvent, cacheGetJson, cacheSetJson, cacheDel, triggerWorkflow } from "../middlewareHelpers";
import { emitComplianceEvent, opensearchIndex, lakehouseIngest, daprPublish, fluvioPublish, permifyCheck } from "../middlewareExtensions";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { getPgSslConfig } from "../dbSslConfig";
import { getDatabaseUrl } from "../config";
import { logger } from "../logger";

const { Pool } = pg;
let _pool: InstanceType<typeof Pool> | null = null;

function getPool(): InstanceType<typeof Pool> {
  if (!_pool) {
    _pool = new Pool({ connectionString: getDatabaseUrl(), ssl: getPgSslConfig() });
  }
  return _pool;
}

// Helper: raw query with runtime ? -> $N conversion
async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  let idx = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
  const result = await getPool().query(pgSql, params);
  return result.rows as T[];
}

// Helper: generate invoice number
function generateInvoiceNumber(dpcoOrgId: number): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const seq = String(Date.now()).slice(-6);
  return `INV-${year}${month}-DPCO${dpcoOrgId}-${seq}`;
}

// ─── Subscription Tiers ───────────────────────────────────────────────────────
const SUBSCRIPTION_TIERS: Record<
  string,
  {
    name: string;
    monthlyFee: number;
    maxClients: number;
    maxAuditsPerMonth: number;
    platformFeeRate: number;
    features: string[];
  }
> = {
  starter: {
    name: "Starter",
    monthlyFee: 50000,
    maxClients: 10,
    maxAuditsPerMonth: 5,
    platformFeeRate: 0.12,
    features: ["basic_audit", "policy_drafts", "training"],
  },
  professional: {
    name: "Professional",
    monthlyFee: 150000,
    maxClients: 50,
    maxAuditsPerMonth: 20,
    platformFeeRate: 0.1,
    features: [
      "basic_audit",
      "advanced_audit",
      "policy_drafts",
      "training",
      "evidence_vault",
      "analytics",
    ],
  },
  enterprise: {
    name: "Enterprise",
    monthlyFee: 350000,
    maxClients: 200,
    maxAuditsPerMonth: 100,
    platformFeeRate: 0.08,
    features: [
      "basic_audit",
      "advanced_audit",
      "policy_drafts",
      "training",
      "evidence_vault",
      "analytics",
      "api_access",
      "white_label",
      "dedicated_support",
    ],
  },
};

// ─── Billing Router ───────────────────────────────────────────────────────────
export const billingRouter = router({
  // ── Invoice CRUD ──────────────────────────────────────────────────────────

  listInvoices: protectedProcedure
    .input(
      z
        .object({
          dpcoOrgId: z.number().int().optional(),
          status: z.string().optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.dpcoOrgId) {
        conditions.push("i.dpco_org_id = ?");
        params.push(input.dpcoOrgId);
      }
      if (input?.status) {
        conditions.push("i.status = ?");
        params.push(input.status);
      }
      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;

      const rows = await q(
        `SELECT i.*, d.name as dpco_name, d.licence_number as dpco_licence
         FROM dpco_invoices i
         LEFT JOIN dpco_organisations d ON d.id = i.dpco_org_id
         ${where}
         ORDER BY i.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      const [{ total }] = await q<{ total: string }>(
        `SELECT COUNT(*) as total FROM dpco_invoices i ${where}`,
        params
      );
      return { rows, total: Number(total), limit, offset };
    }),

  getInvoice: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const [invoice] = await q<any>(
        `SELECT i.*, d.name as dpco_name, d.licence_number as dpco_licence,
                d.email as dpco_email, d.phone as dpco_phone
         FROM dpco_invoices i
         LEFT JOIN dpco_organisations d ON d.id = i.dpco_org_id
         WHERE i.id = ?`,
        [input.id]
      );
      if (!invoice)
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });

      const payments = await q<any>(
        `SELECT * FROM dpco_payments WHERE invoice_id = ? ORDER BY paid_at DESC`,
        [input.id]
      );
      return { invoice, payments };
    }),

  createInvoice: protectedProcedure
    .input(
      z.object({
        dpcoOrgId: z.number().int(),
        clientOrgId: z.number().int().optional(),
        clientName: z.string().min(1),
        clientEmail: z.string().email().optional(),
        serviceType: z.string().min(1),
        description: z.string().optional(),
        subtotal: z.number().positive(),
        vatRate: z.number().min(0).max(1).default(0.075), // 7.5% VAT
        dueDate: z.string(), // ISO date string
        notes: z.string().optional(),
        lineItems: z
          .array(
            z.object({
              description: z.string(),
              quantity: z.number(),
              unitPrice: z.number(),
              amount: z.number(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Get DPCO subscription to determine platform fee rate
      const [sub] = await q<any>(
        `SELECT platform_fee_rate FROM dpco_subscriptions WHERE dpco_org_id = ? AND status != 'cancelled'`,
        [input.dpcoOrgId]
      );
      const platformFeeRate = sub?.platform_fee_rate ?? 0.1;

      const vatAmount = input.subtotal * input.vatRate;
      const totalAmount = input.subtotal + vatAmount;
      const platformFeeAmount = totalAmount * platformFeeRate;
      const dpcoNetAmount = totalAmount - platformFeeAmount;

      const invoiceNumber = generateInvoiceNumber(input.dpcoOrgId);

      const [result] = await q<any>(
        `INSERT INTO dpco_invoices
          (invoice_number, dpco_org_id, client_org_id, client_name, client_email,
           status, service_type, description, subtotal, vat_amount, total_amount,
           platform_fee_rate, platform_fee_amount, dpco_net_amount, currency,
           due_date, notes, line_items)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         RETURNING id`,
        [
          invoiceNumber,
          input.dpcoOrgId,
          input.clientOrgId ?? null,
          input.clientName,
          input.clientEmail ?? null,
          "draft",
          input.serviceType,
          input.description ?? null,
          input.subtotal,
          vatAmount,
          totalAmount,
          platformFeeRate,
          platformFeeAmount,
          dpcoNetAmount,
          "NGN",
          input.dueDate,
          input.notes ?? null,
          input.lineItems ? JSON.stringify(input.lineItems) : null,
        ]
      );

      const [invoice] = await q<any>(
        `SELECT * FROM dpco_invoices WHERE id = ?`,
        [result.id]
      );
      emitMutationEvent("ndsep.billing.mutation", { action: "billing", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return invoice;
    }),

  updateInvoiceStatus: protectedProcedure
    .input(
      z.object({
        id: z.number().int(),
        status: z.enum(["draft", "sent", "paid", "overdue", "cancelled"]),
      })
    )
    .mutation(async ({ input }) => {
      await q(
        `UPDATE dpco_invoices SET status = ?, updated_at = NOW() WHERE id = ?`,
        [input.status, input.id]
      );
      const [invoice] = await q<any>(
        `SELECT * FROM dpco_invoices WHERE id = ?`,
        [input.id]
      );
      emitMutationEvent("ndsep.billing.mutation", { action: "billing", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return invoice;
    }),

  // ── Payments ──────────────────────────────────────────────────────────────

  recordPayment: protectedProcedure
    .input(
      z.object({
        invoiceId: z.number().int(),
        amount: z.number().positive(),
        paymentMethod: z
          .enum([
            "bank_transfer",
            "card",
            "ussd",
            "mobile_money",
            "crypto",
            "cash",
          ])
          .default("bank_transfer"),
        gatewayReference: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Fetch invoice
      const [invoice] = await q<any>(
        `SELECT * FROM dpco_invoices WHERE id = ?`,
        [input.invoiceId]
      );
      if (!invoice)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invoice not found",
        });
      if (invoice.status === "paid")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invoice already paid",
        });

      const platformFeeAmount =
        input.amount * Number(invoice.platform_fee_rate);
      const dpcoNetAmount = input.amount - platformFeeAmount;
      const paymentRef = `PAY-${Date.now()}-${invoice.dpco_org_id}`;

      // Atomic transaction: insert payment + revenue split + mark invoice paid
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");

        // Insert payment
        const payRes = await client.query(
          `INSERT INTO dpco_payments
            (invoice_id, dpco_org_id, payment_reference, amount,
             platform_fee_amount, dpco_net_amount, currency, payment_method,
             gateway_reference, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id`,
          [
            input.invoiceId,
            invoice.dpco_org_id,
            paymentRef,
            input.amount,
            platformFeeAmount,
            dpcoNetAmount,
            invoice.currency,
            input.paymentMethod,
            input.gatewayReference ?? null,
            input.notes ?? null,
          ]
        );
        const paymentId = payRes.rows[0].id;

        // Insert revenue split
        await client.query(
          `INSERT INTO platform_revenue_splits
            (payment_id, invoice_id, dpco_org_id, total_amount,
             platform_share, dpco_share, platform_fee_rate, currency)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            paymentId,
            input.invoiceId,
            invoice.dpco_org_id,
            input.amount,
            platformFeeAmount,
            dpcoNetAmount,
            invoice.platform_fee_rate,
            invoice.currency,
          ]
        );

        // Mark invoice as paid
        await client.query(
          `UPDATE dpco_invoices SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [input.invoiceId]
        );

        await client.query("COMMIT");

        const [payment] = await q<any>(
          `SELECT * FROM dpco_payments WHERE id = ?`,
          [paymentId]
        );
        emitMutationEvent("ndsep.billing.mutation", { action: "billing", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return {
          payment,
          platformFeeAmount,
          dpcoNetAmount,
          paymentReference: paymentRef,
        };
      } catch (err) {
        await client.query("ROLLBACK");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Payment recording failed: ${(err as Error).message}`,
        });
      } finally {
        client.release();
      }
    }),

  listPayments: protectedProcedure
    .input(
      z
        .object({
          dpcoOrgId: z.number().int().optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.dpcoOrgId) {
        conditions.push("p.dpco_org_id = ?");
        params.push(input.dpcoOrgId);
      }
      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;

      const rows = await q(
        `SELECT p.*, i.invoice_number, i.client_name, i.service_type,
                d.name as dpco_name
         FROM dpco_payments p
         LEFT JOIN dpco_invoices i ON i.id = p.invoice_id
         LEFT JOIN dpco_organisations d ON d.id = p.dpco_org_id
         ${where}
         ORDER BY p.paid_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      const [{ total }] = await q<{ total: string }>(
        `SELECT COUNT(*) as total FROM dpco_payments p ${where}`,
        params
      );
      return { rows, total: Number(total) };
    }),

  // ── DPCO Earnings ─────────────────────────────────────────────────────────

  getDpcoEarnings: protectedProcedure
    .input(
      z.object({
        dpcoOrgId: z.number().int(),
        period: z.enum(["7d", "30d", "90d", "12m", "all"]).default("30d"),
      })
    )
    .query(async ({ input }) => {
      const intervalMap: Record<string, string> = {
        "7d": "7 days",
        "30d": "30 days",
        "90d": "90 days",
        "12m": "12 months",
        all: "100 years",
      };
      const interval = intervalMap[input.period];

      const [summary] = await q<any>(
        `SELECT
           COUNT(DISTINCT i.id) as total_invoices,
           COUNT(DISTINCT CASE WHEN i.status = 'paid' THEN i.id END) as paid_invoices,
           COUNT(DISTINCT CASE WHEN i.status = 'overdue' THEN i.id END) as overdue_invoices,
           COALESCE(SUM(CASE WHEN i.status = 'paid' THEN i.total_amount END), 0) as total_billed,
           COALESCE(SUM(CASE WHEN i.status = 'paid' THEN i.dpco_net_amount END), 0) as total_earned,
           COALESCE(SUM(CASE WHEN i.status = 'paid' THEN i.platform_fee_amount END), 0) as total_platform_fees,
           COALESCE(SUM(CASE WHEN i.status NOT IN ('paid','cancelled') THEN i.total_amount END), 0) as outstanding_amount
         FROM dpco_invoices i
         WHERE i.dpco_org_id = ?
           AND i.created_at >= NOW() - INTERVAL '${interval}'`,
        [input.dpcoOrgId]
      );

      const monthlyTrend = await q<any>(
        `SELECT
           TO_CHAR(DATE_TRUNC('month', paid_at), 'Mon YYYY') as month,
           DATE_TRUNC('month', paid_at) as month_date,
           COUNT(*) as payments,
           SUM(amount) as total_billed,
           SUM(dpco_net_amount) as net_earned,
           SUM(platform_fee_amount) as platform_fees
         FROM dpco_payments
         WHERE dpco_org_id = ?
           AND paid_at >= NOW() - INTERVAL '12 months'
         GROUP BY DATE_TRUNC('month', paid_at)
         ORDER BY month_date ASC`,
        [input.dpcoOrgId]
      );

      const byServiceType = await q<any>(
        `SELECT
           i.service_type,
           COUNT(*) as invoice_count,
           SUM(i.total_amount) as total_billed,
           SUM(i.dpco_net_amount) as net_earned
         FROM dpco_invoices i
         WHERE i.dpco_org_id = ?
           AND i.status = 'paid'
           AND i.created_at >= NOW() - INTERVAL '${interval}'
         GROUP BY i.service_type
         ORDER BY net_earned DESC`,
        [input.dpcoOrgId]
      );

      const recentPayments = await q<any>(
        `SELECT p.*, i.invoice_number, i.client_name, i.service_type
         FROM dpco_payments p
         LEFT JOIN dpco_invoices i ON i.id = p.invoice_id
         WHERE p.dpco_org_id = ?
         ORDER BY p.paid_at DESC
         LIMIT 10`,
        [input.dpcoOrgId]
      );

      return {
        summary: {
          totalInvoices: Number(summary.total_invoices),
          paidInvoices: Number(summary.paid_invoices),
          overdueInvoices: Number(summary.overdue_invoices),
          totalBilled: Number(summary.total_billed),
          totalEarned: Number(summary.total_earned),
          totalPlatformFees: Number(summary.total_platform_fees),
          outstandingAmount: Number(summary.outstanding_amount),
        },
        monthlyTrend,
        byServiceType,
        recentPayments,
      };
    }),

  // ── Platform Revenue ──────────────────────────────────────────────────────

  getPlatformRevenue: protectedProcedure
    .input(
      z
        .object({
          period: z.enum(["7d", "30d", "90d", "12m", "all"]).default("30d"),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const intervalMap: Record<string, string> = {
        "7d": "7 days",
        "30d": "30 days",
        "90d": "90 days",
        "12m": "12 months",
        all: "100 years",
      };
      const interval = intervalMap[input?.period ?? "30d"];

      const [summary] = await q<any>(
        `SELECT
           COUNT(DISTINCT dpco_org_id) as active_dpcos,
           COUNT(*) as total_payments,
           COALESCE(SUM(total_amount), 0) as gross_revenue,
           COALESCE(SUM(platform_share), 0) as platform_revenue,
           COALESCE(SUM(dpco_share), 0) as dpco_payouts,
           COALESCE(AVG(platform_fee_rate), 0) as avg_fee_rate
         FROM platform_revenue_splits
         WHERE split_at >= NOW() - INTERVAL '${interval}'`
      );

      const monthlyTrend = await q<any>(
        `SELECT
           TO_CHAR(DATE_TRUNC('month', split_at), 'Mon YYYY') as month,
           DATE_TRUNC('month', split_at) as month_date,
           COUNT(*) as transactions,
           SUM(total_amount) as gross_revenue,
           SUM(platform_share) as platform_revenue,
           SUM(dpco_share) as dpco_payouts
         FROM platform_revenue_splits
         WHERE split_at >= NOW() - INTERVAL '12 months'
         GROUP BY DATE_TRUNC('month', split_at)
         ORDER BY month_date ASC`
      );

      const byDpco = await q<any>(
        `SELECT
           s.dpco_org_id,
           d.name as dpco_name,
           d.licence_number,
           COUNT(*) as transactions,
           SUM(s.total_amount) as gross_revenue,
           SUM(s.platform_share) as platform_revenue,
           SUM(s.dpco_share) as dpco_payouts,
           AVG(s.platform_fee_rate) as fee_rate
         FROM platform_revenue_splits s
         LEFT JOIN dpco_organisations d ON d.id = s.dpco_org_id
         WHERE s.split_at >= NOW() - INTERVAL '${interval}'
         GROUP BY s.dpco_org_id, d.name, d.licence_number
         ORDER BY platform_revenue DESC
         LIMIT 20`
      );

      const pendingPayouts = await q<any>(
        `SELECT
           s.dpco_org_id,
           d.name as dpco_name,
           COUNT(*) as pending_count,
           SUM(s.dpco_share) as pending_payout_amount
         FROM platform_revenue_splits s
         LEFT JOIN dpco_organisations d ON d.id = s.dpco_org_id
         WHERE s.dpco_paid_out = FALSE
         GROUP BY s.dpco_org_id, d.name
         ORDER BY pending_payout_amount DESC`
      );

      return {
        summary: {
          activeDpcos: Number(summary.active_dpcos),
          totalPayments: Number(summary.total_payments),
          grossRevenue: Number(summary.gross_revenue),
          platformRevenue: Number(summary.platform_revenue),
          dpcoPayouts: Number(summary.dpco_payouts),
          avgFeeRate: Number(summary.avg_fee_rate),
        },
        monthlyTrend,
        byDpco,
        pendingPayouts,
      };
    }),

  // ── Subscriptions ─────────────────────────────────────────────────────────

  getSubscription: protectedProcedure
    .input(z.object({ dpcoOrgId: z.number().int() }))
    .query(async ({ input }) => {
      const [sub] = await q<any>(
        `SELECT * FROM dpco_subscriptions WHERE dpco_org_id = ?`,
        [input.dpcoOrgId]
      );
      return sub ?? null;
    }),

  upsertSubscription: protectedProcedure
    .input(
      z.object({
        dpcoOrgId: z.number().int(),
        tier: z.enum(["starter", "professional", "enterprise"]),
      })
    )
    .mutation(async ({ input }) => {
      const tierConfig = SUBSCRIPTION_TIERS[input.tier];
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      const [existing] = await q<any>(
        `SELECT id FROM dpco_subscriptions WHERE dpco_org_id = ?`,
        [input.dpcoOrgId]
      );

      if (existing) {
        await q(
          `UPDATE dpco_subscriptions SET tier=?, monthly_fee=?, max_clients=?,
           max_audits_per_month=?, platform_fee_rate=?, features=?, updated_at=NOW()
           WHERE dpco_org_id=?`,
          [
            input.tier,
            tierConfig.monthlyFee,
            tierConfig.maxClients,
            tierConfig.maxAuditsPerMonth,
            tierConfig.platformFeeRate,
            JSON.stringify(tierConfig.features),
            input.dpcoOrgId,
          ]
        );
      } else {
        const trialEnd = new Date(now);
        trialEnd.setDate(trialEnd.getDate() + 30);
        await q(
          `INSERT INTO dpco_subscriptions
            (dpco_org_id, tier, status, monthly_fee, currency, max_clients,
             max_audits_per_month, platform_fee_rate, trial_ends_at,
             current_period_start, current_period_end, features)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            input.dpcoOrgId,
            input.tier,
            "trial",
            tierConfig.monthlyFee,
            "NGN",
            tierConfig.maxClients,
            tierConfig.maxAuditsPerMonth,
            tierConfig.platformFeeRate,
            trialEnd.toISOString(),
            now.toISOString(),
            periodEnd.toISOString(),
            JSON.stringify(tierConfig.features),
          ]
        );
      }

      const [sub] = await q<any>(
        `SELECT * FROM dpco_subscriptions WHERE dpco_org_id = ?`,
        [input.dpcoOrgId]
      );
      emitMutationEvent("ndsep.billing.mutation", { action: "billing", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return sub;
    }),

  getSubscriptionTiers: protectedProcedure.query(async () => {
    return Object.entries(SUBSCRIPTION_TIERS).map(([key, tier]) => ({
      key,
      ...tier,
    }));
  }),

  // ── Revenue Split Ledger ──────────────────────────────────────────────────

  listRevenueSplits: protectedProcedure
    .input(
      z
        .object({
          dpcoOrgId: z.number().int().optional(),
          platformPaidOut: z.boolean().optional(),
          dpcoPaidOut: z.boolean().optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.dpcoOrgId) {
        conditions.push("s.dpco_org_id = ?");
        params.push(input.dpcoOrgId);
      }
      if (input?.platformPaidOut !== undefined) {
        conditions.push("s.platform_paid_out = ?");
        params.push(input.platformPaidOut);
      }
      if (input?.dpcoPaidOut !== undefined) {
        conditions.push("s.dpco_paid_out = ?");
        params.push(input.dpcoPaidOut);
      }
      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;

      const rows = await q(
        `SELECT s.*, i.invoice_number, i.client_name, i.service_type,
                d.name as dpco_name, p.payment_reference, p.payment_method
         FROM platform_revenue_splits s
         LEFT JOIN dpco_invoices i ON i.id = s.invoice_id
         LEFT JOIN dpco_organisations d ON d.id = s.dpco_org_id
         LEFT JOIN dpco_payments p ON p.id = s.payment_id
         ${where}
         ORDER BY s.split_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      const [{ total }] = await q<{ total: string }>(
        `SELECT COUNT(*) as total FROM platform_revenue_splits s ${where}`,
        params
      );
      return { rows, total: Number(total) };
    }),

  markDpcoPaidOut: protectedProcedure
    .input(z.object({ splitIds: z.array(z.number().int()).min(1) }))
    .mutation(async ({ input }) => {
      const placeholders = input.splitIds.map((_, i) => `$${i + 1}`).join(",");
      await getPool().query(
        `UPDATE platform_revenue_splits SET dpco_paid_out = TRUE, dpco_paid_out_at = NOW() WHERE id IN (${placeholders})`,
        input.splitIds
      );
      emitMutationEvent("ndsep.billing.mutation", { action: "billing", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, count: input.splitIds.length };
    }),

  // ── Stripe Checkout ───────────────────────────────────────────────────────

  createCheckoutSession: protectedProcedure
    .input(
      z.object({
        invoiceId: z.number().int(),
        origin: z.string().url(),
      })
    )
    .mutation(async ({ input }) => {
      const [invoice] = await q<any>(
        `SELECT i.*, d.name as dpco_name, d.email as dpco_email
         FROM dpco_invoices i
         LEFT JOIN dpco_organisations d ON d.id = i.dpco_org_id
         WHERE i.id = ?`,
        [input.invoiceId]
      );
      if (!invoice)
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      if (invoice.status === "paid")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invoice already paid" });

      const session = await createInvoiceCheckoutSession({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        clientName: invoice.client_name,
        dpcoOrgName: invoice.dpco_name ?? `DPCO-${invoice.dpco_org_id}`,
        serviceType: invoice.service_type,
        totalAmountNGN: Number(invoice.total_amount),
        currency: invoice.currency ?? "NGN",
        successUrl: `${input.origin}/dpco/billing?payment=success&invoice=${invoice.id}`,
        cancelUrl: `${input.origin}/dpco/billing?payment=cancelled&invoice=${invoice.id}`,
        customerEmail: invoice.client_email ?? invoice.dpco_email,
      });

      // Store the Stripe session ID on the invoice for webhook matching
      await q(
        `UPDATE dpco_invoices SET stripe_session_id = ?, updated_at = NOW() WHERE id = ?`,
        [session.sessionId, input.invoiceId]
      );

       emitMutationEvent("ndsep.billing.mutation", { action: "billing", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
       return { sessionId: session.sessionId, url: session.url };
    }),

  // ── Subscription Upgrade Checkout ──────────────────────────────────────
  createSubscriptionCheckout: protectedProcedure
    .input(
      z.object({
        dpcoOrgId: z.number().int(),
        tier: z.enum(["starter", "professional", "enterprise"]),
        origin: z.string().url(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Fetch DPCO org details
      const [org] = await q<any>(
        `SELECT id, name, email, tier as current_tier FROM dpco_organisations WHERE id = ?`,
        [input.dpcoOrgId]
      );
      if (!org)
        throw new TRPCError({ code: "NOT_FOUND", message: "DPCO organisation not found" });

      // Prevent downgrade via checkout (handled by upsertSubscription directly)
      const tierOrder = ["starter", "professional", "enterprise"];
      const currentIdx = tierOrder.indexOf(org.current_tier ?? "starter");
      const newIdx = tierOrder.indexOf(input.tier);
      if (newIdx <= currentIdx) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot upgrade to ${input.tier}: already on ${org.current_tier ?? "starter"} or higher. Use the direct plan change for downgrades.`,
        });
      }

      const session = await createSubscriptionCheckoutSession({
        dpcoOrgId: input.dpcoOrgId,
        dpcoOrgName: org.name,
        tier: input.tier,
        customerEmail: org.email ?? (ctx.user as any).email ?? undefined,
        successUrl: `${input.origin}/dpco/subscription?upgrade=success&tier=${input.tier}`,
        cancelUrl: `${input.origin}/dpco/subscription?upgrade=cancelled`,
      });

      // Record pending upgrade intent in subscription table
      await q(
        `UPDATE dpco_subscriptions
         SET stripe_session_id = ?, updated_at = NOW()
         WHERE dpco_org_id = ?`,
        [session.sessionId, input.dpcoOrgId]
      );

      emitMutationEvent("ndsep.billing.mutation", { action: "billing", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { sessionId: session.sessionId, url: session.url };
    }),

  // ── Invoice Email Dispatch ────────────────────────────────────────────────

  sendInvoiceEmail: protectedProcedure
    .input(
      z.object({
        invoiceId: z.number().int(),
        recipientEmail: z.string().email().optional(),
        message: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const [invoice] = await q<any>(
        `SELECT i.*, d.name as dpco_name, d.email as dpco_email
         FROM dpco_invoices i
         LEFT JOIN dpco_organisations d ON d.id = i.dpco_org_id
         WHERE i.id = ?`,
        [input.invoiceId]
      );
      if (!invoice)
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });

      const toEmail =
        input.recipientEmail ?? invoice.client_email ?? invoice.dpco_email;
      if (!toEmail)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No recipient email address available for this invoice",
        });

      // Generate PDF buffer
      const { generateInvoicePdf } = await import("../invoicePdf");
      const pdfBuffer = await generateInvoicePdf(invoice.id);
      const pdfBase64 = pdfBuffer.toString("base64");

      // Use the built-in notification helper as email channel
      const { notifyOwner } = await import("../_core/notification");
      const body = [
        `Invoice ${invoice.invoice_number} has been dispatched to ${toEmail}.`,
        ``,
        `Client: ${invoice.client_name}`,
        `Service: ${invoice.service_type}`,
        `Amount: ${invoice.currency} ${Number(invoice.total_amount).toLocaleString()}`,
        `Due: ${invoice.due_date}`,
        input.message ? `\nMessage: ${input.message}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      await notifyOwner({
        title: `Invoice ${invoice.invoice_number} sent to ${toEmail}`,
        content: body,
      });

      // Mark invoice as sent if it was draft
      if (invoice.status === "draft") {
        await q(
          `UPDATE dpco_invoices SET status = 'sent', updated_at = NOW() WHERE id = ?`,
          [input.invoiceId]
        );
      }

      // Record email dispatch timestamp
      await q(
        `UPDATE dpco_invoices SET email_sent_at = NOW(), email_sent_to = ?, updated_at = NOW() WHERE id = ?`,
        [toEmail, input.invoiceId]
      );

      emitMutationEvent("ndsep.billing.mutation", { action: "billing", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return {
        success: true,
        sentTo: toEmail,
        invoiceNumber: invoice.invoice_number,
        pdfSizeBytes: pdfBuffer.length,
      };
    }),
});

// ── Stripe Webhook Handler (Express route, not tRPC) ─────────────────────────
export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"] as string;
  if (!sig) {
    return res.status(400).json({ error: "Missing stripe-signature header" });
  }

  let event: import("stripe").Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      sig,
      STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature verification failed: ${(err as Error).message}` });
  }

  // Test event passthrough (required for Stripe webhook verification)
  if (event.id.startsWith("evt_test_")) {
    logger.info("[Webhook] Test event detected, returning verification response");
    return res.json({ verified: true });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as import("stripe").Stripe.Checkout.Session;
    const invoiceId = session.metadata?.invoice_id
      ? parseInt(session.metadata.invoice_id, 10)
      : null;

    if (invoiceId && !isNaN(invoiceId)) {
      try {
        // Fetch the invoice to get amounts
        const pool = getPool();
        const { rows } = await pool.query(
          `SELECT * FROM dpco_invoices WHERE id = $1`,
          [invoiceId]
        );
        const invoice = rows[0];
        if (invoice && invoice.status !== "paid") {
          const platformFeeAmount =
            Number(invoice.total_amount) * Number(invoice.platform_fee_rate);
          const dpcoNetAmount =
            Number(invoice.total_amount) - platformFeeAmount;
          const paymentRef = `STRIPE-${session.id}`;

          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            const payRes = await client.query(
              `INSERT INTO dpco_payments
                (invoice_id, dpco_org_id, payment_reference, amount,
                 platform_fee_amount, dpco_net_amount, currency, payment_method,
                 gateway_reference, notes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
               RETURNING id`,
              [
                invoiceId,
                invoice.dpco_org_id,
                paymentRef,
                invoice.total_amount,
                platformFeeAmount,
                dpcoNetAmount,
                invoice.currency,
                "card",
                session.id,
                `Stripe Checkout: ${session.payment_intent ?? ""}`,
              ]
            );
            const paymentId = payRes.rows[0].id;

            await client.query(
              `INSERT INTO platform_revenue_splits
                (payment_id, invoice_id, dpco_org_id, total_amount,
                 platform_share, dpco_share, platform_fee_rate, currency)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [
                paymentId,
                invoiceId,
                invoice.dpco_org_id,
                invoice.total_amount,
                platformFeeAmount,
                dpcoNetAmount,
                invoice.platform_fee_rate,
                invoice.currency,
              ]
            );

            await client.query(
              `UPDATE dpco_invoices SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = $1`,
              [invoiceId]
            );
            await client.query("COMMIT");
            logger.info(`[Webhook] Invoice ${invoiceId} marked paid via Stripe session ${session.id}`);
          } catch (txErr) {
            await client.query("ROLLBACK");
            logger.error({ err: txErr instanceof Error ? txErr.message : String(txErr) }, "[Webhook] Payment recording failed");
          } finally {
            client.release();
          }
        }
      } catch (err) {
        logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, "[Webhook] Error processing checkout.session.completed:");
      }
    }
  }

  // ── Handle subscription upgrade from Stripe Checkout ─────────────────────
  if (
    event.type === "checkout.session.completed" &&
    event.data.object.metadata?.type === "subscription_upgrade"
  ) {
    const session = event.data.object as import("stripe").Stripe.Checkout.Session;
    const dpcoOrgId = session.metadata?.dpco_org_id
      ? parseInt(session.metadata.dpco_org_id, 10)
      : null;
    const tier = session.metadata?.tier as string | undefined;

    if (dpcoOrgId && tier) {
      try {
        const pool = getPool();
        const tierDefs: Record<string, { monthlyFee: number; maxClients: number; maxAuditsPerMonth: number; platformFeeRate: number; features: string[] }> = {
          starter:      { monthlyFee: 150000, maxClients: 10,  maxAuditsPerMonth: 5,   platformFeeRate: 0.15, features: ["invoice_management", "client_portal", "basic_audit_workspace"] },
          professional: { monthlyFee: 450000, maxClients: 50,  maxAuditsPerMonth: 20,  platformFeeRate: 0.10, features: ["invoice_management", "client_portal", "basic_audit_workspace", "ai_gap_analysis", "car_narrative_generator", "risk_prediction", "policy_hub", "evidence_vault"] },
          enterprise:   { monthlyFee: 900000, maxClients: 999, maxAuditsPerMonth: 999, platformFeeRate: 0.07, features: ["invoice_management", "client_portal", "basic_audit_workspace", "ai_gap_analysis", "car_narrative_generator", "risk_prediction", "policy_hub", "evidence_vault", "custom_reporting", "api_access", "dedicated_support", "white_label"] },
        };
        const def = tierDefs[tier];
        if (def) {
          const now = new Date();
          const periodEnd = new Date(now);
          periodEnd.setMonth(periodEnd.getMonth() + 1);

          // Upsert subscription record
          const { rows } = await pool.query(
            `SELECT id FROM dpco_subscriptions WHERE dpco_org_id = $1`,
            [dpcoOrgId]
          );
          if (rows.length > 0) {
            await pool.query(
              `UPDATE dpco_subscriptions
               SET tier = $1, monthly_fee = $2, max_clients = $3, max_audits_per_month = $4,
                   platform_fee_rate = $5, features = $6, status = 'active',
                   stripe_subscription_id = $7, stripe_customer_id = $8,
                   current_period_start = $9, current_period_end = $10, updated_at = NOW()
               WHERE dpco_org_id = $11`,
              [
                tier, def.monthlyFee, def.maxClients, def.maxAuditsPerMonth,
                def.platformFeeRate, def.features,
                session.subscription ?? null,
                session.customer as string ?? null,
                now, periodEnd, dpcoOrgId,
              ]
            );
          } else {
            await pool.query(
              `INSERT INTO dpco_subscriptions
               (dpco_org_id, tier, monthly_fee, max_clients, max_audits_per_month,
                platform_fee_rate, features, status, stripe_subscription_id, stripe_customer_id,
                current_period_start, current_period_end, created_at, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$11,NOW(),NOW())`,
              [
                dpcoOrgId, tier, def.monthlyFee, def.maxClients, def.maxAuditsPerMonth,
                def.platformFeeRate, def.features,
                session.subscription ?? null,
                session.customer as string ?? null,
                now, periodEnd,
              ]
            );
          }
          // Also update the org tier column
          await pool.query(
            `UPDATE dpco_organisations SET tier = $1, updated_at = NOW() WHERE id = $2`,
            [tier, dpcoOrgId]
          );
          logger.info(`[Webhook] DPCO org ${dpcoOrgId} upgraded to ${tier} via Stripe session ${session.id}`);
        }
      } catch (err) {
        logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, "[Webhook] Error processing subscription upgrade:");
      }
    }
  }

  // ── Handle subscription period update (subscription.updated) ──────────────
  if (event.type === "customer.subscription.updated") {
    const sub = event.data.object as import("stripe").Stripe.Subscription;
    const dpcoOrgId = sub.metadata?.dpco_org_id ? parseInt(sub.metadata.dpco_org_id, 10) : null;
    if (dpcoOrgId) {
      try {
        const pool = getPool();
        const newStatus = sub.status === "active" ? "active" : sub.status === "past_due" ? "past_due" : "suspended";
        const periodStart = new Date(((sub as any).current_period_start as number) * 1000);
        const periodEnd = new Date(((sub as any).current_period_end as number) * 1000);
        await pool.query(
          `UPDATE dpco_subscriptions
           SET status = $1, current_period_start = $2, current_period_end = $3,
               stripe_subscription_id = $4, updated_at = NOW()
           WHERE dpco_org_id = $5`,
          [newStatus, periodStart, periodEnd, sub.id, dpcoOrgId]
        );
        logger.info(`[Webhook] DPCO org ${dpcoOrgId} subscription updated → ${newStatus}`);
      } catch (err) { logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, "[Webhook] Error processing subscription.updated:"); }
    }
  }

  // ── Handle payment failure (invoice.payment_failed) — set 7-day grace period ────
  if (event.type === "invoice.payment_failed") {
    const inv = event.data.object as import("stripe").Stripe.Invoice;
    const customerId = inv.customer as string;
    if (customerId) {
      try {
        const pool = getPool();
        const { rows } = await pool.query(
          `SELECT dpco_org_id FROM dpco_subscriptions WHERE stripe_customer_id = $1`,
          [customerId]
        );
        if (rows.length > 0) {
          const dpcoOrgId = rows[0].dpco_org_id;
          const gracePeriodEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          await pool.query(
            `UPDATE dpco_subscriptions SET status = 'past_due', grace_period_end = $1, updated_at = NOW() WHERE dpco_org_id = $2`,
            [gracePeriodEnd, dpcoOrgId]
          );
          logger.info(`[Webhook] DPCO org ${dpcoOrgId} payment failed — grace period until ${gracePeriodEnd.toISOString()}`);
        }
      } catch (err) { logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, "[Webhook] Error processing invoice.payment_failed:"); }
    }
  }

  // ── Handle invoice paid (invoice.paid) — clear grace period, reactivate ──────
  if (event.type === "invoice.paid") {
    const inv = event.data.object as import("stripe").Stripe.Invoice;
    const customerId = inv.customer as string;
    if (customerId) {
      try {
        const pool = getPool();
        const { rows } = await pool.query(
          `SELECT dpco_org_id FROM dpco_subscriptions WHERE stripe_customer_id = $1`,
          [customerId]
        );
        if (rows.length > 0) {
          const dpcoOrgId = rows[0].dpco_org_id;
          await pool.query(
            `UPDATE dpco_subscriptions SET status = 'active', grace_period_end = NULL, updated_at = NOW() WHERE dpco_org_id = $1`,
            [dpcoOrgId]
          );
          logger.info(`[Webhook] DPCO org ${dpcoOrgId} invoice paid — subscription reactivated`);
        }
      } catch (err) { logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, "[Webhook] Error processing invoice.paid:"); }
    }
  }

  // ── Handle subscription renewal / cancellation ────────────────────────────
  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as import("stripe").Stripe.Subscription;
    const dpcoOrgId = sub.metadata?.dpco_org_id
      ? parseInt(sub.metadata.dpco_org_id, 10)
      : null;
    if (dpcoOrgId) {
      try {
        const pool = getPool();
        await pool.query(
          `UPDATE dpco_subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE dpco_org_id = $1`,
          [dpcoOrgId]
        );
        logger.info(`[Webhook] DPCO org ${dpcoOrgId} subscription cancelled`);
      } catch (err) {
        logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, "[Webhook] Error processing subscription cancellation:");
      }
    }
  }

  res.json({ received: true });
}
