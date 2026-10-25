/**
 * Election-Period Oversight Router (Gap 15)
 * Proclaimed election periods with heightened-scrutiny mode that
 *  (a) raises the priority of political-data complaints,
 *  (b) enables the political microtargeting report intake channel,
 * plus the INEC liaison referral workflow and dashboard aggregates.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { logAuditEvent } from "../middlewareHelpers";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { encryptField } from "../encryption";
import { withCache, CK, TTL } from "../queryCache";
import { hashIp, ipHashSalt, fixedWindowStart, counterExceedsLimit, extractClientIp } from "../services/complaintLogic";

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
    logger.error({ err, query: query.slice(0, 200) }, "[election] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

function safeParams(params: unknown[]): unknown[] {
  return params.map((p) =>
    Array.isArray(p) || (p !== null && typeof p === "object" && !(p instanceof Date))
      ? JSON.stringify(p)
      : p
  );
}

/** Referral insert + linked-report status flip must be atomic. */
async function withTransaction<T>(fn: (tx: (q: string, p?: unknown[]) => Promise<any[]>) => Promise<T>): Promise<T> {
  const pool = getPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const client = (await pool.connect()) as unknown as {
    query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }>;
    release: () => void;
  };
  const tx = async (q: string, p: unknown[] = []): Promise<any[]> => {
    const r = await client.query(q, safeParams(p));
    return autoDecryptRows(q, r.rows ?? []);
  };
  try {
    await client.query("BEGIN");
    const out = await fn(tx);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (err instanceof TRPCError) throw err;
    logger.error({ err }, "[election] transaction failed — rolled back");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  } finally {
    client.release();
  }
}

// ─── Intake rate limiting (shared counter table + complaintLogic helpers) ────
const PMR_RATE_LIMIT_PER_HOUR = Math.max(1, parseInt(process.env.ELECTION_PMR_RATE_LIMIT_PER_HOUR ?? "10", 10) || 10);
const TRUSTED_PROXY_COUNT = Math.max(0, parseInt(process.env.NDSEP_TRUSTED_PROXY_COUNT ?? "0", 10) || 0);

/**
 * Non-TOCTOU fixed-window rate limit on the public microtargeting intake:
 * one atomic upsert increments the counter and returns the new value.
 * Keyed by salted IP hash (never a raw IP).
 */
async function enforceIntakeRateLimit(req: any, action: string): Promise<void> {
  const ip = extractClientIp(req?.headers, req?.ip ?? req?.socket?.remoteAddress, TRUSTED_PROXY_COUNT);
  const key = hashIp(`${action}|${ip}`, ipHashSalt());
  const windowStart = fixedWindowStart(Date.now(), 3_600_000);
  const rows = await exec(
    `INSERT INTO rate_limit_counters (limiter_key, window_start, count, updated_at)
     VALUES ($1, $2, 1, NOW())
     ON CONFLICT (limiter_key, window_start)
     DO UPDATE SET count = rate_limit_counters.count + 1, updated_at = NOW()
     RETURNING count`,
    [key, windowStart],
  );
  if (counterExceedsLimit(Number(rows[0]?.count ?? 1), PMR_RATE_LIMIT_PER_HOUR)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Rate limit reached. Please try again later." });
  }
}

/**
 * Microtargeting review transition guard (0052 statuses):
 *   received         -> under_review | escalated | dismissed | closed
 *   under_review     -> escalated | dismissed | closed
 *   escalated        -> closed      (referral to INEC flips to referred_to_inec)
 *   referred_to_inec -> closed
 *   dismissed/closed -> TERMINAL (never reopen)
 */
const PMR_TRANSITIONS: Record<string, readonly string[]> = {
  received: ["under_review", "escalated", "dismissed", "closed"],
  under_review: ["escalated", "dismissed", "closed"],
  escalated: ["closed"],
  referred_to_inec: ["closed"],
  dismissed: [],
  closed: [],
};

// Keyword set identifying political-data complaints in citizen_requests
const POLITICAL_FILTER = `(cr.description ~* '\\m(political|election|campaign|voter|voting|party|pvc|inec)\\M')`;

async function getActiveScrutinyPeriod(): Promise<any | null> {
  const rows = await exec(
    `SELECT * FROM election_periods
     WHERE heightened_scrutiny = true
       AND status IN ('proclaimed','active')
       AND starts_at <= NOW() AND ends_at >= NOW()
     ORDER BY starts_at DESC LIMIT 1`
  );
  return rows[0] ?? null;
}

