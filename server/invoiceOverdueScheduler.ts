/**
 * NDSEP DPCO Invoice Overdue Scheduler
 * ======================================
 * Runs every 24 hours (configurable) to:
 *   1. Find dpco_invoices with status = 'sent' and due_date < NOW()
 *   2. Flip their status to 'overdue' in a single atomic UPDATE … RETURNING
 *   3. Send an owner notification with the count and list of overdue invoices
 *   4. Log the run result for audit purposes
 *
 * The scheduler starts automatically when the server boots and can be
 * stopped gracefully on shutdown.
 *
 * Production note: Replace setInterval with a Temporal cron workflow
 * (J16 — Regulatory Report Generation) for durability and distributed locking.
 */

import { Pool } from "pg";

import { notifyOwner } from "./_core/notification";
import { logger } from "./logger";
import { getPgSslConfig } from "./dbSslConfig";
import { getDatabaseUrl } from "./config";

// ─── Configuration ────────────────────────────────────────────────────────────
const PG_URL = getDatabaseUrl();

/** How often to run the overdue check (default: every 24 hours) */
const INTERVAL_MS =
  parseInt(process.env.INVOICE_OVERDUE_INTERVAL_MS ?? "0", 10) ||
  24 * 60 * 60 * 1000;

let overdueTimer: NodeJS.Timeout | null = null;
let pool: Pool | null = null;

// ─── Core job ─────────────────────────────────────────────────────────────────
export interface OverdueRunResult {
  markedOverdue: number;
  invoiceNumbers: string[];
  ranAt: string;
}

export async function runInvoiceOverdueCheck(): Promise<OverdueRunResult> {
  if (!pool) {
    pool = new Pool({ connectionString: PG_URL, ssl: getPgSslConfig(), max: 3 });
  }

  const client = await pool.connect();
  let markedOverdue = 0;
  let invoiceNumbers: string[] = [];

  try {
    await client.query("BEGIN");

    // 1. Atomically flip 'sent' invoices past due_date to 'overdue'
    const updateResult = await client.query<{
      id: number;
      invoice_number: string;
      client_name: string;
      total_amount: string;
      dpco_org_id: number;
    }>(
      `UPDATE dpco_invoices
       SET status = 'overdue', updated_at = NOW()
       WHERE status = 'sent'
         AND due_date < NOW()
       RETURNING id, invoice_number, client_name, total_amount, dpco_org_id`
    );

    markedOverdue = updateResult.rowCount ?? 0;
    invoiceNumbers = updateResult.rows.map((r) => r.invoice_number);

    await client.query("COMMIT");

    // 2. Notify platform owner if any invoices were escalated
    if (markedOverdue > 0) {
      const invoiceList = updateResult.rows
        .map(
          (r) =>
            `  • ${r.invoice_number} — ${r.client_name} — NGN ${Number(r.total_amount).toLocaleString("en-NG")}`
        )
        .join("\n");

      try {
        await notifyOwner({
          title: `⚠️ ${markedOverdue} DPCO Invoice(s) Marked Overdue`,
          content:
            `The daily invoice overdue check has escalated ${markedOverdue} invoice(s) to OVERDUE status.\n\n` +
            `Overdue invoices:\n${invoiceList}\n\n` +
            `Action required: Review the DPCO Billing Dashboard at /dpco/billing and follow up with the respective DPCOs.`,
        });
      } catch (notifyErr: unknown) {
        logger.warn({ err: notifyErr }, "Invoice overdue owner notification failed");
      }
    }

    const result: OverdueRunResult = {
      markedOverdue,
      invoiceNumbers,
      ranAt: new Date().toISOString(),
    };

    logger.info(result, "[invoice-overdue] Overdue check completed");
    return result;
  } catch (err: unknown) {
    await client.query("ROLLBACK").catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    logger.error({ err }, "[invoice-overdue] Overdue check failed — rolled back");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Scheduler lifecycle ──────────────────────────────────────────────────────
export function startInvoiceOverdueScheduler(): void {
  if (overdueTimer) return; // already running

  logger.info(
    { intervalMs: INTERVAL_MS },
    "[invoice-overdue] Scheduler started"
  );

  // Run immediately on startup, then on interval
  runInvoiceOverdueCheck().catch((err) =>
    logger.error({ err }, "[invoice-overdue] Initial run failed")
  );

  overdueTimer = setInterval(() => {
    runInvoiceOverdueCheck().catch((err) =>
      logger.error({ err }, "[invoice-overdue] Scheduled run failed")
    );
  }, INTERVAL_MS);

  // Prevent the timer from keeping the process alive
  if (overdueTimer.unref) overdueTimer.unref();
}

export function stopInvoiceOverdueScheduler(): void {
  if (overdueTimer) {
    clearInterval(overdueTimer);
    overdueTimer = null;
    logger.info("[invoice-overdue] Scheduler stopped");
  }
  if (pool) {
    pool.end().catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    pool = null;
  }
}
