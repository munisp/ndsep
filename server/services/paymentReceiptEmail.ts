/**
 * Payment receipt email (gap 12)
 *
 * Mirrors the transport pattern of server/emailNotification.ts (Resend primary,
 * Manus Forge fallback). Kept in a separate module because
 * emailNotification.ts is a shared read-only dependency in this workstream.
 */
import { Resend } from "resend";
import { ENV } from "../_core/env";
import { logger } from "../logger";

const _resend = ENV.resendApiKey ? new Resend(ENV.resendApiKey) : null;
const FROM_ADDRESS = ENV.emailFrom;

async function sendEmail(payload: { to: string; subject: string; html: string }): Promise<boolean> {
  if (_resend) {
    try {
      const { data, error } = await _resend.emails.send({
        from: FROM_ADDRESS,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.html.replace(/<[^>]+>/g, ""),
        replyTo: ENV.nitdaComplianceEmail,
      });
      if (error) {
        logger.warn(`[ReceiptEmail] Resend error for ${payload.to}: ${error.message}`);
      } else {
        logger.info(`[ReceiptEmail] Sent via Resend id=${data?.id} to ${payload.to}`);
        return true;
      }
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "[ReceiptEmail] Resend exception");
    }
  }
  try {
    const res = await fetch(`${ENV.forgeApiUrl}/v1/notifications/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ENV.forgeApiKey}` },
      body: JSON.stringify({ to: payload.to, subject: payload.subject, html: payload.html, text: payload.html.replace(/<[^>]+>/g, "") }),
    });
    if (!res.ok) {
      logger.warn(`[ReceiptEmail] Forge fallback failed for ${payload.to}: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[ReceiptEmail] Forge fallback error");
    return false;
  }
}

function baseTemplate(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:0">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
<tr><td style="background:#1a3a5c;padding:24px 32px">
  <h1 style="color:#fff;margin:0;font-size:20px">National Data Sovereignty Enforcement Platform</h1>
  <p style="color:#a0b4c8;margin:4px 0 0;font-size:13px">Official Payment Receipt</p>
</td></tr>
<tr><td style="padding:32px">
  <h2 style="color:#1a3a5c;margin:0 0 16px">${title}</h2>
  ${body}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
  <p style="color:#6b7280;font-size:12px;margin:0">
    This is an automated message from the NDSEP. Do not reply directly to this email.
    For support, contact <a href="mailto:compliance@ndsep.gov.ng">compliance@ndsep.gov.ng</a>.
  </p>
</td></tr>
</table></td></tr></table></body></html>`;
}

/** Issue the official payment receipt email for a settled penalty payment. */
export async function sendPaymentReceipt(opts: {
  to: string;
  orgName: string;
  receiptNumber: string;
  rrr: string;
  amount: number;
  currency: string;
  penaltyRef?: string;
  paidAt: Date;
}): Promise<boolean> {
  const body = `
    <p>Dear <strong>${opts.orgName}</strong>,</p>
    <p>This confirms receipt of your penalty payment under the Nigeria Data Protection Act (NDPA) 2023.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr style="background:#f0fdf4"><td style="padding:8px 12px;border:1px solid #bbf7d0;font-weight:600">Receipt Number</td><td style="padding:8px 12px;border:1px solid #bbf7d0;font-family:monospace">${opts.receiptNumber}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">RRR</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:monospace">${opts.rrr}</td></tr>
      <tr style="background:#f8fafc"><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Amount Paid</td><td style="padding:8px 12px;border:1px solid #e5e7eb;color:#16a34a;font-weight:700">${opts.currency} ${opts.amount.toLocaleString()}</td></tr>
      ${opts.penaltyRef ? `<tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Penalty Reference</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${opts.penaltyRef}</td></tr>` : ""}
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">Paid At</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${opts.paidAt.toLocaleString("en-NG")}</td></tr>
    </table>
    <p>Retain this receipt as proof of settlement. It is verifiable against NDPC records by receipt number.</p>
  `;
  return sendEmail({
    to: opts.to,
    subject: `[NDSEP] Payment Receipt ${opts.receiptNumber} — ${opts.currency} ${opts.amount.toLocaleString()}`,
    html: baseTemplate("Official Payment Receipt", body),
  });
}
