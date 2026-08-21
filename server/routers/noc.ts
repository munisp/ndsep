/**
 * NDSEP NOC (Network Operations Center) Aggregation Router
 * ==========================================================
 * Unified tRPC router that aggregates data from all NOC subsystems:
 *   - NOC Collector (Rust :8190) — SNMP/Syslog/NetFlow
 *   - NOC Escalation (Go :8191) — Policies/On-call/Runbooks
 *   - NOC Correlator (Python :8192) — Cross-domain alert correlation
 *   - NOC Uptime (Rust :8193) — Availability/SLA tracking
 *   - Wiredigg (Rust :8160) — Network intelligence
 *   - SIEM Correlator (Python :8086) — Security alerts
 *   - SLA Tracker (Rust :8105) — Compliance SLA
 *   - Health Integration — Middleware health
 *
 * Plus direct DB queries for NOC tables (devices, alerts, topology, uptime).
 *
 * Middleware integrations via middleware wrappers:
 *   PostgreSQL, Kafka, Redis, OpenSearch, Temporal, Dapr, Keycloak,
 *   Permify, APISIX, Mojaloop, TigerBeetle, OpenAppSec, Fluvio, Lakehouse
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import pino from "pino";
import { getAllMiddlewareHealth } from "../middleware/healthIntegration";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";

const logger = pino({ name: "noc-router" });

// ── Service URLs ─────────────────────────────────────────────────────────────

const NOC_COLLECTOR_URL = process.env.NOC_COLLECTOR_URL ?? "http://localhost:8190";
const NOC_ESCALATION_URL = process.env.NOC_ESCALATION_URL ?? "http://localhost:8191";
const NOC_CORRELATOR_URL = process.env.NOC_CORRELATOR_URL ?? "http://localhost:8192";
const NOC_UPTIME_URL = process.env.NOC_UPTIME_URL ?? "http://localhost:8193";

// ── Fetch Helpers ────────────────────────────────────────────────────────────

async function nocFetch(baseUrl: string, path: string, method = "GET", body?: unknown): Promise<unknown> {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${baseUrl}${path}`, { ...opts, signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      const text = await res.text();
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `NOC ${res.status}: ${text}` });
    }
    return res.json();
  } catch (e: unknown) {
    if (e instanceof TRPCError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: msg, path }, "NOC service unreachable");
    return null;
  }
}

// ── DB Query Helper ──────────────────────────────────────────────────────────

async function nocDbQuery(ctx: { db?: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> } },
  sql: string, params: unknown[] = []): Promise<unknown[]> {
  try {
    const pool = (await import("../db")).getPool();
    if (!pool) return [];
    const result = await pool.query(sql, params);
    return result.rows;
  } catch (e: unknown) {
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, "NOC DB query failed");
    return [];
  }
}

// ── NOC Router ───────────────────────────────────────────────────────────────

export const nocRouter = router({
  // ═══════════════════════════════════════════════════════════════════════════
  // UNIFIED DASHBOARD — Aggregates all NOC data into single response
  // ═══════════════════════════════════════════════════════════════════════════

  dashboard: protectedProcedure.query(async () => {
    const [
      collectorHealth,
      escalationHealth,
      correlatorHealth,
      uptimeLatest,
      middlewareHealth,
      alertStats,
      deviceStats,
    ] = await Promise.all([
      nocFetch(NOC_COLLECTOR_URL, "/health"),
      nocFetch(NOC_ESCALATION_URL, "/health"),
      nocFetch(NOC_CORRELATOR_URL, "/health"),
      nocFetch(NOC_UPTIME_URL, "/api/dashboard"),
      getAllMiddlewareHealth(),
      nocDbQuery(
        {},
        `SELECT severity, status, COUNT(*) as count FROM noc_alerts
         WHERE first_seen > NOW() - INTERVAL '24 hours'
         GROUP BY severity, status ORDER BY severity, status`,
      ),
      nocDbQuery(
        {},
        `SELECT status, COUNT(*) as count, device_type FROM noc_devices
         GROUP BY status, device_type ORDER BY status`,
      ),
    ]);

    return {
      subsystems: {
        collector: collectorHealth,
        escalation: escalationHealth,
        correlator: correlatorHealth,
        uptime: uptimeLatest,
      },
      middleware: middlewareHealth,
      alerts: {
        last24h: alertStats,
      },
      devices: deviceStats,
      timestamp: new Date().toISOString(),
    };
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // ALERTS — Unified NOC alert management
  // ═══════════════════════════════════════════════════════════════════════════

  alerts: protectedProcedure
    .input(z.object({
      severity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
      source: z.string().optional(),
      status: z.enum(["open", "acknowledged", "investigating", "escalated", "resolved", "suppressed"]).optional(),
      limit: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const filters: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (input?.severity) { filters.push(`severity = $${paramIdx++}`); params.push(input.severity); }
      if (input?.source) { filters.push(`source = $${paramIdx++}`); params.push(input.source); }
      if (input?.status) { filters.push(`status = $${paramIdx++}`); params.push(input.status); }

      const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;

      const rows = await nocDbQuery({},
        `SELECT id, alert_id, source, severity, category, title, description,
                device_id, source_ip::text, affected_service, correlation_id,
                is_correlated, status, assigned_to, escalation_level,
                repeat_count, first_seen, last_seen, metadata
         FROM noc_alerts ${where}
         ORDER BY first_seen DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
        [...params, limit, offset],
      );

      const countRows = await nocDbQuery({},
        `SELECT COUNT(*) as total FROM noc_alerts ${where}`, params);
      const total = Number((countRows[0] as Record<string, unknown>)?.total ?? 0);

      return { alerts: rows, total, limit, offset };
    }),

  alertStats: protectedProcedure.query(async () => {
    const rows = await nocDbQuery({}, `
      SELECT 
        COUNT(*) FILTER (WHERE status = 'open') as open,
        COUNT(*) FILTER (WHERE status = 'acknowledged') as acknowledged,
        COUNT(*) FILTER (WHERE status = 'escalated') as escalated,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
        COUNT(*) FILTER (WHERE severity = 'critical' AND status != 'resolved') as critical_active,
        COUNT(*) FILTER (WHERE severity = 'high' AND status != 'resolved') as high_active,
        COUNT(*) FILTER (WHERE is_correlated = true) as correlated,
        COUNT(*) as total
      FROM noc_alerts
      WHERE first_seen > NOW() - INTERVAL '24 hours'
    `);
    return rows[0] ?? {};
  }),

  acknowledgeAlert: protectedProcedure
    .input(z.object({ alertId: z.string(), acknowledgedBy: z.string() }))
    .mutation(async ({ input }) => {
      const result = await nocFetch(NOC_ESCALATION_URL, "/api/acknowledge", "POST", {
        alert_id: input.alertId, acknowledged_by: input.acknowledgedBy,
      });
      emitMutationEvent(EVENTS.NOC_ALERT_ACKNOWLEDGED, { alertId: input.alertId, acknowledgedBy: input.acknowledgedBy }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  resolveAlert: protectedProcedure
    .input(z.object({ alertId: z.string(), resolutionNotes: z.string() }))
    .mutation(async ({ input }) => {
      const result = await nocFetch(NOC_ESCALATION_URL, "/api/resolve", "POST", {
        alert_id: input.alertId, resolution_notes: input.resolutionNotes,
      });
      emitMutationEvent(EVENTS.NOC_ALERT_RESOLVED, { alertId: input.alertId }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // DEVICES — Network infrastructure inventory
  // ═══════════════════════════════════════════════════════════════════════════

  devices: protectedProcedure
    .input(z.object({
      status: z.enum(["up", "down", "degraded", "maintenance", "unknown"]).optional(),
      deviceType: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input }) => {
      const filters: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (input?.status) { filters.push(`status = $${paramIdx++}`); params.push(input.status); }
      if (input?.deviceType) { filters.push(`device_type = $${paramIdx++}`); params.push(input.deviceType); }

      const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
      const limit = input?.limit ?? 50;

      return nocDbQuery({},
        `SELECT device_id, hostname, ip_address::text, mac_address::text, device_type,
                vendor, model, firmware_version, location, status,
                cpu_utilization, memory_utilization, bandwidth_in_mbps, bandwidth_out_mbps,
                uptime_seconds, last_seen, created_at
         FROM noc_devices ${where}
         ORDER BY last_seen DESC NULLS LAST LIMIT $${paramIdx}`,
        [...params, limit],
      );
    }),

  registerDevice: protectedProcedure
    .input(z.object({
      hostname: z.string().min(1),
      ipAddress: z.string().min(7),
      deviceType: z.enum(["router", "switch", "firewall", "load_balancer", "server", "access_point", "iot_gateway", "storage", "ups", "pdu", "other"]),
      vendor: z.string().optional(),
      model: z.string().optional(),
      location: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await nocFetch(NOC_COLLECTOR_URL, "/api/devices/register", "POST", {
        hostname: input.hostname, ip_address: input.ipAddress, device_type: input.deviceType,
        vendor: input.vendor, model: input.model, location: input.location,
      });
      emitMutationEvent(EVENTS.NOC_DEVICE_REGISTERED, { hostname: input.hostname, deviceType: input.deviceType, ipAddress: input.ipAddress }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // TOPOLOGY — Network topology visualization data
  // ═══════════════════════════════════════════════════════════════════════════

  topology: protectedProcedure.query(async () => {
    const [devices, links] = await Promise.all([
      nocDbQuery({},
        `SELECT device_id, hostname, ip_address::text, device_type, status,
                cpu_utilization, memory_utilization, location
         FROM noc_devices ORDER BY hostname`),
      nocDbQuery({},
        `SELECT source_device_id, target_device_id, link_type,
                source_interface, target_interface, bandwidth_mbps,
                latency_ms, packet_loss_pct, status
         FROM noc_topology_links ORDER BY source_device_id`),
    ]);

    return {
      nodes: devices,
      edges: links,
      nodeCount: (devices as unknown[]).length,
      edgeCount: (links as unknown[]).length,
    };
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // COLLECTOR — SNMP/Syslog/NetFlow data
  // ═══════════════════════════════════════════════════════════════════════════

  collectorMetrics: protectedProcedure.query(async () => nocFetch(NOC_COLLECTOR_URL, "/metrics")),
  snmpTraps: protectedProcedure.query(async () => nocFetch(NOC_COLLECTOR_URL, "/api/snmp/traps")),
  syslogMessages: protectedProcedure.query(async () => nocFetch(NOC_COLLECTOR_URL, "/api/syslog/messages")),
  netflowFlows: protectedProcedure.query(async () => nocFetch(NOC_COLLECTOR_URL, "/api/netflow/flows")),
  bandwidthSummary: protectedProcedure.query(async () => nocFetch(NOC_COLLECTOR_URL, "/api/netflow/bandwidth")),

  // ═══════════════════════════════════════════════════════════════════════════
  // ESCALATION — Policies, on-call, runbooks
  // ═══════════════════════════════════════════════════════════════════════════

  escalationPolicies: protectedProcedure.query(async () => nocFetch(NOC_ESCALATION_URL, "/api/policies")),
  onCallSchedules: protectedProcedure.query(async () => nocFetch(NOC_ESCALATION_URL, "/api/schedules")),
  runbooks: protectedProcedure.query(async () => nocFetch(NOC_ESCALATION_URL, "/api/runbooks")),
  escalationHistory: protectedProcedure.query(async () => nocFetch(NOC_ESCALATION_URL, "/api/escalation-history")),
  escalationMetrics: protectedProcedure.query(async () => nocFetch(NOC_ESCALATION_URL, "/metrics")),

  executeRunbook: protectedProcedure
    .input(z.object({ runbookId: z.string(), alertId: z.string() }))
    .mutation(async ({ input }) => {
      const result = await nocFetch(NOC_ESCALATION_URL, "/api/execute-runbook", "POST", {
        runbook_id: input.runbookId, alert_id: input.alertId,
      });
      emitMutationEvent(EVENTS.NOC_RUNBOOK_EXECUTED, { runbookId: input.runbookId, alertId: input.alertId }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // CORRELATION — Cross-domain incident correlation
  // ═══════════════════════════════════════════════════════════════════════════

  correlationPatterns: protectedProcedure.query(async () => nocFetch(NOC_CORRELATOR_URL, "/api/patterns")),
  correlatedIncidents: protectedProcedure.query(async () => nocFetch(NOC_CORRELATOR_URL, "/api/incidents")),
  correlationWindow: protectedProcedure.query(async () => nocFetch(NOC_CORRELATOR_URL, "/api/window")),
  correlatorMetrics: protectedProcedure.query(async () => nocFetch(NOC_CORRELATOR_URL, "/metrics")),
  networkTopologyGraph: protectedProcedure.query(async () => nocFetch(NOC_CORRELATOR_URL, "/api/topology")),

  // ═══════════════════════════════════════════════════════════════════════════
  // UPTIME & SLA — Per-service availability tracking
  // ═══════════════════════════════════════════════════════════════════════════

  uptimeLatest: protectedProcedure.query(async () => nocFetch(NOC_UPTIME_URL, "/api/latest")),
  uptimeSla: protectedProcedure.query(async () => nocFetch(NOC_UPTIME_URL, "/api/sla")),
  uptimeDashboard: protectedProcedure.query(async () => nocFetch(NOC_UPTIME_URL, "/api/dashboard")),

  uptimeHistory: protectedProcedure
    .input(z.object({
      serviceName: z.string(),
      hours: z.number().int().min(1).max(720).default(24),
    }))
    .query(async ({ input }) => {
      return nocDbQuery({},
        `SELECT is_up, response_time_ms, status_code, error_message, checked_at
         FROM noc_uptime_records
         WHERE service_name = $1 AND checked_at > NOW() - ($2 || ' hours')::interval
         ORDER BY checked_at DESC LIMIT 500`,
        [input.serviceName, String(input.hours)],
      );
    }),

  slaTrend: protectedProcedure
    .input(z.object({ serviceName: z.string().optional(), days: z.number().int().min(1).max(90).default(7) }))
    .query(async ({ input }) => {
      const filter = input.serviceName ? "AND service_name = $2" : "";
      const params: unknown[] = [input.days];
      if (input.serviceName) params.push(input.serviceName);

      return nocDbQuery({},
        `SELECT service_name, period_start, period_end, availability_pct,
                avg_response_ms, p95_response_ms, p99_response_ms,
                sla_target_pct, sla_met, total_checks
         FROM noc_uptime_sla
         WHERE period_start > NOW() - ($1 || ' days')::interval ${filter}
         ORDER BY period_start DESC LIMIT 200`,
        params,
      );
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // MIDDLEWARE HEALTH — Aggregated health from all integrated services
  // ═══════════════════════════════════════════════════════════════════════════

  middlewareHealth: protectedProcedure.query(async () => getAllMiddlewareHealth()),
});
