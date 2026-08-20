import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./trpc";
import { readinessReport } from "../productionRuntime";
import { getAdministratorInfrastructureStatus } from "../infrastructureStatus";
import { getWafBlockTrend } from "../securityTelemetry";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      }),
    )
    .query(() => ({
      ok: true,
    })),
  runtimeReadiness: publicProcedure.query(() => readinessReport()),
  infrastructureStatus: adminProcedure.query(() => getAdministratorInfrastructureStatus()),
  identitySecurity: protectedProcedure.query(({ ctx }) => ({ activeSessions: [{ sessionId: "current", label: "Current authenticated session", signedInAt: ctx.user.lastSignedIn?.toISOString?.() ?? new Date().toISOString(), loginMethod: ctx.user.loginMethod ?? "unknown", passkeyStatus: ctx.enterprise?.authMethod === "oidc" ? (ctx.enterprise.passkeyAuthenticated ? "verified_in_this_session" : "not_reported_by_token") : "not_available_for_local_session" }], accountConsoleUrl: process.env.KEYCLOAK_ACCOUNT_CONSOLE_URL?.trim() || null })),
  wafBlockTrend: adminProcedure.query(() => getWafBlockTrend()),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      }),
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});
