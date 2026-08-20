import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./trpc";
import { readinessReport } from "../productionRuntime";
import { getAdministratorInfrastructureStatus } from "../infrastructureStatus";
import { getSecurityPosture } from "../securityPosture";

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
  securityPosture: adminProcedure.query(() => getSecurityPosture()),
  identitySecurity: protectedProcedure.query(({ ctx }) => ({ loginMethod: ctx.user.loginMethod, lastSignedIn: ctx.user.lastSignedIn.toISOString(), mfaVerified: Boolean(ctx.enterprise?.mfaAuthenticated), accountConsoleUrl: process.env.KEYCLOAK_ACCOUNT_CONSOLE_URL?.trim() || null, sessionManagement: process.env.KEYCLOAK_ACCOUNT_CONSOLE_URL?.trim() ? "external_keycloak_account_console" : "unavailable_until_keycloak_account_console_is_configured" })),

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
