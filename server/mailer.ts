/**
 * NDSEP Unified Mailer
 * =====================
 * Three-tier email delivery with automatic fallback:
 *
 *  1. SMTP (nodemailer)  — set SMTP_HOST + SMTP_USER + SMTP_PASS
 *  2. Resend             — set RESEND_API_KEY
 *  3. Manus Forge relay  — always available, zero config (owner notification only)
 *
 * All callers use `sendMail()` — transport selection is transparent.
 */

import nodemailer from "nodemailer";
import { Resend } from "resend";
import { ENV } from "./_core/env";
import { logger } from "./logger";
import { notifyOwner } from "./_core/notification";

const log = logger.child({ module: "mailer" });

export interface MailOptions {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  /** Inline attachments (e.g. PDF invoice) */
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

export interface MailResult {
  success: boolean;
  transport: "smtp" | "resend" | "forge" | "suppressed";
  messageId?: string;
  error?: string;
}

// ─── Transport 1: SMTP (nodemailer) ──────────────────────────────────────────

function buildSmtpTransport() {
  if (!ENV.smtpHost || !ENV.smtpUser || !ENV.smtpPass) return null;
  return nodemailer.createTransport({
    host: ENV.smtpHost,
    port: ENV.smtpPort,
    secure: ENV.smtpSecure,
    auth: { user: ENV.smtpUser, pass: ENV.smtpPass },
    tls: { rejectUnauthorized: ENV.isProduction },
  });
}

// ─── Transport 2: Resend ──────────────────────────────────────────────────────

const resendClient = ENV.resendApiKey ? new Resend(ENV.resendApiKey) : null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send an email using the best available transport.
 * Never throws — returns a MailResult with success/error details.
 */
export async function sendMail(opts: MailOptions): Promise<MailResult> {
  const toList = Array.isArray(opts.to) ? opts.to : [opts.to];

  // ── Tier 1: SMTP ────────────────────────────────────────────────────────
  const smtp = buildSmtpTransport();
  if (smtp) {
    try {
      const info = await smtp.sendMail({
        from: ENV.smtpFrom,
        to: toList.join(", "),
        subject: opts.subject,
        html: opts.html,
        replyTo: opts.replyTo,
        attachments: opts.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
      log.info({ messageId: info.messageId, to: toList, subject: opts.subject }, "Email sent via SMTP");
      return { success: true, transport: "smtp", messageId: info.messageId };
    } catch (err: unknown) {
      log.error({ err, subject: opts.subject }, "SMTP send failed — falling back to Resend");
    }
  }

  // ── Tier 2: Resend ───────────────────────────────────────────────────────
  if (resendClient) {
    try {
      const { data, error } = await resendClient.emails.send({
        from: ENV.emailFrom,
        to: toList,
        subject: opts.subject,
        html: opts.html,
        replyTo: opts.replyTo,
        attachments: opts.attachments?.map((a) => ({
          filename: a.filename,
          content:
            typeof a.content === "string"
              ? a.content
              : a.content.toString("base64"),
        })),
      });
      if (error) {
        log.error({ error, subject: opts.subject }, "Resend send failed — falling back to Forge relay");
      } else {
        log.info({ messageId: data?.id, to: toList, subject: opts.subject }, "Email sent via Resend");
        return { success: true, transport: "resend", messageId: data?.id };
      }
    } catch (err: unknown) {
      log.error({ err, subject: opts.subject }, "Resend exception — falling back to Forge relay");
    }
  }

  // ── Tier 3: Manus Forge relay (owner notification only) ─────────────────
  try {
    const ok = await notifyOwner({
      title: `[Email] ${opts.subject}`,
      content: `**To:** ${toList.join(", ")}\n\n${opts.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`,
    });
    if (ok) {
      log.info({ to: toList, subject: opts.subject }, "Email relayed via Forge notification");
      return { success: true, transport: "forge" };
    }
  } catch (err: unknown) {
    log.error({ err, subject: opts.subject }, "Forge relay failed");
  }

  log.warn({ to: toList, subject: opts.subject }, "All email transports failed — suppressed");
  return { success: false, transport: "suppressed", error: "All transports failed" };
}

/**
 * Test the currently configured SMTP transport.
 * Returns { ok, transport, error }.
 */
export async function testSmtpConnection(): Promise<{
  ok: boolean;
  transport: string;
  host?: string;
  port?: number;
  error?: string;
}> {
  const smtp = buildSmtpTransport();
  if (!smtp) {
    return { ok: false, transport: "none", error: "SMTP_HOST / SMTP_USER / SMTP_PASS not configured" };
  }
  try {
    await smtp.verify();
    return { ok: true, transport: "smtp", host: ENV.smtpHost, port: ENV.smtpPort };
  } catch (err: unknown) {
    return { ok: false, transport: "smtp", host: ENV.smtpHost, port: ENV.smtpPort, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * Returns the active transport name for display in the admin settings UI.
 */
export function activeTransport(): "smtp" | "resend" | "forge" {
  if (ENV.smtpHost && ENV.smtpUser && ENV.smtpPass) return "smtp";
  if (ENV.resendApiKey) return "resend";
  return "forge";
}
