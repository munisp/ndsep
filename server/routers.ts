import { z } from "zod";

import { getSessionCookieOptions } from "./_core/cookies";
import { COOKIE_NAME } from "../shared/const";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  analyzeDocumentImage,
  analyzeLivenessSelfie,
  appendBusinessDocument,
  appendIdentityDocument,
  completeLivenessSession,
  getMobilePlatformBundle,
  listLegalWorkflows,
  startLivenessSession,
  submitBusinessProfile,
  syncBundleMutation,
  updateLegalWorkflowStatus,
  updateMissionStatus,
} from "./mobilePlatformRepository";

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
      status: z.enum(["pending", "verified", "rejected", "requires_review"]),
      engine: z.enum(["paddleocr", "vlm", "docling", "tesseract_fallback", "manual"]).optional(),
      confidence: z.number().nullable().optional(),
      extractedSummary: z.string().nullable().optional(),
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
  onboarding: router({
    getProfile: publicProcedure.query(() => getMobilePlatformBundle().onboarding),
    submitBusinessProfile: publicProcedure
      .input(businessProfileSchema)
      .mutation(({ input }) => submitBusinessProfile(input)),
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
          failureReason: analysis.status === "failed" ? analysis.notes || "low_confidence" : null,
        });

        return {
          analysis,
          session,
          onboarding: getMobilePlatformBundle().onboarding,
        };
      }),
  }),
  legal: router({
    list: publicProcedure.query(() => listLegalWorkflows()),
    advance: publicProcedure
      .input(
        z.object({
          workflowId: z.string(),
          status: z.enum(["draft", "pending_review", "approved", "signed", "registered", "rejected"]),
          reviewedBy: z.string().nullable().optional(),
        }),
      )
      .mutation(({ input }) => updateLegalWorkflowStatus(input)),
  }),
});

export type AppRouter = typeof appRouter;
