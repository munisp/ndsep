/**
 * NDSEP Breach Notification Timer — 72-Hour NDPA Countdown
 * =========================================================
 * NDPA requires notification to NDPC within 72 hours of breach discovery.
 * This module provides automated countdown, escalation, and audit trail.
 *
 * Recommendation M15: Automated breach notification deadline enforcement
 */

import { Pool } from "pg";
import { logger } from "./logger";
import { handleError } from "./errorClassifier";

export interface BreachTimer {
  breachId: number;
  discoveredAt: Date;
  deadlineAt: Date;        // discovered + 72 hours
  notifiedAt: Date | null;
  escalationsSent: number;
  status: "active" | "notified" | "overdue" | "escalated";
}

const BREACH_DEADLINE_HOURS = 72;
const ESCALATION_THRESHOLDS_HOURS = [24, 48, 60, 66, 70, 71]; // hours remaining

const TIMER_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS breach_timers (
  breach_id INTEGER PRIMARY KEY REFERENCES breach_incidents(id),
  discovered_at TIMESTAMPTZ NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL,
  notified_at TIMESTAMPTZ,
  escalations_sent INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'notified', 'overdue', 'escalated')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

export async function initBreachTimers(pool: Pool): Promise<void> {
  try {
    await pool.query(TIMER_TABLE_SQL);
    logger.info("[BreachTimer] Table initialized");
  } catch (err) {
    handleError(err, { module: "breachTimer", action: "init" });
  }
}

/** Start a 72-hour countdown for a new breach */
export async function startBreachTimer(pool: Pool, breachId: number, discoveredAt: Date = new Date()): Promise<BreachTimer> {
  const deadlineAt = new Date(discoveredAt.getTime() + BREACH_DEADLINE_HOURS * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO breach_timers (breach_id, discovered_at, deadline_at, status)
     VALUES ($1, $2, $3, 'active')
     ON CONFLICT (breach_id) DO NOTHING`,
    [breachId, discoveredAt, deadlineAt]
  );

  logger.info({ breachId, deadline: deadlineAt.toISOString() }, "[BreachTimer] 72-hour countdown started");

  return { breachId, discoveredAt, deadlineAt, notifiedAt: null, escalationsSent: 0, status: "active" };
}

/** Mark a breach as notified (stops the countdown) */
export async function markBreachNotified(pool: Pool, breachId: number): Promise<void> {
  await pool.query(
    `UPDATE breach_timers SET notified_at = NOW(), status = 'notified' WHERE breach_id = $1`,
    [breachId]
  );
  logger.info({ breachId }, "[BreachTimer] Breach marked as notified to NDPC");
}

/** Check all active timers and return escalations needed */
export async function checkBreachTimers(pool: Pool): Promise<{
  activeTimers: BreachTimer[];
  escalationsNeeded: Array<{ breachId: number; hoursRemaining: number; urgency: "warning" | "urgent" | "critical" }>;
  overdueTimers: BreachTimer[];
}> {
  const result = await pool.query(
    `SELECT * FROM breach_timers WHERE status = 'active' ORDER BY deadline_at ASC`
  );

  const now = new Date();
  const activeTimers: BreachTimer[] = [];
  const escalationsNeeded: Array<{ breachId: number; hoursRemaining: number; urgency: "warning" | "urgent" | "critical" }> = [];
  const overdueTimers: BreachTimer[] = [];

  for (const row of result.rows) {
    const timer: BreachTimer = {
      breachId: row.breach_id,
      discoveredAt: row.discovered_at,
      deadlineAt: row.deadline_at,
      notifiedAt: row.notified_at,
      escalationsSent: row.escalations_sent,
      status: row.status,
    };

    const msRemaining = timer.deadlineAt.getTime() - now.getTime();
    const hoursRemaining = msRemaining / (60 * 60 * 1000);

    if (hoursRemaining <= 0) {
      overdueTimers.push(timer);
      await pool.query(
        `UPDATE breach_timers SET status = 'overdue' WHERE breach_id = $1`,
        [timer.breachId]
      );
      logger.error({ breachId: timer.breachId }, "[BreachTimer] BREACH OVERDUE — 72-hour deadline passed!");
    } else {
      activeTimers.push(timer);
      // Determine escalation urgency
      let urgency: "warning" | "urgent" | "critical" = "warning";
      if (hoursRemaining <= 6) urgency = "critical";
      else if (hoursRemaining <= 24) urgency = "urgent";

      // Check if escalation should be sent
      for (const threshold of ESCALATION_THRESHOLDS_HOURS) {
        const remaining = BREACH_DEADLINE_HOURS - threshold;
        if (hoursRemaining <= remaining && timer.escalationsSent < ESCALATION_THRESHOLDS_HOURS.indexOf(threshold) + 1) {
          escalationsNeeded.push({ breachId: timer.breachId, hoursRemaining: Math.round(hoursRemaining * 10) / 10, urgency });
          await pool.query(
            `UPDATE breach_timers SET escalations_sent = escalations_sent + 1 WHERE breach_id = $1`,
            [timer.breachId]
          );
        }
      }
    }
  }

  return { activeTimers, escalationsNeeded, overdueTimers };
}

/** Get timer status for a specific breach */
export async function getBreachTimer(pool: Pool, breachId: number): Promise<BreachTimer | null> {
  const result = await pool.query(
    `SELECT * FROM breach_timers WHERE breach_id = $1`,
    [breachId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    breachId: row.breach_id,
    discoveredAt: row.discovered_at,
    deadlineAt: row.deadline_at,
    notifiedAt: row.notified_at,
    escalationsSent: row.escalations_sent,
    status: row.status,
  };
}
