/**
 * SIGINT Compound Threat Correlation Router
 * Aircraft, vessels, seismic, fires, weather, GDELT events, correlations
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import {
  getAircraft, getVessels, getSeismicEvents, getFireHotspots,
  getWeatherAlerts, getGdeltEvents, getCorrelations, getSigintStats,
} from "../sigintClient";

export const sigintRouter = router({
  aircraft: protectedProcedure
    .input(z.object({ bbox: z.string().optional(), militaryOnly: z.boolean().optional() }))
    .query(async ({ input }) => {
      try {
        const data = await getAircraft(input);
        return { aircraft: data, total: data.length };
      } catch { return { aircraft: [], total: 0 }; }
    }),

  vessels: protectedProcedure
    .input(z.object({ bbox: z.string().optional() }))
    .query(async ({ input }) => {
      try {
        const data = await getVessels(input);
        return { vessels: data, total: data.length };
      } catch { return { vessels: [], total: 0 }; }
    }),

  seismic: protectedProcedure
    .input(z.object({ minMagnitude: z.number().optional() }))
    .query(async ({ input }) => {
      try {
        const events = await getSeismicEvents(input);
        return { events, total: events.length };
      } catch { return { events: [], total: 0 }; }
    }),

  fires: protectedProcedure
    .input(z.object({ bbox: z.string().optional() }))
    .query(async ({ input }) => {
      try {
        const hotspots = await getFireHotspots(input);
        return { hotspots, total: hotspots.length };
      } catch { return { hotspots: [], total: 0 }; }
    }),

  weather: protectedProcedure
    .input(z.object({ severity: z.string().optional() }))
    .query(async ({ input }) => {
      try {
        const alerts = await getWeatherAlerts(input);
        return { alerts, total: alerts.length };
      } catch { return { alerts: [], total: 0 }; }
    }),

  gdelt: protectedProcedure
    .input(z.object({ country: z.string().optional(), limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      try {
        const events = await getGdeltEvents(input);
        return { events, total: events.length };
      } catch { return { events: [], total: 0 }; }
    }),

  correlations: protectedProcedure.query(async () => {
    try {
      const data = await getCorrelations();
      return { correlations: data, total: data.length };
    } catch { return { correlations: [], total: 0 }; }
  }),

  stats: protectedProcedure.query(async () => {
    try { return await getSigintStats(); }
    catch {
      return {
        trackedAircraft: 0, militaryAircraft: 0, trackedVessels: 0,
        seismicEvents24h: 0, fireHotspots24h: 0, activeWeatherAlerts: 0,
        gdeltEvents24h: 0, activeCorrelations: 0,
      };
    }
  }),
});
