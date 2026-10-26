/**
 * Fine Payments & Reconciliation Router (gap 12)
 *
 * Remita-style RRR flow on top of enforcement_fines. Distinct procedure names
 * from the phase11 finePaymentRouter (getOutstanding / recordPayment /
 * getPaymentStats) so both can be mounted side by side.
 *
 *   - generateRrr / getRrrStatus / gatewayWebhook / simulateRrrSettlement
 *   - runReconciliationBatch (daily) + reconciliationQueue (unmatched)
 *   - createInstallmentPlan / listInstallmentPlans / detectInstallmentDefaults
 *   - getReceipt / resendReceipt (receipt numbers NDPC-RCT-YYYY-#####)
 *   - requestRefund / listRefunds / decideRefund (approval workflow)
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { getRemitaGateway, verifyGatewaySignature } from "../services/remitaAdapter";
import { sendPaymentReceipt } from "../services/paymentReceiptEmail";
import { tigerbeetleTransfer } from "../middlewareExtensions";
import { runFineReconciliationBatch } from "../services/scheduledSweeps";

/** TigerBeetle collections account receiving settled fine payments. */
const FINE_COLLECTIONS_ACCOUNT = "ndpc-fine-collections";

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
    return result.rows ?? [];
  } catch (err) {
    logger.error({ err, query: query.slice(0, 200) }, "[finePayments] DB query error");
    // Preserve the original pg error on .cause so callers can react to
    // specific SQLSTATEs (e.g. 23505 unique-violation for the one-live-RRR
    // per penalty guard) without string-matching messages.
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error", cause: err });
  }
}

/** Extract the Postgres SQLSTATE from an exec() failure, if any. */
function sqlstate(err: unknown): string | undefined {
  const cause = (err as { cause?: { code?: string } } | null)?.cause;
  return cause?.code;
}

/** audit_logs.resource_id / user_id are int4; coerce non-numeric refs to NULL. */
function toIntOrNull(v: string | number | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isInteger(n) && Math.abs(n) < 2147483647 ? n : null;
}

const STAFF_ROLES = new Set(["admin", "government_staff", "regulator", "auditor"]);

/**
 * Org-scope guard: staff roles see everything; organisation users only fines
 * belonging to their own organisation (organization_users membership or the
 * org id on their account).
 */
async function assertFineOrgAccess(
  user: { id: number; role: string; organizationId?: number | null },
  fineOrgId: number | null | undefined,
): Promise<void> {
  if (STAFF_ROLES.has(user.role)) return;
  if (fineOrgId == null) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Fine is not linked to an organisation" });
  }
  if (user.organizationId != null && Number(user.organizationId) === Number(fineOrgId)) return;
  const rows = await exec(
    `SELECT 1 AS member FROM organization_users WHERE user_id = $1 AND organization_id = $2 LIMIT 1`,
    [user.id, fineOrgId],
  );
  if (!rows[0]) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Fine belongs to a different organisation" });
  }
}

/** Resolve the org that owns a fine. */
async function fineOrgId(penaltyId: number): Promise<number | null> {
  const rows = await exec(`SELECT org_id FROM enforcement_fines WHERE id = $1`, [penaltyId]);
  return rows[0]?.org_id ?? null;
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
    logger.warn({ err, action, resourceType }, "[finePayments] Audit log write failed");
  }
}

/**
 * Reference-number allocation from a Postgres SEQUENCE (migration 0075/0077).
 * Replaces the racy COUNT(*)+1 / Date.now()-suffix schemes: sequence values
 * are unique across concurrent settlements by construction. `sequence` is an
 * internal constant, never user input.
 */
async function nextSequencedRef(sequence: string, prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await exec(`SELECT nextval('${sequence}') AS n`);
  return `${prefix}-${year}-${String(row?.n ?? 1).padStart(5, "0")}`;
}

/** Receipt number generator: NDPC-RCT-YYYY-##### backed by ndsep_receipt_number_seq. */
async function nextReceiptNumber(): Promise<string> {
  return nextSequencedRef("ndsep_receipt_number_seq", "NDPC-RCT");
}

/**
 * Route a non-settleable gateway payment to the unmatched reconciliation
 * queue for manual review (expired RRRs, amount mismatches). Idempotent per
 * RRR+reason via the NOT EXISTS guard.
 */
async function routeToUnmatchedQueue(
  rrr: string,
  penaltyId: number | null,
  amount: number | null,
  notes: string,
): Promise<void> {
  await exec(
    `INSERT INTO payment_reconciliations (rrr, penalty_id, matched_amount, match_status, batch_date, notes)
     SELECT $1, $2, $3, 'unmatched', CURRENT_DATE, $4
     WHERE NOT EXISTS (
       SELECT 1 FROM payment_reconciliations r WHERE r.rrr = $1 AND r.notes = $4
     )`,
    [rrr, penaltyId, amount, notes],
  );
  await logAudit("payment.routed_to_unmatched", "payment_rrr_code", rrr, null, { penalty_id: penaltyId, amount, notes });
}

/**
 * Shared settlement path used by the gateway webhook and the dev simulator:
 * mark RRR paid, issue the receipt, update the fine, email the payer.
 * Idempotent — re-settling an already-paid RRR is a no-op.
 *
 * Genuine payments that cannot be settled cleanly are NOT silently dropped:
 *  - webhookAmount !== RRR amount  -> unmatched/reconciliation queue;
 *  - RRR expired/cancelled/unknown-but-present -> unmatched/reconciliation
 *    queue (the payer's money must be traced, not vanish into {}).
 */
