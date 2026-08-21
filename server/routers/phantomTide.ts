/**
 * Phantom Tide Maritime Intelligence Router
 * Gulf of Guinea / Niger Delta vessel tracking, sanctions, anomalies
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import {
  getVessels, getSanctionAlerts, getAnomalies, getConvergenceZones,
  getPortActivity, getMaritimeStats, lookupVessel,
} from "../phantomTideClient";

export const phantomTideRouter = router({
  vessels: protectedProcedure
    .input(z.object({
      bbox: z.string().optional(),
      type: z.string().optional(),
      flagOnly: z.string().optional(),
    }))
    .query(async ({ input }) => {
      try {
        const vessels = await getVessels(input);
        return { vessels, total: vessels.length };
      } catch { return { vessels: [], total: 0 }; }
    }),

  lookupVessel: protectedProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ input }) => {
      try { return { results: await lookupVessel(input.query) }; }
      catch { return { results: [] }; }
    }),

  sanctionAlerts: protectedProcedure.query(async () => {
    try {
      const alerts = await getSanctionAlerts();
      return { alerts, total: alerts.length };
    } catch { return { alerts: [], total: 0 }; }
  }),

  anomalies: protectedProcedure
    .input(z.object({ resolved: z.boolean().optional() }))
    .query(async ({ input }) => {
      try {
        const anomalies = await getAnomalies(input);
        return { anomalies, total: anomalies.length };
      } catch { return { anomalies: [], total: 0 }; }
    }),

  convergenceZones: protectedProcedure.query(async () => {
    try {
      const zones = await getConvergenceZones();
      return { zones, total: zones.length };
    } catch { return { zones: [], total: 0 }; }
  }),

  portActivity: protectedProcedure
    .input(z.object({ country: z.string().optional() }))
    .query(async ({ input }) => {
      try {
        const ports = await getPortActivity(input);
        return { ports, total: ports.length };
      } catch { return { ports: [], total: 0 }; }
    }),

  stats: protectedProcedure.query(async () => {
    try { return await getMaritimeStats(); }
    catch {
      return {
        totalVessels: 0, sanctionedVessels: 0, activeAnomalies: 0,
        convergenceZones: 0, moniteredPorts: 0, aisGaps24h: 0, avgRiskScore: 0,
      };
    }
  }),
});
