import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { sendWeeklyDigest, previewDigest } from "../digestScheduler";
import { sendPenaltyNotice, sendCertificateGranted } from "../emailNotification";
import { sendSlackAlert, sendPagerDutyAlert } from "../slack";
import { ENV } from "./env";
import { getAllCircuitBreakerStates } from "../resilience";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  /** Admin-only: manually trigger the weekly compliance digest for all registered orgs */
  sendDigest: adminProcedure
    .mutation(async () => {
      const portalBaseUrl = process.env.VITE_OAUTH_PORTAL_URL ?? "http://localhost:3000";
      const result = await sendWeeklyDigest(portalBaseUrl);
      return result; // { sent: number; failed: number }
    }),
  /** Admin-only: preview the digest HTML for a given org (no email sent) */
  previewDigest: adminProcedure
    .input(z.object({ orgId: z.number().int().positive().optional() }))
    .mutation(async ({ input }) => {
      const portalBaseUrl = process.env.VITE_OAUTH_PORTAL_URL ?? "http://localhost:3000";
      const result = await previewDigest(input.orgId ?? 0, portalBaseUrl);
      return result; // { orgName: string; html: string } | null
    }),

  /** Admin-only: send a test email to verify Resend / Forge API transport */
  testEmail: adminProcedure
    .input(z.object({
      to: z.string().email("Must be a valid email address"),
      type: z.enum(["penalty", "certificate"]).default("penalty"),
    }))
    .mutation(async ({ input }) => {
      const transport = ENV.resendApiKey ? "Resend" : "Forge API (fallback)";
      let ok = false;
      if (input.type === "penalty") {
        ok = await sendPenaltyNotice({
          to: input.to,
          orgName: "Test Organisation Ltd.",
          penaltyId: 999999,
          amount: 500000,
          currency: "NGN",
          description: "Test notification — NDPA Section 42 data breach notification failure",
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          portalUrl: `${ENV.platformUrl}/portal`,
        });
      } else {
        ok = await sendCertificateGranted({
          to: input.to,
          orgName: "Test Organisation Ltd.",
          certToken: "TEST-CERT-000000",
          complianceScore: 95,
          certifiedAt: new Date(),
          verifyBaseUrl: ENV.platformUrl,
        });
      }
      return {
        success: ok,
        transport,
        to: input.to,
        type: input.type,
        message: ok
          ? `Test ${input.type} email sent via ${transport} to ${input.to}`
          : `Email delivery failed — check server logs for details`,
      };
    }),

  /** Admin-only: send a test Slack alert to verify webhook connectivity */
  testSlack: adminProcedure
    .input(z.object({
      severity: z.enum(["critical", "warning", "info", "resolved"]).default("info"),
    }))
    .mutation(async ({ input }) => {
      const configured = !!ENV.slackWebhookUrl;
      if (!configured) {
        return {
          success: false,
          configured: false,
          message: "SLACK_WEBHOOK_URL is not configured. Add it via the Secrets panel.",
        };
      }
      const ok = await sendSlackAlert({
        severity: input.severity,
        title: `NDSEP Test Alert — ${input.severity.toUpperCase()}`,
        description: "This is a test alert from the NDSEP platform to verify Slack webhook connectivity.",
        fields: [
          { title: "Platform", value: "NDSEP", short: true },
          { title: "Environment", value: ENV.isProduction ? "Production" : "Development", short: true },
        ],
        actionUrl: ENV.platformUrl,
        actionLabel: "Open NDSEP Dashboard",
      });
      return {
        success: ok,
        configured: true,
        message: ok
          ? "Test Slack alert delivered successfully to #ndsep-alerts"
          : "Slack webhook delivery failed — check server logs",
      };
    }),

  /** Admin-only: send a test PagerDuty incident */
  testPagerDuty: adminProcedure
    .mutation(async () => {
      const configured = !!ENV.pagerdutyKey;
      if (!configured) {
        return { success: false, configured: false, message: "PAGERDUTY_INTEGRATION_KEY is not configured." };
      }
      const ok = await sendPagerDutyAlert({
        severity: "info",
        summary: "NDSEP Test Alert — Platform connectivity check",
        source: "ndsep-api",
        component: "system-test",
        dedupKey: `ndsep-test-${Date.now()}`,
      });
      return {
        success: ok,
        configured: true,
        message: ok ? "Test PagerDuty incident triggered" : "PagerDuty delivery failed — check server logs",
      };
    }),

  /** Admin-only: returns alerting configuration status (no secrets exposed) */
  alertingStatus: adminProcedure
    .query(() => ({
      email: {
        transport: ENV.resendApiKey ? "resend" : "forge_api",
        configured: true,
        from: ENV.emailFrom,
      },
      slack: { configured: !!ENV.slackWebhookUrl },
      pagerduty: { configured: !!ENV.pagerdutyKey },
    })),

  /** Admin-only: returns real-time circuit breaker states for all external service integrations.
   *  States: CLOSED (healthy), OPEN (failing, requests blocked), HALF_OPEN (testing recovery). */
  circuitBreakerStates: adminProcedure
    .query(() => {
      const states = getAllCircuitBreakerStates();
      const summary = {
        total: states.length,
        closed: states.filter(s => s.state === "CLOSED").length,
        open: states.filter(s => s.state === "OPEN").length,
        halfOpen: states.filter(s => s.state === "HALF_OPEN").length,
        degraded: states.filter(s => s.state !== "CLOSED").length,
      };
      return { states, summary, timestamp: Date.now() };
    }),

  /** Server-side proxy: checks health of all middleware workers (Go/Rust/Python).
   *  Avoids CORS issues — browser calls this instead of localhost:PORT directly. */
  workerHealth: adminProcedure
    .input(z.object({ ports: z.array(z.number()).optional() }).optional())
    .query(async ({ input }) => {
      const defaultPorts = [
        { port: 8150, name: "Dapr Bridge",         lang: "Go"     },
        { port: 8151, name: "Fluvio Relay",         lang: "Go"     },
        { port: 8152, name: "Mojaloop Adapter",     lang: "Go"     },
        { port: 8153, name: "Temporal Worker",      lang: "Go"     },
        { port: 8160, name: "Keycloak Validator",   lang: "Rust"   },
        { port: 8161, name: "Permify RBAC",         lang: "Rust"   },
        { port: 8162, name: "TigerBeetle Ledger",   lang: "Rust"   },
        { port: 8163, name: "Lakehouse Ingest",     lang: "Rust"   },
        { port: 8164, name: "AML Scorer",           lang: "Python" },
        { port: 8165, name: "Insurance Monitor",    lang: "Python" },
        { port: 8166, name: "SIEM Correlator",      lang: "Python" },
        { port: 8167, name: "Watchlist Screener",   lang: "Python" },
        // Existing workers
        { port: 8100, name: "Compliance Engine",    lang: "Go"     },
        { port: 8101, name: "Discovery Agent",      lang: "Go"     },
        { port: 8102, name: "Anomaly Dispatcher",   lang: "Go"     },
        { port: 8103, name: "APISIX Manager",       lang: "Go"     },
        { port: 8104, name: "BGP Monitor",          lang: "Go"     },
        { port: 8105, name: "SLA Tracker",          lang: "Go"     },
        { port: 8106, name: "CAR PDF Generator",    lang: "Go"     },
        { port: 8107, name: "Citizen SLA Tracker",  lang: "Go"     },
        { port: 8108, name: "Compliance Rescorer",  lang: "Go"     },
        { port: 8109, name: "Dapr Bridge (legacy)", lang: "Go"     },
        { port: 8110, name: "Arkime PCAP",          lang: "Go"     },
        { port: 8120, name: "Evidence Signer",      lang: "Rust"   },
        { port: 8121, name: "Financial Ledger",     lang: "Rust"   },
        { port: 8122, name: "BGP Validator",        lang: "Rust"   },
        { port: 8123, name: "Residency Enforcer",   lang: "Rust"   },
        { port: 8124, name: "Vector Cache",         lang: "Rust"   },
        { port: 8125, name: "OpenSearch Indexer",   lang: "Rust"   },
        { port: 8126, name: "Middleware Cache",     lang: "Rust"   },
        { port: 8127, name: "Lakehouse Writer",     lang: "Rust"   },
        { port: 8140, name: "AI Governance Scorer", lang: "Python" },
        { port: 8141, name: "ART Adversarial",      lang: "Python" },
        { port: 8142, name: "ML Prediction",        lang: "Python" },
        { port: 8143, name: "Fluvio Telemetry",     lang: "Python" },
        { port: 8144, name: "Egeria Lineage",       lang: "Python" },
        { port: 8145, name: "Falco Steampipe",      lang: "Python" },
        // NOC subsystems
        { port: 8190, name: "NOC Collector",         lang: "Rust"   },
        { port: 8191, name: "NOC Escalation",        lang: "Go"     },
        { port: 8192, name: "NOC Correlator",        lang: "Python" },
        { port: 8193, name: "NOC Uptime Tracker",    lang: "Rust"   },
        // AI NOC Agents
        { port: 8194, name: "AI Perception Engine",  lang: "Rust"   },
        { port: 8195, name: "AI Reasoning Engine",   lang: "Python" },
        { port: 8196, name: "AI Action Engine",      lang: "Go"     },
      ];
      const results = await Promise.allSettled(
        defaultPorts.map(async (w) => {
          const start = Date.now();
          try {
            const resp = await fetch(`http://localhost:${w.port}/health`, {
              signal: AbortSignal.timeout(1500),
            });
            const latency = Date.now() - start;
            return { ...w, status: resp.ok ? "healthy" : "degraded", latency };
          } catch {
            return { ...w, status: "down", latency: null };
          }
        })
      );
      return results.map((r, i) =>
        r.status === "fulfilled" ? r.value : { ...defaultPorts[i], status: "down", latency: null }
      );
    }),
});
