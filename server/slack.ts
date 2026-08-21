/**
 * NDSEP Slack Notification Utility
 * Sends structured alerts to a Slack channel via Incoming Webhook.
 *
 * Activated when SLACK_WEBHOOK_URL env var is set.
 * Gracefully no-ops when not configured.
 */

import { ENV } from "./_core/env";
import { logger } from "./logger";

export type SlackAlertSeverity = "critical" | "warning" | "info" | "resolved";

const SEVERITY_COLOR: Record<SlackAlertSeverity, string> = {
  critical: "#dc2626",
  warning:  "#f59e0b",
  info:     "#3b82f6",
  resolved: "#16a34a",
};

const SEVERITY_EMOJI: Record<SlackAlertSeverity, string> = {
  critical: "🚨",
  warning:  "⚠️",
  info:     "ℹ️",
  resolved: "✅",
};

export interface SlackAlertPayload {
  severity: SlackAlertSeverity;
  title: string;
  description: string;
  fields?: Array<{ title: string; value: string; short?: boolean }>;
  actionUrl?: string;
  actionLabel?: string;
}

/**
 * Send a structured alert to the configured Slack webhook.
 * Returns true on success, false if webhook is not configured or request fails.
 */
export async function sendSlackAlert(payload: SlackAlertPayload): Promise<boolean> {
  if (!ENV.slackWebhookUrl) {
    // Not configured — silent no-op in development
    return false;
  }

  const color = SEVERITY_COLOR[payload.severity];
  const emoji = SEVERITY_EMOJI[payload.severity];
  const now = new Date().toISOString();

  const attachment: Record<string, unknown> = {
    color,
    title: `${emoji} ${payload.title}`,
    text: payload.description,
    footer: "NDSEP Platform",
    footer_icon: "https://ndsep.nitda.gov.ng/favicon.ico",
    ts: Math.floor(Date.now() / 1000),
    fields: [
      { title: "Severity", value: payload.severity.toUpperCase(), short: true },
      { title: "Timestamp", value: now, short: true },
      ...(payload.fields ?? []),
    ],
  };

  if (payload.actionUrl) {
    attachment.actions = [{
      type: "button",
      text: payload.actionLabel ?? "View in NDSEP",
      url: payload.actionUrl,
      style: payload.severity === "critical" ? "danger" : "primary",
    }];
  }

  const body = {
    username: "NDSEP Alertmanager",
    icon_emoji: ":shield:",
    attachments: [attachment],
  };

  try {
    const res = await fetch(ENV.slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn(`[Slack] Webhook delivery failed: ${res.status} ${res.statusText}`);
      return false;
    }
    logger.info(`[Slack] Alert sent: ${payload.title}`);
    return true;
  } catch (err) {
    logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, "[Slack] Webhook error:");
    return false;
  }
}

/**
 * Send a PagerDuty event via Events API v2.
 * Activated when PAGERDUTY_INTEGRATION_KEY env var is set.
 */
export async function sendPagerDutyAlert(opts: {
  severity: "critical" | "error" | "warning" | "info";
  summary: string;
  source?: string;
  component?: string;
  dedupKey?: string;
}): Promise<boolean> {
  if (!ENV.pagerdutyKey) return false;

  try {
    const res = await fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routing_key: ENV.pagerdutyKey,
        event_action: "trigger",
        dedup_key: opts.dedupKey ?? `ndsep-${Date.now()}`,
        payload: {
          summary: opts.summary,
          severity: opts.severity,
          source: opts.source ?? "ndsep-api",
          component: opts.component ?? "enforcement-platform",
          timestamp: new Date().toISOString(),
          custom_details: {
            platform: "NDSEP",
            environment: ENV.isProduction ? "production" : "development",
          },
        },
      }),
    });
    if (!res.ok) {
      logger.warn(`[PagerDuty] Alert delivery failed: ${res.status}`);
      return false;
    }
    logger.info(`[PagerDuty] Alert triggered: ${opts.summary}`);
    return true;
  } catch (err) {
    logger.error({ err: err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err) }, "[PagerDuty] Error:");
    return false;
  }
}
