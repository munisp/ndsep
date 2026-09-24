/**
 * Settlement Workflow Router (migration 0086)
 *
 * NDPA 2023 settlement negotiation lifecycle for enforcement cases:
 *
 *   proposal -> counter -> agreement -> approval -> active
 *     -> fulfilled | defaulted | void
 *
 *   proposeSettlement      staff; opens negotiation with structured terms
 *   counterPropose         staff; new versioned terms (counter-offer)
 *   acceptTerms            staff; current terms accepted -> agreement
 *   submitForApproval      staff; agreement -> approval (dual-control gate)
 *   approveSettlement      admin; maker-checker: two DISTINCT approvers,
 *                          neither the proposer; the activating approval
 *                          must be commissioner level (platform admin) —
 *                          then the instalment schedule is materialised and
 *                          posted to TigerBeetle
 *   rejectSettlement       admin; approval -> void with reason
 *   recordInstalmentPayment staff; applies a payment to an open instalment,
 *                          mirrors the amount onto the linked fine
 *                          (finePayments semantics, linked by fine_reference)
 *   detectDefaults         staff; overdue instalment -> escalation event ->
 *                          settlement defaults and the enforcement case
 *                          reopens (fine flips back to 'outstanding')
 *   requestWaiver          staff; waiver/reduction requires a documented
 *                          legal basis AND maker-checker dual control via
 *                          the 0080 dual_control_requests queue
 *                          ('fine_settlement')
 *   executeWaiver          admin; applies the reduction only after the dual-
 *                          control request was approved by two approvers
 *   getSettlement / listSettlements / instalments  staff reads
 *
 * TigerBeetle bridge (server/middlewareExtensions.ts#tigerbeetleTransfer):
 * every materialised instalment is posted with transferType 'settlement'.
 * The bridge is USD-only and may be absent — outcomes are recorded
 * EXPLICITLY per instalment (ledger_post_status = posted | skipped_non_usd |
 * UNCONFIGURED | failed). A posting failure never blocks activation and is
 * never reported as a success; it surfaces in default/ledger queues for
 * manual reconciliation.
 *
 * Every mutation emits an audit event (emitMutationEvent) and appends to
 * the hash-chained audit ledger (payload carries caseRef so tribunal
 * bundles pick settlement events up in their chain-proof segment).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, staffProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { tigerbeetleTransfer } from "../middlewareExtensions";
import { appendLedger } from "../antiwipe/ledger";
import { requireDualControl } from "./insiderThreat";
import {
  assertTransition,
  validateSettlementTerms,
  applyPayment,
  evaluateDefaults,
  isFulfilled,
  validateWaiver,
  DEFAULT_GRACE_DAYS,
  type SettlementStatus,
  type InstalmentRecord,
  type InstalmentStatus,
} from "../services/settlementLogic";

// ─── DB helpers ──────────────────────────────────────────────────────────────

function requirePool() {
  const pool = getPool();
  if (!pool) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  }
  return pool;
}

function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01";
}

async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const pool = requirePool();
  const safe = params.map((p) =>
    p !== null && typeof p === "object" && !(p instanceof Date) ? JSON.stringify(p) : p,
  );
  const result = await pool.query(sql, safe);
  return (result.rows ?? []) as T[];
}

function actorOf(user: { id: number; openId?: string | null }): string {
  return user.openId ?? String(user.id);
}

/** Commissioner-level authority maps to the platform admin role. */
function approvalLevelOf(user: { role?: string }): "commissioner" | "officer" {
  return user.role === "admin" ? "commissioner" : "officer";
}

async function nextSettlementRef(): Promise<string> {
  const [row] = await query<{ n: string }>(`SELECT nextval('ndsep_settlement_ref_seq')::text AS n`);
  return `NDPC-SET-${new Date().getFullYear()}-${String(row?.n ?? 1).padStart(5, "0")}`;
}

async function getSettlement(id: number) {
  const rows = await query(`SELECT * FROM settlements WHERE id = $1`, [id]);
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "settlement not found" });
  return rows[0];
}

async function currentTerms(settlementId: number) {
  const rows = await query(
    `SELECT t.* FROM settlement_terms t
     JOIN settlements s ON s.id = t.settlement_id AND s.current_terms_version = t.version
     WHERE t.settlement_id = $1`,
    [settlementId],
  );
  return rows[0] ?? null;
}

