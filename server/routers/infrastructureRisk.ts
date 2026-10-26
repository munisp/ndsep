/**
 * Infrastructure Risk Router (Round-13 P2.8 + P2.9)
 * ===================================================================
 * Read/acknowledge surface for the infrastructure risk watch
 * (server/services/infrastructureRiskWatch.ts, migration 0148):
 *
 *   listAvailabilityRisks   disaster-proximity events for declared
 *                           data-center locations (optional status filter)
 *   listCableAlerts         vessel anomalies near submarine cable landings
 *   acknowledge             open -> acknowledged (or -> closed); staff only,
 *                           audit_logs row + hash-chained ledger + outbox
 *                           event via the service layer
 *   stats                   dashboard counters (open risks/alerts, last
 *                           sweep timestamps, per-event-type breakdown)
 *   seedStatus              whether the cable_landing_points reference seed
 *                           (migration 0148) is present and complete
 *
 * Authz: staffProcedure throughout (operational early-warning queue).
 * Reads degrade gracefully (empty result + note) when migration 0148 has
 * not been applied yet. Every mutation writes an audit_logs row
 * (hard rule: no silent mutations).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, staffProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import {
  acknowledgeInfrastructureRisk,
  isMissingTable,
  RISK_STATUSES,
  CABLE_LANDING_SEED,
  CABLE_ALERT_SIGNAL,
} from "../services/infrastructureRiskWatch";

// ─── DB helpers (mirrors dataSovereignty pattern) ────────────────────────────

async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  try {
    const result = await pool.query(query, params);
    return result.rows ?? [];
  } catch (err) {
    if (isMissingTable(err)) throw err;
    logger.error({ err, query: query.slice(0, 200) }, "[infrastructureRisk] DB query error");
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
  details: Record<string, unknown> = {}
): Promise<void> {
  try {
    await exec(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NOW())`,
      [action, resourceType, toIntOrNull(resourceId), toIntOrNull(userId), JSON.stringify(details)]
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[infrastructureRisk] Audit log write failed");
  }
}

function missingTableNote<T>(empty: T) {
  return { rows: empty, note: "migration 0148 not applied yet" };
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const infrastructureRiskRouter = router({
  /** Disaster-proximity events for declared DC locations, newest first. */
  listAvailabilityRisks: staffProcedure
    .input(
      z
        .object({
          status: z.enum(RISK_STATUSES).optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const params: unknown[] = [];
        const conditions: string[] = [];
        if (input?.status) {
          params.push(input.status);
          conditions.push(`r.status = $${params.length}`);
        }
        params.push(input?.limit ?? 200);
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const rows = await exec(
          `SELECT r.id, r.declaration_id, r.location_name, r.latitude, r.longitude,
                  r.event_type, r.event_ref, r.magnitude, r.severity, r.distance_km,
                  r.assessed_at, r.status, r.acknowledged_by, r.acknowledged_at,
                  d.entity_ref, d.entity_name
             FROM availability_risk_events r
             JOIN hosting_declarations d ON d.id = r.declaration_id
             ${where}
            ORDER BY r.assessed_at DESC
            LIMIT $${params.length}`,
          params
        );
        return { rows, note: null as string | null };
      } catch (err) {
        if (isMissingTable(err)) return missingTableNote([]);
        throw err;
      }
    }),

  /** Vessel anomalies near cable landings, most recently seen first. */
  listCableAlerts: staffProcedure
    .input(
      z
        .object({
          status: z.enum(RISK_STATUSES).optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const params: unknown[] = [];
        const conditions: string[] = [];
        if (input?.status) {
          params.push(input.status);
          conditions.push(`status = $${params.length}`);
        }
        params.push(input?.limit ?? 200);
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const rows = await exec(
          `SELECT id, cable_point_id, cable_point_name, cable_system, vessel_mmsi,
                  vessel_name, latitude, longitude, speed_knots, vessel_status,
                  distance_km, first_seen_at, last_seen_at, status,
                  acknowledged_by, acknowledged_at
             FROM cable_watch_alerts
             ${where}
            ORDER BY last_seen_at DESC
            LIMIT $${params.length}`,
          params
        );
        return { rows, signal: CABLE_ALERT_SIGNAL, note: null as string | null };
      } catch (err) {
        if (isMissingTable(err)) return { ...missingTableNote([]), signal: CABLE_ALERT_SIGNAL };
        throw err;
      }
    }),

  /** Acknowledge (or close) an alert. Staff only; full audit trail. */
  acknowledge: staffProcedure
    .input(
      z.object({
        kind: z.enum(["availability", "cable"]),
        id: z.string().uuid(),
        target_status: z.enum(["acknowledged", "closed"]).default("acknowledged"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = String((ctx.user as { id: number | string; name?: string | null }).name
        ?? (ctx.user as { id: number | string }).id);
      const result = await acknowledgeInfrastructureRisk({
        kind: input.kind,
        id: input.id,
        targetStatus: input.target_status,
        actor,
      });
      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert not found, or already in the requested state",
        });
      }
      await logAudit(
        `infrastructure_risk_${input.kind}_${input.target_status}`,
        input.kind === "availability" ? "availability_risk_events" : "cable_watch_alerts",
        null, // uuid resource id is not int4 — recorded in details instead
        String(ctx.user.id),
        { alert_id: input.id, kind: input.kind, target_status: input.target_status }
      );
      return result;
    }),

  /** Dashboard counters. */
  stats: staffProcedure.query(async () => {
    const empty = {
      availability: { open: 0, acknowledged: 0, closed: 0, byType: {} as Record<string, number>, lastAssessedAt: null as string | null },
      cable: { open: 0, acknowledged: 0, closed: 0, lastSeenAt: null as string | null },
      note: null as string | null,
    };
    try {
      const [avail] = await exec(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'open')::int          AS open,
           COUNT(*) FILTER (WHERE status = 'acknowledged')::int  AS acknowledged,
           COUNT(*) FILTER (WHERE status = 'closed')::int        AS closed,
           MAX(assessed_at)                                      AS last_assessed_at
         FROM availability_risk_events`
      );
      const byType = await exec(
        `SELECT event_type, COUNT(*)::int AS n
           FROM availability_risk_events WHERE status = 'open'
          GROUP BY event_type`
      );
      const [cable] = await exec(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'open')::int          AS open,
           COUNT(*) FILTER (WHERE status = 'acknowledged')::int  AS acknowledged,
           COUNT(*) FILTER (WHERE status = 'closed')::int        AS closed,
           MAX(last_seen_at)                                     AS last_seen_at
         FROM cable_watch_alerts`
      );
      return {
        availability: {
          open: avail?.open ?? 0,
          acknowledged: avail?.acknowledged ?? 0,
          closed: avail?.closed ?? 0,
          byType: Object.fromEntries(byType.map((r) => [String(r.event_type), Number(r.n)])),
          lastAssessedAt: avail?.last_assessed_at ?? null,
        },
        cable: {
          open: cable?.open ?? 0,
          acknowledged: cable?.acknowledged ?? 0,
          closed: cable?.closed ?? 0,
          lastSeenAt: cable?.last_seen_at ?? null,
        },
        note: null,
      };
    } catch (err) {
      if (isMissingTable(err)) return { ...empty, note: "migration 0148 not applied yet" };
      throw err;
    }
  }),

  /** Whether the cable-landing reference seed is present and complete. */
  seedStatus: staffProcedure.query(async () => {
    try {
      const rows = await exec(
        `SELECT cable_system, name, city, latitude, longitude, provenance, active
           FROM cable_landing_points ORDER BY cable_system`
      );
      const expected = CABLE_LANDING_SEED.map((s) => s.cableSystem);
      const present = new Set(rows.map((r) => String(r.cable_system)));
      return {
        seeded: rows.length > 0,
        pointCount: rows.length,
        expectedCount: CABLE_LANDING_SEED.length,
        missingSystems: expected.filter((s) => !present.has(s)),
        provenance: rows[0]?.provenance ?? null,
        points: rows,
        note: null as string | null,
      };
    } catch (err) {
      if (isMissingTable(err)) {
        return {
          seeded: false,
          pointCount: 0,
          expectedCount: CABLE_LANDING_SEED.length,
          missingSystems: CABLE_LANDING_SEED.map((s) => s.cableSystem),
          provenance: null,
          points: [],
          note: "migration 0148 not applied yet",
        };
      }
      throw err;
    }
  }),
});
