/**
 * SOCint Intelligence Router — unified CTI hub
 * Indicators, detection rules, dark web tracking, cases, ransomware, CVEs
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import {
  getIndicators, getDetectionRules, getDarkWebHits, getCases,
  getRansomwareGroups, getCveDatabase, getConnectorStatus, searchIndicator,
} from "../socintClient";

export const socintRouter = router({
  indicators: protectedProcedure
    .input(z.object({ type: z.string().optional(), limit: z.number().min(1).max(500).default(50) }))
    .query(async ({ input }) => {
      try {
        const data = await getIndicators(input);
        return { indicators: data, total: data.length };
      } catch { return { indicators: [], total: 0 }; }
    }),

  searchIndicator: protectedProcedure
    .input(z.object({ value: z.string().min(1) }))
    .query(async ({ input }) => {
      try { return { results: await searchIndicator(input.value) }; }
      catch { return { results: [] }; }
    }),

  detectionRules: protectedProcedure
    .input(z.object({ type: z.string().optional(), severity: z.string().optional() }))
    .query(async ({ input }) => {
      try {
        const rules = await getDetectionRules(input);
        return { rules, total: rules.length, byType: groupBy(rules, r => r.type) };
      } catch { return { rules: [], total: 0, byType: {} }; }
    }),

  darkWebHits: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      try {
        const hits = await getDarkWebHits(input);
        return { hits, total: hits.length };
      } catch { return { hits: [], total: 0 }; }
    }),

  cases: protectedProcedure
    .input(z.object({ status: z.string().optional() }))
    .query(async ({ input }) => {
      try {
        const cases = await getCases(input);
        return { cases, total: cases.length };
      } catch { return { cases: [], total: 0 }; }
    }),

  ransomwareGroups: protectedProcedure.query(async () => {
    try {
      const groups = await getRansomwareGroups();
      return { groups, total: groups.length };
    } catch { return { groups: [], total: 0 }; }
  }),

  cves: protectedProcedure
    .input(z.object({ severity: z.string().optional(), exploitedOnly: z.boolean().optional() }))
    .query(async ({ input }) => {
      try {
        const cves = await getCveDatabase(input);
        return { cves, total: cves.length };
      } catch { return { cves: [], total: 0 }; }
    }),

  connectors: protectedProcedure.query(async () => {
    try { return { connectors: await getConnectorStatus() }; }
    catch { return { connectors: [] }; }
  }),
});

function groupBy<T>(arr: T[], fn: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of arr) { const k = fn(item); result[k] = (result[k] ?? 0) + 1; }
  return result;
}