async function transition(
  settlementId: number,
  from: SettlementStatus,
  to: SettlementStatus,
  extra: Record<string, unknown> = {},
): Promise<void> {
  assertTransition(from, to); // pure guard — throws on illegal transition
  const sets = ["status = $2", "updated_at = now()"];
  const params: unknown[] = [settlementId, to];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i}`);
    params.push(val);
    i += 1;
  }
  // Guarded update: only transition from the expected status (optimistic concurrency).
  const res = await query(
    `UPDATE settlements SET ${sets.join(", ")} WHERE id = $1 AND status = $${i} RETURNING id`,
    [...params, from],
  );
  if (!res[0]) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `settlement is no longer '${from}' — refresh and retry`,
    });
  }
}

async function audit(
  action: string,
  payload: Record<string, unknown>,
  actor: string,
): Promise<void> {
  await appendLedger(action, payload, actor).catch((err: unknown) => {
    logger.error({ err, action }, "[settlement] audit-ledger append failed");
  });
  await emitMutationEvent(`settlement.${action}`, payload).catch(() => undefined);
}

/** Resolve the linked enforcement fine by fine_reference (never silently). */
async function resolveFine(fineReference: string | undefined) {
  if (!fineReference) return null;
  const rows = await query(
    `SELECT id, org_id, amount, amount_paid, currency, status, fine_reference, case_id
     FROM enforcement_fines WHERE fine_reference = $1`,
    [fineReference],
  ).catch((err: unknown) => {
    if (isMissingTable(err)) return [];
    throw err;
  });
  if (!rows[0]) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `no enforcement fine found for fine_reference '${fineReference}'`,
    });
  }
  return rows[0];
}

// ─── TigerBeetle posting ─────────────────────────────────────────────────────

const SETTLEMENT_CLEARING_ACCOUNT = "ndpc-settlement-clearing";

/**
 * Post one instalment to the TigerBeetle ledger via the middlewareExtensions
 * bridge. Returns the explicit ledger_post_status; never throws (posting
 * failure must not roll back settlement activation) and never fakes success.
 */
async function postInstalmentToLedger(params: {
  instalmentId: number;
  settlementRef: string;
  seq: number;
  amount: number;
  currency: string;
  orgAccount: string;
}): Promise<{ status: "posted" | "skipped_non_usd" | "UNCONFIGURED" | "failed"; ref: string; error: string | null }> {
  const ref = `${params.settlementRef}-INST-${params.seq}`;
  if (params.currency.toUpperCase() !== "USD") {
    // The Go ledger proxy is USD-only (middlewareExtensions). Record the
    // skip explicitly for manual reconciliation — never coerce currencies.
    logger.error(
      { reconciliation_pending: true, ref, currency: params.currency, amount: params.amount },
      "[settlement] instalment NOT posted to USD-only TigerBeetle ledger — manual reconciliation required",
    );
    return { status: "skipped_non_usd", ref, error: `ledger is USD-only; currency ${params.currency} requires manual reconciliation` };
  }
  try {
    await tigerbeetleTransfer({
      debitAccountId: params.orgAccount,
      creditAccountId: SETTLEMENT_CLEARING_ACCOUNT,
      amount: params.amount,
      currency: params.currency,
      reference: ref,
      transferType: "settlement",
    });
    return { status: "posted", ref, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err: message, ref },
      "[settlement] TigerBeetle bridge UNCONFIGURED/unreachable — instalment recorded but NOT posted to the ledger",
    );
    return {
      status: /unavailable|ECONNREFUSED|abort/i.test(message) ? "UNCONFIGURED" : "failed",
      ref,
      error: message.slice(0, 500),
    };
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

const termsSchema = z.object({
  monetaryAmount: z.number().finite().min(0),
  currency: z.string().regex(/^[A-Z]{3}$/).default("NGN"),
  nonMonetaryObligations: z.array(z.string().min(1)).default([]),
  instalmentSchedule: z.array(z.object({
    seq: z.number().int().positive(),
    dueDate: z.string().min(4),
    amount: z.number().positive(),
  })).default([]),
  confidentialityFlag: z.boolean().default(false),
  transparencyRationale: z.string().default(""),
});

export const settlementWorkflowRouter = router({
  /** Open a settlement negotiation for an enforcement case. */
  proposeSettlement: staffProcedure
    .input(z.object({
      caseRef: z.string().min(1).max(128),
      fineReference: z.string().max(60).optional(),
      respondentName: z.string().max(256).optional(),
      respondentEmail: z.string().email().max(255).optional(),
      terms: termsSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = actorOf(ctx.user);
      const problems = validateSettlementTerms(input.terms);
      if (problems.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `invalid terms: ${problems.join("; ")}` });
      }
      const fine = await resolveFine(input.fineReference);
      const ref = await nextSettlementRef();
      const rows = await query<{ id: string }>(
        `INSERT INTO settlements
           (settlement_ref, case_ref, fine_reference, fine_id, org_id, status,
            proposed_by, respondent_name, respondent_email, original_amount)
         VALUES ($1, $2, $3, $4, $5, 'proposal', $6, $7, $8, $9) RETURNING id`,
        [
          ref, input.caseRef, input.fineReference ?? null,
          fine ? Number(fine.id) : null, fine ? Number(fine.org_id) : null,
          actor, input.respondentName ?? null, input.respondentEmail ?? null,
          fine ? Number(fine.amount) : null,
        ],
      );
      const settlementId = Number(rows[0].id);
      await query(
        `INSERT INTO settlement_terms
           (settlement_id, version, monetary_amount, currency, non_monetary_obligations,
            instalment_schedule, confidentiality_flag, transparency_rationale, is_counter, proposed_by)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, false, $8)`,
        [
          settlementId, input.terms.monetaryAmount, input.terms.currency,
          input.terms.nonMonetaryObligations, input.terms.instalmentSchedule,
          input.terms.confidentialityFlag, input.terms.transparencyRationale || null, actor,
        ],
      );
      await audit("proposed", {
        settlementId, settlementRef: ref, caseRef: input.caseRef,
        fineReference: input.fineReference ?? null, monetaryAmount: input.terms.monetaryAmount,
        currency: input.terms.currency, actor,
      }, actor);
      return { settlementId, settlementRef: ref, status: "proposal" as const };
    }),

  /** Counter-offer: new versioned terms while negotiating. */
  counterPropose: staffProcedure
    .input(z.object({ settlementId: z.number().int().positive(), terms: termsSchema }))
    .mutation(async ({ ctx, input }) => {
      const actor = actorOf(ctx.user);
      const s = await getSettlement(input.settlementId);
      const problems = validateSettlementTerms(input.terms);
      if (problems.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `invalid terms: ${problems.join("; ")}` });
      }
      const from = s.status as SettlementStatus;
      assertTransition(from, "counter");
      const version = Number(s.current_terms_version) + 1;
      await query(
        `INSERT INTO settlement_terms
           (settlement_id, version, monetary_amount, currency, non_monetary_obligations,
            instalment_schedule, confidentiality_flag, transparency_rationale, is_counter, proposed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)`,
        [
          input.settlementId, version, input.terms.monetaryAmount, input.terms.currency,
          input.terms.nonMonetaryObligations, input.terms.instalmentSchedule,
          input.terms.confidentialityFlag, input.terms.transparencyRationale || null, actor,
        ],
      );
      await query(
        `UPDATE settlements SET status = 'counter', current_terms_version = $2, updated_at = now() WHERE id = $1`,
        [input.settlementId, version],
      );
      await audit("countered", {
        settlementId: input.settlementId, settlementRef: s.settlement_ref, caseRef: s.case_ref,
        version, monetaryAmount: input.terms.monetaryAmount, actor,
      }, actor);
      return { settlementId: input.settlementId, status: "counter" as const, version };
    }),

  /** Accept current terms -> agreement. */
  acceptTerms: staffProcedure
    .input(z.object({ settlementId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const actor = actorOf(ctx.user);
      const s = await getSettlement(input.settlementId);
      await transition(input.settlementId, s.status as SettlementStatus, "agreement");
      await audit("agreed", {
        settlementId: input.settlementId, settlementRef: s.settlement_ref,
        caseRef: s.case_ref, termsVersion: s.current_terms_version, actor,
      }, actor);
      return { settlementId: input.settlementId, status: "agreement" as const };
    }),

  /** Submit an agreement into the dual-control approval gate. */
  submitForApproval: staffProcedure
    .input(z.object({ settlementId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const actor = actorOf(ctx.user);
      const s = await getSettlement(input.settlementId);
      await transition(input.settlementId, s.status as SettlementStatus, "approval");
      await audit("submitted_for_approval", {
        settlementId: input.settlementId, settlementRef: s.settlement_ref, caseRef: s.case_ref, actor,
      }, actor);
      return { settlementId: input.settlementId, status: "approval" as const };
    }),

  /**
   * Maker-checker approval. Two DISTINCT approvers, neither the proposer;
   * the approval that ACTIVATES the settlement must be commissioner level
   * (platform admin). Activation materialises the instalment schedule and
   * posts each entry to TigerBeetle (explicit ledger_post_status).
   */
  approveSettlement: adminProcedure
    .input(z.object({
      settlementId: z.number().int().positive(),
      reason: z.string().max(2000).default(""),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = actorOf(ctx.user);
      const level = approvalLevelOf(ctx.user);
      const s = await getSettlement(input.settlementId);
      if (s.status !== "approval") {
        throw new TRPCError({ code: "CONFLICT", message: `settlement is '${s.status}', not awaiting approval` });
      }
      if (s.proposed_by === actor) {
        throw new TRPCError({ code: "FORBIDDEN", message: "the proposer cannot approve their own settlement" });
      }
      const existing = await query<{ approver: string; approval_level: string }>(
        `SELECT approver, approval_level FROM settlement_approvals
         WHERE settlement_id = $1 AND decision = 'approved'`,
        [input.settlementId],
      );
      const alreadyApproved = existing.some((a) => a.approver === actor);
      // The activating approval must be commissioner level. If a commissioner
      // approved FIRST and an officer completed the pair, the settlement sits
      // in approval with no finalizer — so an already-signed commissioner may
      // re-confirm to finalize (no duplicate row inserted). Any other
      // duplicate approval is rejected.
      const canFinalize =
        alreadyApproved &&
        level === "commissioner" &&
        existing.length >= 2 &&
        existing.some((a) => a.approval_level === "commissioner");
      if (alreadyApproved && !canFinalize) {
        throw new TRPCError({ code: "CONFLICT", message: "approver has already approved" });
      }
      if (!alreadyApproved) {
        await query(
          `INSERT INTO settlement_approvals (settlement_id, approver, approval_level, decision, reason)
           VALUES ($1, $2, $3, 'approved', $4)`,
          [input.settlementId, actor, level, input.reason],
        );
      }
      const approvals = alreadyApproved
        ? existing
        : [...existing, { approver: actor, approval_level: level }];
      await audit("approval_recorded", {
        settlementId: input.settlementId, settlementRef: s.settlement_ref,
        caseRef: s.case_ref, approver: actor, approvalLevel: level,
        approvalCount: approvals.length,
      }, actor);

      const hasCommissioner = approvals.some((a) => a.approval_level === "commissioner");
      if (approvals.length < 2 || !hasCommissioner) {
        return {
          settlementId: input.settlementId,
          status: "approval" as const,
          approvals: approvals.length,
          awaiting: approvals.length < 2
            ? "second approver"
            : "commissioner-level approval",
        };
      }
      // The activating approval is commissioner-level by construction here
      // (level is this approver's level and hasCommissioner just became true
      // or already was) — but enforce FINAL-approval-is-commissioner strictly:
      if (level !== "commissioner") {
        return {
          settlementId: input.settlementId,
          status: "approval" as const,
          approvals: approvals.length,
          awaiting: "commissioner-level final approval",
        };
      }

      // ── Activation: transition + materialise + post instalments ──
      await transition(input.settlementId, "approval", "active", { activated_at: new Date().toISOString() });
      const terms = await currentTerms(input.settlementId);
      const schedule = (terms?.instalment_schedule ?? []) as Array<{ seq: number; dueDate: string; amount: number }>;
      const orgAccount = s.org_id != null ? `org:${s.org_id}` : "org:unknown";
      const ledgerResults: Array<{ seq: number; ledgerPostStatus: string; ledgerRef: string; error: string | null }> = [];
      for (const inst of schedule) {
        const inserted = await query<{ id: string }>(
          `INSERT INTO settlement_instalments (settlement_id, seq, due_date, amount, currency, status)
           VALUES ($1, $2, $3, $4, $5, 'scheduled') RETURNING id`,
          [input.settlementId, inst.seq, inst.dueDate, inst.amount, String(terms?.currency ?? "NGN")],
        );
        const posted = await postInstalmentToLedger({
          instalmentId: Number(inserted[0].id),
          settlementRef: String(s.settlement_ref),
          seq: inst.seq,
          amount: inst.amount,
          currency: String(terms?.currency ?? "NGN"),
          orgAccount,
        });
        await query(
          `UPDATE settlement_instalments
           SET ledger_post_status = $3, ledger_ref = $4, ledger_error = $5,
               status = CASE WHEN $3 = 'posted' THEN 'posted' ELSE status END,
               updated_at = now()
           WHERE id = $1 AND settlement_id = $2`,
          [Number(inserted[0].id), input.settlementId, posted.status, posted.ref, posted.error],
        );
        ledgerResults.push({ seq: inst.seq, ledgerPostStatus: posted.status, ledgerRef: posted.ref, error: posted.error });
      }
      await audit("activated", {
        settlementId: input.settlementId, settlementRef: s.settlement_ref, caseRef: s.case_ref,
        activatedBy: actor, instalments: ledgerResults,
      }, actor);
      return {
        settlementId: input.settlementId,
        status: "active" as const,
        approvals: approvals.length,
        instalments: ledgerResults,
        note: ledgerResults.some((r) => r.ledgerPostStatus !== "posted")
          ? "one or more instalments were NOT posted to TigerBeetle (see ledgerPostStatus) — manual reconciliation required"
          : null,
      };
    }),

  /** Reject at the approval gate -> void. */
  rejectSettlement: adminProcedure
    .input(z.object({
      settlementId: z.number().int().positive(),
      reason: z.string().min(5).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = actorOf(ctx.user);
      const s = await getSettlement(input.settlementId);
      if (s.status !== "approval") {
        throw new TRPCError({ code: "CONFLICT", message: `settlement is '${s.status}', not awaiting approval` });
      }
      if (s.proposed_by === actor) {
        throw new TRPCError({ code: "FORBIDDEN", message: "the proposer cannot reject their own settlement — ask a second officer" });
      }
      await query(
        `INSERT INTO settlement_approvals (settlement_id, approver, approval_level, decision, reason)
         VALUES ($1, $2, $3, 'rejected', $4)`,
        [input.settlementId, actor, approvalLevelOf(ctx.user), input.reason],
      );
      await transition(input.settlementId, "approval", "void", {
        void_reason: input.reason, voided_at: new Date().toISOString(),
      });
      await audit("rejected", {
        settlementId: input.settlementId, settlementRef: s.settlement_ref,
        caseRef: s.case_ref, rejectedBy: actor, reason: input.reason,
      }, actor);
      return { settlementId: input.settlementId, status: "void" as const };
    }),

  /**
   * Record a payment against an open instalment. Mirrors the settled amount
   * onto the linked enforcement fine (finePayments semantics) and flips the
   * settlement to 'fulfilled' when every instalment is settled and the
   * non-monetary obligations are signed off.
   */
  recordInstalmentPayment: staffProcedure
    .input(z.object({
      settlementId: z.number().int().positive(),
      seq: z.number().int().positive(),
      amount: z.number().positive(),
      paymentReference: z.string().min(3).max(255),
      obligationsSignedOff: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = actorOf(ctx.user);
      const s = await getSettlement(input.settlementId);
      if (s.status !== "active") {
        throw new TRPCError({ code: "CONFLICT", message: `settlement is '${s.status}' — payments only accepted while active` });
      }
      const rows = await query(
        `SELECT * FROM settlement_instalments WHERE settlement_id = $1 AND seq = $2`,
        [input.settlementId, input.seq],
      );
      const inst = rows[0];
      if (!inst) throw new TRPCError({ code: "NOT_FOUND", message: "instalment not found" });

      // Idempotency: a payment reference may be applied exactly once per
      // settlement (backed by idx_settlement_instalments_payment_ref).
      const dupe = await query(
        `SELECT id, seq FROM settlement_instalments
         WHERE settlement_id = $1 AND payment_reference = $2`,
        [input.settlementId, input.paymentReference],
      );
      if (dupe[0]) {
        return {
          settlementId: input.settlementId,
          seq: Number(dupe[0].seq),
          duplicated: true as const,
        };
      }

      const record: InstalmentRecord = {
        seq: Number(inst.seq),
        dueDate: String(inst.due_date),
        amount: Number(inst.amount),
        status: inst.status as InstalmentStatus,
        amountPaid: Number(inst.amount_paid),
      };
      const { instalment: updated, overpayment } = applyPayment(record, input.amount);
      await query(
        `UPDATE settlement_instalments
         SET amount_paid = $3, status = $4,
             paid_at = CASE WHEN $4 = 'paid' THEN now() ELSE paid_at END,
             payment_reference = $5, updated_at = now()
         WHERE id = $1 AND settlement_id = $2`,
        [inst.id, input.settlementId, updated.amountPaid, updated.status, input.paymentReference],
      );

      // Mirror onto the linked fine (settlement -> finePayments linkage).
      let fineUpdated = false;
      if (s.fine_id != null) {
        await query(
          `UPDATE enforcement_fines
           SET amount_paid = COALESCE(amount_paid, 0) + $2,
               status = CASE WHEN COALESCE(amount_paid, 0) + $2 >= amount THEN 'paid' ELSE 'partial' END,
               paid_at = CASE WHEN COALESCE(amount_paid, 0) + $2 >= amount THEN NOW() ELSE paid_at END,
               payment_reference = $3, updated_at = NOW()
           WHERE id = $1`,
          [Number(s.fine_id), input.amount - overpayment, input.paymentReference],
        ).catch((err: unknown) => {
          if (isMissingTable(err)) return;
          throw err;
        });
        fineUpdated = true;
      }

      // Fulfilment check across all instalments.
      const all = await query(
        `SELECT id, seq, due_date, amount, status, amount_paid FROM settlement_instalments WHERE settlement_id = $1`,
        [input.settlementId],
      );
      const records: InstalmentRecord[] = all.map((r) => ({
        seq: Number(r.seq), dueDate: String(r.due_date), amount: Number(r.amount),
        status: (r.id === inst.id ? updated.status : r.status) as InstalmentStatus,
        amountPaid: r.id === inst.id ? updated.amountPaid : Number(r.amount_paid),
      }));
      let fulfilled = false;
      if (isFulfilled(records, input.obligationsSignedOff)) {
        await transition(input.settlementId, "active", "fulfilled", { fulfilled_at: new Date().toISOString() });
        fulfilled = true;
      }
      await audit(fulfilled ? "fulfilled" : "instalment_paid", {
        settlementId: input.settlementId, settlementRef: s.settlement_ref, caseRef: s.case_ref,
        seq: input.seq, amount: input.amount, overpayment,
        paymentReference: input.paymentReference, fineReference: s.fine_reference ?? null,
        fineUpdated, actor,
      }, actor);
      return {
        settlementId: input.settlementId, seq: input.seq,
        instalmentStatus: updated.status, amountPaid: updated.amountPaid,
        overpayment, fulfilled, fineUpdated,
      };
    }),

  /**
   * Default detection sweep: any open instalment past due + grace period
   * escalates — the settlement defaults and the enforcement case reopens
   * (the linked fine flips back to 'outstanding'). Designed to be called by
   * a scheduler or manually by staff; returns every escalation performed.
   */
  detectDefaults: staffProcedure
    .input(z.object({
      settlementId: z.number().int().positive().optional(),
      graceDays: z.number().int().min(0).max(90).default(DEFAULT_GRACE_DAYS),
    }).optional())
    .mutation(async ({ ctx, input }) => {
      const actor = actorOf(ctx.user);
      const active = await query(
        `SELECT id, settlement_ref, case_ref, fine_id, fine_reference FROM settlements
         WHERE status = 'active' AND ($1::bigint IS NULL OR id = $1)`,
        [input?.settlementId ?? null],
      );
      const escalations: Array<{ settlementId: number; overdueSeqs: number[]; reason: string }> = [];
      for (const s of active) {
        const rows = await query(
          `SELECT seq, due_date, amount, status, amount_paid FROM settlement_instalments WHERE settlement_id = $1`,
          [Number(s.id)],
        );
        const records: InstalmentRecord[] = rows.map((r) => ({
          seq: Number(r.seq), dueDate: String(r.due_date), amount: Number(r.amount),
          status: r.status as InstalmentStatus, amountPaid: Number(r.amount_paid),
        }));
        const verdict = evaluateDefaults("active", records, new Date(), input?.graceDays ?? DEFAULT_GRACE_DAYS);
        if (!verdict.shouldDefault) continue;
        await query(
          `UPDATE settlement_instalments SET status = 'overdue', updated_at = now()
           WHERE settlement_id = $1 AND seq = ANY($2::int[]) AND status IN ('scheduled', 'posted', 'partial')`,
          [Number(s.id), verdict.overdueSeqs],
        );
        await transition(Number(s.id), "active", "defaulted", {
          default_reason: verdict.escalationReason, defaulted_at: new Date().toISOString(),
        });
        // Case reopens: the settled amount is no longer performing.
        if (s.fine_id != null) {
          await query(
            `UPDATE enforcement_fines SET status = 'outstanding', updated_at = NOW() WHERE id = $1`,
            [Number(s.fine_id)],
          ).catch((err: unknown) => {
            if (isMissingTable(err)) return;
            throw err;
          });
        }
        await audit("defaulted", {
          settlementId: Number(s.id), settlementRef: s.settlement_ref, caseRef: s.case_ref,
          overdueSeqs: verdict.overdueSeqs, reason: verdict.escalationReason,
          fineReference: s.fine_reference ?? null, caseReopened: s.fine_id != null, actor,
        }, actor);
        escalations.push({
          settlementId: Number(s.id),
          overdueSeqs: verdict.overdueSeqs,
          reason: verdict.escalationReason ?? "overdue instalments",
        });
      }
      return { checked: active.length, escalations };
    }),

  /**
   * Request a waiver/reduction of the agreed monetary amount. Requires a
   * documented legal basis and is routed through the 0080 maker-checker
   * queue (action 'fine_settlement') — two distinct approvers, neither the
   * requester. Nothing is applied here; executeWaiver applies it after the
   * dual-control request is approved.
   */
  requestWaiver: staffProcedure
    .input(z.object({
      settlementId: z.number().int().positive(),
      reductionAmount: z.number().positive(),
      legalBasis: z.string().min(1).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = actorOf(ctx.user);
      const s = await getSettlement(input.settlementId);
      if (!["agreement", "approval", "active"].includes(String(s.status))) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `waiver only applies to agreed/active settlements (current: '${s.status}')`,
        });
      }
      const terms = await currentTerms(input.settlementId);
      const outstanding = Number(terms?.monetary_amount ?? 0) - Number(s.reduction_amount ?? 0);
      const problems = validateWaiver({
        reductionAmount: input.reductionAmount,
        outstandingAmount: outstanding,
        legalBasis: input.legalBasis,
      });
      if (problems.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: problems.join("; ") });
      }
      const queued = await requireDualControl(
        "fine_settlement",
        {
          kind: "settlement_waiver",
          settlement_id: input.settlementId,
          settlement_ref: s.settlement_ref,
          case_ref: s.case_ref,
          reduction_amount: input.reductionAmount,
          legal_basis: input.legalBasis,
        },
        actor,
        { policy: "waiver_requires_dual_control", outstanding },
      );
      await audit("waiver_requested", {
        settlementId: input.settlementId, settlementRef: s.settlement_ref, caseRef: s.case_ref,
        reductionAmount: input.reductionAmount, dualControlRequestId: queued.requestId, actor,
      }, actor);
      return { settlementId: input.settlementId, dualControlRequestId: queued.requestId, status: "pending_dual_control" as const };
    }),

  /**
   * Apply a waiver after its dual-control request was approved. Reduction
   * is applied to outstanding instalments from the LAST one backwards;
   * fully reduced instalments become 'waived'. Refuses without an approved,
   * unconsumed dual-control request for this settlement.
   */
  executeWaiver: adminProcedure
    .input(z.object({
      settlementId: z.number().int().positive(),
      dualControlRequestId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = actorOf(ctx.user);
      const s = await getSettlement(input.settlementId);
      const reqs = await query(
        `SELECT id, payload, status FROM dual_control_requests
         WHERE id = $1 AND action_type = 'fine_settlement' AND status = 'approved'`,
        [input.dualControlRequestId],
      ).catch((err: unknown) => {
        if (isMissingTable(err)) return [];
        throw err;
      });
      const req = reqs[0];
      const payload = (req?.payload ?? {}) as Record<string, unknown>;
      if (!req || payload.kind !== "settlement_waiver" || Number(payload.settlement_id) !== input.settlementId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "no approved dual-control waiver request for this settlement",
        });
      }
      if (Number(s.reduction_amount ?? 0) > 0 && s.reduction_legal_basis === payload.legal_basis) {
        return { settlementId: input.settlementId, status: "already_applied" as const };
      }
      const reduction = Number(payload.reduction_amount);
      let remaining = reduction;
      const open = await query<{ id: number; seq: number; amount: string; status: string }>(
        `SELECT id, seq, amount, status FROM settlement_instalments
         WHERE settlement_id = $1 AND status IN ('scheduled', 'posted', 'partial', 'overdue')
         ORDER BY seq DESC`,
        [input.settlementId],
      );
      const waivedSeqs: number[] = [];
      for (const inst of open) {
        if (remaining <= 0) break;
        const amt = Number(inst.amount);
        if (amt <= remaining + 0.001) {
          await query(
            `UPDATE settlement_instalments SET status = 'waived', updated_at = now() WHERE id = $1`,
            [inst.id],
          );
          waivedSeqs.push(inst.seq);
          remaining = Math.round((remaining - amt) * 100) / 100;
        } else {
          await query(
            `UPDATE settlement_instalments SET amount = amount - $2, updated_at = now() WHERE id = $1`,
            [inst.id, remaining],
          );
          remaining = 0;
        }
      }
      await query(
        `UPDATE settlements
         SET reduction_amount = COALESCE(reduction_amount, 0) + $2,
             reduction_legal_basis = $3, updated_at = now()
         WHERE id = $1`,
        [input.settlementId, reduction, String(payload.legal_basis)],
      );
      await audit("waiver_executed", {
        settlementId: input.settlementId, settlementRef: s.settlement_ref, caseRef: s.case_ref,
        reductionAmount: reduction, legalBasis: payload.legal_basis,
        waivedInstalmentSeqs: waivedSeqs.sort((a, b) => a - b),
        dualControlRequestId: input.dualControlRequestId, actor,
      }, actor);
      return {
        settlementId: input.settlementId,
        status: "waiver_applied" as const,
        reductionAmount: reduction,
        waivedInstalmentSeqs: waivedSeqs.sort((a, b) => a - b),
      };
    }),

  // ─── Reads ─────────────────────────────────────────────────────────────

  getSettlement: staffProcedure
    .input(z.object({ settlementId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const settlement = await getSettlement(input.settlementId);
      const terms = await query(
        `SELECT version, monetary_amount, currency, non_monetary_obligations,
                instalment_schedule, confidentiality_flag, transparency_rationale,
                is_counter, proposed_by, proposed_at
         FROM settlement_terms WHERE settlement_id = $1 ORDER BY version DESC`,
        [input.settlementId],
      );
      const approvals = await query(
        `SELECT approver, approval_level, decision, reason, decided_at
         FROM settlement_approvals WHERE settlement_id = $1 ORDER BY decided_at ASC`,
        [input.settlementId],
      );
      const instalments = await query(
        `SELECT seq, due_date, amount, currency, status, amount_paid,
                ledger_post_status, ledger_ref, ledger_error, payment_reference, paid_at
         FROM settlement_instalments WHERE settlement_id = $1 ORDER BY seq ASC`,
        [input.settlementId],
      );
      return { settlement, terms, approvals, instalments };
    }),

  listSettlements: staffProcedure
    .input(z.object({
      caseRef: z.string().max(128).optional(),
      fineReference: z.string().max(60).optional(),
      status: z.enum(["proposal", "counter", "agreement", "approval", "active", "fulfilled", "defaulted", "void"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input }) => {
      const rows = await query(
        `SELECT id, settlement_ref, case_ref, fine_reference, org_id, status,
                original_amount, reduction_amount, proposed_by, created_at, updated_at
         FROM settlements
         WHERE ($1::text IS NULL OR case_ref = $1)
           AND ($2::text IS NULL OR fine_reference = $2)
           AND ($3::text IS NULL OR status = $3)
         ORDER BY id DESC LIMIT $4`,
        [input?.caseRef ?? null, input?.fineReference ?? null, input?.status ?? null, input?.limit ?? 50],
      );
      return { rows };
    }),

  /** Instalments not posted to the ledger — manual reconciliation queue. */
  ledgerReconciliationQueue: staffProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(async ({ input }) => {
      const rows = await query(
        `SELECT i.id, i.settlement_id, s.settlement_ref, s.case_ref, i.seq, i.due_date,
                i.amount, i.currency, i.status, i.ledger_post_status, i.ledger_ref, i.ledger_error
         FROM settlement_instalments i
         JOIN settlements s ON s.id = i.settlement_id
         WHERE i.ledger_post_status IN ('UNCONFIGURED', 'failed', 'skipped_non_usd')
         ORDER BY i.due_date ASC LIMIT $1`,
        [input?.limit ?? 100],
      );
      return { rows };
    }),
});

export type SettlementWorkflowRouter = typeof settlementWorkflowRouter;
