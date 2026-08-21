import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./trpc";
import { readinessReport } from "../productionRuntime";
import { getAdministratorInfrastructureStatus } from "../infrastructureStatus";
import { getWafBlockTrend } from "../securityTelemetry";
import { keycloakAdminStatus, revokeKeycloakSession, sessionFingerprint } from "../keycloakAdmin";
import { recordKeycloakSessionRevocation, verifySecurityAuditChain } from "../securityOperations";

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
  identitySecurity: protectedProcedure.query(({ ctx }) => ({ activeSessions: [{ sessionId: ctx.enterprise?.sessionId ?? "current", label: "Current authenticated session", signedInAt: ctx.user.lastSignedIn?.toISOString?.() ?? new Date().toISOString(), loginMethod: ctx.user.loginMethod ?? "unknown", passkeyStatus: ctx.enterprise?.authMethod === "oidc" ? (ctx.enterprise.passkeyAuthenticated ? "verified_in_this_session" : "not_reported_by_token") : "not_available_for_local_session", revocable: Boolean(ctx.enterprise?.sessionId && keycloakAdminStatus().available) }], accountConsoleUrl: process.env.KEYCLOAK_ACCOUNT_CONSOLE_URL?.trim() || null, revocation: keycloakAdminStatus() })),
  wafBlockTrend: adminProcedure.query(() => getWafBlockTrend()),
  verifySecurityAuditChain: adminProcedure.query(() => verifySecurityAuditChain()),
  revokeKeycloakSession: adminProcedure.input(z.object({ sessionId: z.string().min(8).max(512) })).mutation(async ({ ctx, input }) => { const fingerprint = sessionFingerprint(input.sessionId); try { const result = await revokeKeycloakSession(input.sessionId); recordKeycloakSessionRevocation({ actor: ctx.user.openId, sessionHash: fingerprint, outcome: result.revoked ? "revoked" : "unavailable" }); if (!result.revoked) throw new Error(result.reason); return result; } catch (error) { recordKeycloakSessionRevocation({ actor: ctx.user.openId, sessionHash: fingerprint, outcome: "rejected" }); throw error; } }),

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
