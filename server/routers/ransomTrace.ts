/**
 * Ransom Trace Router (round 13, W3 / P0.4)
 * =========================================
 * Crypto wallet tracing for ransomware / breach enforcement via OSIRIS
 * (server/osiris/cryptoClient.ts → GET /api/osint/crypto, proxying
 * blockstream/Blockscout-style explorers).
 *
 *   traceWallet(address, caseId?)  staff; traces a wallet, persists a
 *     ransom_traces row (migration 0145) and, when caseId is given, attaches
 *     the result to the enforcement case via the existing case-timeline
 *     notes mechanism (server/db.ts addCaseTimelineEntry — the same channel
 *     enforcementCases.update uses). OFAC-SANCTIONED wallets produce a
 *     prominent flag in the response AND a hash-chained audit_ledger entry
 *     (appendLedger, anti-wipe trail).
 *   listTraces(caseId?)            staff; trace history, newest first.
 *
 * Fail-closed: an unreachable OSIRIS crypto endpoint yields
 * status='unavailable' — the wallet is reported as NOT TRACED, never as
 * "clean". The OFAC flag is only asserted from real response data.
 */
import { z } from "zod";
import { router, staffProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool, addCaseTimelineEntry } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { appendLedger } from "../antiwipe/ledger";
import {
  traceWallet as osirisTraceWallet,
  isPlausibleWalletAddress,
  type WalletTraceResult,
} from "../osiris/cryptoClient";

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
    logger.error({ err, query: query.slice(0, 200) }, "[ransomTrace] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

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
  details: Record<string, unknown> = {}
): Promise<void> {
  try {
    await exec(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NOW())`,
      [action, resourceType, toIntOrNull(resourceId), toIntOrNull(userId), JSON.stringify(details)]
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[ransomTrace] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

/** Compact, JSONB-safe trace summary persisted on ransom_traces.result. */
function traceSummary(t: WalletTraceResult): Record<string, unknown> {
  return {
    chain: t.chain,
    chain_inferred: t.chainInferred,
    balance: t.balance,
    tx_count: t.txCount,
    recent_txs: t.recentTxs,
    ofac_sanctioned: t.ofacSanctioned,
    status: t.status,
    reason: t.reason ?? null,
    traced_at: t.tracedAt,
  };
}

export const ransomTraceRouter = router({
  /**
   * Trace a wallet and (optionally) attach the result to an enforcement case.
   * OFAC hit ⇒ prominent `ofacAlert` flag + audit_ledger entry.
   */
  traceWallet: staffProcedure
    .input(z.object({
      address: z.string().min(20).max(120),
      caseId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const address = input.address.trim();
      if (!isPlausibleWalletAddress(address)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Malformed wallet address" });
      }
      const actor = ctx.user.name ?? String(ctx.user.id);

      // Verify the enforcement case BEFORE tracing so a bad caseId fails fast.
      let caseRow: any = null;
      if (input.caseId !== undefined) {
        const rows = await exec(`SELECT id, status, case_reference FROM enforcement_cases WHERE id = $1`, [input.caseId]);
        caseRow = rows[0];
        if (!caseRow) throw new TRPCError({ code: "NOT_FOUND", message: "Enforcement case not found" });
      }

      const trace = await osirisTraceWallet(address);

      const [row] = await exec(
        `INSERT INTO ransom_traces
           (case_id, address, chain, ofac_sanctioned, status, result, traced_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [input.caseId ?? null, address, trace.chain, trace.ofacSanctioned,
         trace.status, JSON.stringify(traceSummary(trace)), actor]
      );

      // Attach to the case's evidence/notes channel (case_timeline) — note-only
      // entry: the case status itself is unchanged by a trace.
      if (caseRow) {
        const flag = trace.status !== "ok"
          ? "TRACE UNAVAILABLE (not traced — do not treat as clean)"
          : trace.ofacSanctioned
            ? "OFAC-SANCTIONED WALLET"
            : "no OFAC match";
        await addCaseTimelineEntry({
          caseId: caseRow.id,
          changedByUserId: ctx.user.id,
          changedByName: actor,
          fromStatus: caseRow.status,
          toStatus: caseRow.status,
          note: `Crypto wallet trace #${row?.id}: ${address} (${trace.chain}) — balance ${trace.balance ?? "unknown"}, ${trace.txCount ?? trace.recentTxs.length} tx(s); ${flag}.`,
        }).catch((e: unknown) => logger.warn({ err: e instanceof Error ? e.message : String(e) }, "[ransomTrace] case timeline attach failed"));
      }

      // OFAC hit → prominent flag + tamper-evident ledger entry.
      let ledgerSeq: number | null = null;
      if (trace.status === "ok" && trace.ofacSanctioned) {
        const entry = await appendLedger("ransom_wallet_ofac_hit", {
          trace_id: row?.id ?? null,
          case_id: input.caseId ?? null,
          case_reference: caseRow?.case_reference ?? null,
          address,
          chain: trace.chain,
          balance: trace.balance,
          tx_count: trace.txCount,
          traced_at: trace.tracedAt,
        }, actor).catch((e: unknown) => {
          logger.warn({ err: e instanceof Error ? e.message : String(e) }, "[ransomTrace] audit_ledger append failed");
          return null;
        });
        ledgerSeq = entry?.seq ?? null;
      }

      await logAudit("ransom_wallet_traced", "ransom_traces", row?.id ?? null, String(ctx.user.id), {
        address, chain: trace.chain, status: trace.status,
        ofac_sanctioned: trace.ofacSanctioned, case_id: input.caseId ?? null,
      });
      fireAndForget("ransomTrace.traceWallet");

      return {
        trace: row,
        result: trace,
        /** Prominent UI flag: ONLY set on a confirmed OFAC hit. */
        ofacAlert: trace.status === "ok" && trace.ofacSanctioned,
        /** True when upstream was unreachable — wallet NOT cleared. */
        unavailable: trace.status !== "ok",
        ledgerSeq,
      };
    }),

  /** Trace history for a case (or global, newest first). */
  listTraces: staffProcedure
    .input(z.object({
      caseId: z.number().int().positive().optional(),
      address: z.string().min(20).max(120).optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.caseId !== undefined) { params.push(input.caseId); conditions.push(`rt.case_id = $${params.length}`); }
      if (input?.address) { params.push(input.address.trim()); conditions.push(`rt.address = $${params.length}`); }
      params.push(input?.limit ?? 100);
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(
        `SELECT rt.*, ec.case_reference
           FROM ransom_traces rt
           LEFT JOIN enforcement_cases ec ON ec.id = rt.case_id
           ${where} ORDER BY rt.created_at DESC LIMIT $${params.length}`,
        params
      );
    }),
});