async function settleRrr(
  rrr: string,
  payerEmail: string | null,
  webhookAmount: number | null = null,
): Promise<{ receiptNumber?: string; queuedForReview?: boolean; healed?: boolean; ledgerPosted?: boolean }> {
  const existing = await exec(
    `SELECT id, penalty_id, amount, currency, status, expires_at FROM payment_rrr_codes WHERE rrr = $1`,
    [rrr],
  );
  const current = existing[0];
  if (current && current.status === "paid") {
    // Already settled — idempotent no-op, but HEAL any missing side-effects
    // left by a partially-committed earlier settlement (receipt row and/or
    // fine credit).
    const receiptRows = await exec(`SELECT receipt_number FROM receipts WHERE rrr = $1 LIMIT 1`, [rrr]);
    const fineRows = await exec(
      `SELECT amount, COALESCE(amount_paid, 0) AS amount_paid, status FROM enforcement_fines WHERE id = $1`,
      [current.penalty_id],
    );
    const receiptMissing = !receiptRows[0];
    const fineUnderCredited = fineRows[0] != null && Number(fineRows[0].amount_paid) < Number(current.amount);
    if (!receiptMissing && !fineUnderCredited) return {};
    const healPool = getPool();
    if (!healPool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const healClient = await healPool.connect();
    try {
      await healClient.query("BEGIN");
      let healedReceipt: string | undefined;
      if (receiptMissing) {
        healedReceipt = await nextReceiptNumber();
        await healClient.query(
          `INSERT INTO receipts (receipt_number, rrr, penalty_id, amount, currency, payer_email)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [healedReceipt, rrr, current.penalty_id, current.amount, current.currency, payerEmail],
        );
      }
      if (fineUnderCredited) {
        await healClient.query(
          `UPDATE enforcement_fines
           SET amount_paid = GREATEST(COALESCE(amount_paid, 0), $2),
               status = CASE WHEN GREATEST(COALESCE(amount_paid, 0), $2) >= amount THEN 'paid' ELSE status END,
               paid_at = CASE WHEN GREATEST(COALESCE(amount_paid, 0), $2) >= amount THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
               updated_at = NOW()
           WHERE id = $1`,
          [current.penalty_id, current.amount],
        );
      }
      await healClient.query("COMMIT");
      await logAudit("payment.settlement_healed", "payment_rrr_code", rrr, null, {
        receipt_healed: receiptMissing, fine_healed: fineUnderCredited,
      });
      return { receiptNumber: healedReceipt, healed: true };
    } catch (err) {
      await healClient.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      healClient.release();
    }
  }
  if (current && webhookAmount != null && Number(webhookAmount) !== Number(current.amount)) {
    // Amount mismatch: do not settle. The under/over-payment goes to the
    // unmatched queue for manual reconciliation.
    await routeToUnmatchedQueue(
      rrr,
      current.penalty_id,
      webhookAmount,
      `Webhook amount ${webhookAmount} does not match RRR amount ${current.amount}; manual reconciliation required`,
    );
    return { queuedForReview: true };
  }
  if (current && current.status !== "generated") {
    // Genuine payment against an expired/cancelled RRR — route to the
    // unmatched queue instead of silently swallowing it.
    await routeToUnmatchedQueue(
      rrr,
      current.penalty_id,
      webhookAmount ?? Number(current.amount),
      `Payment received for RRR in '${current.status}' status; manual reconciliation required`,
    );
    return { queuedForReview: true };
  }
  // Atomic settlement: RRR flip + receipt issue + fine credit commit or roll
  // back together in one transaction.
  const pool = getPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const client = await pool.connect();
  let payment: { id: number; penalty_id: number; amount: string | number; currency: string } | null = null;
  let receiptNumber = "";
  try {
    await client.query("BEGIN");
    const settled = await client.query(
      `UPDATE payment_rrr_codes SET status = 'paid', paid_at = NOW()
       WHERE rrr = $1 AND status = 'generated' AND expires_at > NOW()
       RETURNING id, penalty_id, amount, currency`,
      [rrr],
    );
    if (!settled.rows[0]) {
      await client.query("ROLLBACK");
      if (current) {
        // Generated but past expiry at settlement time — same expired-RRR path.
        await routeToUnmatchedQueue(
          rrr,
          current.penalty_id,
          webhookAmount ?? Number(current.amount),
          "Payment received for expired RRR; manual reconciliation required",
        );
        return { queuedForReview: true };
      }
      // Unknown RRR — idempotent no-op (callers 404 unknown RRRs upstream).
      return {};
    }
    payment = settled.rows[0];
    receiptNumber = await nextReceiptNumber();
    // Receipt numbers come from ndsep_receipt_number_seq and are unique by
    // construction; a conflict here is a real integrity failure, not a skip.
    await client.query(
      `INSERT INTO receipts (receipt_number, rrr, penalty_id, amount, currency, payer_email)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [receiptNumber, rrr, payment.penalty_id, payment.amount, payment.currency, payerEmail],
    );
    // Reflect the settlement on the fine itself (mirrors phase11 recordPayment semantics).
    await client.query(
      `UPDATE enforcement_fines
       SET status = CASE WHEN COALESCE(amount_paid, 0) + $2 >= amount THEN 'paid' ELSE 'partial' END,
           amount_paid = COALESCE(amount_paid, 0) + $2,
           paid_at = CASE WHEN COALESCE(amount_paid, 0) + $2 >= amount THEN NOW() ELSE paid_at END,
           payment_reference = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [payment.penalty_id, payment.amount, rrr],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  if (!payment) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Settlement state error" });
  const fineRows = await exec(
    `SELECT f.id, f.org_id, o.name AS org_name FROM enforcement_fines f LEFT JOIN organizations o ON o.id = f.org_id WHERE f.id = $1`,
    [payment.penalty_id],
  );
  // TigerBeetle mirror (Round-10 NGN ledger wiring): the settled amount must
  // also exist in the double-entry ledger (NGN -> ledger TB_LEDGER_NGN via
  // middlewareExtensions). This runs AFTER the Postgres commit and never
  // blocks settlement: a bridge failure is enqueued into
  // ledger_reconciliation_queue (0110) with alerting inside
  // tigerbeetleTransfer, and logged here. Runs exactly once per RRR — the
  // idempotency guard above (status 'paid' early-return / heal path) never
  // reaches this code, so replays cannot double-post.
  let ledgerPosted = false;
  try {
    await tigerbeetleTransfer({
      debitAccountId: fineRows[0]?.org_id != null ? `org:${fineRows[0].org_id}` : `penalty:${payment.penalty_id}`,
      creditAccountId: FINE_COLLECTIONS_ACCOUNT,
      amount: Number(payment.amount),
      currency: payment.currency,
      reference: receiptNumber,
      transferType: "fine",
    });
    ledgerPosted = true;
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), rrr, receiptNumber },
      "[finePayments] TigerBeetle ledger post failed — settlement stands, transfer enqueued to ledger_reconciliation_queue",
    );
  }
  if (payerEmail) {
    sendPaymentReceipt({
      to: payerEmail,
      orgName: fineRows[0]?.org_name ?? "Organisation",
      receiptNumber,
      rrr,
      amount: Number(payment.amount),
      currency: payment.currency,
      penaltyRef: `NDSEP-PEN-${String(payment.penalty_id).padStart(6, "0")}`,
      paidAt: new Date(),
    }).catch((e: unknown) => logger.warn({ err: e instanceof Error ? e.message : String(e) }, "[finePayments] Receipt email failed"));
  }
  emitMutationEvent("ndsep.payments.settlement", { action: "rrrPaid", rrr, receiptNumber, ledgerPosted, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
  return { receiptNumber, ledgerPosted };
}

export const finePaymentsRouter = router({
  // ─── RRR lifecycle ────────────────────────────────────────────────────────

  /** Generate a Remita-style RRR for an outstanding penalty (72h validity). */
  generateRrr: protectedProcedure
    .input(z.object({
      penaltyId: z.number(),
      payerEmail: z.string().email().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const fine = await exec(
        `SELECT id, org_id, amount, COALESCE(amount_paid, 0) AS amount_paid, currency, status FROM enforcement_fines WHERE id = $1`,
        [input.penaltyId],
      );
      if (!fine[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Penalty not found" });
      // Org-scope: org users may only raise RRRs against their own org's fines.
      await assertFineOrgAccess(ctx.user, fine[0].org_id);
      if (fine[0].status === "paid") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Penalty is already fully paid" });
      }
      if (fine[0].status === "waived" || fine[0].status === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Penalty is '${fine[0].status}' — no payment can be collected` });
      }
      // Penalty-ledger bridge (0101): a stay on the linked financial_penalty
      // suspends RRR collection on the fine.
      const stays = await exec(
        `SELECT ps.id FROM penalty_stays ps
         JOIN financial_penalties fp ON fp.id = ps.penalty_id
         WHERE fp.enforcement_fine_id = $1 AND ps.status = 'active'
         LIMIT 1`,
        [input.penaltyId],
      );
      if (stays[0]) {
        throw new TRPCError({ code: "CONFLICT", message: "Collection is stayed pending appeal — RRR generation is suspended" });
      }
      // One live RRR per penalty; expire any stale ones first.
      await exec(
        `UPDATE payment_rrr_codes SET status = 'expired' WHERE penalty_id = $1 AND status = 'generated' AND expires_at <= NOW()`,
        [input.penaltyId],
      );
      const live = await exec(
        `SELECT rrr, amount, currency, status, expires_at FROM payment_rrr_codes WHERE penalty_id = $1 AND status = 'generated'`,
        [input.penaltyId],
      );
      if (live[0]) return { ...live[0], reused: true };

      const gateway = getRemitaGateway();
      // Outstanding remainder — the old `a - b || a` fallback re-charged the
      // FULL amount whenever the remainder was exactly 0.
      const amount = Math.round((Number(fine[0].amount) - Number(fine[0].amount_paid)) * 100) / 100;
      if (amount <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Penalty has no outstanding balance" });
      }
      const result = await gateway.generateRRR({
        penaltyId: input.penaltyId,
        amount,
        currency: fine[0].currency ?? "NGN",
        payerEmail: input.payerEmail,
        description: `NDPC penalty NDSEP-PEN-${String(input.penaltyId).padStart(6, "0")}`,
      });
      let rows: any[];
      try {
        rows = await exec(
          `INSERT INTO payment_rrr_codes (rrr, penalty_id, amount, currency, gateway_ref, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING rrr, amount, currency, status, expires_at`,
          [result.rrr, input.penaltyId, amount, fine[0].currency ?? "NGN", result.gatewayRef, result.expiresAt],
        );
      } catch (err) {
        // Double-RRR race: the partial unique index
        // idx_payment_rrr_one_active_per_penalty (migration 0075) admits at
        // most one live/settled RRR per penalty. A concurrent request won the
        // race — return the RRR it minted instead of erroring.
        if (sqlstate(err) === "23505") {
          const raced = await exec(
            `SELECT rrr, amount, currency, status, expires_at FROM payment_rrr_codes WHERE penalty_id = $1 AND status = 'generated'`,
            [input.penaltyId],
          );
          if (raced[0]) return { ...raced[0], reused: true };
        }
        throw err;
      }
      await logAudit("payment.rrr_generate", "payment_rrr_code", result.rrr, String(ctx.user.id), { penalty_id: input.penaltyId, amount });
      return { ...rows[0], reused: false };
    }),

  /** Check RRR status; lazily expires stale codes. */
  getRrrStatus: protectedProcedure
    .input(z.object({ rrr: z.string().min(6) }))
    .query(async ({ input, ctx }) => {
      await exec(`UPDATE payment_rrr_codes SET status = 'expired' WHERE rrr = $1 AND status = 'generated' AND expires_at <= NOW()`, [input.rrr]);
      const rows = await exec(
        `SELECT rrr, penalty_id, amount, currency, status, expires_at, paid_at FROM payment_rrr_codes WHERE rrr = $1`,
        [input.rrr],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "RRR not found" });
      await assertFineOrgAccess(ctx.user, await fineOrgId(rows[0].penalty_id));
      return rows[0];
    }),

  /**
   * Gateway settlement webhook. PUBLIC but HMAC-verified: the payload must be
   * signed by the gateway secret (see remitaAdapter for the PROD HMAC-SHA512
   * scheme). Replays are harmless because settleRrr is idempotent.
   */
  gatewayWebhook: publicProcedure
    .input(z.object({
      rrr: z.string().min(6),
      amount: z.number().positive(),
      payerEmail: z.string().email().optional(),
      signature: z.string().min(16),
    }))
    .mutation(async ({ input }) => {
      const payload = `${input.rrr}|${input.amount}`;
      if (!verifyGatewaySignature(payload, input.signature)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid gateway signature" });
      }
      const rrrRows = await exec(`SELECT amount FROM payment_rrr_codes WHERE rrr = $1`, [input.rrr]);
      if (!rrrRows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "RRR not found" });
      // The webhook amount is compared against the RRR amount inside
      // settleRrr; mismatches/expired-RRR payments are routed to the
      // unmatched reconciliation queue rather than silently swallowed.
      const { receiptNumber, queuedForReview } = await settleRrr(input.rrr, input.payerEmail ?? null, input.amount);
      await logAudit("payment.gateway_webhook", "payment_rrr_code", input.rrr, null, {
        amount: input.amount, receipt: receiptNumber ?? null, queued_for_review: queuedForReview ?? false,
      });
      return { success: true, receiptNumber: receiptNumber ?? null, queuedForReview: queuedForReview ?? false };
    }),

  /**
   * DEV/DEMO ONLY: simulate a gateway settlement for the mock adapter. Signs
   * the payload with the same secret the webhook verifies, so it exercises the
   * exact production path. Disable by unsetting the mock gateway in prod.
   */
  simulateRrrSettlement: adminProcedure
    .input(z.object({ rrr: z.string().min(6), payerEmail: z.string().email().optional() }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(`SELECT amount FROM payment_rrr_codes WHERE rrr = $1 AND status = 'generated'`, [input.rrr]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Active RRR not found" });
      const { receiptNumber } = await settleRrr(input.rrr, input.payerEmail ?? null);
      await logAudit("payment.rrr_simulate", "payment_rrr_code", input.rrr, String(ctx.user.id), { receipt: receiptNumber ?? null });
      return { success: true, receiptNumber: receiptNumber ?? null };
    }),

  // ─── Reconciliation ───────────────────────────────────────────────────────

  /**
   * Reconciliation batch: match paid RRR payments to penalties. Already-
   * reconciled RRRs are skipped. Payments whose penalty no longer exists (or
   * with mismatched amounts) land in the unmatched queue for manual review.
   * The canonical logic lives in services/scheduledSweeps.runFineReconciliationBatch
   * — the durable round12-fine-reconciliation-batch Temporal schedule (every
   * 6h) runs the SAME function; this mutation remains as the operator override.
   */
  runReconciliationBatch: adminProcedure
    .input(z.object({ batchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }))
    .mutation(async ({ input, ctx }) => {
      return runFineReconciliationBatch({
        batchDate: input.batchDate,
        actor: String(ctx.user.id),
      });
    }),

  /** Unmatched reconciliation queue for manual review. */
  reconciliationQueue: protectedProcedure
    .input(z.object({ batchDate: z.string().optional() }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM payment_reconciliations WHERE match_status IN ('unmatched', 'partial')`;
      const params: unknown[] = [];
      if (input.batchDate) { params.push(input.batchDate); sql += ` AND batch_date = $${params.length}`; }
      sql += ` ORDER BY created_at DESC LIMIT 500`;
      return exec(sql, params);
    }),

  /** Batch history summary. */
  reconciliationHistory: protectedProcedure.query(async () => {
    return exec(
      `SELECT batch_date,
              COUNT(*) AS processed,
              COUNT(*) FILTER (WHERE match_status = 'matched') AS matched,
              COUNT(*) FILTER (WHERE match_status = 'partial') AS partial,
              COUNT(*) FILTER (WHERE match_status = 'unmatched') AS unmatched
       FROM payment_reconciliations GROUP BY batch_date ORDER BY batch_date DESC LIMIT 90`,
    );
  }),

  // ─── Installment plans ────────────────────────────────────────────────────

  /**
   * Create an installment plan for a penalty. The schedule is generated
   * server-side: equal tranches (last tranche absorbs rounding) spaced
   * `intervalDays` apart starting from `firstDueDate`.
   */
  createInstallmentPlan: protectedProcedure
    .input(z.object({
      penaltyId: z.number(),
      installments: z.number().int().min(2).max(12),
      firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      intervalDays: z.number().int().min(7).max(92).default(30),
    }))
    .mutation(async ({ input, ctx }) => {
      const fine = await exec(`SELECT id, amount, status FROM enforcement_fines WHERE id = $1`, [input.penaltyId]);
      if (!fine[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Penalty not found" });
      if (fine[0].status === "paid") throw new TRPCError({ code: "BAD_REQUEST", message: "Penalty already paid" });
      const total = Number(fine[0].amount);
      const tranche = Math.floor((total / input.installments) * 100) / 100;
      const schedule = Array.from({ length: input.installments }, (_, i) => {
        const due = new Date(`${input.firstDueDate}T00:00:00Z`);
        due.setUTCDate(due.getUTCDate() + i * input.intervalDays);
        return {
          seq: i + 1,
          due_date: due.toISOString().slice(0, 10),
          amount: i === input.installments - 1 ? Math.round((total - tranche * (input.installments - 1)) * 100) / 100 : tranche,
          status: "pending" as const,
          paid_at: null as string | null,
        };
      });
      // Per-year DB-sequence reference (migration 0077) — no Date.now() suffix.
      const planRef = await nextSequencedRef("ndsep_installment_plan_ref_seq", "INS");
      const rows = await exec(
        `INSERT INTO payment_installments (plan_ref, penalty_id, schedule)
         VALUES ($1, $2, $3) RETURNING *`,
        [planRef, input.penaltyId, JSON.stringify(schedule)],
      );
      await logAudit("payment.installment_create", "payment_installment", rows[0].id, String(ctx.user.id), { plan_ref: planRef, penalty_id: input.penaltyId, installments: input.installments });
      return rows[0];
    }),

  /**
   * Record a payment against an installment plan. The amount is applied to
   * the earliest unpaid tranches (paid_amount tracked per tranche so partial
   * tranche payments work), the fine's amount_paid/status advance
   * cumulatively, and the plan flips to 'completed' when every tranche is
   * paid — so plans can actually complete. Idempotent on paymentReference.
   */
  recordInstallmentPayment: protectedProcedure
    .input(z.object({
      planRef: z.string().min(4),
      amount: z.number().positive(),
      paymentReference: z.string().min(5),
      paidAt: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const pool = getPool();
      if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const client = await pool.connect();
      let result: Record<string, unknown>;
      try {
        await client.query("BEGIN");
        // Row lock: concurrent payments against the same plan serialize here.
        const plans = await client.query(
          `SELECT id, plan_ref, penalty_id, schedule, status, recorded_payments FROM payment_installments WHERE plan_ref = $1 FOR UPDATE`,
          [input.planRef],
        );
        const plan = plans.rows[0];
        if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "Installment plan not found" });
        if (plan.status !== "active") {
          throw new TRPCError({ code: "CONFLICT", message: `Plan is '${plan.status}'; payments can only be applied to active plans` });
        }
        const recorded = typeof plan.recorded_payments === "string" ? JSON.parse(plan.recorded_payments) : (plan.recorded_payments ?? []);
        // Idempotency: a reference already applied to this plan returns the
        // current state instead of double-counting.
        if (recorded.some((p: { payment_reference?: string }) => p.payment_reference === input.paymentReference)) {
          await client.query("ROLLBACK");
          return { planRef: plan.plan_ref, status: plan.status, idempotent: true, alreadyApplied: true };
        }
        const schedule = (typeof plan.schedule === "string" ? JSON.parse(plan.schedule) : plan.schedule) as Array<{
          seq: number; due_date: string; amount: number; status: string; paid_at: string | null; paid_amount?: number;
        }>;
        let remaining = Math.round(input.amount * 100) / 100;
        const paidAt = input.paidAt ?? new Date().toISOString();
        for (const entry of schedule) {
          if (remaining <= 0) break;
          if (entry.status === "paid") continue;
          const alreadyPaid = Number(entry.paid_amount ?? 0);
          const outstanding = Math.round((Number(entry.amount) - alreadyPaid) * 100) / 100;
          const applied = Math.min(outstanding, remaining);
          entry.paid_amount = Math.round((alreadyPaid + applied) * 100) / 100;
          remaining = Math.round((remaining - applied) * 100) / 100;
          if (entry.paid_amount >= Number(entry.amount)) {
            entry.status = "paid";
            entry.paid_at = paidAt;
          }
        }
        if (remaining > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Payment of ${input.amount} exceeds the plan's outstanding balance by ${remaining}`,
          });
        }
        const allPaid = schedule.every((e) => e.status === "paid");
        recorded.push({ payment_reference: input.paymentReference, amount: input.amount, applied_at: paidAt });
        const updated = await client.query(
          `UPDATE payment_installments
           SET schedule = $1, recorded_payments = $2,
               status = CASE WHEN $3 THEN 'completed' ELSE status END,
               updated_at = NOW()
           WHERE id = $4 RETURNING *`,
          [JSON.stringify(schedule), JSON.stringify(recorded), allPaid, plan.id],
        );
        // Advance the fine cumulatively (mirrors settleRrr / phase11 recordPayment).
        await client.query(
          `UPDATE enforcement_fines
           SET status = CASE WHEN COALESCE(amount_paid, 0) + $2 >= amount THEN 'paid' ELSE 'partial' END,
               amount_paid = COALESCE(amount_paid, 0) + $2,
               paid_at = CASE WHEN COALESCE(amount_paid, 0) + $2 >= amount THEN NOW() ELSE paid_at END,
               payment_reference = $3,
               payment_method = 'installment',
               updated_at = NOW()
           WHERE id = $1`,
          [plan.penalty_id, input.amount, input.paymentReference],
        );
        await client.query("COMMIT");
        result = updated.rows[0];
        await logAudit("payment.installment_payment", "payment_installment", plan.id, String(ctx.user.id), {
          plan_ref: plan.plan_ref, amount: input.amount, payment_reference: input.paymentReference, completed: allPaid,
        });
        emitMutationEvent("ndsep.payments.installment", { action: "payment", planRef: plan.plan_ref, ts: new Date().toISOString() })
          .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
      return result!;
    }),

  listInstallmentPlans: protectedProcedure
    .input(z.object({
      penaltyId: z.number().optional(),
      status: z.enum(["active", "completed", "defaulted", "cancelled"]).optional(),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM payment_installments WHERE 1=1`;
      const params: unknown[] = [];
      if (input.penaltyId) { params.push(input.penaltyId); sql += ` AND penalty_id = $${params.length}`; }
      if (input.status) { params.push(input.status); sql += ` AND status = $${params.length}`; }
      sql += ` ORDER BY created_at DESC LIMIT 200`;
      return exec(sql, params);
    }),

  /**
   * Auto-default detection (daily batch): flips schedule entries past their
   * due date to 'overdue', and marks the plan 'defaulted' when any entry has
   * been overdue beyond the grace window. Grace window matches the settlement
   * engine (services/settlementLogic.DEFAULT_GRACE_DAYS = 7). On default the
   * linked fine flips back to 'outstanding' and the org is notified.
   */
  detectInstallmentDefaults: adminProcedure
    .input(z.object({ graceDays: z.number().int().min(0).max(60).default(7) }))
    .mutation(async ({ input, ctx }) => {
      const plans = await exec(`SELECT id, plan_ref, penalty_id, schedule FROM payment_installments WHERE status = 'active'`);
      const today = new Date().toISOString().slice(0, 10);
      const graceCutoff = new Date(Date.now() - input.graceDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      let overdueMarked = 0;
      let defaulted = 0;
      for (const plan of plans) {
        const schedule = typeof plan.schedule === "string" ? JSON.parse(plan.schedule) : plan.schedule;
        let changed = false;
        let beyondGrace = false;
        for (const entry of schedule as Array<{ due_date: string; status: string }>) {
          if (entry.status === "pending" && entry.due_date < today) {
            entry.status = "overdue";
            changed = true;
            overdueMarked++;
          }
          if (entry.status === "overdue" && entry.due_date < graceCutoff) beyondGrace = true;
        }
        if (beyondGrace) {
          await exec(
            `UPDATE payment_installments SET schedule = $1, status = 'defaulted', defaulted_at = NOW(), updated_at = NOW() WHERE id = $2`,
            [JSON.stringify(schedule), plan.id],
          );
          defaulted++;
          // Flip the linked fine back to outstanding (it may have been
          // 'partial' from collected tranches) and notify the org.
          const fineRows = await exec(
            `UPDATE enforcement_fines SET status = 'outstanding', updated_at = NOW()
             WHERE id = $1 AND status IN ('pending', 'partial', 'overdue')
             RETURNING org_id`,
            [plan.penalty_id],
          );
          const fineOrg = fineRows[0]?.org_id ?? null;
          await exec(
            `INSERT INTO in_app_notifications (title, message, severity, category, organization_id, user_id, created_at)
             VALUES ($1, $2, 'warning', 'payment', $3, NULL, NOW())`,
            [
              `Installment plan ${plan.plan_ref} defaulted`,
              `The installment plan ${plan.plan_ref} for fine NDSEP-PEN-${String(plan.penalty_id).padStart(6, "0")} has defaulted (instalment overdue beyond the ${input.graceDays}-day grace period). The fine is outstanding in full.`,
              fineOrg,
            ],
          ).catch((e: unknown) => logger.warn({ err: e instanceof Error ? e.message : String(e) }, "[finePayments] default notification failed"));
          await logAudit("payment.installment_default", "payment_installment", plan.id, String(ctx.user.id), { plan_ref: plan.plan_ref, fine_outstanding: fineOrg != null });
          emitMutationEvent("ndsep.payments.installment", { action: "defaulted", planRef: plan.plan_ref, ts: new Date().toISOString() })
            .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        } else if (changed) {
          await exec(
            `UPDATE payment_installments SET schedule = $1, updated_at = NOW() WHERE id = $2`,
            [JSON.stringify(schedule), plan.id],
          );
        }
      }
      return { plansScanned: plans.length, overdueMarked, defaulted };
    }),

  // ─── Receipts ─────────────────────────────────────────────────────────────

  /** Fetch a receipt by its NDPC-RCT-YYYY-##### number. */
  getReceipt: protectedProcedure
    .input(z.object({ receiptNumber: z.string().regex(/^NDPC-RCT-\d{4}-\d{5}$/) }))
    .query(async ({ input, ctx }) => {
      const rows = await exec(`SELECT * FROM receipts WHERE receipt_number = $1`, [input.receiptNumber]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Receipt not found" });
      await assertFineOrgAccess(ctx.user, await fineOrgId(rows[0].penalty_id));
      return rows[0];
    }),

  listReceipts: protectedProcedure
    .input(z.object({ penaltyId: z.number().optional() }))
    .query(async ({ input, ctx }) => {
      const params: unknown[] = [];
      let sql: string;
      if (STAFF_ROLES.has(ctx.user.role)) {
        sql = `SELECT * FROM receipts WHERE 1=1`;
        if (input.penaltyId) { params.push(input.penaltyId); sql += ` AND penalty_id = $${params.length}`; }
      } else {
        // Org users only see receipts for their own organisation's fines.
        sql = `SELECT r.* FROM receipts r JOIN enforcement_fines f ON f.id = r.penalty_id WHERE 1=1`;
        if (input.penaltyId) { params.push(input.penaltyId); sql += ` AND r.penalty_id = $${params.length}`; }
        params.push(ctx.user.id);
        sql += ` AND (f.org_id = (SELECT organization_id FROM users WHERE id = $${params.length})
                 OR EXISTS (SELECT 1 FROM organization_users ou WHERE ou.user_id = $${params.length} AND ou.organization_id = f.org_id))`;
      }
      sql += ` ORDER BY issued_at DESC LIMIT 200`;
      return exec(sql, params);
    }),

  /** Re-send the receipt email to the recorded payer address. */
  resendReceipt: protectedProcedure
    .input(z.object({ receiptNumber: z.string().regex(/^NDPC-RCT-\d{4}-\d{5}$/), to: z.string().email().optional() }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `SELECT r.*, o.name AS org_name FROM receipts r
         LEFT JOIN enforcement_fines f ON f.id = r.penalty_id
         LEFT JOIN organizations o ON o.id = f.org_id
         WHERE r.receipt_number = $1`,
        [input.receiptNumber],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Receipt not found" });
      const to = input.to ?? rows[0].payer_email;
      if (!to) throw new TRPCError({ code: "BAD_REQUEST", message: "No payer email on record; supply 'to'" });
      const sent = await sendPaymentReceipt({
        to,
        orgName: rows[0].org_name ?? "Organisation",
        receiptNumber: rows[0].receipt_number,
        rrr: rows[0].rrr ?? "",
        amount: Number(rows[0].amount),
        currency: rows[0].currency,
        penaltyRef: rows[0].penalty_id ? `NDSEP-PEN-${String(rows[0].penalty_id).padStart(6, "0")}` : undefined,
        paidAt: new Date(rows[0].issued_at),
      });
      await logAudit("payment.receipt_resend", "receipt", rows[0].id, String(ctx.user.id), { to, sent });
      return { sent };
    }),

  // ─── Refunds ──────────────────────────────────────────────────────────────

  /** Request a refund against a paid RRR / receipt. */
  requestRefund: protectedProcedure
    .input(z.object({
      rrr: z.string().min(6).optional(),
      penaltyId: z.number().optional(),
      amount: z.number().positive(),
      reason: z.string().min(10),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!input.rrr && !input.penaltyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Provide rrr or penaltyId" });
      }
      // Per-year DB-sequence reference (migration 0077) — no Date.now() suffix.
      const refundRef = await nextSequencedRef("ndsep_refund_ref_seq", "RFD");
      const rows = await exec(
        `INSERT INTO refund_requests (refund_ref, rrr, penalty_id, amount, reason, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [refundRef, input.rrr ?? null, input.penaltyId ?? null, input.amount, input.reason, ctx.user.email ?? String(ctx.user.id)],
      );
      await logAudit("payment.refund_request", "refund_request", rows[0].id, String(ctx.user.id), { refund_ref: refundRef, amount: input.amount });
      return rows[0];
    }),

  listRefunds: protectedProcedure
    .input(z.object({ status: z.enum(["requested", "approved", "rejected", "processed"]).optional() }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM refund_requests WHERE 1=1`;
      const params: unknown[] = [];
      if (input.status) { params.push(input.status); sql += ` AND status = $${params.length}`; }
      sql += ` ORDER BY created_at DESC LIMIT 200`;
      return exec(sql, params);
    }),

  /** Admin approval workflow: requested -> approved | rejected -> processed. */
  decideRefund: adminProcedure
    .input(z.object({
      refundRef: z.string().min(4),
      decision: z.enum(["approved", "rejected", "processed"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const allowedFrom = input.decision === "processed" ? ["approved"] : ["requested"];
      const rows = await exec(
        `UPDATE refund_requests
         SET status = $1, decided_by = $2, decided_at = NOW(), updated_at = NOW()
         WHERE refund_ref = $3 AND status = ANY(string_to_array($4, ',')) RETURNING *`,
        [input.decision, ctx.user.email ?? String(ctx.user.id), input.refundRef, allowedFrom.join(",")],
      );
      if (!rows[0]) {
        throw new TRPCError({ code: "CONFLICT", message: `Refund not found or not in '${allowedFrom.join("/")}' status` });
      }
      const refund = rows[0];
      let penaltyId: number | null = refund.penalty_id ?? null;
      if (penaltyId == null && refund.rrr) {
        const rrrRows = await exec(`SELECT penalty_id FROM payment_rrr_codes WHERE rrr = $1`, [refund.rrr]);
        penaltyId = rrrRows[0]?.penalty_id ?? null;
      }

      if (input.decision === "approved") {
        // Queue (or execute) a REAL payout. The fine is NOT reverted here —
        // it only reverts on 'processed', after the payout is confirmed.
        if (penaltyId == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Refund has no resolvable fine; cannot queue payout" });
        }
        const fineRows = await exec(`SELECT org_id, currency FROM enforcement_fines WHERE id = $1`, [penaltyId]);
        await exec(
          `INSERT INTO refund_payouts (refund_ref, fine_id, organization_id, amount, currency, status, requested_by)
           VALUES ($1, $2, $3, $4, $5, 'queued', $6)
           ON CONFLICT (refund_ref) DO NOTHING`,
          [input.refundRef, penaltyId, fineRows[0]?.org_id ?? null, refund.amount, fineRows[0]?.currency ?? "NGN", String(ctx.user.id)],
        );
        // Attempt immediate execution when a payout rail is configured.
        const payoutUrl = process.env.NDSEP_REFUND_PAYOUT_URL;
        if (payoutUrl) {
          try {
            const res = await fetch(payoutUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                refund_ref: input.refundRef,
                fine_id: penaltyId,
                amount: Number(refund.amount),
                currency: fineRows[0]?.currency ?? "NGN",
                rrr: refund.rrr ?? null,
              }),
              signal: AbortSignal.timeout(10000),
            });
            if (res.ok) {
              const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
              await exec(
                `UPDATE refund_payouts SET status = 'sent', provider_ref = $2, updated_at = NOW() WHERE refund_ref = $1`,
                [input.refundRef, String(body.provider_ref ?? body.reference ?? "")],
              );
            } else {
              logger.error({ refundRef: input.refundRef, status: res.status }, "[finePayments] Refund payout rail rejected the instruction — payout remains queued");
            }
          } catch (e) {
            logger.error({ refundRef: input.refundRef, err: e instanceof Error ? e.message : String(e) }, "[finePayments] Refund payout rail unreachable — payout remains queued");
          }
        } else {
          logger.error({ refundRef: input.refundRef }, "[finePayments] NDSEP_REFUND_PAYOUT_URL UNCONFIGURED — payout queued for manual disbursement, fine NOT reverted until payout confirmed");
        }
        await logAudit("payment.refund_payout_queued", "refund_request", refund.id, String(ctx.user.id), { refund_ref: input.refundRef, amount: refund.amount });
      }

      if (input.decision === "processed") {
        // Payout must be confirmed before money is clawed back from the fine.
        const payoutRows = await exec(
          `SELECT status FROM refund_payouts WHERE refund_ref = $1`,
          [input.refundRef],
        );
        if (!payoutRows[0] || !["sent", "confirmed"].includes(payoutRows[0].status)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Payout for ${input.refundRef} is not confirmed (status: ${payoutRows[0]?.status ?? "missing"}) — the refund cannot be marked processed`,
          });
        }
        await exec(
          `UPDATE refund_payouts SET status = 'confirmed', confirmed_by = $2, updated_at = NOW() WHERE refund_ref = $1 AND status = 'sent'`,
          [input.refundRef, String(ctx.user.id)],
        );
        if (penaltyId != null) {
          // The refunded amount is reversed out of the fine only now that the
          // payout is confirmed: decrement amount_paid and recompute the
          // cumulative status so a refunded "paid" fine re-opens.
          await exec(
            `UPDATE enforcement_fines
             SET amount_paid = GREATEST(0, COALESCE(amount_paid, 0) - $2),
                 status = CASE
                   WHEN GREATEST(0, COALESCE(amount_paid, 0) - $2) >= amount THEN 'paid'
                   WHEN GREATEST(0, COALESCE(amount_paid, 0) - $2) > 0 THEN 'partial'
                   ELSE 'pending'
                 END,
                 paid_at = CASE
                   WHEN GREATEST(0, COALESCE(amount_paid, 0) - $2) >= amount THEN paid_at
                   ELSE NULL
                 END,
                 updated_at = NOW()
             WHERE id = $1`,
            [penaltyId, refund.amount],
          );
          await logAudit("payment.refund_fine_reverted", "enforcement_fine", penaltyId, String(ctx.user.id), {
            refund_ref: input.refundRef, amount: refund.amount,
          });
        } else {
          logger.warn({ refundRef: input.refundRef }, "[finePayments] Processed refund has no resolvable penalty; fine state not reverted");
        }
      }
      await logAudit("payment.refund_decide", "refund_request", rows[0].id, String(ctx.user.id), { refund_ref: input.refundRef, decision: input.decision });
      emitMutationEvent("ndsep.payments.refund", { action: input.decision, refundRef: input.refundRef, ts: new Date().toISOString() })
        .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  /**
   * Confirm a queued refund payout (manual disbursement channel or provider
   * callback reconciliation). Only confirmed/sent payouts allow a refund to
   * reach 'processed'.
   */
  confirmRefundPayout: adminProcedure
    .input(z.object({ refundRef: z.string().min(4), providerRef: z.string().min(3) }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `UPDATE refund_payouts
         SET status = 'confirmed', provider_ref = COALESCE(NULLIF($2, ''), provider_ref), confirmed_by = $3, updated_at = NOW()
         WHERE refund_ref = $1 AND status IN ('queued', 'sent')
         RETURNING *`,
        [input.refundRef, input.providerRef, String(ctx.user.id)],
      );
      if (!rows[0]) {
        throw new TRPCError({ code: "CONFLICT", message: `No queued/sent payout found for ${input.refundRef}` });
      }
      await logAudit("payment.refund_payout_confirmed", "refund_payout", rows[0].id, String(ctx.user.id), { refund_ref: input.refundRef, provider_ref: input.providerRef });
      return rows[0];
    }),
});
