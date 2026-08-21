/**
 * Phase 6 Features Router
 * - Weekly email digest (subscribe, unsubscribe, send now, preview)
 * - Org onboarding checklist (get, complete step, progress banner)
 */
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { z } from "zod";
import { getDb, getSharedPool } from "../db";
import { notifyOwner } from "../_core/notification";
import { ENV } from "../_core/env";
import { emitEvent, logAuditEvent, broadcastEvent, cacheGetJson, cacheSetJson, cacheDel, triggerWorkflow } from "../middlewareHelpers";
import { emitComplianceEvent, opensearchIndex, lakehouseIngest, daprPublish, fluvioPublish, permifyCheck } from "../middlewareExtensions";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { logger } from "../logger";

async function exec(sql: string, params: unknown[] = []): Promise<any[]> {
  const pool = getSharedPool();
  const result = await pool.query(sql, params);
  return autoDecryptRows(sql, result.rows as any[]);
}

// ─── Ensure onboarding_checklists table exists ──────────────────────────────
(async () => {
  try {
    const pool = getSharedPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS onboarding_checklists (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      step_id VARCHAR(100) NOT NULL,
      completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(user_id, step_id)
    )`);
  } catch {}
})();

// ── Onboarding checklist steps ────────────────────────────────────────────────
const ONBOARDING_STEPS = [
  { id: "profile",     label: "Complete organisation profile",          path: "/my-org",    points: 20 },
  { id: "assets",      label: "Register at least one data asset",       path: "/catalog",   points: 20 },
  { id: "dpo",         label: "Appoint a Data Protection Officer",      path: "/dpo-registry", points: 20 },
  { id: "ropa",        label: "Create your first ROPA record",          path: "/ropa",      points: 20 },
  { id: "tutorial",    label: "Complete the Getting Started tutorial",  path: "/user-guide", points: 20 },
];

// ── Build digest content ──────────────────────────────────────────────────────
async function buildDigestContent(userId: number): Promise<string> {
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  // Upcoming deadlines (next 14 days)
  const deadlines = await exec(
    `SELECT title, due_date, priority FROM compliance_deadlines WHERE due_date > ? AND due_date < ? ORDER BY due_date ASC LIMIT 5`,
    [now, now + 14 * 24 * 60 * 60 * 1000]
  ).catch(() => []);

  // Recent breach incidents
  const breaches = await exec(
    `SELECT title, severity, status, reported_at FROM breach_incidents WHERE reported_at > ? ORDER BY reported_at DESC LIMIT 3`,
    [now - sevenDays]
  ).catch(() => []);

  // Compliance score
  const scores = await exec(
    `SELECT sector, score FROM compliance_scores ORDER BY scored_at DESC LIMIT 5`
  ).catch(() => []);

  // Pending SLA timers
  const slaTimers = await exec(
    `SELECT title, deadline_at, status FROM sla_timers WHERE status = 'active' AND deadline_at < ? ORDER BY deadline_at ASC LIMIT 3`,
    [now + 7 * 24 * 60 * 60 * 1000]
  ).catch(() => []);

  let content = `# NDSEP Weekly Compliance Digest\n\n`;
  content += `**Generated:** ${new Date().toLocaleDateString("en-NG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}\n\n`;

  if (deadlines.length > 0) {
    content += `## ⏰ Upcoming Deadlines (Next 14 Days)\n\n`;
    deadlines.forEach((d: any) => {
      const daysLeft = Math.ceil((d.due_date - now) / (24 * 60 * 60 * 1000));
      content += `- **${d.title}** — Due in ${daysLeft} day${daysLeft !== 1 ? "s" : ""} (${d.priority} priority)\n`;
    });
    content += "\n";
  }

  if (slaTimers.length > 0) {
    content += `## 🚨 Active SLA Timers Expiring Soon\n\n`;
    slaTimers.forEach((s: any) => {
      const hoursLeft = Math.ceil((s.deadline_at - now) / (60 * 60 * 1000));
      content += `- **${s.title}** — ${hoursLeft}h remaining\n`;
    });
    content += "\n";
  }

  if (breaches.length > 0) {
    content += `## 🔴 Recent Breach Incidents (Last 7 Days)\n\n`;
    breaches.forEach((b: any) => {
      content += `- **${b.title}** — Severity: ${b.severity} | Status: ${b.status}\n`;
    });
    content += "\n";
  }

  if (scores.length > 0) {
    content += `## 📊 Sector Compliance Scores\n\n`;
    scores.forEach((s: any) => {
      const bar = "█".repeat(Math.floor(s.score / 10)) + "░".repeat(10 - Math.floor(s.score / 10));
      content += `- **${s.sector}**: ${bar} ${s.score}%\n`;
    });
    content += "\n";
  }

  content += `---\n*This digest was sent from the NDSEP platform. Visit ${ENV.platformUrl} to manage your subscription.*\n`;
  return content;
}

// ── Send digest via Termii ────────────────────────────────────────────────────
async function sendDigestEmail(email: string, content: string): Promise<boolean> {
  try {
    const resp = await fetch(`${ENV.termiiBaseUrl}/api/email/otp/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: ENV.termiiApiKey,
        email_address: email,
        code: "DIGEST",
        email_configuration_id: "ndsep-digest",
        subject: `NDSEP Weekly Compliance Digest — ${new Date().toLocaleDateString("en-NG")}`,
        message_text: content,
        message_html: content.replace(/\n/g, "<br>").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"),
      }),
    });
    return resp.ok;
  } catch {
    // Graceful degradation — log via notifyOwner
    await notifyOwner({
      title: "Email Digest Sent (Termii unavailable)",
      content: `Digest for ${email} generated but Termii was unreachable. Content preview:\n${content.slice(0, 500)}`,
    }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return false;
  }
}

export const emailDigestRouter = router({
  // Subscribe to weekly digest
  subscribe: protectedProcedure
    .input(z.object({ email: z.string().email().optional() }))
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      const email = input.email ?? ctx.user.email ?? `user-${ctx.user.id}@ndsep.gov.ng`;
      await exec(
        `INSERT INTO email_digest_subscriptions (user_id, email, frequency, subscribed_at, next_send_at, active)
         VALUES (?, ?, 'weekly', ?, ?, 1)
         ON DUPLICATE KEY UPDATE active = 1, email = ?, updated_at = ?`,
        [ctx.user.id, email, now, now + 7 * 24 * 60 * 60 * 1000, email, now]
      );
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_lifecycle", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, email, nextSendAt: now + 7 * 24 * 60 * 60 * 1000 };
    }),

  // Unsubscribe
  unsubscribe: protectedProcedure.mutation(async ({ ctx }) => {
    await exec(
      `UPDATE email_digest_subscriptions SET active = 0, updated_at = ? WHERE user_id = ?`,
      [Date.now(), ctx.user.id]
    );
    emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_lifecycle", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return { success: true };
  }),

  // Get subscription status
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const rows = await exec(
      `SELECT * FROM email_digest_subscriptions WHERE user_id = ? LIMIT 1`,
      [ctx.user.id]
    );
    return rows[0] ?? null;
  }),

  // Preview digest content (without sending)
  preview: protectedProcedure.query(async ({ ctx }) => {
    const content = await buildDigestContent(ctx.user.id);
    return { content };
  }),

  // Send digest now (admin or self)
  sendNow: protectedProcedure.mutation(async ({ ctx }) => {
    const subs = await exec(
      `SELECT * FROM email_digest_subscriptions WHERE user_id = ? AND active = 1 LIMIT 1`,
      [ctx.user.id]
    );
    if (subs.length === 0) {
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_lifecycle", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: false, message: "Not subscribed to digest. Please subscribe first." };
    }
    const content = await buildDigestContent(ctx.user.id);
    const sent = await sendDigestEmail(subs[0].email, content);
    const now = Date.now();
    await exec(
      `UPDATE email_digest_subscriptions SET last_sent_at = ?, next_send_at = ?, updated_at = ? WHERE user_id = ?`,
      [now, now + 7 * 24 * 60 * 60 * 1000, now, ctx.user.id]
    );
    emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_lifecycle", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return { success: true, sent, email: subs[0].email, previewContent: content.slice(0, 500) };
  }),

  // Admin: send digest to all active subscribers
  sendToAll: protectedProcedure.mutation(async ({ ctx }) => {
    const subs = await exec(
      `SELECT * FROM email_digest_subscriptions WHERE active = 1`
    );
    let sent = 0;
    let failed = 0;
    for (const sub of subs) {
      const content = await buildDigestContent(sub.user_id);
      const ok = await sendDigestEmail(sub.email, content);
      if (ok) sent++; else failed++;
      const now = Date.now();
      await exec(
        `UPDATE email_digest_subscriptions SET last_sent_at = ?, next_send_at = ?, updated_at = ? WHERE id = ?`,
        [now, now + 7 * 24 * 60 * 60 * 1000, now, sub.id]
      );
    }
    emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_lifecycle", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return { success: true, sent, failed, total: subs.length };
  }),
});

// ── Org Onboarding Checklist Router ──────────────────────────────────────────
export const onboardingChecklistRouter = router({
  // Get checklist for current user's org
  getChecklist: protectedProcedure.query(async ({ ctx }) => {
    const progress = await exec(
      `SELECT step_id, completed_at FROM onboarding_checklists WHERE user_id = $1`,
      [ctx.user.id]
    );
    const completedIds = new Set(progress.map((p: any) => p.step_id));
    const steps = ONBOARDING_STEPS.map((s) => ({
      ...s,
      completed: completedIds.has(s.id),
      completedAt: progress.find((p: any) => p.step_id === s.id)?.completed_at ?? null,
    }));
    const completedCount = steps.filter((s) => s.completed).length;
    const totalPoints = steps.filter((s) => s.completed).reduce((sum, s) => sum + s.points, 0);
    const isComplete = completedCount === ONBOARDING_STEPS.length;
    return { steps, completedCount, totalSteps: ONBOARDING_STEPS.length, totalPoints, isComplete, percentComplete: Math.round((completedCount / ONBOARDING_STEPS.length) * 100) };
  }),

  // Mark a step as complete
  completeStep: protectedProcedure
    .input(z.object({ stepId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      await exec(
        `INSERT INTO onboarding_checklists (user_id, step_id, completed_at) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, step_id) DO UPDATE SET completed_at = $3`,
        [ctx.user.id, input.stepId, now]
      );
      // Check if all steps complete
      const progress = await exec(
        `SELECT COUNT(*) as cnt FROM onboarding_checklists WHERE user_id = $1`,
        [ctx.user.id]
      );
      const allDone = progress[0]?.cnt >= ONBOARDING_STEPS.length;
      if (allDone) {
        await notifyOwner({
          title: `Onboarding Complete: User ${ctx.user.name ?? ctx.user.id}`,
          content: `User ${ctx.user.name ?? ctx.user.id} (ID: ${ctx.user.id}) has completed all ${ONBOARDING_STEPS.length} onboarding steps on NDSEP.`,
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      }
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_lifecycle", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, stepId: input.stepId, allComplete: allDone };
    }),

  // Auto-trigger: called after portal wizard completion
  triggerAfterPortalWizard: protectedProcedure.mutation(async ({ ctx }) => {
    const now = Date.now();
    // Mark "profile" and "assets" steps as complete (wizard covers these)
    for (const stepId of ["profile", "assets"]) {
      await exec(
        `INSERT INTO onboarding_checklists (user_id, step_id, completed_at) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, step_id) DO UPDATE SET completed_at = $3`,
        [ctx.user.id, stepId, now]
      );
    }
    emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_lifecycle", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return { success: true, autoCompletedSteps: ["profile", "assets"], nextStep: "dpo" };
  }),

  // Dismiss banner (user has seen it)
  dismissBanner: protectedProcedure.mutation(async ({ ctx }) => {
    await exec(
      `INSERT INTO onboarding_checklists (user_id, step_id, completed_at) VALUES ($1, 'banner_dismissed', $2)
       ON CONFLICT (user_id, step_id) DO UPDATE SET completed_at = $2`,
      [ctx.user.id, Date.now()]
    );
    emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_lifecycle", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return { success: true };
  }),

  // Check if banner should be shown
  shouldShowBanner: protectedProcedure.query(async ({ ctx }) => {
    const dismissed = await exec(
      `SELECT 1 FROM onboarding_checklists WHERE user_id = $1 AND step_id = 'banner_dismissed' LIMIT 1`,
      [ctx.user.id]
    );
    if (dismissed.length > 0) return { show: false };
    const progress = await exec(
      `SELECT COUNT(*) as cnt FROM onboarding_checklists WHERE user_id = $1 AND step_id != 'banner_dismissed'`,
      [ctx.user.id]
    );
    const completedCount = progress[0]?.cnt ?? 0;
    const isComplete = completedCount >= ONBOARDING_STEPS.length;
    return { show: !isComplete, completedCount, totalSteps: ONBOARDING_STEPS.length, percentComplete: Math.round((completedCount / ONBOARDING_STEPS.length) * 100) };
  }),
});
