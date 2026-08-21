/**
 * NDSEP Platform Intelligence tRPC Router
 *
 * Proxies requests to next-generation microservices:
 * - AI Compliance Engine (port 8155)
 * - Audit Chain / Blockchain (port 8165)
 * - Federated Learning (port 8170)
 * - Digital Twin (port 8175)
 * - Sovereign AI (port 8180)
 * - Quantum Crypto (port 8185)
 *
 * Also exposes: Event Store, CQRS, Feature Flags, Multi-Tenancy, Real-Time stats
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { logger } from "../logger";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";

const AI_URL = process.env.AI_COMPLIANCE_URL ?? "http://localhost:8155";
const AUDIT_URL = process.env.AUDIT_CHAIN_URL ?? "http://localhost:8165";
const FED_URL = process.env.FEDERATED_LEARNING_URL ?? "http://localhost:8170";
const TWIN_URL = process.env.DIGITAL_TWIN_URL ?? "http://localhost:8175";
const SOVEREIGN_URL = process.env.SOVEREIGN_AI_URL ?? "http://localhost:8180";
const PQC_URL = process.env.QUANTUM_CRYPTO_URL ?? "http://localhost:8185";

async function serviceFetch(baseUrl: string, path: string, method = "GET", body?: unknown): Promise<unknown> {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${baseUrl}${path}`, opts);
    if (!res.ok) {
      const text = await res.text();
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Service ${res.status}: ${text}` });
    }
    return res.json();
  } catch (e: unknown) {
    if (e instanceof TRPCError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: msg, path }, "Service unreachable — returning null");
    return null;
  }
}

export const platformIntelligenceRouter = router({
  // ── AI Compliance Engine ────────────────────────────────────────────────
  aiComplianceQuery: protectedProcedure
    .input(z.object({ question: z.string().min(1), orgContext: z.record(z.string(), z.unknown()).optional() }))
    .mutation(async ({ input }) => {
      const result = await serviceFetch(AI_URL, "/api/v1/compliance/query", "POST", { question: input.question, org_context: input.orgContext });
      emitMutationEvent(EVENTS.PLATFORM_AI_QUERY, { questionLength: input.question.length }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  aiGenerateDPIA: protectedProcedure
    .input(z.object({
      orgName: z.string(), processingActivity: z.string(), dataCategories: z.array(z.string()),
      dataSubjects: z.array(z.string()), purpose: z.string(), legalBasis: z.string(),
      crossBorder: z.boolean().default(false), automatedDecision: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const result = await serviceFetch(AI_URL, "/api/v1/compliance/dpia/generate", "POST", {
        org_name: input.orgName, processing_activity: input.processingActivity,
        data_categories: input.dataCategories, data_subjects: input.dataSubjects,
        purpose: input.purpose, legal_basis: input.legalBasis,
        cross_border: input.crossBorder, automated_decision: input.automatedDecision,
      });
      emitMutationEvent(EVENTS.PLATFORM_AI_DPIA, { orgName: input.orgName, processingActivity: input.processingActivity }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  aiGapAnalysis: protectedProcedure
    .input(z.object({
      orgName: z.string(), sector: z.string(), currentPolicies: z.array(z.string()),
      dataCategories: z.array(z.string()), hasDpo: z.boolean(), hasBreachPlan: z.boolean(),
      hasConsentMechanism: z.boolean(), hasDpia: z.boolean(), crossBorderTransfers: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const result = await serviceFetch(AI_URL, "/api/v1/compliance/gap-analysis", "POST", {
        org_name: input.orgName, sector: input.sector, current_policies: input.currentPolicies,
        data_categories: input.dataCategories, has_dpo: input.hasDpo, has_breach_plan: input.hasBreachPlan,
        has_consent_mechanism: input.hasConsentMechanism, has_dpia: input.hasDpia,
        cross_border_transfers: input.crossBorderTransfers,
      });
      emitMutationEvent(EVENTS.PLATFORM_AI_GAP_ANALYSIS, { orgName: input.orgName, sector: input.sector }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  aiImpactAnalysis: protectedProcedure
    .input(z.object({ regulatoryChange: z.string(), affectedArticles: z.array(z.string()), orgSectors: z.array(z.string()).optional() }))
    .mutation(async ({ input }) => {
      const result = await serviceFetch(AI_URL, "/api/v1/compliance/impact-analysis", "POST", {
        regulatory_change: input.regulatoryChange, affected_articles: input.affectedArticles, org_sectors: input.orgSectors,
      });
      emitMutationEvent(EVENTS.PLATFORM_AI_IMPACT, { regulatoryChange: input.regulatoryChange }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  aiNdpaSections: protectedProcedure.query(async () => {
    return serviceFetch(AI_URL, "/api/v1/compliance/ndpa/sections");
  }),

  // ── Blockchain Audit Trail ──────────────────────────────────────────────
  auditChainStats: protectedProcedure.query(async () => {
    return serviceFetch(AUDIT_URL, "/api/v1/audit/stats");
  }),

  auditChainVerify: protectedProcedure.query(async () => {
    return serviceFetch(AUDIT_URL, "/api/v1/audit/verify");
  }),

  auditChainMerkleRoot: protectedProcedure.query(async () => {
    return serviceFetch(AUDIT_URL, "/api/v1/audit/merkle-root");
  }),

  auditChainEntries: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }))
    .query(async ({ input }) => {
      return serviceFetch(AUDIT_URL, `/api/v1/audit/entries?limit=${input.limit}`);
    }),

  auditChainAppend: protectedProcedure
    .input(z.object({ aggregateType: z.string(), aggregateId: z.string(), eventType: z.string(), actorId: z.string().optional(), payload: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ input }) => {
      const result = await serviceFetch(AUDIT_URL, "/api/v1/audit/append", "POST", {
        aggregate_type: input.aggregateType, aggregate_id: input.aggregateId,
        event_type: input.eventType, actor_id: input.actorId, payload: input.payload,
      });
      emitMutationEvent(EVENTS.PLATFORM_AUDIT_APPENDED, { aggregateType: input.aggregateType, aggregateId: input.aggregateId, eventType: input.eventType }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  // ── Federated Learning ──────────────────────────────────────────────────
  federatedStats: protectedProcedure.query(async () => {
    return serviceFetch(FED_URL, "/api/v1/federated/stats");
  }),

  federatedModel: protectedProcedure.query(async () => {
    return serviceFetch(FED_URL, "/api/v1/federated/model");
  }),

  federatedThreatFeed: protectedProcedure
    .input(z.object({ limit: z.number().default(50), severity: z.string().optional() }))
    .query(async ({ input }) => {
      const params = new URLSearchParams({ limit: String(input.limit) });
      if (input.severity) params.set("severity", input.severity);
      return serviceFetch(FED_URL, `/api/v1/federated/threat-feed?${params}`);
    }),

  federatedHistory: protectedProcedure.query(async () => {
    return serviceFetch(FED_URL, "/api/v1/federated/history");
  }),

  // ── Digital Twin V2 ─────────────────────────────────────────────────────
  twinState: protectedProcedure.query(async () => {
    return serviceFetch(TWIN_URL, "/api/v1/twin/state");
  }),

  twinSimulate: protectedProcedure
    .input(z.object({
      scenario: z.string(),
      parameters: z.record(z.string(), z.number()),
      durationMonths: z.number().default(12),
      jurisdictions: z.array(z.string()).default(["NG"]),
      policyIds: z.array(z.number()).default([]),
      type: z.string().default("scenario"),
      iterations: z.number().default(1),
    }))
    .mutation(async ({ input }) => {
      const result = await serviceFetch(TWIN_URL, "/api/v1/twin/simulate", "POST", {
        scenario: input.scenario, parameters: input.parameters,
        duration_months: input.durationMonths, jurisdictions: input.jurisdictions,
        policy_ids: input.policyIds, type: input.type, iterations: input.iterations,
      });
      emitMutationEvent(EVENTS.PLATFORM_TWIN_SIMULATION, { scenario: input.scenario, type: input.type }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  twinMonteCarlo: protectedProcedure
    .input(z.object({
      scenario: z.string(),
      parameters: z.record(z.string(), z.number()),
      durationMonths: z.number().default(12),
      jurisdictions: z.array(z.string()).default(["NG"]),
      policyIds: z.array(z.number()).default([]),
      iterations: z.number().default(1000),
    }))
    .mutation(async ({ input }) => {
      const result = await serviceFetch(TWIN_URL, "/api/v1/twin/monte-carlo", "POST", {
        scenario: input.scenario, parameters: input.parameters,
        duration_months: input.durationMonths, jurisdictions: input.jurisdictions,
        policy_ids: input.policyIds, iterations: input.iterations,
      });
      emitMutationEvent(EVENTS.PLATFORM_TWIN_MONTE_CARLO, { scenario: input.scenario, iterations: input.iterations }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  twinPredictBreaches: protectedProcedure
    .input(z.object({
      jurisdictions: z.array(z.string()).default(["NG"]),
      count: z.number().default(30),
    }).optional())
    .query(async ({ input }) => {
      const params = new URLSearchParams();
      if (input?.jurisdictions) params.set("jurisdictions", input.jurisdictions.join(","));
      if (input?.count) params.set("count", String(input.count));
      return serviceFetch(TWIN_URL, `/api/v1/twin/predict-breaches?${params}`);
    }),

  twinHistory: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ input }) => {
      return serviceFetch(TWIN_URL, `/api/v1/twin/history?limit=${input?.limit ?? 50}`);
    }),

  twinJurisdictions: protectedProcedure.query(async () => {
    return serviceFetch(TWIN_URL, "/api/v1/twin/jurisdictions");
  }),

  twinPolicies: protectedProcedure
    .input(z.object({ jurisdictions: z.array(z.string()).optional() }).optional())
    .query(async ({ input }) => {
      const params = input?.jurisdictions ? `?jurisdictions=${input.jurisdictions.join(",")}` : "";
      return serviceFetch(TWIN_URL, `/api/v1/twin/policies${params}`);
    }),

  twinPolicyCompose: protectedProcedure
    .input(z.object({ policyIds: z.array(z.number()) }))
    .mutation(async ({ input }) => {
      const result = await serviceFetch(TWIN_URL, "/api/v1/twin/policies/compose", "POST", { policy_ids: input.policyIds });
      emitMutationEvent(EVENTS.PLATFORM_TWIN_POLICY_COMPOSE, { policyCount: input.policyIds.length }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  twinPolicyCreate: protectedProcedure
    .input(z.object({
      jurisdictionCode: z.string(),
      code: z.string(),
      name: z.string(),
      category: z.string(),
      status: z.string().default("draft"),
      effectiveDate: z.string().optional(),
      rules: z.array(z.record(z.string(), z.unknown())).default([]),
      parameters: z.record(z.string(), z.number()).default({}),
    }))
    .mutation(async ({ input }) => {
      const result = await serviceFetch(TWIN_URL, "/api/v1/twin/policies/create", "POST", {
        jurisdiction_code: input.jurisdictionCode, code: input.code, name: input.name,
        category: input.category, status: input.status, effective_date: input.effectiveDate,
        rules: input.rules, parameters: input.parameters,
      });
      emitMutationEvent(EVENTS.PLATFORM_TWIN_POLICY_CREATED, { code: input.code, name: input.name, jurisdiction: input.jurisdictionCode }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  twinCounterfactual: protectedProcedure
    .input(z.object({
      scenario: z.string(),
      parameters: z.record(z.string(), z.number()),
      durationMonths: z.number().default(12),
      jurisdictions: z.array(z.string()).default(["NG"]),
      policyIds: z.array(z.number()).default([]),
      counterfactualYear: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await serviceFetch(TWIN_URL, "/api/v1/twin/counterfactual", "POST", {
        scenario: input.scenario, parameters: input.parameters,
        duration_months: input.durationMonths, jurisdictions: input.jurisdictions,
        policy_ids: input.policyIds, counterfactual_year: input.counterfactualYear,
      });
      emitMutationEvent(EVENTS.PLATFORM_TWIN_COUNTERFACTUAL, { scenario: input.scenario }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  twinSandboxes: protectedProcedure.query(async () => {
    return serviceFetch(TWIN_URL, "/api/v1/twin/sandboxes");
  }),

  twinSandboxCreate: protectedProcedure
    .input(z.object({ name: z.string(), description: z.string().optional(), policyIds: z.array(z.number()).default([]) }))
    .mutation(async ({ input }) => {
      const result = await serviceFetch(TWIN_URL, "/api/v1/twin/sandboxes", "POST", {
        name: input.name, description: input.description, policy_ids: input.policyIds,
      });
      emitMutationEvent(EVENTS.PLATFORM_TWIN_SANDBOX, { name: input.name }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  twinEconomics: protectedProcedure
    .input(z.object({ jurisdiction: z.string().default("NG") }).optional())
    .query(async ({ input }) => {
      return serviceFetch(TWIN_URL, `/api/v1/twin/economics?jurisdiction=${input?.jurisdiction ?? "NG"}`);
    }),

  twinAgreements: protectedProcedure.query(async () => {
    return serviceFetch(TWIN_URL, "/api/v1/twin/agreements");
  }),

  // ── ML Breach Prediction (Python :8176) ─────────────────────────────
  twinMLPredict: protectedProcedure
    .input(z.object({ jurisdictions: z.array(z.string()).default(["NG"]), count: z.number().default(30) }).optional())
    .query(async ({ input }) => {
      const mlUrl = process.env.ML_PREDICTION_URL ?? "http://localhost:8176";
      return serviceFetch(mlUrl, "/api/v1/predict", "POST", {
        jurisdictions: input?.jurisdictions ?? ["NG"], count: input?.count ?? 30,
      });
    }),

  twinMLEconomicImpact: protectedProcedure
    .input(z.object({
      jurisdiction: z.string().default("NG"),
      policyChanges: z.record(z.string(), z.number()).default({}),
      durationMonths: z.number().default(12),
    }))
    .mutation(async ({ input }) => {
      const mlUrl = process.env.ML_PREDICTION_URL ?? "http://localhost:8176";
      const result = await serviceFetch(mlUrl, "/api/v1/economic-impact", "POST", {
        jurisdiction: input.jurisdiction, policy_changes: input.policyChanges,
        duration_months: input.durationMonths,
      });
      emitMutationEvent(EVENTS.PLATFORM_ML_ECONOMIC, { jurisdiction: input.jurisdiction }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  twinMLNetworkEffects: protectedProcedure
    .input(z.object({
      jurisdiction: z.string().default("NG"),
      triggerOrg: z.string(),
      triggerEvent: z.string().default("breach"),
      propagationSteps: z.number().default(3),
    }))
    .mutation(async ({ input }) => {
      const mlUrl = process.env.ML_PREDICTION_URL ?? "http://localhost:8176";
      const result = await serviceFetch(mlUrl, "/api/v1/network-effects", "POST", {
        jurisdiction: input.jurisdiction, trigger_org: input.triggerOrg,
        trigger_event: input.triggerEvent, propagation_steps: input.propagationSteps,
      });
      emitMutationEvent(EVENTS.PLATFORM_ML_NETWORK, { jurisdiction: input.jurisdiction, triggerOrg: input.triggerOrg }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  twinMLModelInfo: protectedProcedure.query(async () => {
    const mlUrl = process.env.ML_PREDICTION_URL ?? "http://localhost:8176";
    return serviceFetch(mlUrl, "/api/v1/model-info");
  }),

  // ── Rust Simulation Engines ─────────────────────────────────────────
  twinMonteCarloEngine: protectedProcedure
    .input(z.object({
      sectors: z.array(z.object({
        sector: z.string(), jurisdiction: z.string(), organizations: z.number(),
        avg_compliance: z.number(), breach_rate: z.number(), avg_penalty_local: z.number(),
        avg_budget_usd: z.number(), staff_count_avg: z.number(), tech_maturity: z.number(),
      })),
      iterations: z.number().default(1000),
      durationMonths: z.number().default(12),
      breachSlaHours: z.number().default(72),
      penaltyMultiplier: z.number().default(1.0),
      complianceThreshold: z.number().default(70),
    }))
    .mutation(async ({ input }) => {
      const mcUrl = process.env.MONTE_CARLO_URL ?? "http://localhost:8177";
      const result = await serviceFetch(mcUrl, "/api/v1/monte-carlo/run", "POST", {
        sectors: input.sectors, iterations: input.iterations,
        duration_months: input.durationMonths, breach_sla_hours: input.breachSlaHours,
        penalty_multiplier: input.penaltyMultiplier, compliance_threshold: input.complianceThreshold,
      });
      emitMutationEvent(EVENTS.PLATFORM_MONTE_CARLO_ENGINE, { sectorCount: input.sectors.length, iterations: input.iterations }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  twinAgentSim: protectedProcedure
    .input(z.object({
      agents: z.array(z.object({
        id: z.number(), name: z.string(), sector: z.string(), jurisdiction: z.string(),
        compliance_score: z.number(), security_budget: z.number(), infosec_staff: z.number(),
        tech_maturity: z.number(), risk_appetite: z.number(), breach_history: z.number(),
        data_volume_gb: z.number(), cross_border: z.boolean(),
      })),
      durationMonths: z.number().default(12),
      breachSlaHours: z.number().default(72),
      penaltyMultiplier: z.number().default(1.0),
      complianceThreshold: z.number().default(70),
      peerPressureWeight: z.number().default(0.3),
      networkEffects: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const abmUrl = process.env.AGENT_MODEL_URL ?? "http://localhost:8178";
      const result = await serviceFetch(abmUrl, "/api/v1/agent-sim/run", "POST", {
        agents: input.agents, duration_months: input.durationMonths,
        breach_sla_hours: input.breachSlaHours, penalty_multiplier: input.penaltyMultiplier,
        compliance_threshold: input.complianceThreshold,
        peer_pressure_weight: input.peerPressureWeight, network_effects: input.networkEffects,
      });
      emitMutationEvent(EVENTS.PLATFORM_TWIN_AGENT_SIM, { agentCount: input.agents.length, durationMonths: input.durationMonths }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  twinSystemDynamics: protectedProcedure
    .input(z.object({
      initialStocks: z.object({
        compliance_level: z.number(), breach_rate: z.number(), penalty_pool: z.number(),
        compliance_investment: z.number(), public_trust: z.number(), regulatory_capacity: z.number(),
        data_economy_growth: z.number(), cross_border_volume: z.number(),
        fdi_confidence: z.number(), insurance_cost_index: z.number(),
      }),
      durationMonths: z.number().default(12),
      policyParams: z.object({
        breach_sla_hours: z.number(), penalty_multiplier: z.number(),
        enforcement_budget_increase: z.number(), awareness_campaign: z.boolean(),
        mandatory_audit: z.boolean(), cross_border_restriction: z.number(),
      }),
      jurisdiction: z.string().default("NG"),
    }))
    .mutation(async ({ input }) => {
      const sdUrl = process.env.SYSTEM_DYNAMICS_URL ?? "http://localhost:8179";
      const result = await serviceFetch(sdUrl, "/api/v1/system-dynamics/run", "POST", {
        initial_stocks: input.initialStocks, duration_months: input.durationMonths,
        policy_params: input.policyParams, jurisdiction: input.jurisdiction,
      });
      emitMutationEvent(EVENTS.PLATFORM_TWIN_SYSTEM_DYNAMICS, { jurisdiction: input.jurisdiction, durationMonths: input.durationMonths }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  // ── Sovereign AI ────────────────────────────────────────────────────────
  sovereignLanguages: protectedProcedure.query(async () => {
    return serviceFetch(SOVEREIGN_URL, "/api/v1/ai/languages");
  }),

  sovereignModels: protectedProcedure.query(async () => {
    return serviceFetch(SOVEREIGN_URL, "/api/v1/ai/models");
  }),

  sovereignTranslate: protectedProcedure
    .input(z.object({ keys: z.array(z.string()), language: z.string() }))
    .mutation(async ({ input }) => {
      const result = await serviceFetch(SOVEREIGN_URL, "/api/v1/ai/translate", "POST", input);
      emitMutationEvent(EVENTS.PLATFORM_SOVEREIGN_TRANSLATE, { language: input.language, keyCount: input.keys.length }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  sovereignFairnessCheck: protectedProcedure
    .input(z.object({ scoresBySector: z.record(z.string(), z.array(z.number())), scoresByRegion: z.record(z.string(), z.array(z.number())).optional() }))
    .mutation(async ({ input }) => {
      const result = await serviceFetch(SOVEREIGN_URL, "/api/v1/ai/fairness/check", "POST", {
        scores_by_sector: input.scoresBySector, scores_by_region: input.scoresByRegion,
      });
      emitMutationEvent(EVENTS.PLATFORM_SOVEREIGN_FAIRNESS, { sectorCount: Object.keys(input.scoresBySector).length }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  sovereignResidencyReport: protectedProcedure.query(async () => {
    return serviceFetch(SOVEREIGN_URL, "/api/v1/ai/residency-report");
  }),

  sovereignRedTeam: protectedProcedure
    .input(z.object({ modelId: z.string(), attackType: z.string(), prompt: z.string() }))
    .mutation(async ({ input }) => {
      const result = await serviceFetch(SOVEREIGN_URL, "/api/v1/ai/red-team", "POST", {
        model_id: input.modelId, attack_type: input.attackType, prompt: input.prompt,
      });
      emitMutationEvent(EVENTS.PLATFORM_SOVEREIGN_REDTEAM, { modelId: input.modelId, attackType: input.attackType }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  // ── Quantum Crypto ──────────────────────────────────────────────────────
  pqcAlgorithms: protectedProcedure.query(async () => {
    return serviceFetch(PQC_URL, "/api/v1/pqc/algorithms");
  }),

  pqcGenerateKemKeypair: protectedProcedure.mutation(async () => {
    const result = await serviceFetch(PQC_URL, "/api/v1/pqc/kem/keypair", "POST");
    emitMutationEvent(EVENTS.PLATFORM_PQC_KEM, { action: "generate_keypair" }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return result;
  }),

  pqcGenerateSigKeypair: protectedProcedure.mutation(async () => {
    const result = await serviceFetch(PQC_URL, "/api/v1/pqc/sig/keypair", "POST");
    emitMutationEvent(EVENTS.PLATFORM_PQC_SIG, { action: "generate_keypair" }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return result;
  }),

  pqcSign: protectedProcedure
    .input(z.object({ message: z.string() }))
    .mutation(async ({ input }) => {
      const result = await serviceFetch(PQC_URL, "/api/v1/pqc/sig/sign", "POST", input);
      emitMutationEvent(EVENTS.PLATFORM_PQC_SIGN, { messageLength: input.message.length }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  pqcHybridEncrypt: protectedProcedure
    .input(z.object({ plaintext: z.string() }))
    .mutation(async ({ input }) => {
      const result = await serviceFetch(PQC_URL, "/api/v1/pqc/hybrid/encrypt", "POST", input);
      emitMutationEvent(EVENTS.PLATFORM_PQC_ENCRYPT, { plaintextLength: input.plaintext.length }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),
});
