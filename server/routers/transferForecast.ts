/**
 * Transfer Forecast Router (Round-13 P1.6 + P1.7)
 * =================================================
 * tRPC surface over server/services/transferRiskForecast.ts — predictive
 * geopolitical risk for cross-border transfers via OSIRIS's OI Forecast
 * engine, blended with the static conflict-zone risk.
 *
 *   forecastForCountry(iso)          staff MUTATION — run (or 24h-cache-
 *                                    serve) a forecast + blend for one
 *                                    destination country. Mutation, not
 *                                    query: fresh runs are expensive swarm
 *                                    simulations and must be deliberate.
 *   blendedRiskForDeclaration(id)    staff query used during cross-border
 *                                    review — resolves the declaration's
 *                                    destination country, then returns the
 *                                    blended reading (cache-first via the
 *                                    service).
 *   latestForCountry(iso)            cheap DB-only read of the latest
 *                                    persisted reading (badge rendering —
 *                                    never triggers a forecast run).
 *   listForecasts()                  latest reading per country (history
 *                                    table is append-only).
 *   forecastFeedback(forecastId,     officer agree/disagree with a blended
 *     agree, notes?)                 reading — appends the human outcome to
 *                                    decision_feedback under surface
 *                                    'transfer_forecast' (baseline minted
 *                                    at run time by the service), emits the
 *                                    feedback topic and the audit ledger.
 *   intelStreamStatus()              P1.7 — SSE stream health (subscriber
 *                                    state + snapshot freshness) for ops
 *                                    dashboards.
 *
 * Authz: staffProcedure throughout (forecast runs cost money and inform
 * supervisory review — not an entity self-serve surface).
 *
 * KEY CUSTODY: OSIRIS_OI_KEY is read server-side only (env). This router
 * NEVER accepts key material in inputs. Production should route forecasts
 * through NDSEP's LOCAL ollama as the OI model backend where possible
 * (data sovereignty); external keys are an operator choice.
 *
 * Wiring: registered in server/routers.ts by the integrator (that file is
 * owned by another workstream this round).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, staffProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { publishWithOutbox } from "../kafka";
import { appendLedger } from "../antiwipe/ledger";
import { actorUuid, FEEDBACK_TOPIC } from "./decisionFeedback";
import {
  forecastTransferRisk,
  listLatestForecasts,
  latestForecastForCountry,
  resolveIsoForCountry,
  FEEDBACK_SURFACE,
  type TransferRiskResult,
} from "../services/transferRiskForecast";
import { getIntelStreamHealth } from "../osiris/sseSubscriber";
import { getSanctionsSnapshot, getThreatSnapshot } from "../osiris/snapshotStore";

// ─── DB helpers (mirrors hostingVerification.ts conventions) ─────────────────

function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01";
}

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
    if (isMissingTable(err)) throw err;
    logger.error({ err, query: query.slice(0, 200) }, "[transferForecast] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

const ISO_SCHEMA = z
  .string()
  .regex(/^[A-Za-z]{2}$/, "ISO-3166 alpha-2 country code expected");

type Ctx = { user?: { id?: number | string; name?: string | null } };

/** Officer agree/disagree with a blended forecast reading. */
async function forecastOutcome(
  forecastId: string,
  action: "accept" | "reject",
  ctx: Ctx,
  notes?: string
): Promise<{ forecastId: string; action: string; feedbackId: string }> {
  const [row] = await exec(
    `SELECT id, country_iso, blended_level, forecast_probability, prediction_id
     FROM transfer_risk_forecasts WHERE id = $1`,
    [forecastId]
  );
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Forecast not found" });
  if (!row.prediction_id) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Forecast has no decision_feedback baseline (prediction_id missing) — cannot record outcome",
    });
  }
  const actor = ctx.user?.name ?? String(ctx.user?.id ?? "staff");
  const actorId = actorUuid(ctx.user?.id ?? actor);

  const rows = await exec(
    `INSERT INTO decision_feedback
       (prediction_id, surface, model_version, suggestion, actor_id, action, edit_distance, final_value)
     SELECT $1, $2, 'oi-forecast-r13',
            (SELECT suggestion FROM decision_feedback WHERE prediction_id = $1
             ORDER BY created_at ASC LIMIT 1),
            $3, $4, NULL, $5::jsonb
     RETURNING id, created_at`,
    [row.prediction_id, FEEDBACK_SURFACE, actorId, action, JSON.stringify({ notes: notes ?? null, forecastId })]
  );
  const feedbackId = rows[0]?.id as string;

  publishWithOutbox(FEEDBACK_TOPIC, String(row.prediction_id), {
    event: "feedback.recorded",
    feedbackId,
    predictionId: row.prediction_id,
    surface: FEEDBACK_SURFACE,
    action,
    actorId,
    modelVersion: "oi-forecast-r13",
    ts: new Date().toISOString(),
  }).catch((e: unknown) =>
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "[transferForecast] feedback publish failed")
  );
  appendLedger("transfer.forecast.feedback", {
    forecastId,
    countryIso: row.country_iso,
    blendedLevel: row.blended_level,
    action,
    feedbackId,
  }, actor).catch((e: unknown) =>
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, "[transferForecast] ledger append failed")
  );

  return { forecastId, action, feedbackId };
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const transferForecastRouter = router({
  /**
   * Run (or 24h-cache-serve) the OI forecast + blended risk for one
   * destination country. STAFF MUTATION — forecasts are expensive.
   */
  forecastForCountry: staffProcedure
    .input(z.object({ iso: ISO_SCHEMA }))
    .mutation(async ({ input }): Promise<TransferRiskResult> => {
      return forecastTransferRisk(input.iso);
    }),

  /**
   * Blended risk for a specific cross-border transfer declaration, used
   * during review. Resolves the declaration's destination country to an ISO
   * code (destination_risk_register first, two-letter prefix fallback —
   * same heuristic as phase13Features), then returns the blended reading
   * (service is cache-first; a fresh forecast runs only when the 24h cache
   * is cold).
   */
  blendedRiskForDeclaration: staffProcedure
    .input(z.object({ declarationId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [decl] = await exec(
        `SELECT id, destination_country FROM transfer_declarations WHERE id = $1`,
        [input.declarationId]
      );
      if (!decl) throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });
      const resolved = await resolveIsoForCountry(String(decl.destination_country ?? ""));
      const risk = await forecastTransferRisk(resolved.iso);
      return {
        declarationId: input.declarationId,
        destinationCountry: decl.destination_country,
        isoResolution: resolved,
        ...risk,
      };
    }),

  /** Cheap DB-only read of the latest reading for a country (badges). */
  latestForCountry: staffProcedure
    .input(z.object({ iso: ISO_SCHEMA }))
    .query(async ({ input }) => {
      const latest = await latestForecastForCountry(input.iso);
      return { iso: input.iso.toUpperCase(), forecast: latest };
    }),

  /** Latest reading per country (history is append-only, never mutated). */
  listForecasts: staffProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(async ({ input }) => {
      const forecasts = await listLatestForecasts(input?.limit ?? 100);
      return { forecasts, count: forecasts.length };
    }),

  /** Officer agrees with the blended reading (accepts the suggestion). */
  agreeForecast: staffProcedure
    .input(z.object({ forecastId: z.string().uuid(), notes: z.string().max(2000).optional() }))
    .mutation(async ({ input, ctx }) => forecastOutcome(input.forecastId, "accept", ctx, input.notes)),

  /** Officer disagrees with the blended reading (rejects the suggestion). */
  disagreeForecast: staffProcedure
    .input(z.object({ forecastId: z.string().uuid(), notes: z.string().max(2000).optional() }))
    .mutation(async ({ input, ctx }) => forecastOutcome(input.forecastId, "reject", ctx, input.notes)),

  /**
   * P1.7 — OSIRIS SSE intel-stream health: subscriber state plus snapshot
   * freshness for the sanctions/threat streams. Ops dashboards use this to
   * decide whether the stream is live or consumers are on the polling
   * fallback.
   */
  intelStreamStatus: staffProcedure.query(async () => {
    const stream = getIntelStreamHealth();
    const sanctions = getSanctionsSnapshot();
    const threats = getThreatSnapshot();
    return {
      stream,
      snapshots: {
        sanctions: sanctions
          ? { updatedAt: new Date(sanctions.updatedAt).toISOString(), eventId: sanctions.eventId, stale: sanctions.stale }
          : null,
        threats: threats
          ? { updatedAt: new Date(threats.updatedAt).toISOString(), eventId: threats.eventId, stale: threats.stale }
          : null,
      },
      consumerGuidance:
        "Read snapshotStore snapshots BEFORE falling back to the cached polling GET (see snapshotStore.ts integrator note).",
    };
  }),
});
