/**
 * NDSEP Osiris Intelligence Router
 * ==================================
 * tRPC endpoints that expose Osiris OSINT capabilities within NDSEP:
 *   - Sanctions search (enriched with conflict zone cross-reference)
 *   - Cyber threat intelligence (CISA KEV feed)
 *   - Conflict zone mapping (for cross-border risk)
 *   - OSINT tools (WHOIS, DNS, IP intel, CVE)
 *   - Country risk assessment
 *
 * All calls gracefully degrade if Osiris is unreachable.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import pino from "pino";
import {
  searchSanctions,
  getCyberThreats,
  getConflictZones,
  isConflictCountry,
  getConflictRiskLevel,
  getCountryRisk,
  whoisLookup,
  dnsLookup,
  ipIntelLookup,
  cveLookup,
  enrichedSanctionsCheck,
} from "../osirisClient";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";

const logger = pino({ name: "osiris-intel-router" });

export const osirisIntelRouter = router({
  // ── Sanctions Search (enriched with Osiris OFAC SDN) ─────────────────────
  sanctionsSearch: protectedProcedure
    .input(z.object({
      query: z.string().min(4, "Query must be at least 4 characters"),
      schema: z.enum(["Person", "Organization", "Company", "Vessel", "Airplane", "LegalEntity"]).optional(),
      limit: z.number().min(1).max(100).default(25),
    }))
    .query(async ({ input }) => {
      const results = await searchSanctions(input.query, {
        schema: input.schema,
        limit: input.limit,
      });
      return { results, count: results.length, source: "osiris-ofac-sdn" };
    }),

  // ── Enriched Sanctions Check (combines OFAC + conflict zone risk) ────────
  enrichedCheck: protectedProcedure
    .input(z.object({
      name: z.string().min(2),
      countryIso: z.string().length(2).optional(),
    }))
    .query(async ({ input }) => {
      const result = await enrichedSanctionsCheck(input.name, input.countryIso);
      return result;
    }),

  // ── Cyber Threats (CISA KEV + Shadowserver) ──────────────────────────────
  cyberThreats: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      const data = await getCyberThreats();
      return {
        threats: data.threats.slice(0, input?.limit ?? 20),
        total: data.threats.length,
        stats: data.stats,
        source: "osiris-cisa-kev",
      };
    }),

  // ── Conflict Zones (static geopolitical data) ────────────────────────────
  conflictZones: protectedProcedure
    .query(async () => {
      const zones = getConflictZones();
      return {
        zones,
        total: zones.length,
        activeWars: zones.filter(z => z.severity === "active_war").length,
        highTension: zones.filter(z => z.severity === "high_tension").length,
        elevated: zones.filter(z => z.severity === "elevated").length,
      };
    }),

  // ── Country Conflict Risk Check ──────────────────────────────────────────
  countryRisk: protectedProcedure
    .input(z.object({ countryIso: z.string().length(2) }))
    .query(async ({ input }) => {
      const conflictZone = isConflictCountry(input.countryIso);
      const riskLevel = getConflictRiskLevel(input.countryIso);
      const countryRisk = await getCountryRisk(input.countryIso);
      return {
        countryIso: input.countryIso,
        conflictZone,
        riskLevel,
        countryRisk,
      };
    }),

  // ── OSINT: WHOIS Lookup ──────────────────────────────────────────────────
  whois: protectedProcedure
    .input(z.object({ domain: z.string().min(3) }))
    .query(async ({ input }) => {
      const result = await whoisLookup(input.domain);
      return result;
    }),

  // ── OSINT: DNS Lookup ────────────────────────────────────────────────────
  dns: protectedProcedure
    .input(z.object({ domain: z.string().min(3) }))
    .query(async ({ input }) => {
      const result = await dnsLookup(input.domain);
      return result;
    }),

  // ── OSINT: IP Intelligence ───────────────────────────────────────────────
  ipIntel: protectedProcedure
    .input(z.object({ ip: z.string().min(7) }))
    .query(async ({ input }) => {
      const result = await ipIntelLookup(input.ip);
      return result;
    }),

  // ── OSINT: CVE Lookup ────────────────────────────────────────────────────
  cve: protectedProcedure
    .input(z.object({ cveId: z.string().regex(/^CVE-\d{4}-\d+$/) }))
    .query(async ({ input }) => {
      const result = await cveLookup(input.cveId);
      return result;
    }),

  // ── Cross-Border Transfer Risk Assessment (uses conflict zones) ──────────
  transferRisk: protectedProcedure
    .input(z.object({
      destinationCountry: z.string().min(2),
      dataCategory: z.string().optional(),
      volumeRecords: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const iso = input.destinationCountry.toUpperCase().slice(0, 2);
      const conflictZone = isConflictCountry(iso);
      const riskLevel = getConflictRiskLevel(iso);
      const countryRisk = await getCountryRisk(iso);

      let recommendation = "Standard transfer safeguards apply.";
      let requiresEdd = false;

      if (riskLevel === "critical") {
        recommendation = "BLOCK: Destination is an active conflict zone. Data transfer poses extreme risk to data subjects. NDPA Art. 40 prohibits transfers without extraordinary safeguards.";
        requiresEdd = true;
      } else if (riskLevel === "high") {
        recommendation = "ENHANCED DUE DILIGENCE: Destination has high geopolitical tensions. Binding Corporate Rules or Standard Contractual Clauses required with additional technical measures.";
        requiresEdd = true;
      } else if (riskLevel === "elevated") {
        recommendation = "MONITOR: Destination has elevated tensions. Standard transfer mechanisms apply but periodic review recommended.";
      }

      emitMutationEvent(EVENTS.CROSS_BORDER_TRANSFER, {
        destination: input.destinationCountry,
        riskLevel,
        conflictZone: conflictZone?.name ?? null,
        ts: new Date().toISOString(),
      }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));

      return {
        destinationCountry: input.destinationCountry,
        conflictZone,
        riskLevel,
        countryRisk,
        recommendation,
        requiresEdd,
        ndpaArticle40: riskLevel === "critical" || riskLevel === "high",
      };
    }),
});
