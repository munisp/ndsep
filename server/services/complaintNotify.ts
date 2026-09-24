/**
 * Complaint notification hooks — INTERFACE ONLY.
 *
 * SMS and email notification of complaint lifecycle events (submission
 * acknowledgement, status changes). No gateway is bundled or faked:
 *  - Without COMPLAINT_SMS_GATEWAY_URL + COMPLAINT_SMS_GATEWAY_KEY the SMS
 *    channel reports "UNCONFIGURED" and sends nothing.
 *  - Email: COMPLAINT_EMAIL_GATEWAY_URL + COMPLAINT_EMAIL_GATEWAY_KEY
 *    (generic HTTPS JSON gateway) or RESEND_API_KEY (Resend HTTPS API).
 *    Without either, the email channel reports "UNCONFIGURED".
 * A channel is only reported "sent" after a real 2xx response from the
 * configured gateway; transport failures are reported "failed" with the
 * diagnostic, never silently swallowed.
 */
import { logger } from "../logger";

export type NotificationChannelStatus = "sent" | "failed" | "skipped" | "UNCONFIGURED";

export interface NotificationResult {
  channel: "sms" | "email";
  status: NotificationChannelStatus;
  detail?: string;
}

export interface ComplaintNotification {
  to?: string | null;          // phone (SMS) or email address
  subject: string;
  body: string;
  referenceCode: string;
}

function smsGatewayConfig(): { url: string; key: string } | null {
  const url = process.env.COMPLAINT_SMS_GATEWAY_URL ?? "";
  const key = process.env.COMPLAINT_SMS_GATEWAY_KEY ?? "";
  if (!url || !key) return null;
  return { url, key };
}

function emailGatewayConfig(): { url: string; key: string } | null {
  const url = process.env.COMPLAINT_EMAIL_GATEWAY_URL ?? "";
  const key = process.env.COMPLAINT_EMAIL_GATEWAY_KEY ?? "";
  if (url && key) return { url, key };
  const resend = process.env.RESEND_API_KEY ?? "";
  if (resend) return { url: "https://api.resend.com/emails", key: resend };
  return null;
}

/** Configuration probe for dashboards/health: which channels are live? */
export function notificationChannelStatus(): { sms: "CONFIGURED" | "UNCONFIGURED"; email: "CONFIGURED" | "UNCONFIGURED" } {
  return {
    sms: smsGatewayConfig() ? "CONFIGURED" : "UNCONFIGURED",
    email: emailGatewayConfig() ? "CONFIGURED" : "UNCONFIGURED",
  };
}

/** SMS via a generic HTTPS JSON gateway (Termii/Twilio-style POST). */
export async function sendSms(n: ComplaintNotification): Promise<NotificationResult> {
  const cfg = smsGatewayConfig();
  if (!cfg) {
    return { channel: "sms", status: "UNCONFIGURED", detail: "COMPLAINT_SMS_GATEWAY_URL/KEY not set" };
  }
  if (!n.to) return { channel: "sms", status: "skipped", detail: "no recipient" };
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ to: n.to, message: `${n.referenceCode}: ${n.body}` }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { channel: "sms", status: "failed", detail: `gateway HTTP ${res.status}` };
    }
    return { channel: "sms", status: "sent" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, ref: n.referenceCode }, "[complaintNotify] SMS gateway error");
    return { channel: "sms", status: "failed", detail: msg };
  }
}

/**
 * Email hook via HTTPS JSON gateway (generic gateway or the Resend API).
 * Explicitly UNCONFIGURED when no gateway credentials exist — no fake success.
 */
export async function sendEmail(n: ComplaintNotification): Promise<NotificationResult> {
  const cfg = emailGatewayConfig();
  if (!cfg) {
    return { channel: "email", status: "UNCONFIGURED", detail: "no COMPLAINT_EMAIL_GATEWAY_URL/KEY or RESEND_API_KEY" };
  }
  if (!n.to) return { channel: "email", status: "skipped", detail: "no recipient" };
  const from = process.env.EMAIL_FROM ?? "NDPC Complaints <noreply@ndpc.gov.ng>";
  const html = `<p>${n.body.replace(/</g, "&lt;")}</p><p>Reference: <b>${n.referenceCode}</b></p>`;
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ from, to: [n.to], subject: n.subject, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { channel: "email", status: "failed", detail: `gateway HTTP ${res.status}` };
    }
    return { channel: "email", status: "sent" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, ref: n.referenceCode }, "[complaintNotify] email transport error");
    return { channel: "email", status: "failed", detail: msg };
  }
}

/** Fire both hooks; results are recorded to the complaint event log by the caller. */
export async function notifyComplainant(n: ComplaintNotification & { emailTo?: string | null; smsTo?: string | null }): Promise<NotificationResult[]> {
  const results: NotificationResult[] = [];
  results.push(await sendEmail({ ...n, to: n.emailTo ?? null }));
  results.push(await sendSms({ ...n, to: n.smsTo ?? null }));
  return results;
}
