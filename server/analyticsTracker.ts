/**
 * NDSEP Product Analytics Tracker
 * =================================
 * Privacy-respecting analytics for product usage insights.
 * Tracks page views, feature usage, form completions, and errors.
 * All PII is anonymized before storage.
 *
 * Recommendation E2: Product analytics — usage tracking
 */

import crypto from "crypto";
import { Pool } from "pg";
import { logger } from "./logger";
import { handleError } from "./errorClassifier";

export type EventType =
  | "page_view" | "feature_use" | "form_start" | "form_complete"
  | "form_abandon" | "search" | "error" | "export" | "api_call";

export interface AnalyticsEvent {
  eventType: EventType;
  page: string;
  feature?: string;
  userId?: string;     // will be anonymized
  orgId?: number;
  role?: string;
  metadata?: Record<string, unknown>;
  duration?: number;   // ms
  timestamp?: Date;
}

const ANALYTICS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  page TEXT NOT NULL,
  feature TEXT,
  user_hash TEXT,
  org_id INTEGER,
  role TEXT,
  metadata JSONB DEFAULT '{}',
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_page ON analytics_events(page);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);
`;

export async function initAnalytics(pool: Pool): Promise<void> {
  try {
    await pool.query(ANALYTICS_TABLE_SQL);
    logger.info("[Analytics] Tracking system initialized");
  } catch (err) {
    handleError(err, { module: "analytics", action: "init" });
  }
}

/** Anonymize a user ID using one-way hash */
function anonymizeUserId(userId: string): string {
  return crypto.createHash("sha256").update(userId + (process.env.ANALYTICS_SALT ?? "ndsep")).digest("hex").substring(0, 16);
}

/** Track an analytics event */
export async function trackEvent(pool: Pool, event: AnalyticsEvent): Promise<void> {
  try {
    const userHash = event.userId ? anonymizeUserId(event.userId) : null;
    await pool.query(
      `INSERT INTO analytics_events (event_type, page, feature, user_hash, org_id, role, metadata, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [event.eventType, event.page, event.feature ?? null, userHash, event.orgId ?? null,
       event.role ?? null, JSON.stringify(event.metadata ?? {}), event.duration ?? null]
    );
  } catch (err) {
    // Analytics failures should never break the main app
    handleError(err, { module: "analytics", eventType: event.eventType });
  }
}

/** Get page view statistics */
export async function getPageStats(
  pool: Pool,
  days: number = 30
): Promise<Array<{ page: string; views: number; uniqueUsers: number; avgDuration: number }>> {
  const result = await pool.query(
    `SELECT page, COUNT(*) as views, COUNT(DISTINCT user_hash) as unique_users,
            AVG(duration_ms) as avg_duration
     FROM analytics_events
     WHERE event_type = 'page_view' AND created_at > NOW() - INTERVAL '1 day' * $1
     GROUP BY page ORDER BY views DESC LIMIT 50`,
    [days]
  );
  return result.rows.map(r => ({
    page: r.page,
    views: parseInt(r.views, 10),
    uniqueUsers: parseInt(r.unique_users, 10),
    avgDuration: Math.round(parseFloat(r.avg_duration ?? "0")),
  }));
}

/** Get feature usage statistics */
export async function getFeatureStats(
  pool: Pool,
  days: number = 30
): Promise<Array<{ feature: string; usageCount: number; uniqueUsers: number }>> {
  const result = await pool.query(
    `SELECT feature, COUNT(*) as usage_count, COUNT(DISTINCT user_hash) as unique_users
     FROM analytics_events
     WHERE event_type = 'feature_use' AND feature IS NOT NULL
       AND created_at > NOW() - INTERVAL '1 day' * $1
     GROUP BY feature ORDER BY usage_count DESC LIMIT 50`,
    [days]
  );
  return result.rows.map(r => ({
    feature: r.feature,
    usageCount: parseInt(r.usage_count, 10),
    uniqueUsers: parseInt(r.unique_users, 10),
  }));
}

/** Get form completion rates */
export async function getFormStats(
  pool: Pool,
  days: number = 30
): Promise<Array<{ page: string; starts: number; completions: number; abandonments: number; completionRate: number }>> {
  const result = await pool.query(
    `SELECT page,
            SUM(CASE WHEN event_type = 'form_start' THEN 1 ELSE 0 END) as starts,
            SUM(CASE WHEN event_type = 'form_complete' THEN 1 ELSE 0 END) as completions,
            SUM(CASE WHEN event_type = 'form_abandon' THEN 1 ELSE 0 END) as abandonments
     FROM analytics_events
     WHERE event_type IN ('form_start', 'form_complete', 'form_abandon')
       AND created_at > NOW() - INTERVAL '1 day' * $1
     GROUP BY page ORDER BY starts DESC`,
    [days]
  );
  return result.rows.map(r => {
    const starts = parseInt(r.starts, 10);
    const completions = parseInt(r.completions, 10);
    const abandonments = parseInt(r.abandonments, 10);
    return {
      page: r.page,
      starts,
      completions,
      abandonments,
      completionRate: starts > 0 ? Math.round((completions / starts) * 100) : 0,
    };
  });
}
