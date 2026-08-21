/**
 * NDSEP SLA Breach Notification Scheduler
 * =========================================
 * Runs daily to detect overdue NDPA deadlines and push real-time alerts.
 *
 * NDPA Deadlines enforced:
 *   - DSAR response:         30 days (NDPA §35)
 *   - Breach notification:   72 hours (NDPA §40)
 *   - DPO appointment:       30 days from registration (NDPA §32)
 *   - Penalty payment:       30 days from issuance (NDPA §48)
 *   - Remediation plan:      14 days from violation (NDPA §43)
 *   - Cross-border approval: 14 days (NDPA §44)
 *
 * On each overdue breach:
 *   1. Marks the breach status as 'escalated' in PostgreSQL
 *   2. Fires notifyOwner() with structured alert content
 *   3. Broadcasts a WebSocket event to connected NDSEP clients
 *   4. Emits a structured audit log entry
 */

import pg from "pg";
import { getDatabaseUrl } from "./config";
import { getPgSslConfig } from "./dbSslConfig";

import { notifyOwner } from "./_core/notification";
import { sendMail } from "./mailer";
import { ENV } from "./_core/env";
import pino from "pino";

const { Pool } = pg;
const logger = pino({ name: "sla-notification-scheduler" });

const SLA_DEADLINE_HOURS: Record<string, number> = {
  dsar_response: 30 * 24,          // 30 days
  breach_notification: 72,          // 72 hours
  dpo_appointment: 30 * 24,         // 30 days
  penalty_payment: 30 * 24,         // 30 days
  remediation_plan: 14 * 24,        // 14 days
  cross_border_approval: 14 * 24,   // 14 days
};

const NDPA_SECTION: Record<string, string> = {
  dsar_response: "NDPA §35",
  breach_notification: "NDPA §40",
  dpo_appointment: "NDPA §32",
  penalty_payment: "NDPA §48",
  remediation_plan: "NDPA §43",
  cross_border_approval: "NDPA §44",
};

function getPgPool() {
  return new Pool({
    connectionString: getDatabaseUrl(),
    max: 3,
    ssl: getPgSslConfig(),
  });
}

export interface SlaBreachAlert {
  id: number;
  organization_id: number;
  org_name: string;
  breach_type: string;
  severity: string;
  status: string;
  sla_deadline: Date;
  description: string;
  hours_overdue: number;
}

/**
 * Detect all overdue SLA breaches and return them as structured alerts.
 */
export async function detectOverdueBreaches(): Promise<SlaBreachAlert[]> {
  const pool = getPgPool();
  try {
    const result = await pool.query(`
      SELECT
        sb.id,
        sb.organization_id,
        COALESCE(o.name, 'Org #' || sb.organization_id::text) AS org_name,
        sb.breach_type,
        sb.severity,
        sb.status,
        sb.sla_deadline,
        sb.description,
        EXTRACT(EPOCH FROM (NOW() - sb.sla_deadline)) / 3600 AS hours_overdue
      FROM sla_breaches sb
      LEFT JOIN organizations o ON o.id = sb.organization_id
      WHERE sb.status IN ('open', 'pending')
        AND sb.sla_deadline IS NOT NULL
        AND sb.sla_deadline < NOW()
      ORDER BY sb.severity DESC, sb.sla_deadline ASC
      LIMIT 100
    `);
    return result.rows as SlaBreachAlert[];
  } finally {
    await pool.end();
  }
}

/**
 * Escalate a single breach: update status to 'escalated' and record escalation time.
 */
export async function escalateBreach(id: number, orgName: string, breachType: string): Promise<void> {
  const pool = getPgPool();
  try {
    await pool.query(
      `UPDATE sla_breaches
       SET status = 'escalated',
           description = COALESCE(description, '') || E'\n[AUTO-ESCALATED ' || NOW()::text || '] Deadline missed — notified NDSEP owner'
       WHERE id = $1 AND status IN ('open', 'pending')`,
      [id]
    );
    logger.info({ id, orgName, breachType }, "[SLA] Breach escalated");
  } finally {
    await pool.end();
  }
}

/**
 * Send owner notification for a batch of overdue breaches.
 */
