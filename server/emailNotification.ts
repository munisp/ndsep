/**
 * NDSEP Email Notification Service
 * Sends automated enforcement notices, certificate grants, and appeal updates.
 *
 * Transport priority:
 *   1. Resend (if RESEND_API_KEY is set) — production transactional email
 *   2. Manus Forge notification API — fallback / development
 */

import { Resend } from "resend";
import { ENV } from "./_core/env";
import { logger } from "./logger";

const _resend = ENV.resendApiKey ? new Resend(ENV.resendApiKey) : null;
const FROM_ADDRESS = ENV.emailFrom;

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

// ─── Low-level send ───────────────────────────────────────────────────────────

async function sendEmail(payload: EmailPayload): Promise<boolean> {
  // ── Primary: Resend ──────────────────────────────────────────────────────
  if (_resend) {
    try {
      const { data, error } = await _resend.emails.send({
        from: FROM_ADDRESS,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text ?? payload.html.replace(/<[^>]+>/g, ""),
        replyTo: ENV.nitdaComplianceEmail,
      });
      if (error) {
        logger.warn(`[EmailNotification] Resend error for ${payload.to}: ${error.message}`);
      } else {
        logger.info(`[EmailNotification] Sent via Resend id=${data?.id} to ${payload.to}`);
        return true;
      }
    } catch (err) {
      logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, "[EmailNotification] Resend exception:");
    }
  }
  // ── Fallback: Manus Forge API ────────────────────────────────────────────
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
        text: payload.text ?? payload.html.replace(/<[^>]+>/g, ""),
      }),
    });
    if (!res.ok) {
      logger.warn(`[EmailNotification] Forge fallback failed for ${payload.to}: ${res.status}`);
      return false;
    }
    logger.info(`[EmailNotification] Sent via Forge to ${payload.to}`);
    return true;
  } catch (err) {
    logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, "[EmailNotification] Forge fallback error:");
    return false;
  }
}

// ─── Template helpers ─────────────────────────────────────────────────────────

function baseTemplate(title: string, body: string, cta?: { label: string; url: string }): string {
  const ctaHtml = cta
    ? `<p style="margin:24px 0"><a href="${cta.url}" style="background:#1a3a5c;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">${cta.label}</a></p>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:0">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
<tr><td style="background:#1a3a5c;padding:24px 32px">
  <h1 style="color:#fff;margin:0;font-size:20px">🇳🇬 National Data Sovereignty Enforcement Platform</h1>
  <p style="color:#a0b4c8;margin:4px 0 0;font-size:13px">Official Enforcement Communication</p>
</td></tr>
<tr><td style="padding:32px">
  <h2 style="color:#1a3a5c;margin:0 0 16px">${title}</h2>
  ${body}
  ${ctaHtml}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
  <p style="color:#6b7280;font-size:12px;margin:0">
    This is an automated message from the NDSEP. Do not reply directly to this email.
    For support, contact <a href="mailto:compliance@ndsep.gov.ng">compliance@ndsep.gov.ng</a>.
  </p>
</td></tr>
</table></td></tr></table></body></html>`;
}

// ─── Enforcement notice ───────────────────────────────────────────────────────

export async function sendPenaltyNotice(opts: {
  to: string;
  orgName: string;
  penaltyId: number;
  amount: number;
  currency: string;
  description: string;
  dueDate?: Date;
  portalUrl?: string;
}): Promise<boolean> {
  const due = opts.dueDate ? opts.dueDate.toLocaleDateString("en-NG") : "30 days from issuance";
  const body = `
    <p>Dear <strong>${opts.orgName}</strong>,</p>
    <p>The National Data Sovereignty Enforcement Platform has issued a <strong>financial penalty</strong> against your organisation under the Nigeria Data Protection Act (NDPA) 2023.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr style="background:#f8fafc"><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Penalty Reference</td><td style="padding:8px 12px;border:1px solid #e5e7eb">NDSEP-PEN-${String(opts.penaltyId).padStart(6, "0")}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Amount Due</td><td style="padding:8px 12px;border:1px solid #e5e7eb;color:#dc2626;font-weight:700">${opts.currency} ${opts.amount.toLocaleString()}</td></tr>
      <tr style="background:#f8fafc"><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Due Date</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${due}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Reason</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${opts.description}</td></tr>
    </table>
    <p>You may appeal this penalty within <strong>30 days</strong> through the NDSEP Organisation Portal. Failure to pay or appeal by the due date will result in escalation to the NITDA enforcement division.</p>
  `;
  return sendEmail({
    to: opts.to,
    subject: `[NDSEP] Penalty Notice — ${opts.currency} ${opts.amount.toLocaleString()} — ${opts.orgName}`,
    html: baseTemplate("Financial Penalty Notice", body, opts.portalUrl ? { label: "View & Appeal in Portal", url: opts.portalUrl } : undefined),
  });
}

// ─── Certificate granted ──────────────────────────────────────────────────────

