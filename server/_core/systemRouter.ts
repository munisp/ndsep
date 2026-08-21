import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./trpc";
import { assertEnterpriseRole } from "./enterpriseAuth";
import { readinessReport } from "../productionRuntime";
import { getAdministratorInfrastructureStatus } from "../infrastructureStatus";
import { getWafBlockTrend } from "../securityTelemetry";
import { keycloakAdminStatus, listKeycloakDirectorySessions, revokeKeycloakSession, sessionBelongsToSubject, sessionFingerprint } from "../keycloakAdmin";
import { recordAuditInvestigationExport, recordKeycloakSessionRevocation, verifySecurityAuditChain } from "../securityOperations";
import { validateBulkSessionRevocation } from "../../lib/keycloak-bulk-revocation";
import { deleteTeamWafThreatPreset, listTeamWafThreatPresets, publishTeamWafThreatPreset } from "../wafThreatPresetRepository";

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
  identitySecurity: protectedProcedure.query(({ ctx }) => ({ activeSessions: [{ sessionId: ctx.enterprise?.sessionId ?? "current", label: "Current authenticated session", signedInAt: ctx.user.lastSignedIn?.toISOString?.() ?? new Date().toISOString(), loginMethod: ctx.user.loginMethod ?? "unknown", passkeyStatus: ctx.enterprise?.authMethod === "oidc" ? (ctx.enterprise.passkeyAuthenticated ? "verified_in_this_session" : "not_reported_by_token") : "not_available_for_local_session", revocable: Boolean(ctx.enterprise?.sessionId && keycloakAdminStatus().available) }], accountConsoleUrl: process.env.KEYCLOAK_ACCOUNT_CONSOLE_URL?.trim() || null, revocation: keycloakAdminStatus(), canInvestigateOtherUsers: Boolean(ctx.enterprise?.agencyRoles.includes("planning_supervisor")), externalSessionDirectoryAvailable: keycloakAdminStatus().available })),
  wafBlockTrend: adminProcedure.query(() => getWafBlockTrend()),
  verifySecurityAuditChain: adminProcedure.query(() => verifySecurityAuditChain()),
  revokeKeycloakSession: adminProcedure.input(z.object({ sessionId: z.string().min(8).max(512) })).mutation(async ({ ctx, input }) => { const fingerprint = sessionFingerprint(input.sessionId); try { const result = await revokeKeycloakSession(input.sessionId); recordKeycloakSessionRevocation({ actor: ctx.user.openId, sessionHash: fingerprint, outcome: result.revoked ? "revoked" : "unavailable" }); if (!result.revoked) throw new Error(result.reason); return result; } catch (error) { recordKeycloakSessionRevocation({ actor: ctx.user.openId, sessionHash: fingerprint, outcome: "rejected" }); throw error; } }),
  revokeKeycloakSessionsBulk: adminProcedure.input(z.object({ sessionIds: z.array(z.string().min(8).max(512)).min(1).max(20), confirmation: z.string().max(64), reason: z.string().min(10).max(240) })).mutation(async ({ ctx, input }) => {
    const validated = validateBulkSessionRevocation(input); if (!validated.valid) throw new Error(validated.reason);
    const batchId = crypto.randomUUID(); const outcomes: Array<{ sessionHash: string; revoked: boolean; reason: string }> = [];
    for (const sessionId of validated.sessionIds) { const sessionHash = sessionFingerprint(sessionId); try { const result = await revokeKeycloakSession(sessionId); recordKeycloakSessionRevocation({ actor: ctx.user.openId, sessionHash, outcome: result.revoked ? "revoked" : "unavailable", reason: validated.reason, batchId }); outcomes.push({ sessionHash, revoked: result.revoked, reason: result.reason ?? "Keycloak accepted the revocation request." }); } catch (error) { const reason = error instanceof Error ? error.message : "Keycloak revocation request failed."; recordKeycloakSessionRevocation({ actor: ctx.user.openId, sessionHash, outcome: "rejected", reason: validated.reason, batchId }); outcomes.push({ sessionHash, revoked: false, reason }); } }
    return { batchId, outcomes, allRevoked: outcomes.every((item) => item.revoked) };
  }),
  listKeycloakDirectorySessions: adminProcedure.input(z.object({ search: z.string().min(2).max(120) })).query(async ({ ctx, input }) => { if (!ctx.enterprise) throw new Error("Verified enterprise identity is required for cross-user session investigation."); assertEnterpriseRole(ctx.enterprise, ["planning_supervisor"]); if (!ctx.enterprise.passkeyAuthenticated && process.env.NODE_ENV === "production") throw new Error("A verified passkey or WebAuthn MFA session is required for cross-user session investigation."); return { sessions: await listKeycloakDirectorySessions(input.search), source: "keycloak_administrative_api" as const }; }),
  revokeOtherUserKeycloakSession: adminProcedure.input(z.object({ targetSubject: z.string().min(1).max(256), sessionId: z.string().min(8).max(512), confirmation: z.literal("TERMINATE OTHER USER SESSION"), reason: z.string().min(10).max(240) })).mutation(async ({ ctx, input }) => { if (!ctx.enterprise) throw new Error("Verified enterprise identity is required."); assertEnterpriseRole(ctx.enterprise, ["planning_supervisor"]); if (!ctx.enterprise.passkeyAuthenticated && process.env.NODE_ENV === "production") throw new Error("A verified passkey or WebAuthn MFA session is required for cross-user session termination."); const ownsSession = await sessionBelongsToSubject(input.targetSubject, input.sessionId); if (!ownsSession) throw new Error("Keycloak did not verify that the requested session belongs to the selected subject."); const result = await revokeKeycloakSession(input.sessionId); recordKeycloakSessionRevocation({ actor: ctx.user.openId, sessionHash: sessionFingerprint(input.sessionId), outcome: result.revoked ? "revoked" : "unavailable", reason: input.reason }); if (!result.revoked) throw new Error(result.reason); return result; }),
  listTeamWafThreatPresets: adminProcedure.query(async ({ ctx }) => { if (!ctx.enterprise) throw new Error("Verified enterprise identity with an agency claim is required for team presets."); return listTeamWafThreatPresets(ctx.enterprise.agencyId); }),
  publishTeamWafThreatPreset: adminProcedure.input(z.object({ name: z.string().trim().min(1).max(80), query: z.string().trim().min(1).max(160) })).mutation(async ({ ctx, input }) => { if (!ctx.enterprise) throw new Error("Verified enterprise identity with an agency claim is required for team presets."); assertEnterpriseRole(ctx.enterprise, ["planning_supervisor"]); return publishTeamWafThreatPreset({ agencyId: ctx.enterprise.agencyId, name: input.name, query: input.query, createdBy: ctx.enterprise.subject }); }),
  deleteTeamWafThreatPreset: adminProcedure.input(z.object({ presetId: z.string().uuid() })).mutation(async ({ ctx, input }) => { if (!ctx.enterprise) throw new Error("Verified enterprise identity with an agency claim is required for team presets."); return deleteTeamWafThreatPreset({ presetId: input.presetId, agencyId: ctx.enterprise.agencyId, actor: ctx.enterprise.subject, mayManageAgency: ctx.enterprise.agencyRoles.includes("planning_supervisor") }); }),
  recordAuditInvestigationExport: adminProcedure.input(z.object({ format: z.enum(["csv", "pdf"]), totalEvents: z.number().int().min(0).max(250), integrityValid: z.boolean() })).mutation(({ ctx, input }) => ({ receipt: recordAuditInvestigationExport({ actor: ctx.user.openId, ...input }) })),

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
