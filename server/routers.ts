import { z } from "zod";

import { getSessionCookieOptions } from "./_core/cookies";
import { COOKIE_NAME } from "../shared/const";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  analyzeDocumentImage,
  analyzeLivenessSelfie,
  analyzeNotificationActivities,
  appendBusinessDocument,
  appendIdentityDocument,
  approveIdentityDocument,
  clearParcelMutePreference,
  completeLivenessSession,
  getMobilePlatformBundle,
  listLegalWorkflows,
  setParcelMutePreference,
  startLivenessSession,
  submitBusinessProfile,
  syncBundleMutation,
  toggleParcelSubscriptionPreference,
  updateLegalWorkflowStatus,
  updateMissionStatus,
  updateNotificationPreferences,
  updateParcelGeofencePreference,
  reconcileParcelGeofenceReplay,
} from "./mobilePlatformRepository";
import {
  appendPermitReviewNote,
  exportPermitAuditHistory,
  extractPermitDocumentToForm,
  getActiveAgencyUser,
  getAuditVerificationKey,
  getPermitCase,
  getPermitCaseForRole,
  getPermitCustodyTimeline,
  getPermittingPlatform,
  listAgencies,
  listAgencyUsers,
  listApprovalQueues,
  listMiddlewareComponents,
  listParityState,
  listPermitCases,
  listQueueAnalytics,
  listReminderQueue,
  listSigningKeys,
  listSupervisorDigests,
  listSupervisorExceptionAnalytics,
  listServiceTopology,
  overridePermitAssignment,
  revokeSigningKey,
  setActiveAgencyUser,
  updatePermitCaseStage,
  updatePermitFormSections,
  uploadPermitDocumentAndExtract,
  verifyAuditPackage,
  advancePermitHandoff,
} from "./permittingPlatformRepository";

