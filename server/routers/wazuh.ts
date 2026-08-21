/**
 * Wazuh SIEM / Compliance Router
 * Alerts, agents, vulnerabilities, compliance checks, FIM events
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import {
  getAlerts, getAgents, getVulnerabilities, getComplianceChecks,
  getFimEvents, getWazuhStats,
} from "../wazuhClient";

export const wazuhRouter = router({
  alerts: protectedProcedure
    .input(z.object({ level: z.number().optional(), limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      try {
        const alerts = await getAlerts(input);
        return { alerts, total: alerts.length };
      } catch { return { alerts: [], total: 0 }; }
    }),

  agents: protectedProcedure.query(async () => {
    try {
      const agents = await getAgents();
      return { agents, total: agents.length, active: agents.filter(a => a.status === "active").length };
    } catch { return { agents: [], total: 0, active: 0 }; }
  }),

  vulnerabilities: protectedProcedure
    .input(z.object({ agentId: z.string().optional(), severity: z.string().optional() }))
    .query(async ({ input }) => {
      try {
        const vulns = await getVulnerabilities(input);
        return { vulnerabilities: vulns, total: vulns.length };
      } catch { return { vulnerabilities: [], total: 0 }; }
    }),

  compliance: protectedProcedure
    .input(z.object({ framework: z.string().optional(), agentId: z.string().optional() }))
    .query(async ({ input }) => {
      try {
        const checks = await getComplianceChecks(input);
        const passed = checks.filter(c => c.status === "passed").length;
        const failed = checks.filter(c => c.status === "failed").length;
        return { checks, total: checks.length, passed, failed, passRate: checks.length > 0 ? Math.round((passed / checks.length) * 100) : 0 };
      } catch { return { checks: [], total: 0, passed: 0, failed: 0, passRate: 0 }; }
    }),

  fimEvents: protectedProcedure
    .input(z.object({ agentId: z.string().optional(), limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      try {
        const events = await getFimEvents(input);
        return { events, total: events.length };
      } catch { return { events: [], total: 0 }; }
    }),

  stats: protectedProcedure.query(async () => {
    try { return await getWazuhStats(); }
    catch {
      return {
        totalAgents: 0, activeAgents: 0, disconnectedAgents: 0,
        criticalAlerts24h: 0, highAlerts24h: 0, totalVulnerabilities: 0,
        criticalVulnerabilities: 0, compliancePassRate: 0, fimEvents24h: 0,
      };
    }
  }),
});