export async function sendCertificateGranted(opts: {
  to: string;
  orgName: string;
  certToken: string;
  complianceScore: number;
  certifiedAt: Date;
  verifyBaseUrl?: string;
}): Promise<boolean> {
  const verifyUrl = `${opts.verifyBaseUrl ?? "https://ndsep.gov.ng"}/verify/${opts.certToken}`;
  const body = `
    <p>Dear <strong>${opts.orgName}</strong>,</p>
    <p>Congratulations! Your organisation has successfully completed the NDSEP compliance certification process and has been awarded the <strong>NDSEP Data Sovereignty Compliance Certificate</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr style="background:#f0fdf4"><td style="padding:8px 12px;border:1px solid #bbf7d0;font-weight:600">Certificate Token</td><td style="padding:8px 12px;border:1px solid #bbf7d0;font-family:monospace">${opts.certToken}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #bbf7d0;font-weight:600">Compliance Score</td><td style="padding:8px 12px;border:1px solid #bbf7d0;color:#16a34a;font-weight:700">${opts.complianceScore}/100</td></tr>
      <tr style="background:#f0fdf4"><td style="padding:8px 12px;border:1px solid #bbf7d0;font-weight:600">Certified On</td><td style="padding:8px 12px;border:1px solid #bbf7d0">${opts.certifiedAt.toLocaleDateString("en-NG")}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #bbf7d0;font-weight:600">Verification URL</td><td style="padding:8px 12px;border:1px solid #bbf7d0"><a href="${verifyUrl}">${verifyUrl}</a></td></tr>
    </table>
    <p>Your certificate is publicly verifiable. Share the verification link with banks, investors, and partners to demonstrate your data sovereignty compliance status.</p>
    <p>The certificate is valid for <strong>12 months</strong> from the date of issuance, subject to continuous monitoring by the NDSEP platform.</p>
  `;
  return sendEmail({
    to: opts.to,
    subject: `[NDSEP] 🎉 Compliance Certificate Granted — ${opts.orgName}`,
    html: baseTemplate("NDSEP Compliance Certificate Granted", body, { label: "Verify Certificate", url: verifyUrl }),
  });
}

// ─── Appeal status update ─────────────────────────────────────────────────────

export async function sendAppealUpdate(opts: {
  to: string;
  orgName: string;
  appealId: number;
  penaltyId: number;
  decision: "upheld" | "dismissed" | "under_review";
  notes?: string;
  portalUrl?: string;
}): Promise<boolean> {
  const decisionLabel: Record<string, string> = {
    upheld: "✅ Appeal Upheld",
    dismissed: "❌ Appeal Dismissed",
    under_review: "🔍 Under Review",
  };
  const decisionColor: Record<string, string> = {
    upheld: "#16a34a",
    dismissed: "#dc2626",
    under_review: "#d97706",
  };
  const body = `
    <p>Dear <strong>${opts.orgName}</strong>,</p>
    <p>Your penalty appeal (Reference: NDSEP-APP-${String(opts.appealId).padStart(6, "0")}) against Penalty NDSEP-PEN-${String(opts.penaltyId).padStart(6, "0")} has been reviewed.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr style="background:#f8fafc"><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Decision</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:700;color:${decisionColor[opts.decision]}">${decisionLabel[opts.decision]}</td></tr>
      ${opts.notes ? `<tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Reviewer Notes</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${opts.notes}</td></tr>` : ""}
    </table>
    ${opts.decision === "upheld" ? "<p>The penalty has been waived or reduced as per the appeal decision. No further action is required.</p>" : ""}
    ${opts.decision === "dismissed" ? "<p>The original penalty stands. Please ensure payment is made by the original due date to avoid escalation.</p>" : ""}
    ${opts.decision === "under_review" ? "<p>Your appeal is being reviewed by the NDSEP Enforcement Committee. You will receive a final decision within 15 business days.</p>" : ""}
  `;
  return sendEmail({
    to: opts.to,
    subject: `[NDSEP] Appeal Update — ${decisionLabel[opts.decision]} — ${opts.orgName}`,
    html: baseTemplate("Penalty Appeal Decision", body, opts.portalUrl ? { label: "View in Portal", url: opts.portalUrl } : undefined),
  });
}

// ─── Portal phase advance ─────────────────────────────────────────────────────

export async function sendPortalPhaseUpdate(opts: {
  to: string;
  orgName: string;
  submissionToken: string;
  newPhase: string;
  notes?: string;
  portalUrl?: string;
}): Promise<boolean> {
  const phaseLabels: Record<string, string> = {
    submitted: "Submission Received",
    document_review: "Document Review",
    technical_assessment: "Technical Assessment",
    field_audit: "Field Audit",
    remediation: "Remediation Period",
    final_review: "Final Review",
    certified: "🎉 Certified",
  };
  const label = phaseLabels[opts.newPhase] ?? opts.newPhase;
  const body = `
    <p>Dear <strong>${opts.orgName}</strong>,</p>
    <p>Your NDSEP compliance registration has advanced to a new phase:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr style="background:#eff6ff"><td style="padding:8px 12px;border:1px solid #bfdbfe;font-weight:600">Current Phase</td><td style="padding:8px 12px;border:1px solid #bfdbfe;font-weight:700;color:#1d4ed8">${label}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #bfdbfe;font-weight:600">Reference</td><td style="padding:8px 12px;border:1px solid #bfdbfe;font-family:monospace">${opts.submissionToken}</td></tr>
      ${opts.notes ? `<tr style="background:#eff6ff"><td style="padding:8px 12px;border:1px solid #bfdbfe;font-weight:600">Reviewer Notes</td><td style="padding:8px 12px;border:1px solid #bfdbfe">${opts.notes}</td></tr>` : ""}
    </table>
    <p>Log in to the NDSEP Organisation Portal to view your full submission status and any required actions.</p>
  `;
  return sendEmail({
    to: opts.to,
    subject: `[NDSEP] Registration Update — ${label} — ${opts.orgName}`,
    html: baseTemplate(`Registration Phase: ${label}`, body, opts.portalUrl ? { label: "View in Portal", url: opts.portalUrl } : undefined),
  });
}

