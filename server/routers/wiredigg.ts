/**
 * NDSEP Network Intelligence Engine (wiredigg-rs) tRPC Router
 * Proxies requests to the Rust wiredigg microservice on port 8160.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import pino from "pino";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";

const logger = pino({ name: "wiredigg-router" });
const WIREDIGG_URL = process.env.WIREDIGG_URL ?? "http://localhost:8160";

async function wirediggFetch(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${WIREDIGG_URL}${path}`, opts);
    if (!res.ok) {
      const text = await res.text();
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `wiredigg ${res.status}: ${text}` });
    }
    return res.json();
  } catch (e: unknown) {
    if (e instanceof TRPCError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: msg, path }, "wiredigg service unreachable — returning mock");
    return null;
  }
}

export const wirediggRouter = router({
  // ── Health & status ──
  health: protectedProcedure.query(async () => wirediggFetch("/health")),
  status: protectedProcedure.query(async () => wirediggFetch("/status")),
  metrics: protectedProcedure.query(async () => wirediggFetch("/metrics")),

  // ── Capture control ──
  interfaces: protectedProcedure.query(async () => wirediggFetch("/api/interfaces")),
  startCapture: protectedProcedure
    .input(z.object({ interface: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const result = await wirediggFetch("/api/capture/start", "POST", input);
      emitMutationEvent(EVENTS.NETWORK_CAPTURE_STARTED, { interface: input.interface }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),
  stopCapture: protectedProcedure.mutation(async () => {
    const result = await wirediggFetch("/api/capture/stop", "POST");
    emitMutationEvent(EVENTS.NETWORK_CAPTURE_STOPPED, { action: "stop" }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return result;
  }),
  resetCapture: protectedProcedure.mutation(async () => wirediggFetch("/api/capture/reset", "POST")),
  captureStats: protectedProcedure.query(async () => wirediggFetch("/api/capture/stats")),

  // ── Packets ──
  packets: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(1000).optional(), offset: z.number().int().min(0).optional() }).optional())
    .query(async ({ input }) => {
      const params = new URLSearchParams();
      if (input?.limit) params.set("limit", String(input.limit));
      if (input?.offset) params.set("offset", String(input.offset));
      return wirediggFetch(`/api/packets?${params}`);
    }),

  // ── Threats ──
  threats: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).optional(), severity: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const params = new URLSearchParams();
      if (input?.limit) params.set("limit", String(input.limit));
      if (input?.severity) params.set("severity", input.severity);
      return wirediggFetch(`/api/threats?${params}`);
    }),
  threatSummary: protectedProcedure.query(async () => wirediggFetch("/api/threats/summary")),

  // ── Anomaly detection ──
  anomalyStats: protectedProcedure.query(async () => wirediggFetch("/api/anomaly/stats")),
  analyzeBatch: protectedProcedure.mutation(async () => {
    const result = await wirediggFetch("/api/anomaly/analyze", "POST");
    emitMutationEvent(EVENTS.NETWORK_ANOMALY_ANALYZED, { action: "batch_analyze" }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return result;
  }),

  // ── IoT ──
  iotDevices: protectedProcedure.query(async () => wirediggFetch("/api/iot/devices")),
  iotHighRisk: protectedProcedure.query(async () => wirediggFetch("/api/iot/high-risk")),

  // ── Protocol & network stats ──
  protocolStats: protectedProcedure.query(async () => wirediggFetch("/api/protocols")),
  topSources: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 20;
      return wirediggFetch(`/api/top-sources?limit=${limit}`);
    }),
  topDestinations: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 20;
      return wirediggFetch(`/api/top-destinations?limit=${limit}`);
    }),

  // ── Threat intelligence ──
  addMaliciousIp: protectedProcedure
    .input(z.object({ ip: z.string().min(7).max(45) }))
    .mutation(async ({ input }) => {
      const result = await wirediggFetch("/api/threat-intel/add-ip", "POST", input);
      emitMutationEvent(EVENTS.NETWORK_THREAT_ADDED, { ip: input.ip }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),
});
