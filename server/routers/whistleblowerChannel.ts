/**
 * Whistleblower Follow-Up Channel Router (gap 7)
 *
 * Complements the phase12 `whistleblowerRouter` (submission + triage) with a
 * pseudonymous two-way secure channel:
 *   - One-time access token (SHA-256 hashed at rest) issued at submission;
 *     the raw token is returned exactly once and lets the reporter read/reply
 *     via public endpoints without an account.
 *   - whistleblower_messages log (reporter | case_officer), flagged
 *     encrypted-at-rest for the platform encryption middleware.
 *   - Retaliation-protection workflow (protection_flags).
 *   - Reward / recognition tracking (whistleblower_rewards).
 *
 * Procedure names are deliberately distinct from phase12's
 * (submit / list / updateStatus) so both routers can coexist.
 */
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { encryptField } from "../encryption";

const TOKEN_TTL_DAYS = 90;

async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  try {
    const safeParams = params.map((p) =>
      Array.isArray(p) || (p !== null && typeof p === "object" && !(p instanceof Date))
        ? JSON.stringify(p)
        : p
    );
    const result = await pool.query(query, safeParams);
    return autoDecryptRows(query, result.rows ?? []);
  } catch (err) {
    logger.error({ err, query: query.slice(0, 200) }, "[wbChannel] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

/** audit_logs.resource_id / user_id are int4; coerce non-numeric refs to NULL. */
function toIntOrNull(v: string | number | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isInteger(n) && Math.abs(n) < 2147483647 ? n : null;
}

async function logAudit(
  action: string,
  resourceType: string,
  resourceId: string | number | null,
  userId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await exec(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [action, resourceType, toIntOrNull(resourceId), toIntOrNull(userId), JSON.stringify(details)],
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[wbChannel] Audit log write failed");
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Resolve a raw reporter token to its report row, enforcing expiry/revocation. */
async function resolveToken(rawToken: string): Promise<{ report_id: number; report_ref: string }> {
  const tokenHash = hashToken(rawToken);
  const rows = await exec(
    `SELECT t.id AS token_id, t.report_id, wr.report_ref
     FROM whistleblower_channel_tokens t
     JOIN whistleblower_reports wr ON wr.id = t.report_id
     WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > NOW()`,
    [tokenHash],
  );
  if (!rows[0]) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or expired access token" });
  }
  // Best-effort last_used bookkeeping; does not block the request.
  exec(`UPDATE whistleblower_channel_tokens SET last_used_at = NOW() WHERE id = $1`, [rows[0].token_id])
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "last_used update failed"));
  return rows[0];
}

/** Mint a new channel token for a report. Returns the raw token (shown once). */
async function mintToken(reportId: number): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await exec(
    `INSERT INTO whistleblower_channel_tokens (report_id, token_hash, issued_to, expires_at)
     VALUES ($1, $2, 'reporter', NOW() + ($3 || ' days')::interval)`,
    [reportId, hashToken(raw), String(TOKEN_TTL_DAYS)],
  );
  return raw;
}

