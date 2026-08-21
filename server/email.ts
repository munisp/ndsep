/**
 * NDSEP Email Service
 * ===================
 * Production-grade email notifications using Resend.
 * Falls back gracefully (logs only) when RESEND_API_KEY is not configured.
 *
 * Templates:
 *  - penaltyIssued         → organization DPO + NITDA officer
 *  - citizenRequestUpdate  → citizen (data subject)
 *  - enforcementCaseOpened → organization DPO + assigned officer
 *  - appealStatusChanged   → organization DPO
 *  - slaBreachWarning      → organization DPO + NITDA compliance team
 */

import { logger } from "./logger";
import { sendMail } from "./mailer";
import { ENV } from "./_core/env";

// ─── Configuration ────────────────────────────────────────────────────────────

const NITDA_COMPLIANCE_EMAIL = ENV.nitdaComplianceEmail;
const PLATFORM_URL = ENV.platformUrl;

const log = logger.child({ module: "email" });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// ─── Internal Send Helper (delegates to unified mailer) ─────────────────────────

async function sendEmail(params: {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<EmailResult> {
  const result = await sendMail(params);
  if (!result.success) {
    log.error({ subject: params.subject, transport: result.transport }, "Email send failed");
    return { success: false, error: result.error };
  }
  log.info(
    { messageId: result.messageId, to: params.to, subject: params.subject, transport: result.transport },
    "Email sent"
  );
  return { success: true, messageId: result.messageId };
}

// ─── HTML Template Helper ─────────────────────────────────────────────────────

function baseTemplate(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #0a0e1a; color: #e2e8f0; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 32px auto; background: #111827; border-radius: 8px; overflow: hidden; border: 1px solid #1e3a5f; }
    .header { background: #0d2137; padding: 24px 32px; border-bottom: 2px solid #00d4ff; }
    .header h1 { margin: 0; font-size: 18px; color: #00d4ff; letter-spacing: 0.05em; text-transform: uppercase; }
    .header p { margin: 4px 0 0; font-size: 12px; color: #64748b; }
    .body { padding: 32px; }
    .body h2 { color: #f1f5f9; font-size: 20px; margin: 0 0 16px; }
    .body p { color: #94a3b8; line-height: 1.6; margin: 0 0 12px; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .badge-critical { background: #7f1d1d; color: #fca5a5; }
    .badge-warning  { background: #78350f; color: #fcd34d; }
    .badge-info     { background: #1e3a5f; color: #7dd3fc; }
    .badge-success  { background: #14532d; color: #86efac; }
    .detail-table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    .detail-table td { padding: 8px 12px; border-bottom: 1px solid #1e293b; font-size: 14px; }
    .detail-table td:first-child { color: #64748b; width: 40%; }
    .detail-table td:last-child { color: #e2e8f0; font-weight: 500; }
    .cta { display: inline-block; margin: 16px 0; padding: 12px 24px; background: #00d4ff; color: #0a0e1a; border-radius: 6px; text-decoration: none; font-weight: 700; font-size: 14px; }
    .footer { padding: 16px 32px; background: #0d2137; border-top: 1px solid #1e3a5f; font-size: 11px; color: #475569; }
    .footer a { color: #00d4ff; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>NDSEP — National Data Sovereignty Enforcement Platform</h1>
      <p>National Information Technology Development Agency (NITDA)</p>
    </div>
    <div class="body">${body}</div>
    <div class="footer">
      This is an automated notification from the NDSEP platform. Do not reply directly to this email.
      For queries, contact <a href="mailto:${NITDA_COMPLIANCE_EMAIL}">${NITDA_COMPLIANCE_EMAIL}</a>
      or visit <a href="${PLATFORM_URL}">${PLATFORM_URL}</a>.
    </div>
  </div>
</body>
</html>`;
}

// ─── Email Templates ──────────────────────────────────────────────────────────

/**
 * Notify organization DPO and NITDA officer when a financial penalty is issued.
 */
export async function sendPenaltyIssuedEmail(params: {
  toOrgEmail: string;
  orgName: string;
  penaltyAmount: number;
  currency: string;
  reason: string;
  penaltyRef: string;
  dueDate: string;
  officerEmail?: string;
}): Promise<EmailResult> {
  const formattedAmount = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: params.currency || "NGN",
    maximumFractionDigits: 0,
  }).format(params.penaltyAmount);

  const body = `
    <h2>Financial Penalty Notice</h2>
    <p>A financial penalty has been issued against your organization under the Nigeria Data Protection Act (NDPA) 2023.</p>
    <span class="badge badge-critical">ENFORCEMENT ACTION</span>
    <table class="detail-table">
      <tr><td>Organization</td><td>${params.orgName}</td></tr>
      <tr><td>Penalty Reference</td><td>${params.penaltyRef}</td></tr>
      <tr><td>Amount</td><td>${formattedAmount}</td></tr>
      <tr><td>Reason</td><td>${params.reason}</td></tr>
      <tr><td>Payment Due</td><td>${params.dueDate}</td></tr>
    </table>
    <p>You have the right to appeal this penalty within <strong>30 days</strong> of receipt. To submit an appeal, log in to the NDSEP portal.</p>
    <a href="${PLATFORM_URL}/financial" class="cta">View Penalty Details</a>
    <p style="margin-top:16px;font-size:12px;color:#64748b;">
      Failure to pay within the due date may result in additional enforcement actions under NDPA Section 48.
    </p>
  `;

  const recipients = [params.toOrgEmail];
  if (params.officerEmail) recipients.push(params.officerEmail);

  return sendEmail({
    to: recipients,
    subject: `[NDSEP] Financial Penalty Issued — ${params.orgName} — ${formattedAmount}`,
    html: baseTemplate("Financial Penalty Notice", body),
    replyTo: NITDA_COMPLIANCE_EMAIL,
  });
}

/**
 * Notify a citizen (data subject) when their rights request status changes.
 */
export async function sendCitizenRequestUpdateEmail(params: {
  toCitizenEmail: string;
  citizenName: string;
  requestType: string;
  requestRef: string;
  newStatus: string;
  message?: string;
  orgName: string;
}): Promise<EmailResult> {
  const statusBadge: Record<string, string> = {
    acknowledged: "badge-info",
    in_progress: "badge-info",
    completed: "badge-success",
    rejected: "badge-critical",
    overdue: "badge-warning",
  };
  const badgeClass = statusBadge[params.newStatus] ?? "badge-info";
  const statusLabel = params.newStatus.replace(/_/g, " ").toUpperCase();

  const body = `
    <h2>Your Data Rights Request Has Been Updated</h2>
    <p>Dear ${params.citizenName},</p>
    <p>Your data rights request has been updated by <strong>${params.orgName}</strong>.</p>
    <span class="badge ${badgeClass}">${statusLabel}</span>
    <table class="detail-table">
      <tr><td>Request Reference</td><td>${params.requestRef}</td></tr>
      <tr><td>Request Type</td><td>${params.requestType}</td></tr>
      <tr><td>Organization</td><td>${params.orgName}</td></tr>
      <tr><td>New Status</td><td>${statusLabel}</td></tr>
    </table>
    ${params.message ? `<p><strong>Message from organization:</strong><br/>${params.message}</p>` : ""}
    <p>Under the Nigeria Data Protection Act 2023, organizations must respond to data rights requests within <strong>30 days</strong>.</p>
    <a href="${PLATFORM_URL}/citizen-rights" class="cta">Track Your Request</a>
    <p style="margin-top:16px;font-size:12px;color:#64748b;">
      If you believe your rights have been violated, you may file a complaint with NITDA at
      <a href="mailto:${NITDA_COMPLIANCE_EMAIL}" style="color:#00d4ff;">${NITDA_COMPLIANCE_EMAIL}</a>.
    </p>
  `;

  return sendEmail({
    to: params.toCitizenEmail,
    subject: `[NDSEP] Data Rights Request Update — ${statusLabel} — Ref: ${params.requestRef}`,
    html: baseTemplate("Data Rights Request Update", body),
    replyTo: NITDA_COMPLIANCE_EMAIL,
  });
}

/**
 * Notify the organization DPO and assigned NITDA officer when an enforcement case is opened.
 */
export async function sendEnforcementCaseOpenedEmail(params: {
  toOrgEmail: string;
  orgName: string;
  caseRef: string;
  caseTitle: string;
  severity: string;
  assignedOfficer?: string;
  officerEmail?: string;
}): Promise<EmailResult> {
  const severityBadge: Record<string, string> = {
    critical: "badge-critical",
    high: "badge-critical",
    medium: "badge-warning",
    low: "badge-info",
  };
  const badgeClass = severityBadge[params.severity.toLowerCase()] ?? "badge-warning";

  const body = `
    <h2>Enforcement Case Opened</h2>
    <p>An enforcement case has been opened against your organization by NITDA under the Nigeria Data Protection Act 2023.</p>
    <span class="badge ${badgeClass}">${params.severity.toUpperCase()} SEVERITY</span>
    <table class="detail-table">
      <tr><td>Organization</td><td>${params.orgName}</td></tr>
      <tr><td>Case Reference</td><td>${params.caseRef}</td></tr>
      <tr><td>Case Title</td><td>${params.caseTitle}</td></tr>
      <tr><td>Severity</td><td>${params.severity.toUpperCase()}</td></tr>
      ${params.assignedOfficer ? `<tr><td>Assigned Officer</td><td>${params.assignedOfficer}</td></tr>` : ""}
    </table>
    <p>Your organization is required to cooperate fully with this investigation. A formal notice will be served within <strong>5 business days</strong>.</p>
    <a href="${PLATFORM_URL}/enforcement-cases" class="cta">View Case Details</a>
    <p style="margin-top:16px;font-size:12px;color:#64748b;">
      Failure to cooperate may result in escalated enforcement actions under NDPA Section 48.
    </p>
  `;

  const recipients = [params.toOrgEmail];
  if (params.officerEmail) recipients.push(params.officerEmail);

  return sendEmail({
    to: recipients,
    subject: `[NDSEP] Enforcement Case Opened — ${params.caseRef} — ${params.orgName}`,
    html: baseTemplate("Enforcement Case Opened", body),
    replyTo: NITDA_COMPLIANCE_EMAIL,
  });
}

/**
 * Notify the organization DPO when their penalty appeal status changes.
 */
export async function sendAppealStatusChangedEmail(params: {
  toOrgEmail: string;
  orgName: string;
  appealRef: string;
  penaltyRef: string;
  newStatus: string;
  reviewNotes?: string;
}): Promise<EmailResult> {
  const statusBadge: Record<string, string> = {
    under_review: "badge-info",
    approved: "badge-success",
    rejected: "badge-critical",
    upheld: "badge-warning",
  };
  const badgeClass = statusBadge[params.newStatus] ?? "badge-info";
  const statusLabel = params.newStatus.replace(/_/g, " ").toUpperCase();

  const body = `
    <h2>Penalty Appeal Status Update</h2>
    <p>The status of your penalty appeal has been updated.</p>
    <span class="badge ${badgeClass}">${statusLabel}</span>
    <table class="detail-table">
      <tr><td>Organization</td><td>${params.orgName}</td></tr>
      <tr><td>Appeal Reference</td><td>${params.appealRef}</td></tr>
      <tr><td>Penalty Reference</td><td>${params.penaltyRef}</td></tr>
      <tr><td>Decision</td><td>${statusLabel}</td></tr>
    </table>
    ${params.reviewNotes ? `<p><strong>Review Notes:</strong><br/>${params.reviewNotes}</p>` : ""}
    <a href="${PLATFORM_URL}/financial" class="cta">View Appeal Details</a>
  `;

  return sendEmail({
    to: params.toOrgEmail,
    subject: `[NDSEP] Appeal Decision — ${statusLabel} — ${params.appealRef}`,
    html: baseTemplate("Penalty Appeal Status Update", body),
    replyTo: NITDA_COMPLIANCE_EMAIL,
  });
}

/**
 * Notify the organization DPO when a citizen request SLA is approaching breach.
 */
export async function sendSlaBreachWarningEmail(params: {
  toOrgEmail: string;
  orgName: string;
  overdueCount: number;
  approachingCount: number;
}): Promise<EmailResult> {
  const body = `
    <h2>Citizen Rights Request SLA Warning</h2>
    <p>Your organization has citizen data rights requests that are approaching or have exceeded the statutory 30-day response deadline.</p>
    <span class="badge badge-warning">SLA WARNING</span>
    <table class="detail-table">
      <tr><td>Organization</td><td>${params.orgName}</td></tr>
      <tr><td>Overdue Requests</td><td style="color:#fca5a5;">${params.overdueCount}</td></tr>
      <tr><td>Approaching Deadline (≤5 days)</td><td style="color:#fcd34d;">${params.approachingCount}</td></tr>
    </table>
    <p>Failure to respond within the statutory deadline constitutes a violation of the Nigeria Data Protection Act 2023 and may result in enforcement action.</p>
    <a href="${PLATFORM_URL}/citizen-rights" class="cta">Review Pending Requests</a>
  `;

  return sendEmail({
    to: [params.toOrgEmail, NITDA_COMPLIANCE_EMAIL],
    subject: `[NDSEP] SLA Warning — ${params.overdueCount} Overdue Citizen Requests — ${params.orgName}`,
    html: baseTemplate("Citizen Rights Request SLA Warning", body),
    replyTo: NITDA_COMPLIANCE_EMAIL,
  });
}