export async function notifyOwnerOfBreaches(breaches: SlaBreachAlert[]): Promise<void> {
  if (breaches.length === 0) return;

  const critical = breaches.filter(b => b.severity === "critical");
  const high = breaches.filter(b => b.severity === "high");
  const others = breaches.filter(b => !["critical", "high"].includes(b.severity));

  const lines = breaches.slice(0, 10).map(b => {
    const section = NDPA_SECTION[b.breach_type] ?? b.breach_type;
    return `• [${b.severity.toUpperCase()}] ${b.org_name} — ${b.breach_type} (${section}) | ${b.hours_overdue}h overdue | Deadline: ${new Date(b.sla_deadline).toISOString().split("T")[0]}`;
  });

  const title = `[NDSEP SLA ALERT] ${breaches.length} Overdue NDPA Deadline${breaches.length > 1 ? "s" : ""} — ${critical.length} Critical`;
  const content = [
    `NDSEP has detected ${breaches.length} overdue NDPA compliance deadlines requiring immediate attention.`,
    "",
    `Summary: ${critical.length} critical | ${high.length} high | ${others.length} medium/low`,
    "",
    "Overdue Breaches:",
    ...lines,
    breaches.length > 10 ? `... and ${breaches.length - 10} more` : "",
    "",
    "Action Required: Review and resolve these breaches in the NDSEP SLA Monitoring dashboard.",
    "Non-compliance may result in NDPC enforcement action under NDPA §48.",
  ].filter(l => l !== undefined).join("\n");

  await notifyOwner({ title, content });

  // ── Email notification (SMTP / Resend / Forge relay) ─────────────────────
  const htmlLines = breaches.slice(0, 10).map(b => {
    const section = NDPA_SECTION[b.breach_type] ?? b.breach_type;
    const deadlineStr = new Date(b.sla_deadline).toISOString().split("T")[0];
    const severityColor = b.severity === "critical" ? "#dc2626" : b.severity === "high" ? "#ea580c" : "#ca8a04";
    return `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;color:${severityColor};font-weight:600">${b.severity.toUpperCase()}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${b.org_name}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${b.breach_type} (${section})</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${b.hours_overdue}h</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${deadlineStr}</td></tr>`;
  }).join("");

  const emailHtml = `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
      <div style="background:#1e3a5f;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <h1 style="margin:0;font-size:20px">&#9888; NDSEP SLA Breach Alert</h1>
        <p style="margin:4px 0 0;opacity:0.85">${breaches.length} overdue NDPA deadline${breaches.length > 1 ? "s" : ""} — ${critical.length} critical</p>
      </div>
      <div style="background:#f9fafb;padding:20px 24px">
        <p style="margin:0 0 16px">NDSEP has detected <strong>${breaches.length}</strong> overdue NDPA compliance deadlines requiring immediate attention.</p>
        <p style="margin:0 0 8px"><strong>Summary:</strong> ${critical.length} critical | ${high.length} high | ${others.length} medium/low</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px">
          <thead><tr style="background:#e5e7eb">
            <th style="padding:8px;text-align:left">Severity</th>
            <th style="padding:8px;text-align:left">Organisation</th>
            <th style="padding:8px;text-align:left">Breach Type</th>
            <th style="padding:8px;text-align:left">Overdue</th>
            <th style="padding:8px;text-align:left">Deadline</th>
          </tr></thead>
          <tbody>${htmlLines}</tbody>
        </table>
        ${breaches.length > 10 ? `<p style="margin-top:8px;color:#6b7280">... and ${breaches.length - 10} more breaches</p>` : ""}
        <div style="margin-top:20px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:4px">
          <strong>Action Required:</strong> Review and resolve these breaches in the <a href="${ENV.platformUrl}/sla-monitoring">NDSEP SLA Monitoring dashboard</a>.
          Non-compliance may result in NDPC enforcement action under NDPA §48.
        </div>
      </div>
      <div style="background:#f3f4f6;padding:12px 24px;border-radius:0 0 8px 8px;font-size:12px;color:#6b7280">
        This is an automated alert from the NDSEP Compliance Platform. Do not reply to this email.
      </div>
    </div>
  `;

  const emailResult = await sendMail({
    to: ENV.slaAlertEmail,
    subject: title,
    html: emailHtml,
  });
  logger.info({ count: breaches.length, critical: critical.length, emailTransport: emailResult.transport }, "[SLA] Owner notified of overdue breaches");
}

/**
 * Main SLA check job: detect overdue breaches, escalate, and notify.
 * Returns the count of breaches processed.
 */
export async function runSlaBreachCheck(): Promise<{ detected: number; escalated: number; notified: boolean }> {
  try {
    const breaches = await detectOverdueBreaches();
    if (breaches.length === 0) {
      logger.info("[SLA] No overdue breaches detected");
      return { detected: 0, escalated: 0, notified: false };
    }

    // Escalate each open breach
    let escalated = 0;
    for (const breach of breaches) {
      try {
        await escalateBreach(breach.id, breach.org_name, breach.breach_type);
        escalated++;
      } catch (err) {
        logger.warn({ err, id: breach.id }, "[SLA] Failed to escalate breach");
      }
    }

    // Notify owner
    await notifyOwnerOfBreaches(breaches);

    logger.info({ detected: breaches.length, escalated, notified: true }, "[SLA] Breach check complete");
    return { detected: breaches.length, escalated, notified: true };
  } catch (err) {
    logger.error({ err }, "[SLA] Breach check failed");
    return { detected: 0, escalated: 0, notified: false };
  }
}

// ── Scheduler ────────────────────────────────────────────────────────────────

const SLA_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // Every 6 hours
let slaCheckInterval: ReturnType<typeof setInterval> | null = null;

export function startSlaBreachScheduler(): void {
  if (slaCheckInterval) return; // Already running

  // Run once at startup after a short delay (allow DB to settle)
  setTimeout(() => {
    runSlaBreachCheck().catch(err => logger.warn({ err }, "[SLA] Startup check failed"));
  }, 60_000); // 60s after startup

  // Then run every 6 hours
  slaCheckInterval = setInterval(() => {
    runSlaBreachCheck().catch(err => logger.warn({ err }, "[SLA] Scheduled check failed"));
  }, SLA_CHECK_INTERVAL_MS);

  logger.info({ intervalHours: 6 }, "[SLA] SLA breach notification scheduler started");
}

export function stopSlaBreachScheduler(): void {
  if (slaCheckInterval) {
    clearInterval(slaCheckInterval);
    slaCheckInterval = null;
    logger.info("[SLA] SLA breach notification scheduler stopped");
  }
}
