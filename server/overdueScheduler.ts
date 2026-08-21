/**
 * NDSEP Penalty Overdue Scheduler
 * =================================
 * Runs every 6 hours to:
 *   1. Find penalties with payment_status = 'pending' and due_date < NOW()
 *   2. Update their status to 'overdue'
 *   3. Send a reminder email to the organisation's contact DPO
 *   4. Notify the platform owner of the overdue count
 *
 * In production, replace the setInterval with a Temporal cron workflow
 * (J16 — Regulatory Report Generation) for durability.
 */
import { Pool } from "pg";

import { ENV } from "./_core/env";
import { sendPenaltyNotice } from "./emailNotification";
import { notifyOwner } from "./_core/notification";
import { getPgSslConfig } from "./dbSslConfig";
import { getDatabaseUrl } from "./config";
import { logger } from "./logger";

const PG_URL = getDatabaseUrl();

let overdueTimer: NodeJS.Timeout | null = null;

// ─── Core job ─────────────────────────────────────────────────────────────────

export async function runOverdueCheck(): Promise<{ marked: number; notified: number }> {
  const pool = new Pool({ connectionString: PG_URL, ssl: getPgSslConfig(), max: 3 });
  let marked = 0;
  let notified = 0;

  try {
    // 1. Find and mark overdue penalties in a single UPDATE … RETURNING
    const { rows: overduePenalties } = await pool.query<{
      id: number;
      amount: number;
      currency: string;
      description: string;
      due_date: Date;
      organization_id: number;
      org_name: string;
      contact_email: string | null;
    }>(`
      UPDATE financial_penalties fp
      SET payment_status = 'overdue', updated_at = NOW()
      FROM organizations o
      WHERE fp.organization_id = o.id
        AND fp.payment_status = 'pending'
        AND fp.due_date IS NOT NULL
        AND fp.due_date < NOW()
      RETURNING
        fp.id,
        fp.amount,
        fp.currency,
        fp.description,
        fp.due_date,
        fp.organization_id,
        o.name AS org_name,
        o.contact_email
    `);

    marked = overduePenalties.length;

    if (marked === 0) {
      logger.info("[OverdueScheduler] No newly overdue penalties found.");
      return { marked: 0, notified: 0 };
    }

    logger.info(`[OverdueScheduler] Marked ${marked} penalties as overdue.`);

    // 2. Send reminder emails to orgs with a contact email
    const portalUrl = `${process.env.VITE_OAUTH_PORTAL_URL ?? ""}/portal`;

    for (const p of overduePenalties) {
      if (!p.contact_email) continue;
      try {
        await sendPenaltyNotice({
          to: p.contact_email,
          orgName: p.org_name,
          penaltyId: p.id,
          amount: Number(p.amount),
          currency: p.currency ?? "NGN",
          description: `[OVERDUE REMINDER] ${p.description ?? "Financial penalty"}`,
          dueDate: p.due_date ? new Date(p.due_date) : undefined,
          portalUrl,
        });
        notified++;
      } catch (err) {
        logger.warn({ data: err }, `[OverdueScheduler] Failed to email ${p.contact_email}:`);
      }
    }

    // 3. Notify platform owner with a summary
    const orgList = overduePenalties
      .slice(0, 10)
      .map(p => `• ${p.org_name} — ${p.currency ?? "NGN"} ${Number(p.amount).toLocaleString()} (PEN-${String(p.id).padStart(6, "0")})`)
      .join("\n");

    await notifyOwner({
      title: `[NDSEP] ${marked} Penalty${marked > 1 ? "ies" : ""} Now Overdue`,
      content: [
        `${marked} financial ${marked > 1 ? "penalties have" : "penalty has"} passed their due date and been marked OVERDUE.`,
        "",
        orgList,
        marked > 10 ? `\n…and ${marked - 10} more.` : "",
        "",
        "Enforcement escalation may be required per NDPR §2.10.",
      ]
        .filter(l => l !== undefined)
        .join("\n"),
    }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));

    return { marked, notified };
  } catch (err) {
    logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, "[OverdueScheduler] Error during overdue check:");
    return { marked: 0, notified: 0 };
  } finally {
    await pool.end();
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function startOverdueScheduler(): void {
  if (overdueTimer) return; // already running

  // Run immediately on startup (after a short delay to let DB settle)
  const initialDelay = setTimeout(async () => {
    const result = await runOverdueCheck();
    logger.info(`[OverdueScheduler] Initial check: ${result.marked} marked, ${result.notified} notified.`);
  }, 15_000);

  // Then repeat every 6 hours
  overdueTimer = setInterval(async () => {
    const result = await runOverdueCheck();
    logger.info(`[OverdueScheduler] Periodic check: ${result.marked} marked, ${result.notified} notified.`);
  }, INTERVAL_MS);

  // Prevent the initial timeout from keeping the process alive if server shuts down
  if (initialDelay.unref) initialDelay.unref();
  if (overdueTimer.unref) overdueTimer.unref();

  logger.info(`[OverdueScheduler] Started — checking every 6 hours (next run in ~15s for initial check).`);
}

export function stopOverdueScheduler(): void {
  if (overdueTimer) {
    clearInterval(overdueTimer);
    overdueTimer = null;
    logger.info("[OverdueScheduler] Stopped.");
  }
}
