/**
 * NDSEP Weekly Compliance Digest Scheduler
 * ==========================================
 * Runs every Monday at 08:00 WAT (UTC+1) to send each registered organisation
 * a personalised compliance summary covering:
 *   - Compliance score trend (30-day delta)
 *   - Open penalties and total outstanding amount
 *   - Violations detected in the past 7 days
 *   - Upcoming audit deadlines
 *   - Portal phase status
 *
 * The scheduler uses Node.js setInterval aligned to the next Monday 08:00 WAT.
 * In production, replace with a Temporal cron workflow (J16 — Regulatory Report
 * Generation) for durability and distributed execution.
 */

import { Pool } from "pg";

import { ENV } from "./_core/env";
import { saveNdpaComplianceSnapshot } from "./db";
import { getPgSslConfig } from "./dbSslConfig";
import { getDatabaseUrl } from "./config";
import { logger } from "./logger";

const PG_URL = getDatabaseUrl();

// ─── Email helper (reuses the same Forge API channel) ─────────────────────────
async function sendDigestEmail(payload: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  try {
    const res = await fetch(`${ENV.forgeApiUrl}/v1/notifications/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENV.forgeApiKey}`,
      },
      body: JSON.stringify({
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.html.replace(/<[^>]+>/g, ""),
      }),
    });
    if (!res.ok) {
      logger.warn(`[DigestScheduler] Failed to send to ${payload.to}: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, "[DigestScheduler] Error:");
    return false;
  }
}

// ─── Digest data fetcher ──────────────────────────────────────────────────────
export interface OrgDigestData {
  orgId: number;
  orgName: string;
  orgSector: string;
  contactEmail: string;
  currentPhase: string;
  complianceScore: number;
  scoreDelta: number;
  openPenalties: number;
  pendingAmount: number;
  violationsLast7d: number;
  submissionToken: string;
  certifiedAt: Date | null;
}

export async function fetchDigestData(): Promise<OrgDigestData[]> {
  const pool = new Pool({ connectionString: PG_URL, ssl: getPgSslConfig() });
  try {
    const r = await pool.query<OrgDigestData>(`
      SELECT
        ps.id                                                          AS "orgId",
        ps.org_name                                                    AS "orgName",
        ps.org_sector                                                  AS "orgSector",
        ps.contact_email                                               AS "contactEmail",
        ps.current_phase                                               AS "currentPhase",
        COALESCE(ps.compliance_score, 0)                               AS "complianceScore",
        COALESCE(
          ps.compliance_score - LAG(ps.compliance_score, 1, ps.compliance_score)
            OVER (PARTITION BY ps.id ORDER BY ps.submitted_at), 0
        )                                                              AS "scoreDelta",
        COUNT(fp.id) FILTER (WHERE fp.payment_status IN ('pending','overdue'))
                                                                       AS "openPenalties",
        COALESCE(SUM(fp.amount) FILTER (WHERE fp.payment_status IN ('pending','overdue')), 0)
                                                                       AS "pendingAmount",
        COUNT(cv.id) FILTER (WHERE cv.detected_at >= NOW() - INTERVAL '7 days')
                                                                       AS "violationsLast7d",
        ps.submission_token                                            AS "submissionToken",
        ps.certified_at                                                AS "certifiedAt"
      FROM portal_submissions ps
      LEFT JOIN organizations o ON LOWER(o.name) = LOWER(ps.org_name)
      LEFT JOIN financial_penalties fp ON fp.organization_id = o.id
      LEFT JOIN compliance_violations cv ON cv.organization_id = o.id
      WHERE ps.contact_email IS NOT NULL
        AND ps.contact_email != ''
      GROUP BY ps.id, ps.org_name, ps.org_sector, ps.contact_email,
               ps.current_phase, ps.compliance_score, ps.submitted_at,
               ps.submission_token, ps.certified_at
      ORDER BY ps.submitted_at DESC
    `);
    return r.rows;
  } finally {
    await pool.end();
  }
}

// ─── Email template ───────────────────────────────────────────────────────────
export function buildDigestHtml(org: OrgDigestData, portalBaseUrl: string): string {
  const scoreColor = org.complianceScore >= 75 ? "#16a34a" : org.complianceScore >= 50 ? "#d97706" : "#dc2626";
  const deltaSign = org.scoreDelta >= 0 ? "+" : "";
  const deltaColor = org.scoreDelta >= 0 ? "#16a34a" : "#dc2626";
  const phaseLabels: Record<string, string> = {
    submitted: "Submission Received",
    document_review: "Document Review",
    technical_assessment: "Technical Assessment",
    field_audit: "Field Audit",
    remediation: "Remediation Period",
    final_review: "Final Review",
    certified: "✅ Certified",
  };
  const phaseLabel = phaseLabels[org.currentPhase] ?? org.currentPhase;
  const portalUrl = `${portalBaseUrl}/portal`;
  const statusUrl = `${portalBaseUrl}/status/${org.submissionToken}`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:0">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
<tr><td style="background:#1a3a5c;padding:24px 32px">
  <h1 style="color:#fff;margin:0;font-size:20px">🇳🇬 NDSEP Weekly Compliance Digest</h1>
  <p style="color:#a0b4c8;margin:4px 0 0;font-size:13px">Week ending ${new Date().toLocaleDateString("en-NG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
</td></tr>
<tr><td style="padding:32px">
  <h2 style="color:#1a3a5c;margin:0 0 8px">${org.orgName}</h2>
  <p style="color:#6b7280;font-size:13px;margin:0 0 24px">Sector: ${org.orgSector.toUpperCase()} &nbsp;|&nbsp; Reference: <span style="font-family:monospace">${org.submissionToken}</span></p>

  <!-- Score card -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;margin-bottom:24px">
    <tr>
      <td style="padding:20px;text-align:center;border-right:1px solid #e5e7eb">
        <p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Compliance Score</p>
        <p style="margin:4px 0 0;font-size:36px;font-weight:700;color:${scoreColor}">${org.complianceScore}</p>
        <p style="margin:4px 0 0;font-size:12px;color:${deltaColor}">${deltaSign}${org.scoreDelta} vs last week</p>
      </td>
      <td style="padding:20px;text-align:center;border-right:1px solid #e5e7eb">
        <p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Open Penalties</p>
        <p style="margin:4px 0 0;font-size:36px;font-weight:700;color:${org.openPenalties > 0 ? "#dc2626" : "#16a34a"}">${org.openPenalties}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#6b7280">$${Number(org.pendingAmount).toLocaleString()} outstanding</p>
      </td>
      <td style="padding:20px;text-align:center">
        <p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Violations (7d)</p>
        <p style="margin:4px 0 0;font-size:36px;font-weight:700;color:${org.violationsLast7d > 0 ? "#d97706" : "#16a34a"}">${org.violationsLast7d}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#6b7280">new detections</p>
      </td>
    </tr>
  </table>

  <!-- Phase status -->
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
    <tr style="background:#eff6ff">
      <td style="padding:10px 14px;border:1px solid #bfdbfe;font-weight:600;font-size:13px;width:40%">Onboarding Phase</td>
      <td style="padding:10px 14px;border:1px solid #bfdbfe;font-weight:700;color:#1d4ed8;font-size:13px">${phaseLabel}</td>
    </tr>
    ${org.certifiedAt ? `<tr><td style="padding:10px 14px;border:1px solid #bfdbfe;font-weight:600;font-size:13px">Certified Since</td><td style="padding:10px 14px;border:1px solid #bfdbfe;font-size:13px">${new Date(org.certifiedAt).toLocaleDateString("en-NG")}</td></tr>` : ""}
  </table>

  <!-- Recommended actions -->
  ${org.openPenalties > 0 ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:14px;margin-bottom:16px"><p style="margin:0;font-size:13px;color:#991b1b"><strong>⚠️ Action Required:</strong> You have ${org.openPenalties} open ${org.openPenalties === 1 ? "penalty" : "penalties"} totalling $${Number(org.pendingAmount).toLocaleString()}. Please submit payment references via the portal to avoid escalation.</p></div>` : ""}
  ${org.violationsLast7d > 0 ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:14px;margin-bottom:16px"><p style="margin:0;font-size:13px;color:#92400e"><strong>🔍 Violations Detected:</strong> ${org.violationsLast7d} new compliance ${org.violationsLast7d === 1 ? "violation was" : "violations were"} detected this week. Review and remediate promptly to avoid penalty escalation.</p></div>` : ""}
  ${org.complianceScore < 50 ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:14px;margin-bottom:16px"><p style="margin:0;font-size:13px;color:#991b1b"><strong>🚨 Low Compliance Score:</strong> Your score of ${org.complianceScore}/100 is below the minimum threshold. Request a compliance audit to identify and resolve gaps.</p></div>` : ""}

  <!-- CTAs -->
  <p style="margin:24px 0 8px">
    <a href="${statusUrl}" style="background:#1a3a5c;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;margin-right:12px">View Status Tracker</a>
    <a href="${portalUrl}" style="background:#0ea5e9;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px">Open Portal</a>
  </p>

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
  <p style="color:#6b7280;font-size:12px;margin:0">
    This is an automated weekly digest from NDSEP. To unsubscribe, contact
    <a href="mailto:compliance@ndsep.gov.ng">compliance@ndsep.gov.ng</a>.
    Reference: ${org.submissionToken}
  </p>
</td></tr>
</table></td></tr></table>
</body></html>`;
}

// ─── Send digest to all registered orgs ──────────────────────────────────────
export async function sendWeeklyDigest(portalBaseUrl: string): Promise<{ sent: number; failed: number }> {
  logger.info("[DigestScheduler] Starting weekly compliance digest run...");
  let sent = 0;
  let failed = 0;

  try {
    const orgs = await fetchDigestData();
    logger.info(`[DigestScheduler] Found ${orgs.length} organisations to notify`);

    for (const org of orgs) {
      try {
        const html = buildDigestHtml(org, portalBaseUrl);
        const ok = await sendDigestEmail({
          to: org.contactEmail,
          subject: `[NDSEP] Weekly Compliance Digest — ${org.orgName} — Score: ${org.complianceScore}/100`,
          html,
        });
        if (ok) {
          sent++;
          logger.info(`[DigestScheduler] ✓ Sent digest to ${org.contactEmail} (${org.orgName})`);
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
        logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, `[DigestScheduler] Error sending to ${org.contactEmail}:`);
      }
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, "[DigestScheduler] Fatal error fetching digest data:");
  }

  logger.info(`[DigestScheduler] Digest run complete: ${sent} sent, ${failed} failed`);
  return { sent, failed };
}

/** Preview digest HTML for a single org by submission ID (no email sent) */
export async function previewDigest(orgId: number, portalBaseUrl: string): Promise<{ orgName: string; html: string } | null> {
  const orgs = await fetchDigestData();
  const org = orgs.find(o => o.orgId === orgId) ?? orgs[0];
  if (!org) return null;
  const html = buildDigestHtml(org, portalBaseUrl);
  return { orgName: org.orgName, html };
}

// ─── Daily NDPA Snapshot Scheduler ──────────────────────────────────────────
let snapshotTimer: NodeJS.Timeout | null = null;

function msUntilMidnightWAT(): number {
  const now = Date.now();
  const nowWat = new Date(now + 60 * 60 * 1000);
  const nextMidnight = new Date(nowWat);
  nextMidnight.setUTCHours(24, 0, 0, 0);
  return nextMidnight.getTime() - 60 * 60 * 1000 - now;
}

/** Compare today's NDPA Index against the 30-day rolling average and alert if drop > 10 points. */
async function checkNdpaIndexTrend(): Promise<void> {
  const pool = new Pool({ connectionString: PG_URL, ssl: getPgSslConfig() });
  try {
    // Get today's snapshot score and 30-day rolling average
    const r = await pool.query<{ today_score: number; avg_30d: number; min_score: number; max_score: number }>(`
      SELECT
        (SELECT composite_score FROM ndpa_compliance_snapshots ORDER BY snapshot_date DESC LIMIT 1) AS today_score,
        AVG(composite_score) FILTER (WHERE snapshot_date >= CURRENT_DATE - INTERVAL '30 days') AS avg_30d,
        MIN(composite_score) FILTER (WHERE snapshot_date >= CURRENT_DATE - INTERVAL '30 days') AS min_score,
        MAX(composite_score) FILTER (WHERE snapshot_date >= CURRENT_DATE - INTERVAL '30 days') AS max_score
      FROM ndpa_compliance_snapshots
    `);
    const row = r.rows[0];
    if (!row || row.today_score == null || row.avg_30d == null) {
      logger.info("[NdpaSnapshot] Insufficient data for trend alert check");
      return;
    }
    const todayScore = Number(row.today_score);
    const avg30d = Number(row.avg_30d);
    const drop = avg30d - todayScore;
    logger.info(`[NdpaSnapshot] Trend check: today=${todayScore.toFixed(1)}, 30d_avg=${avg30d.toFixed(1)}, drop=${drop.toFixed(1)}`);
    if (drop >= 10) {
      // Fetch sub-metric breakdown for the alert
      const metricR = await pool.query<Record<string, number>>(`
        SELECT breach_resolution, breach_notification, dpo_appointment,
               dpia_completion, consent_compliance, training_completion,
               audit_return, privacy_notice
        FROM ndpa_compliance_snapshots ORDER BY snapshot_date DESC LIMIT 2
      `);
      const [latest, prev] = metricR.rows;
      const metricNames: Record<string, string> = {
        breach_resolution: "Breach Resolution",
        breach_notification: "72h NDPC Notification",
        dpo_appointment: "DPO Appointment",
        dpia_completion: "DPIA Completion",
        consent_compliance: "Consent Compliance",
        training_completion: "Staff Training",
        audit_return: "Audit Return",
        privacy_notice: "Privacy Notice",
      };
      const declines = prev && latest
        ? Object.keys(metricNames)
            .map(k => ({ name: metricNames[k], delta: Number(latest[k as keyof typeof latest]) - Number(prev[k as keyof typeof prev]) }))
            .filter(m => m.delta < -5)
            .sort((a, b) => a.delta - b.delta)
        : [];
      const declineText = declines.length
        ? declines.map(m => `• ${m.name}: ${m.delta.toFixed(1)} pts`).join("\n")
        : "No specific sub-metric breakdown available.";
      const alertContent = [
        `⚠️ NDPA Compliance Index Alert — ${new Date().toLocaleDateString("en-NG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`,
        ``,
        `Today's NDPA Index: ${todayScore.toFixed(1)}/100`,
        `30-Day Rolling Average: ${avg30d.toFixed(1)}/100`,
        `Drop: ${drop.toFixed(1)} points (threshold: 10)`,
        ``,
        `Sub-metrics with significant decline (>5 pts):`,
        declineText,
        ``,
        `Action required: Review the affected sub-metrics on the NDSEP Dashboard and initiate remediation workflows before the next NDPC audit cycle.`,
      ].join("\n");
      // Fire notifyOwner via Forge API
      try {
        await fetch(`${ENV.forgeApiUrl}/v1/notifications/owner`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ENV.forgeApiKey}` },
          body: JSON.stringify({ title: `🚨 NDPA Index dropped ${drop.toFixed(1)} pts (now ${todayScore.toFixed(1)}/100)`, content: alertContent }),
        });
        logger.info(`[NdpaSnapshot] Owner alert sent: NDPA Index dropped ${drop.toFixed(1)} pts`);
      } catch (alertErr) {
        logger.error({ err: alertErr instanceof Error ? alertErr.message : String(alertErr) }, "[NdpaSnapshot] Failed to send owner alert");
      }
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, "[NdpaSnapshot] Trend check error:");
  } finally {
    await pool.end();
  }
}

export function startNdpaSnapshotScheduler(): void {
  if (snapshotTimer) return;
  const scheduleNext = () => {
    const delay = msUntilMidnightWAT();
    const nextRun = new Date(Date.now() + delay);
    logger.info(`[NdpaSnapshot] Next daily snapshot at ${nextRun.toISOString()} (in ${Math.round(delay / 3600000)}h)`);
    snapshotTimer = setTimeout(async () => {
      try {
        const result = await saveNdpaComplianceSnapshot();
        logger.info(`[NdpaSnapshot] Snapshot saved: ${JSON.stringify(result)}`);
        // Check trend and alert if score dropped significantly
        await checkNdpaIndexTrend();
      } catch (err) {
        logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, "[NdpaSnapshot] Failed:");
      }
      scheduleNext();
    }, delay);
  };
  scheduleNext();
}

export function stopNdpaSnapshotScheduler(): void {
  if (snapshotTimer) {
    clearTimeout(snapshotTimer);
    snapshotTimer = null;
    logger.info("[NdpaSnapshot] Stopped");
  }
}

// ─── Cron scheduler ──────────────────────────────────────────────────────────
let digestTimer: NodeJS.Timeout | null = null;

function msUntilNextMonday8amWAT(): number {
  const now = new Date();
  // WAT = UTC+1
  const nowUtc = now.getTime();
  const nowWat = new Date(nowUtc + 60 * 60 * 1000); // shift to WAT
  const day = nowWat.getUTCDay(); // 0=Sun, 1=Mon
  const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7 || 7;
  const nextMonday = new Date(nowWat);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + daysUntilMonday);
  nextMonday.setUTCHours(7, 0, 0, 0); // 08:00 WAT = 07:00 UTC
  return nextMonday.getTime() - nowUtc;
}

export function startDigestScheduler(portalBaseUrl: string): void {
  if (digestTimer) return; // already running

  const scheduleNext = () => {
    const delay = msUntilNextMonday8amWAT();
    const nextRun = new Date(Date.now() + delay);
    logger.info(`[DigestScheduler] Next weekly digest scheduled for ${nextRun.toISOString()} (in ${Math.round(delay / 3600000)}h)`);

    digestTimer = setTimeout(async () => {
      await sendWeeklyDigest(portalBaseUrl);
      scheduleNext(); // reschedule for next week
    }, delay);
  };

  scheduleNext();
}

export function stopDigestScheduler(): void {
  if (digestTimer) {
    clearTimeout(digestTimer);
    digestTimer = null;
    logger.info("[DigestScheduler] Stopped");
  }
}

// ─── DPCO Licence Renewal Reminder Cron ─────────────────────────────────────
// Fires daily at 09:00 WAT; checks for DPCOs expiring in 90, 60, 30 days
let renewalTimer: NodeJS.Timeout | null = null;

async function sendDpcoRenewalReminders(): Promise<void> {
  const pool = new Pool({ connectionString: PG_URL, ssl: getPgSslConfig() });
  try {
    const thresholds = [90, 60, 30];
    for (const days of thresholds) {
      const r = await pool.query<{
        id: number; name: string; licence_number: string;
        email: string; licence_expires_at: Date;
      }>(
        `SELECT id, name, licence_number, email, licence_expires_at
         FROM dpco_organisations
         WHERE status = 'active'
           AND licence_expires_at::date = CURRENT_DATE + INTERVAL '${days} days'`
      );
      for (const dpco of r.rows) {
        const expiry = new Date(dpco.licence_expires_at).toLocaleDateString("en-NG", {
          day: "2-digit", month: "long", year: "numeric",
        });
        try {
          await fetch(`${ENV.forgeApiUrl}/v1/notifications/owner`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${ENV.forgeApiKey}` },
            body: JSON.stringify({
              title: `DPCO Licence Renewal — ${days} Days Remaining`,
              content: `**${dpco.name}** (Licence: ${dpco.licence_number}) expires on **${expiry}**.\n\nPlease initiate the renewal process at /dpco/onboard or contact the DPCO directly at ${dpco.email || "N/A"}.\n\nAction required within ${days} days to avoid licence lapse.`,
            }),
          });
          logger.info(`[DpcoRenewal] Sent ${days}-day reminder for ${dpco.name} (${dpco.licence_number})`);
        } catch (err) {
          logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, `[DpcoRenewal] Failed to notify for ${dpco.licence_number}:`);
        }
      }
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, "[DpcoRenewal] Failed:");
  } finally {
    await pool.end();
  }
}

function msUntilNext9amWAT(): number {
  const now = Date.now();
  const watOffset = 60 * 60 * 1000; // WAT = UTC+1
  const nowWat = new Date(now + watOffset);
  const next9am = new Date(nowWat);
  next9am.setUTCHours(8, 0, 0, 0); // 09:00 WAT = 08:00 UTC
  if (next9am.getTime() <= nowWat.getTime()) {
    next9am.setUTCDate(next9am.getUTCDate() + 1);
  }
  return next9am.getTime() - watOffset - now;
}

export function startDpcoRenewalScheduler(): void {
  if (renewalTimer) return;
  const scheduleNext = () => {
    const delay = msUntilNext9amWAT();
    const nextRun = new Date(Date.now() + delay);
    logger.info(`[DpcoRenewal] Next check scheduled for ${nextRun.toISOString()}`);
    renewalTimer = setTimeout(async () => {
      await sendDpcoRenewalReminders();
      scheduleNext();
    }, delay);
  };
  scheduleNext();
}

export function stopDpcoRenewalScheduler(): void {
  if (renewalTimer) {
    clearTimeout(renewalTimer);
    renewalTimer = null;
    logger.info("[DpcoRenewal] Stopped");
  }
}