const businessProfileSchema = z.object({
  stakeholderType: z.enum(["individual", "business"]),
  companyName: z.string().nullable(),
  cacNumber: z.string().nullable(),
  tinNumber: z.string().nullable(),
  businessEmail: z.string().nullable(),
  businessPhone: z.string().nullable(),
  businessAddress: z.string().nullable(),
  contactPerson: z.string().nullable(),
  onboardingStatus: z.enum(["draft", "in_review", "verified", "needs_attention"]),
  cacStatus: z.enum(["verified", "pending", "failed"]),
  tinStatus: z.enum(["verified", "pending", "failed"]),
  submittedAt: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  documents: z.array(
    z.object({
      id: z.number(),
      type: z.string(),
      fileName: z.string(),
      documentUrl: z.string().nullable().optional(),
      status: z.enum(["pending", "verified", "rejected", "requires_review", "unavailable"]),
      engine: z.enum(["paddleocr", "vlm", "docling", "tesseract_fallback", "vision_llm", "manual"]).optional(),
      confidence: z.number().nullable().optional(),
      extractedSummary: z.string().nullable().optional(),
      analysisProvenance: z.enum(["model_assisted", "manual_review", "unavailable"]).optional(),
      analysisReason: z.string().nullable().optional(),
      uploadedAt: z.string(),
    }),
  ),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  sync: router({
    getBundle: publicProcedure.query(() => getMobilePlatformBundle()),
    replaceBundle: publicProcedure
      .input(
        z.object({
          bundle: z.object({
            parcels: z.array(z.any()),
            missions: z.array(z.any()),
            onboarding: z.any(),
            legalWorkflows: z.array(z.any()),
            notificationPreferences: z.any(),
            syncMeta: z.any(),
          }),
        }),
      )
      .mutation(({ input }) => syncBundleMutation(input.bundle)),
    updateMissionStatus: publicProcedure
      .input(
        z.object({
          missionId: z.string(),
          status: z.enum(["queued", "active", "synced"]),
        }),
      )
      .mutation(({ input }) => updateMissionStatus(input)),
  }),
  notifications: router({
    getPreferences: publicProcedure.query(() => getMobilePlatformBundle().notificationPreferences),
    updatePreferences: publicProcedure
      .input(
        z.object({
          pushEnabled: z.boolean().optional(),
          fieldAlerts: z.boolean().optional(),
          onboardingAlerts: z.boolean().optional(),
          legalAlerts: z.boolean().optional(),
          geospatialAlerts: z.boolean().optional(),
          geofenceAlerts: z.boolean().optional(),
          onlyAssignedParcels: z.boolean().optional(),
          followedParcelIds: z.array(z.number()).optional(),
          parcelMutes: z
            .array(
              z.object({
                parcelId: z.number(),
                duration: z.enum(["1h", "1d", "until_workflow_completion"]),
                mutedAt: z.string(),
                mutedUntil: z.string().nullable(),
                workflowId: z.string().nullable().optional(),
              }),
            )
            .optional(),
          geofenceSubscriptions: z
            .array(
              z.object({
                parcelId: z.number(),
                radiusMeters: z.number(),
                transition: z.enum(["enter", "exit", "both"]),
                enabled: z.boolean(),
                lastTriggeredAt: z.string().nullable(),
                lastTransition: z.enum(["enter", "exit"]).nullable(),
              }),
            )
            .optional(),
        }),
      )
      .mutation(({ input }) => updateNotificationPreferences(input)),
    toggleParcelSubscription: publicProcedure
      .input(
        z.object({
          parcelId: z.number(),
        }),
      )
      .mutation(({ input }) => toggleParcelSubscriptionPreference(input)),
    setParcelMute: publicProcedure
      .input(
        z.object({
          parcelId: z.number(),
          duration: z.enum(["1h", "1d", "until_workflow_completion"]),
        }),
      )
      .mutation(({ input }) => setParcelMutePreference(input)),
    clearParcelMute: publicProcedure
      .input(
        z.object({
          parcelId: z.number(),
        }),
      )
      .mutation(({ input }) => clearParcelMutePreference(input)),
    updateParcelGeofence: publicProcedure
      .input(
        z.object({
          parcelId: z.number(),
          enabled: z.boolean().optional(),
          radiusMeters: z.number().optional(),
          transition: z.enum(["enter", "exit", "both"]).optional(),
          lastTriggeredAt: z.string().nullable().optional(),
          lastTransition: z.enum(["enter", "exit"]).nullable().optional(),
        }),
      )
      .mutation(({ input }) => updateParcelGeofencePreference(input)),
    analyzeActivities: publicProcedure
      .input(
        z.object({
          activities: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              description: z.string(),
              category: z.string(),
              tone: z.string(),
              unread: z.boolean(),
              parcelNumber: z.string().nullable().optional(),
              actionLabel: z.string().nullable().optional(),
              auditTrailSummary: z.string().nullable().optional(),
            }),
          ),
          interactionProfile: z.object({
            openedByCategory: z.record(z.string(), z.number()),
            dismissedByCategory: z.record(z.string(), z.number()),
            actionedByCategory: z.record(z.string(), z.number()),
            unreadResolvedByCategory: z.record(z.string(), z.number()),
            totalOpened: z.number(),
            totalDismissed: z.number(),
            totalActioned: z.number(),
            totalUnreadResolved: z.number(),
            preferredCategories: z.array(z.string()),
          }),
        }),
      )
      .mutation(({ input }) => analyzeNotificationActivities(input)),
    replayGeofenceEvent: publicProcedure
      .input(
        z.object({
          parcelId: z.number(),
          transition: z.enum(["enter", "exit"]),
          radiusMeters: z.number(),
          latitude: z.number(),
          longitude: z.number(),
          triggeredAt: z.string(),
        }),
      )
      .mutation(({ input }) => reconcileParcelGeofenceReplay(input)),
  }),
  permitting: router({
    getPlatform: publicProcedure.query(() => getPermittingPlatform()),
    listCases: publicProcedure.query(() => listPermitCases()),
    getCase: publicProcedure.input(z.object({ caseId: z.string() })).query(({ input }) => getPermitCase(input.caseId)),
    getCaseForRole: publicProcedure
      .input(
        z.object({
          caseId: z.string(),
          role: z.enum(["applicant", "mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"]),
        }),
      )
      .query(({ input }) => getPermitCaseForRole(input)),
    listAgencies: publicProcedure.query(() => listAgencies()),
    listAgencyUsers: publicProcedure.query(() => listAgencyUsers()),
    getActiveAgencyUser: publicProcedure.query(() => getActiveAgencyUser()),
    setActiveAgencyUser: publicProcedure
      .input(z.object({ userId: z.string() }))
      .mutation(({ input }) => setActiveAgencyUser(input)),
    listApprovalQueues: publicProcedure
      .input(
        z
          .object({
            agencyId: z.string().optional(),
            role: z.enum(["applicant", "mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"]).optional(),
          })
          .optional(),
      )
      .query(({ input }) => listApprovalQueues(input)),
    listQueueAnalytics: publicProcedure.query(() => listQueueAnalytics()),
    listMiddleware: publicProcedure.query(() => listMiddlewareComponents()),
    listServices: publicProcedure.query(() => listServiceTopology()),
    listParity: publicProcedure.query(() => listParityState()),
    updateCaseStage: publicProcedure
      .input(
        z.object({
          caseId: z.string(),
          stage: z.enum([
            "intake",
            "spatial_clearance",
            "technical_review",
            "environmental_review",
            "agency_coordination",
            "payment_pending",
            "approval",
            "issued",
            "active_monitoring",
          ]),
        }),
      )
      .mutation(({ input }) => updatePermitCaseStage(input)),
    updateFormSections: publicProcedure
      .input(
        z.object({
          caseId: z.string(),
          actorRole: z.enum(["applicant", "mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"]).optional(),
          summary: z.string().nullable().optional(),
          formSections: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              description: z.string(),
              fields: z.array(
                z.object({
                  key: z.string(),
                  label: z.string(),
                  value: z.string(),
                  required: z.boolean(),
                  fieldType: z.enum(["text", "textarea", "number", "date"]),
                  source: z.enum(["manual", "ai"]),
                }),
              ),
            }),
          ),
        }),
      )
      .mutation(({ input }) => updatePermitFormSections(input)),
    addReviewNote: publicProcedure
      .input(
        z.object({
          caseId: z.string(),
          author: z.string(),
          role: z.enum(["applicant", "mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"]),
          agencyId: z.string().nullable(),
          decision: z.enum(["comment", "needs_changes", "approved"]),
          note: z.string().min(3),
        }),
      )
      .mutation(({ input }) => appendPermitReviewNote(input)),
    extractDocumentToForm: publicProcedure
      .input(
        z.object({
          caseId: z.string(),
          documentName: z.string(),
          documentText: z.string().min(20),
        }),
      )
      .mutation(({ input }) => extractPermitDocumentToForm(input)),
    uploadDocumentAndExtract: publicProcedure
      .input(
        z.object({
          caseId: z.string(),
          fileName: z.string(),
          mimeType: z.string(),
          base64Data: z.string().min(32),
          uploadedByRole: z.enum(["applicant", "mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"]),
        }),
      )
      .mutation(({ input }) => uploadPermitDocumentAndExtract(input)),
    exportAuditHistory: publicProcedure
      .input(
        z.object({
          caseId: z.string(),
          format: z.enum(["markdown", "csv"]),
        }),
      )
      .query(({ input }) => exportPermitAuditHistory(input)),
    overrideAssignment: publicProcedure
      .input(
        z.object({
          caseId: z.string(),
          assignedUserId: z.string(),
          actorName: z.string(),
          actorRole: z.enum(["applicant", "mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"]),
          reason: z.string().min(3),
        }),
      )
      .mutation(({ input }) => overridePermitAssignment(input)),
    advanceHandoff: publicProcedure
      .input(
        z.object({
          caseId: z.string(),
          handoffId: z.string(),
          actorName: z.string(),
          actorRole: z.enum(["applicant", "mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"]),
          action: z.enum(["accept", "complete", "escalate"]),
          note: z.string().min(3),
        }),
      )
      .mutation(({ input }) => advancePermitHandoff(input)),
    verifyAuditPackage: publicProcedure
      .input(
        z.object({
          caseId: z.string().optional(),
          fileName: z.string(),
          content: z.string().min(10),
          sha256: z.string().min(32),
          signature: z.string().min(32),
        }),
      )
      .mutation(({ input }) => verifyAuditPackage(input)),
    getAuditVerificationKey: publicProcedure.query(() => getAuditVerificationKey()),
    listSigningKeys: publicProcedure.query(() => listSigningKeys()),
    revokeSigningKey: publicProcedure
      .input(
        z.object({
          keyId: z.string(),
          reason: z.string().min(3),
          actorName: z.string(),
        }),
      )
      .mutation(({ input }) => revokeSigningKey(input)),
    getCustodyTimeline: publicProcedure
      .input(z.object({ caseId: z.string() }))
      .query(({ input }) => getPermitCustodyTimeline(input.caseId)),
    listReminderQueue: publicProcedure
      .input(z.object({ role: z.enum(["applicant", "mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"]).optional() }).optional())
      .query(({ input }) => listReminderQueue(input?.role)),
    listSupervisorDigests: publicProcedure.query(() => listSupervisorDigests()),
    listSupervisorExceptionAnalytics: publicProcedure.query(() => listSupervisorExceptionAnalytics()),
  }),
  onboarding: router({
    getProfile: publicProcedure.query(() => getMobilePlatformBundle().onboarding),
    submitBusinessProfile: publicProcedure.input(businessProfileSchema).mutation(({ input }) => submitBusinessProfile(input)),
    analyzeIdentityDocument: publicProcedure
      .input(
        z.object({
          type: z.string(),
          fileName: z.string(),
          mimeType: z.string(),
          base64Data: z.string().min(32),
        }),
      )
      .mutation(async ({ input }) => {
        const analysis = await analyzeDocumentImage({ ...input, documentType: input.type });
        const document = appendIdentityDocument({
          id: `identity-${Date.now()}`,
          type: input.type,
          fileName: input.fileName,
          status: analysis.status,
          extractedSummary: analysis.summary,
          confidence: analysis.confidence,
          engine: analysis.engine,
          analysisProvenance: analysis.provenance,
          analysisReason: analysis.reason,
          uploadedAt: new Date().toISOString(),
        });

        return {
          analysis,
          document,
          onboarding: getMobilePlatformBundle().onboarding,
        };
      }),
    analyzeBusinessDocument: publicProcedure
      .input(
        z.object({
          type: z.string(),
          fileName: z.string(),
          mimeType: z.string(),
          base64Data: z.string().min(32),
        }),
      )
      .mutation(async ({ input }) => {
        const analysis = await analyzeDocumentImage({ ...input, documentType: input.type });
        const document = appendBusinessDocument({
          id: Date.now(),
          type: input.type,
          fileName: input.fileName,
          documentUrl: null,
          status: analysis.status,
          engine: analysis.engine,
          confidence: analysis.confidence,
          extractedSummary: analysis.summary,
          analysisProvenance: analysis.provenance,
          analysisReason: analysis.reason,
          uploadedAt: new Date().toISOString(),
        });

        return {
          analysis,
          document,
          onboarding: getMobilePlatformBundle().onboarding,
        };
      }),
    startLiveness: publicProcedure.mutation(() => startLivenessSession()),
    completeLiveness: publicProcedure
      .input(
        z.object({
          sessionId: z.string(),
          mimeType: z.string(),
          base64Data: z.string().min(32),
          framesAnalyzed: z.number().int().min(1).default(5),
        }),
      )
      .mutation(async ({ input }) => {
        const analysis = await analyzeLivenessSelfie({
          mimeType: input.mimeType,
          base64Data: input.base64Data,
        });

        const session = completeLivenessSession({
          sessionId: input.sessionId,
          status: analysis.status,
          framesAnalyzed: input.framesAnalyzed,
          motionScore: analysis.motionScore,
          faceQualityScore: analysis.faceQualityScore,
          faceMatchScore: analysis.faceMatchScore,
          confidence: analysis.confidence,
          spoofDetected: analysis.spoofDetected,
          failureReason: analysis.status === "unavailable" ? analysis.notes || "service_unavailable" : null,
          verificationMethod: analysis.verificationMethod,
          availabilityReason: analysis.availabilityReason,
        });

        return {
          analysis,
          session,
          onboarding: getMobilePlatformBundle().onboarding,
        };
      }),
    approveIdentityDocument: publicProcedure.input(z.object({ documentId: z.string() })).mutation(({ input }) => approveIdentityDocument(input)),
  }),
  legal: router({
    list: publicProcedure.query(() => listLegalWorkflows()),
    advance: publicProcedure
      .input(
        z.object({
          workflowId: z.string(),
          status: z.enum(["draft", "pending_review", "approved", "signed", "registered", "rejected"]),
          reviewedBy: z.string().nullable().optional(),
          registryReference: z.string().min(3).nullable().optional(),
        }),
      )
      .mutation(({ input }) => updateLegalWorkflowStatus(input)),
    approveFromInbox: publicProcedure
      .input(
        z.object({
          workflowId: z.string(),
          reviewedBy: z.string().nullable().optional(),
        }),
      )
      .mutation(({ input }) => updateLegalWorkflowStatus({ workflowId: input.workflowId, status: "approved", reviewedBy: input.reviewedBy })),
  }),
});

export type AppRouter = typeof appRouter;