export const whistleblowerChannelRouter = router({
  /**
   * Public submission that also provisions the follow-up channel. Mirrors the
   * phase12 submit payload but returns a one-time access token so the reporter
   * can converse pseudonymously afterwards.
   */
  submitWithChannel: publicProcedure
    .input(z.object({
      category: z.enum(["data_breach", "unlawful_processing", "consent_violation", "cross_border", "bribery"]),
      orgId: z.number().optional(),
      description: z.string().min(50),
      isAnonymous: z.boolean().default(true),
      reporterEmail: z.string().email().optional(),
      evidenceUrls: z.array(z.string()).default([]),
    }))
    .mutation(async ({ input }) => {
      // Per-year DB-sequence reference (migration 0077) — no Date.now() suffix.
      const [seqRow] = await exec(`SELECT nextval('ndsep_wb_report_ref_seq') AS n`);
      const ref = `WBR-${new Date().getFullYear()}-${String(seqRow?.n ?? 1).padStart(5, "0")}`;
      const priority = ["data_breach", "bribery"].includes(input.category) ? "critical" : "medium";
      const rows = await exec(
        `INSERT INTO whistleblower_reports (report_ref, category, org_id, description, is_anonymous, reporter_email, evidence_urls, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, report_ref, status`,
        [ref, input.category, input.orgId ?? null, input.description, input.isAnonymous, input.reporterEmail ?? null, JSON.stringify(input.evidenceUrls), priority],
      );
      const report = rows[0];
      const accessToken = await mintToken(report.id);
      await logAudit("whistleblower.channel_submit", "whistleblower_report", report.id, null, { report_ref: ref, category: input.category });
      emitMutationEvent("ndsep.whistleblower.channel", { action: "submitWithChannel", reportRef: ref, ts: new Date().toISOString() })
        .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return {
        id: report.id,
        reportRef: report.report_ref,
        status: report.status,
        // SECURITY: the raw token is returned exactly once. It is never logged
        // or stored in plaintext; only its SHA-256 hash is persisted.
        accessToken,
        message: "Report submitted. Save your access token — it is shown only once and is required to follow up on this report.",
      };
    }),

  /** Admin: provision a channel token for a report submitted before this feature existed. */
  issueChannelToken: adminProcedure
    .input(z.object({ reportRef: z.string().min(4) }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(`SELECT id, report_ref FROM whistleblower_reports WHERE report_ref = $1`, [input.reportRef]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
      const accessToken = await mintToken(rows[0].id);
      await logAudit("whistleblower.token_issue", "whistleblower_report", rows[0].id, String(ctx.user.id), { report_ref: input.reportRef });
      return { reportRef: input.reportRef, accessToken, message: "Deliver this token to the reporter through a secure out-of-band channel; it is shown only once." };
    }),

  /** Admin: revoke a compromised token. */
  revokeChannelToken: adminProcedure
    .input(z.object({ reportRef: z.string().min(4) }))
    .mutation(async ({ input, ctx }) => {
      await exec(
        `UPDATE whistleblower_channel_tokens t SET revoked_at = NOW()
         FROM whistleblower_reports wr
         WHERE t.report_id = wr.id AND wr.report_ref = $1 AND t.revoked_at IS NULL`,
        [input.reportRef],
      );
      await logAudit("whistleblower.token_revoke", "whistleblower_report", input.reportRef, String(ctx.user.id), {});
      return { success: true };
    }),

  /** Reporter (token-auth, no account): read the full message thread. */
  getChannelMessages: publicProcedure
    .input(z.object({ accessToken: z.string().min(20) }))
    .query(async ({ input }) => {
      const report = await resolveToken(input.accessToken);
      const messages = await exec(
        `SELECT id, sender, body, created_at, read_at
         FROM whistleblower_messages WHERE report_id = $1 ORDER BY created_at ASC`,
        [report.report_id],
      );
      // Mark officer messages as read by the reporter.
      exec(
        `UPDATE whistleblower_messages SET read_at = NOW() WHERE report_id = $1 AND sender = 'case_officer' AND read_at IS NULL`,
        [report.report_id],
      ).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "read_at update failed"));
      return { reportRef: report.report_ref, messages };
    }),

  /** Reporter (token-auth): reply to the case officer. */
  postReporterMessage: publicProcedure
    .input(z.object({
      accessToken: z.string().min(20),
      body: z.string().min(1).max(10000),
    }))
    .mutation(async ({ input }) => {
      const report = await resolveToken(input.accessToken);
      const rows = await exec(
        `INSERT INTO whistleblower_messages (report_id, sender, body, encrypted)
         VALUES ($1, 'reporter', $2, true) RETURNING id, sender, created_at`,
        [report.report_id, encryptField(input.body)],
      );
      await logAudit("whistleblower.reporter_message", "whistleblower_report", report.report_id, null, { report_ref: report.report_ref });
      return { success: true, message: rows[0] };
    }),

  /** Case officer: reply to the reporter through the same channel. */
  postOfficerMessage: protectedProcedure
    .input(z.object({
      reportRef: z.string().min(4),
      body: z.string().min(1).max(10000),
    }))
    .mutation(async ({ input, ctx }) => {
      const report = await exec(`SELECT id FROM whistleblower_reports WHERE report_ref = $1`, [input.reportRef]);
      if (!report[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
      const rows = await exec(
        `INSERT INTO whistleblower_messages (report_id, sender, body, encrypted)
         VALUES ($1, 'case_officer', $2, true) RETURNING id, sender, created_at`,
        [report[0].id, encryptField(input.body)],
      );
      await logAudit("whistleblower.officer_message", "whistleblower_report", report[0].id, String(ctx.user.id), { report_ref: input.reportRef });
      emitMutationEvent("ndsep.whistleblower.channel", { action: "officerReply", reportRef: input.reportRef, ts: new Date().toISOString() })
        .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, message: rows[0] };
    }),

  /** Officer view of a thread (by report ref, requires account). */
  getThreadForOfficer: protectedProcedure
    .input(z.object({ reportRef: z.string().min(4) }))
    .query(async ({ input }) => {
      const report = await exec(
        `SELECT id, report_ref, status, category FROM whistleblower_reports WHERE report_ref = $1`,
        [input.reportRef],
      );
      if (!report[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
      const messages = await exec(
        `SELECT id, sender, body, created_at, read_at
         FROM whistleblower_messages WHERE report_id = $1 ORDER BY created_at ASC`,
        [report[0].id],
      );
      return { report: report[0], messages };
    }),

  // ─── Retaliation protection workflow ──────────────────────────────────────

  /** Reporter (token-auth) or identified citizen: flag employer retaliation. */
  reportRetaliation: publicProcedure
    .input(z.object({
      accessToken: z.string().min(20).optional(),
      reportRef: z.string().min(4).optional(),
      reporterEmail: z.string().email().optional(),
      employerName: z.string().max(255).optional(),
      retaliationType: z.enum(["dismissal", "demotion", "harassment", "threats", "blacklisting", "other"]).default("other"),
      description: z.string().min(20),
    }))
    .mutation(async ({ input }) => {
      let reportId: number | null = null;
      if (input.accessToken) {
        reportId = (await resolveToken(input.accessToken)).report_id;
      } else if (input.reportRef) {
        const rows = await exec(`SELECT id FROM whistleblower_reports WHERE report_ref = $1`, [input.reportRef]);
        reportId = rows[0]?.id ?? null;
      }
      const rows = await exec(
        `INSERT INTO protection_flags (report_id, reporter_email, employer_name, retaliation_type, description, priority)
         VALUES ($1, $2, $3, $4, $5, 'high') RETURNING id, status`,
        [reportId, input.reporterEmail ?? null, input.employerName ?? null, input.retaliationType, input.description],
      );
      await logAudit("whistleblower.retaliation_flag", "protection_flag", rows[0].id, null, { report_id: reportId, type: input.retaliationType });
      emitMutationEvent("ndsep.whistleblower.protection", { action: "retaliationFlagged", flagId: rows[0].id, ts: new Date().toISOString() })
        .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, flagId: rows[0].id, message: "Retaliation report received. NDPC will review protective measures urgently." };
    }),

  /** Admin: list protection flags by status. */
  listProtectionFlags: adminProcedure
    .input(z.object({ status: z.enum(["open", "under_review", "protective_measures", "closed"]).optional() }))
    .query(async ({ input }) => {
      let sql = `SELECT pf.*, wr.report_ref FROM protection_flags pf
                 LEFT JOIN whistleblower_reports wr ON wr.id = pf.report_id WHERE 1=1`;
      const params: unknown[] = [];
      if (input.status) { params.push(input.status); sql += ` AND pf.status = $${params.length}`; }
      sql += ` ORDER BY pf.created_at DESC`;
      return exec(sql, params);
    }),

  /** Admin: advance a protection flag through the workflow. */
  updateProtectionFlag: adminProcedure
    .input(z.object({
      flagId: z.number(),
      status: z.enum(["open", "under_review", "protective_measures", "closed"]),
      protectiveMeasures: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `UPDATE protection_flags
         SET status = $1,
             protective_measures = COALESCE($2, protective_measures),
             assigned_to = $3,
             updated_at = NOW(),
             resolved_at = CASE WHEN $1 = 'closed' THEN NOW() ELSE resolved_at END
         WHERE id = $4 RETURNING id, status`,
        [input.status, input.protectiveMeasures ?? null, ctx.user.email ?? String(ctx.user.id), input.flagId],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Protection flag not found" });
      await logAudit("whistleblower.protection_update", "protection_flag", input.flagId, String(ctx.user.id), { status: input.status });
      return rows[0];
    }),

  // ─── Reward / recognition tracking ────────────────────────────────────────

  /** Admin: nominate a report for a reward or formal recognition. */
  nominateReward: adminProcedure
    .input(z.object({
      reportRef: z.string().min(4),
      rewardType: z.enum(["recognition", "monetary", "commendation"]),
      amount: z.number().nonnegative().optional(),
      citation: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const report = await exec(`SELECT id FROM whistleblower_reports WHERE report_ref = $1`, [input.reportRef]);
      if (!report[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
      if (input.rewardType === "monetary" && (input.amount == null || input.amount <= 0)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Monetary rewards require a positive amount" });
      }
      const rows = await exec(
        `INSERT INTO whistleblower_rewards (report_id, reward_type, amount, citation, decided_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, status`,
        [report[0].id, input.rewardType, input.amount ?? null, input.citation ?? null, ctx.user.email ?? String(ctx.user.id)],
      );
      await logAudit("whistleblower.reward_nominate", "whistleblower_reward", rows[0].id, String(ctx.user.id), { report_ref: input.reportRef, type: input.rewardType });
      return { success: true, rewardId: rows[0].id };
    }),

  /** Admin: decide on a nominated reward (approve / pay / decline). */
  decideReward: adminProcedure
    .input(z.object({
      rewardId: z.number(),
      status: z.enum(["approved", "paid", "declined"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `UPDATE whistleblower_rewards SET status = $1, decided_by = $2, updated_at = NOW()
         WHERE id = $3 AND status IN ('nominated', 'approved') RETURNING id, status`,
        [input.status, ctx.user.email ?? String(ctx.user.id), input.rewardId],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Reward not found or already decided" });
      await logAudit("whistleblower.reward_decide", "whistleblower_reward", input.rewardId, String(ctx.user.id), { status: input.status });
      return rows[0];
    }),

  /** Admin: list rewards, optionally filtered by status. */
  listRewards: adminProcedure
    .input(z.object({ status: z.enum(["nominated", "approved", "paid", "declined"]).optional() }))
    .query(async ({ input }) => {
      let sql = `SELECT r.*, wr.report_ref FROM whistleblower_rewards r
                 JOIN whistleblower_reports wr ON wr.id = r.report_id WHERE 1=1`;
      const params: unknown[] = [];
      if (input.status) { params.push(input.status); sql += ` AND r.status = $${params.length}`; }
      sql += ` ORDER BY r.created_at DESC`;
      return exec(sql, params);
    }),

  /** Reporter (token-auth): check reward status for their own report. */
  getMyRewardStatus: publicProcedure
    .input(z.object({ accessToken: z.string().min(20) }))
    .query(async ({ input }) => {
      const report = await resolveToken(input.accessToken);
      return exec(
        `SELECT id, reward_type, status, citation, created_at
         FROM whistleblower_rewards WHERE report_id = $1 ORDER BY created_at DESC`,
        [report.report_id],
      );
    }),
});