export const electionOversightRouter = router({
  // ─── Public: is heightened-scrutiny mode currently on? ──────────────────
  activePeriod: publicProcedure.query(async () => {
    // Public widget polled by the intake portal — cache for TTL.COMPLIANCE
    // seconds; scrutiny periods are proclaimed/concluded by admins.
    return withCache(CK.electionActivePeriod(), TTL.COMPLIANCE, async () => {
      const p = await getActiveScrutinyPeriod();
      if (!p) return { active: false as const };
      return {
        active: true as const,
        name: p.name,
        startsAt: p.starts_at,
        endsAt: p.ends_at,
        daysRemaining: Math.max(0, Math.ceil((new Date(p.ends_at).getTime() - Date.now()) / 86400000)),
      };
    });
  }),

  // ─── Public: political microtargeting report intake (scrutiny mode only) ─
  reportMicrotargeting: publicProcedure
    .input(z.object({
      partyOrCampaign: z.string().min(2).max(256),
      platform: z.enum(["facebook", "instagram", "x", "tiktok", "whatsapp", "sms", "other"]),
      description: z.string().min(20).max(10000),
      evidenceRefs: z.array(z.string().max(1024)).max(20).default([]),
      regionState: z.string().max(64).optional(),
      reporterName: z.string().max(256).optional(),
      reporterEmail: z.string().email().optional(),
      isAnonymous: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      await enforceIntakeRateLimit((ctx as any).req, "election.pmr.submit");
      const period = await getActiveScrutinyPeriod();
      if (!period) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Microtargeting intake is only open during a proclaimed election period with heightened scrutiny." });
      }
      if (!input.isAnonymous && !input.reporterEmail) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Provide a contact email or mark the report as anonymous." });
      }
      const seq = await exec("SELECT nextval('pmr_ref_seq') AS n");
      const ref = `PMR-${new Date().getFullYear()}-${String(Number(seq[0]?.n ?? 0)).padStart(5, "0")}`;
      const rows = await exec(
        `INSERT INTO political_microtargeting_reports
          (election_period_id, reference_number, reporter_name, reporter_email, is_anonymous,
           party_or_campaign, platform, description, evidence_refs, region_state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, reference_number, status, submitted_at`,
        [period.id, ref, input.isAnonymous ? null : (input.reporterName ? encryptField(input.reporterName) : null),
         input.isAnonymous ? null : (input.reporterEmail ? encryptField(input.reporterEmail) : null), input.isAnonymous,
         input.partyOrCampaign, input.platform, input.description, input.evidenceRefs, input.regionState ?? null]
      );
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "election_microtargeting_report", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  // ─── Admin: proclaim & manage election periods ──────────────────────────
  listPeriods: protectedProcedure.query(async () => {
    const rows = await exec(`SELECT * FROM election_periods ORDER BY starts_at DESC`);
    return rows.map((p) => ({
      ...p,
      is_current: new Date(p.starts_at) <= new Date() && new Date(p.ends_at) >= new Date(),
    }));
  }),

  proclaimPeriod: adminProcedure
    .input(z.object({
      name: z.string().min(4).max(256),
      description: z.string().max(5000).optional(),
      startsAt: z.string(), // ISO
      endsAt: z.string(),
      heightenedScrutiny: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      if (new Date(input.endsAt) <= new Date(input.startsAt)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "ends_at must be after starts_at." });
      }
      const rows = await exec(
        `INSERT INTO election_periods (name, description, starts_at, ends_at, heightened_scrutiny, proclaimed_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [input.name, input.description ?? null, input.startsAt, input.endsAt, input.heightenedScrutiny, (ctx as any).user?.id ?? null]
      );
      await logAuditEvent("election.period_proclaimed", "election_period", rows[0]?.id ?? "", String((ctx as any).user?.id ?? ""), { name: input.name, heightenedScrutiny: input.heightenedScrutiny });
      return rows[0];
    }),

  updatePeriod: adminProcedure
    .input(z.object({
      id: z.number().int(),
      status: z.enum(["proclaimed", "active", "concluded", "archived"]).optional(),
      heightenedScrutiny: z.boolean().optional(),
      notes: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `UPDATE election_periods SET
           status = COALESCE($2, status),
           heightened_scrutiny = COALESCE($3, heightened_scrutiny),
           notes = COALESCE($4, notes),
           concluded_at = CASE WHEN $2 IN ('concluded','archived') THEN NOW() ELSE concluded_at END,
           updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [input.id, input.status ?? null, input.heightenedScrutiny ?? null, input.notes ?? null]
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Election period not found." });
      await logAuditEvent("election.period_updated", "election_period", input.id, String((ctx as any).user?.id ?? ""), { status: input.status ?? null, heightenedScrutiny: input.heightenedScrutiny ?? null });
      return rows[0];
    }),

  // ─── (a) Heightened scrutiny raises political-complaint priority ────────
  prioritizedComplaints: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }))
    .query(async ({ input }) => {
      const period = await getActiveScrutinyPeriod();
      const boosted = !!period;
      const rows = await exec(
        `SELECT cr.id, cr.reference_number, cr.request_type, cr.status, cr.submitted_at, cr.response_deadline,
                cr.description, o.name as org_name, o.state as region,
                ${boosted ? "true" : "false"} as priority_boosted,
                CASE WHEN cr.response_deadline < NOW() AND cr.status NOT IN ('completed','rejected') THEN true ELSE false END as overdue
         FROM citizen_requests cr
         LEFT JOIN organizations o ON cr.organization_id = o.id
         WHERE ${POLITICAL_FILTER}
         ORDER BY ${boosted ? "cr.submitted_at ASC" : "cr.submitted_at DESC"}
         LIMIT $1`,
        [input.limit]
      );
      return { heightenedScrutiny: boosted, period: period ? { id: period.id, name: period.name } : null, data: rows };
    }),

  // ─── Internal: microtargeting report review ─────────────────────────────
  listMicrotargetingReports: protectedProcedure
    .input(z.object({ status: z.string().optional(), periodId: z.number().int().optional() }))
    .query(async ({ input }) => {
      const params: unknown[] = [];
      const conds: string[] = [];
      if (input.status) { params.push(input.status); conds.push(`status = $${params.length}`); }
      if (input.periodId) { params.push(input.periodId); conds.push(`election_period_id = $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      return exec(`SELECT * FROM political_microtargeting_reports ${where} ORDER BY submitted_at DESC LIMIT 200`, params);
    }),

  reviewMicrotargetingReport: adminProcedure
    .input(z.object({
      id: z.number().int(),
      status: z.enum(["under_review", "escalated", "dismissed", "closed"]),
      reviewNotes: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Transition guard: terminal states (dismissed/closed) can never be
      // reopened, and only forward transitions in PMR_TRANSITIONS are legal.
      const current = await exec(`SELECT id, status FROM political_microtargeting_reports WHERE id = $1`, [input.id]);
      if (!current[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found." });
      const from = String(current[0].status);
      if (!(PMR_TRANSITIONS[from] ?? []).includes(input.status)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: from === "dismissed" || from === "closed"
            ? `Report is already '${from}' — terminal states cannot be reopened.`
            : `Illegal transition '${from}' -> '${input.status}'.`,
        });
      }
      // Guarded UPDATE re-checks the source status so a concurrent review
      // cannot race past the transition table.
      const rows = await exec(
        `UPDATE political_microtargeting_reports SET status = $1, reviewed_by = $2, review_notes = $3, updated_at = NOW()
         WHERE id = $4 AND status = $5 RETURNING id`,
        [input.status, (ctx as any).user?.id ?? null, input.reviewNotes ?? null, input.id, from]
      );
      if (!rows[0]) throw new TRPCError({ code: "CONFLICT", message: "Report state changed concurrently — re-attempt review." });
      await logAuditEvent(`election.pmr_${input.status}`, "political_microtargeting_report", input.id, String((ctx as any).user?.id ?? ""), { fromStatus: from });
      return { success: true };
    }),

  // ─── INEC liaison workflow ──────────────────────────────────────────────
  createInecReferral: adminProcedure
    .input(z.object({
      electionPeriodId: z.number().int().optional(),
      microtargetingReportId: z.number().int().optional(),
      complaintReference: z.string().max(64).optional(),
      subject: z.string().min(4).max(512),
      summary: z.string().min(20).max(10000),
    }))
    .mutation(async ({ input, ctx }) => {
      const actor = String((ctx as any).user?.id ?? "");
      // Transactional: the referral row and the linked report's status flip
      // commit or roll back together — a referral without the flip (or vice
      // versa) is never persisted.
      const rows = await withTransaction(async (tx) => {
        if (input.microtargetingReportId) {
          const report = await tx(
            `SELECT id, status FROM political_microtargeting_reports WHERE id = $1 FOR UPDATE`,
            [input.microtargetingReportId]
          );
          if (!report[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Linked microtargeting report not found." });
          if (["dismissed", "closed", "referred_to_inec"].includes(String(report[0].status))) {
            throw new TRPCError({ code: "CONFLICT", message: `Report is '${report[0].status}' and cannot be referred to INEC.` });
          }
        }
        const seq = await tx("SELECT nextval('inec_referral_ref_seq') AS n");
        const ref = `INEC-${new Date().getFullYear()}-${String(Number(seq[0]?.n ?? 0)).padStart(5, "0")}`;
        const inserted = await tx(
          `INSERT INTO inec_referrals (case_reference, election_period_id, microtargeting_report_id, complaint_reference, subject, summary, referred_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [ref, input.electionPeriodId ?? null, input.microtargetingReportId ?? null, input.complaintReference ?? null,
           input.subject, input.summary, actor]
        );
        // Linked microtargeting report flips to referred_to_inec (guarded:
        // only from a referable state, re-checked inside the transaction).
        if (input.microtargetingReportId) {
          await tx(
            `UPDATE political_microtargeting_reports SET status = 'referred_to_inec', updated_at = NOW()
             WHERE id = $1 AND status NOT IN ('dismissed','closed','referred_to_inec')`,
            [input.microtargetingReportId]
          );
        }
        return inserted;
      });
      await logAuditEvent("election.inec_referral_created", "inec_referral", rows[0]?.id ?? "", actor, { caseReference: rows[0]?.case_reference });
      return rows[0];
    }),

  listInecReferrals: protectedProcedure
    .input(z.object({ status: z.string().optional() }))
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input.status) { params.push(input.status); where = `WHERE r.status = $${params.length}`; }
      return exec(
        `SELECT r.*, ep.name as period_name, pmr.reference_number as pmr_reference
         FROM inec_referrals r
         LEFT JOIN election_periods ep ON r.election_period_id = ep.id
         LEFT JOIN political_microtargeting_reports pmr ON r.microtargeting_report_id = pmr.id
         ${where} ORDER BY r.referred_at DESC LIMIT 200`,
        params
      );
    }),

  updateInecReferral: adminProcedure
    .input(z.object({
      id: z.number().int(),
      status: z.enum(["acknowledged", "joint_action", "resolved", "closed"]),
      jointActionNotes: z.string().max(10000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `UPDATE inec_referrals SET
           status = $1,
           joint_action_notes = COALESCE($2, joint_action_notes),
           acknowledged_at = CASE WHEN $1 = 'acknowledged' THEN NOW() ELSE acknowledged_at END,
           resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END,
           updated_at = NOW()
         WHERE id = $3 RETURNING id`,
        [input.status, input.jointActionNotes ?? null, input.id]
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Referral not found." });
      await logAuditEvent(`election.inec_referral_${input.status}`, "inec_referral", input.id, String((ctx as any).user?.id ?? ""), {});
      return { success: true };
    }),

  // ─── Dashboard aggregate: political complaints by status / region ───────
  dashboardAggregate: protectedProcedure.query(async () => {
    const period = await getActiveScrutinyPeriod();
    const byStatus = await exec(
      `SELECT cr.status, COUNT(*) as count
       FROM citizen_requests cr
       WHERE ${POLITICAL_FILTER}
       GROUP BY cr.status ORDER BY count DESC`
    );
    const byRegion = await exec(
      `SELECT COALESCE(o.state, 'Unknown') as region, COUNT(*) as count
       FROM citizen_requests cr
       LEFT JOIN organizations o ON cr.organization_id = o.id
       WHERE ${POLITICAL_FILTER}
       GROUP BY COALESCE(o.state, 'Unknown') ORDER BY count DESC LIMIT 20`
    );
    const microtargeting = await exec(
      `SELECT status, COUNT(*) as count FROM political_microtargeting_reports GROUP BY status`
    );
    const referrals = await exec(
      `SELECT status, COUNT(*) as count FROM inec_referrals GROUP BY status`
    );
    return {
      heightenedScrutiny: !!period,
      activePeriod: period ? { id: period.id, name: period.name, endsAt: period.ends_at } : null,
      politicalComplaintsByStatus: byStatus,
      politicalComplaintsByRegion: byRegion,
      microtargetingByStatus: microtargeting,
      inecReferralsByStatus: referrals,
    };
  }),
});
