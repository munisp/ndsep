/**
 * Push Notification Router
 *
 * Handles Web Push (VAPID) subscriptions and notification dispatch.
 * Uses the `web-push` package with generated VAPID keys.
 *
 * Procedures:
 *  - push.getVapidPublicKey   (public)  — returns the VAPID public key for the browser
 *  - push.subscribe           (protected) — saves a push subscription for the current user
 *  - push.unsubscribe         (protected) — removes a push subscription by endpoint
 *  - push.listSubscriptions   (protected) — lists active subscriptions for the current user
 *  - push.sendTestNotification (protected) — sends a test push to the current user
 *  - push.sendOverdueAlerts   (protected) — sends overdue invoice alerts to a DPCO user
 */
import { z } from "zod";
import webPush from "web-push";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { emitComplianceEvent, opensearchIndex, lakehouseIngest, daprPublish, fluvioPublish, permifyCheck } from "../middlewareExtensions";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { logger } from "../logger";

// ─── VAPID Configuration ─────────────────────────────────────────────────────
// Keys are set from env vars; fall back to the generated defaults for dev.
const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ??
  "BGNPOpienGVI-9Ovdqvq_pb_gHBYSqFvzxHftWmkzkMPo0RrJUy0ZZ2q9pGSVLyleaxfdkNNr6qkfK292V0coC0";

const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY ??
  "N9ztU-fPjyBtranPiyVA1-BPQuuSj-GCL3TMvV6EL8M";

const VAPID_EMAIL = process.env.VAPID_EMAIL ?? "mailto:admin@ndpc.gov.ng";

webPush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ─── Helper ───────────────────────────────────────────────────────────────────
async function sendPushToUser(
  userId: number,
  payload: { title: string; body: string; url?: string; icon?: string }
): Promise<{ sent: number; failed: number }> {
  const pool = getPool();
  if (!pool) return { sent: 0, failed: 0 };

  const { rows: subs } = await pool.query(
    "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1",
    [userId]
  );

  let sent = 0;
  let failed = 0;

  for (const sub of subs) {
    try {
      await webPush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({
          ...payload,
          url: payload.url ?? "/dpco-app/dashboard",
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
        })
      );
      // Update last_used_at
      await pool.query(
        "UPDATE push_subscriptions SET last_used_at = $1 WHERE id = $2",
        [Date.now(), sub.id]
      );
      sent++;
    } catch (err: unknown) {
      // 410 Gone = subscription expired; remove it
      const statusCode = err instanceof Error && "statusCode" in err ? (err as Error & { statusCode: number }).statusCode : undefined;
      if (statusCode === 410 || statusCode === 404) {
        await pool.query("DELETE FROM push_subscriptions WHERE id = $1", [sub.id]);
      }
      failed++;
    }
  }

  return { sent, failed };
}

// ─── Router ───────────────────────────────────────────────────────────────────
export const pushRouter = router({
  /** Returns the VAPID public key for the browser to use when subscribing */
  getVapidPublicKey: publicProcedure.query(() => ({
    publicKey: VAPID_PUBLIC_KEY,
  })),

  /** Saves a push subscription for the authenticated user */
  subscribe: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
        p256dh: z.string(),
        auth: z.string(),
        userAgent: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const pool = getPool();
      if (!pool) throw new Error("Database unavailable");

      await pool.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (endpoint) DO UPDATE
           SET p256dh = EXCLUDED.p256dh,
               auth = EXCLUDED.auth,
               user_agent = EXCLUDED.user_agent,
               last_used_at = $6`,
        [ctx.user.id, input.endpoint, input.p256dh, input.auth, input.userAgent ?? null, Date.now()]
      );

      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "push_notification", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  /** Removes a push subscription by endpoint */
  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const pool = getPool();
      if (!pool) throw new Error("Database unavailable");

      const { rowCount } = await pool.query(
        "DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2",
        [ctx.user.id, input.endpoint]
      );

      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "push_notification", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { removed: rowCount ?? 0 };
    }),

  /** Lists all active push subscriptions for the current user */
  listSubscriptions: protectedProcedure.query(async ({ ctx }) => {
    const pool = getPool();
    if (!pool) return [];

    const { rows } = await pool.query(
      `SELECT id, endpoint, user_agent, created_at, last_used_at
       FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC`,
      [ctx.user.id]
    );

    return rows.map((r) => ({
      id: r.id as number,
      endpoint: r.endpoint as string,
      userAgent: r.user_agent as string | null,
      createdAt: Number(r.created_at),
      lastUsedAt: r.last_used_at ? Number(r.last_used_at) : null,
    }));
  }),

  /** Sends a test push notification to the current user */
  sendTestNotification: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await sendPushToUser(ctx.user.id, {
      title: "NDSEP Push Notifications Active",
      body: "You will now receive alerts for overdue invoices and audit deadlines.",
      url: "/dpco-app/dashboard",
    });
    emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "push_notification", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return result;
  }),

  /** Sends overdue invoice push alerts to all subscribed users of a DPCO org */
  sendOverdueAlerts: protectedProcedure
    .input(z.object({ dpcoOrgId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const pool = getPool();
      if (!pool) return { sent: 0, failed: 0 };

      // Get overdue invoices
      const { rows: invoices } = await pool.query(
        `SELECT invoice_number, client_name, total_amount, due_date
         FROM dpco_invoices
         WHERE dpco_org_id = $1 AND status = 'overdue'
         ORDER BY due_date ASC LIMIT 5`,
        [input.dpcoOrgId]
      );

      if (invoices.length === 0) return { sent: 0, failed: 0, message: "No overdue invoices" };

      const body =
        invoices.length === 1
          ? `Invoice ${invoices[0].invoice_number} for ${invoices[0].client_name} is overdue.`
          : `${invoices.length} invoices are overdue. Oldest: ${invoices[0].invoice_number} (${invoices[0].client_name}).`;

      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "push_notification", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return sendPushToUser(ctx.user.id, {
        title: `⚠️ ${invoices.length} Overdue Invoice${invoices.length > 1 ? "s" : ""}`,
        body,
        url: "/dpco/billing",
      });
    }),
});

export { sendPushToUser };
