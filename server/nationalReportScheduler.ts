/**
 * NDSEP National Enforcement Report Scheduler
 * =============================================
 * Runs every Friday at 17:00 WAT (UTC+1) to:
 *   1. Generate the National Enforcement Report PDF
 *   2. Email it to the configured government recipients
 *   3. Notify the platform owner
 *   4. Store a record of the last send time
 *
 * In production, replace with a Temporal cron workflow for durability.
 */
import { Pool } from "pg";

import { ENV } from "./_core/env";
import { generateNationalReportPdf } from "./nationalReportPdf";
import { notifyOwner } from "./_core/notification";
import { getPgSslConfig } from "./dbSslConfig";
import { getDatabaseUrl } from "./config";
import { logger } from "./logger";

const PG_URL = getDatabaseUrl();

// Government recipients — configurable via env
const REPORT_RECIPIENTS: string[] = (
  process.env.NATIONAL_REPORT_RECIPIENTS ?? ""
)
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);

let reportTimer: NodeJS.Timeout | null = null;
let lastSentAt: Date | null = null;

// ─── Core job ─────────────────────────────────────────────────────────────────
export async function runNationalReportJob(): Promise<{ sent: number; error?: string }> {
  logger.info("[NationalReportScheduler] Starting national report generation...");
  try {
    const pdfBuffer = await generateNationalReportPdf();
    const dateStr = new Date().toISOString().split("T")[0];
    const filename = `NDSEP-National-Enforcement-Report-${dateStr}.pdf`;

    // Upload PDF to storage for archival
    let pdfUrl: string | null = null;
    try {
      const { storagePut } = await import("./storage");
      const { url } = await storagePut(
        `national-reports/${filename}`,
        pdfBuffer,
        "application/pdf"
      );
      pdfUrl = url;
    } catch (storageErr) {
      logger.warn({ data: storageErr }, "[NationalReportScheduler] Storage upload failed, continuing without archival:");
    }

    // Send to government recipients
    let sent = 0;
    for (const recipient of REPORT_RECIPIENTS) {
      try {
        const res = await fetch(`${ENV.forgeApiUrl}/v1/notifications/email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ENV.forgeApiKey}`,
          },
          body: JSON.stringify({
            to: recipient,
            subject: `NDSEP National Enforcement Report — ${dateStr}`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
                <div style="background:#1a3a5c;padding:24px;border-radius:8px 8px 0 0">
                  <h1 style="color:#fff;margin:0;font-size:20px">🇳🇬 NDSEP National Enforcement Report</h1>
                  <p style="color:#a0c4e8;margin:4px 0 0">National Data Sovereignty Enforcement Platform</p>
                </div>
                <div style="background:#f8fafc;padding:24px;border:1px solid #e2e8f0;border-top:none">
                  <p>Dear Recipient,</p>
                  <p>Please find attached the <strong>NDSEP National Enforcement Report</strong> for <strong>${dateStr}</strong>.</p>
                  <p>This report covers:</p>
                  <ul>
                    <li>Compliance status across all registered organisations</li>
                    <li>Active enforcement cases and penalties</li>
                    <li>Data residency violations and remediation progress</li>
                    <li>Sector-by-sector risk assessment</li>
                  </ul>
                  ${pdfUrl ? `<p><a href="${pdfUrl}" style="background:#1a3a5c;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;display:inline-block">Download Report PDF</a></p>` : ""}
                  <p style="color:#64748b;font-size:12px;margin-top:24px">
                    This is an automated report from NDSEP. For queries, contact the NITDA Data Protection Office.
                  </p>
                </div>
              </div>
            `,
          }),
        });
        if (res.ok) sent++;
      } catch (emailErr) {
        logger.warn({ data: emailErr }, `[NationalReportScheduler] Failed to send to ${recipient}:`);
      }
    }

    // Update last sent timestamp in DB
    const pool = new Pool({ connectionString: PG_URL, ssl: getPgSslConfig(), max: 2 });
    try {
      await pool.query(
        `INSERT INTO platform_config (key, value, updated_at)
         VALUES ('national_report_last_sent', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [new Date().toISOString()]
      );
    } catch {
      // platform_config table may not exist yet — non-fatal
    } finally {
      await pool.end();
    }

    lastSentAt = new Date();

    // Notify platform owner
    await notifyOwner({
      title: "📊 National Enforcement Report Sent",
      content: `Weekly national enforcement report generated and sent to ${sent} recipient(s). Report date: ${dateStr}.${pdfUrl ? ` Archive: ${pdfUrl}` : ""}`,
    });

    logger.info(`[NationalReportScheduler] Report sent to ${sent} recipients.`);
    return { sent };
  } catch (err: unknown) {
    logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, "[NationalReportScheduler] Error:");
    return { sent: 0, error: (err instanceof Error ? err.message : String(err)) ?? "Unknown error" };
  }
}

export function getLastSentAt(): Date | null {
  return lastSentAt;
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
function getNextFriday17WAT(): Date {
  const now = new Date();
  // WAT = UTC+1
  const watOffset = 60 * 60 * 1000; // 1 hour in ms
  const watNow = new Date(now.getTime() + watOffset);

  // Find next Friday at 17:00 WAT
  const dayOfWeek = watNow.getUTCDay(); // 0=Sun, 5=Fri
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7; // at least 1 day ahead

  const nextFriday = new Date(watNow);
  nextFriday.setUTCDate(watNow.getUTCDate() + daysUntilFriday);
  nextFriday.setUTCHours(16, 0, 0, 0); // 17:00 WAT = 16:00 UTC

  // If today is Friday but before 17:00 WAT, use today
  if (dayOfWeek === 5 && watNow.getUTCHours() < 16) {
    nextFriday.setUTCDate(watNow.getUTCDate());
  }

  return nextFriday;
}

export function startNationalReportScheduler(): void {
  const scheduleNext = () => {
    const nextRun = getNextFriday17WAT();
    const delay = nextRun.getTime() - Date.now();
    logger.info(
      `[NationalReportScheduler] Next report scheduled for ${nextRun.toISOString()} (in ${Math.round(delay / 3600000)}h)`
    );
    reportTimer = setTimeout(async () => {
      await runNationalReportJob();
      scheduleNext(); // reschedule for next week
    }, delay);
  };
  scheduleNext();
}

export function stopNationalReportScheduler(): void {
  if (reportTimer) {
    clearTimeout(reportTimer);
    reportTimer = null;
  }
}
