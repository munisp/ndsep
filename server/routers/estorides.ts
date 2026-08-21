/**
 * Estorides Knowledge Graph / Entity Resolution Router
 * Entity search, graph traversal, investigations, sources, analysis
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import {
  searchEntities, getEntity, getEntityGraph, getInvestigations,
  getSources, getEntityAnalysis, getEstoridesStats, resolveEntity,
} from "../estoridesClient";

export const estoridesRouter = router({
  search: protectedProcedure
    .input(z.object({ query: z.string().min(1), type: z.string().optional(), limit: z.number().min(1).max(100).default(25) }))
    .query(async ({ input }) => {
      try { return { results: await searchEntities(input.query, input) }; }
      catch { return { results: [] }; }
    }),

  entity: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      try { return { entity: await getEntity(input.id) }; }
      catch { return { entity: null }; }
    }),

  graph: protectedProcedure
    .input(z.object({ entityId: z.string(), depth: z.number().min(1).max(5).default(2) }))
    .query(async ({ input }) => {
      try { return await getEntityGraph(input.entityId, { depth: input.depth }); }
      catch { return { entities: [], relationships: [], metadata: { totalEntities: 0, totalRelationships: 0, queryTimeMs: 0 } }; }
    }),

  resolve: protectedProcedure
    .input(z.object({ name: z.string().min(1), type: z.string().optional() }))
    .query(async ({ input }) => {
      try { return { results: await resolveEntity(input.name, input.type) }; }
      catch { return { results: [] }; }
    }),

  investigations: protectedProcedure
    .input(z.object({ status: z.string().optional() }))
    .query(async ({ input }) => {
      try {
        const data = await getInvestigations(input);
        return { investigations: data, total: data.length };
      } catch { return { investigations: [], total: 0 }; }
    }),

  sources: protectedProcedure.query(async () => {
    try {
      const sources = await getSources();
      return { sources, total: sources.length };
    } catch { return { sources: [], total: 0 }; }
  }),

  analysis: protectedProcedure
    .input(z.object({ entityId: z.string(), type: z.string().optional() }))
    .query(async ({ input }) => {
      try { return { analyses: await getEntityAnalysis(input.entityId, input.type) }; }
      catch { return { analyses: [] }; }
    }),

  stats: protectedProcedure.query(async () => {
    try { return await getEstoridesStats(); }
    catch {
      return {
        totalEntities: 0, totalRelationships: 0, activeSources: 0,
        activeInvestigations: 0, entitiesByType: {}, recentIngestions: 0, graphDensity: 0,
      };
    }
  }),
});