// ─── Citizen request status update ───────────────────────────────────────────

export async function sendCitizenRequestUpdate(opts: {
  to: string;
  citizenName: string;
  requestType: string;
  requestRef: string;
  newStatus: string;
  orgName: string;
  message?: string;
  portalUrl?: string;
}): Promise<boolean> {
  const statusColors: Record<string, string> = {
    acknowledged: "#1d4ed8",
    in_progress: "#0891b2",
    completed: "#16a34a",
    rejected: "#dc2626",
    overdue: "#d97706",
  };
  const color = statusColors[opts.newStatus] ?? "#1a3a5c";
  const statusLabel = opts.newStatus.replace(/_/g, " ").toUpperCase();

  const body = `
    <p>Dear <strong>${opts.citizenName}</strong>,</p>
    <p>Your data rights request submitted to <strong>${opts.orgName}</strong> has been updated.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr style="background:#f8fafc">
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Request Reference</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:monospace">${opts.requestRef}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Request Type</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${opts.requestType}</td>
      </tr>
      <tr style="background:#f8fafc">
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Organization</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${opts.orgName}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">New Status</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:700;color:${color}">${statusLabel}</td>
      </tr>
      ${opts.message ? `<tr style="background:#f8fafc"><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Message</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${opts.message}</td></tr>` : ""}
    </table>
    <p>Under the Nigeria Data Protection Act 2023, organizations must respond to data rights requests within <strong>30 days</strong>.</p>
    <p>If you believe your rights have been violated, you may file a complaint with NITDA at <a href="mailto:compliance@nitda.gov.ng">compliance@nitda.gov.ng</a>.</p>
  `;

  return sendEmail({
    to: opts.to,
    subject: `[NDSEP] Data Rights Request Update — ${statusLabel} — Ref: ${opts.requestRef}`,
    html: baseTemplate("Data Rights Request Update", body, opts.portalUrl ? { label: "Track Your Request", url: opts.portalUrl } : undefined),
  });
}

// ─── Enforcement case opened ──────────────────────────────────────────────────

export async function sendEnforcementCaseOpened(opts: {
  to: string;
  orgName: string;
  caseRef: string;
  caseTitle: string;
  severity: string;
  assignedOfficer?: string;
  officerEmail?: string;
  portalUrl?: string;
}): Promise<boolean> {
  const severityColors: Record<string, string> = {
    critical: "#dc2626",
    high: "#ea580c",
    medium: "#d97706",
    low: "#2563eb",
  };
  const color = severityColors[opts.severity.toLowerCase()] ?? "#d97706";

  const body = `
    <p>Dear <strong>${opts.orgName}</strong>,</p>
    <p>An enforcement case has been opened against your organization by NITDA under the Nigeria Data Protection Act 2023.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr style="background:#f8fafc">
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Case Reference</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:monospace">${opts.caseRef}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Case Title</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${opts.caseTitle}</td>
      </tr>
      <tr style="background:#f8fafc">
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Severity</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:700;color:${color}">${opts.severity.toUpperCase()}</td>
      </tr>
      ${opts.assignedOfficer ? `<tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Assigned Officer</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${opts.assignedOfficer}</td></tr>` : ""}
    </table>
    <p>Your organization is required to cooperate fully with this investigation. A formal notice will be served within <strong>5 business days</strong>.</p>
    <p style="color:#dc2626;font-weight:600">Failure to cooperate may result in escalated enforcement actions under NDPA Section 48.</p>
  `;

  const recipients = [opts.to];
  if (opts.officerEmail && opts.officerEmail !== opts.to) {
    // Send a separate copy to the officer
    sendEmail({
      to: opts.officerEmail,
      subject: `[NDSEP] Case Assigned — ${opts.caseRef} — ${opts.orgName}`,
      html: baseTemplate("Enforcement Case Assigned", body, opts.portalUrl ? { label: "View Case", url: opts.portalUrl } : undefined),
    }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
  }

  return sendEmail({
    to: opts.to,
    subject: `[NDSEP] Enforcement Case Opened — ${opts.caseRef} — ${opts.orgName}`,
    html: baseTemplate("Enforcement Case Opened", body, opts.portalUrl ? { label: "View Case Details", url: opts.portalUrl } : undefined),
  });
}
