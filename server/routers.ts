import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { getSessionCookieOptions } from "./_core/cookies";
import { COOKIE_NAME } from "../shared/const";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, enterpriseProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { assertEnterpriseRole, type EnterpriseAgencyRole } from "./_core/enterpriseAuth";
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
  replayStakeholderSubmission,
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
import { getProviderHealth, verifyBusinessRegistration, verifyNationalIdentity, verifyRegistryTitle } from "./trustProviders";
import { INTEGRATION_FIELDS, getConfiguredIntegrationValue, getIntegrationSettingsStatus, saveIntegrationSettings } from "./integrationSettingsRepository";
import { listSecurityAuditEvents, recordSiemCorrelationOpen } from "./securityOperations";
import { acknowledgeFieldEvidenceEscalation, assignFieldEvidenceSupervisor, escalateFieldEvidence, listFieldEvidence, recordFieldEvidence, reviewFieldEvidence } from "./fieldEvidenceRepository";
import { exportLocalPolicyHistoryPdf, listLocalPolicies, updateLocalPolicy } from "./localPolicyRepository";
import { acknowledgeHighRiskReconciliationAlert, getOfflinePaymentSummary, getPaymentGatewayOperationalHealth, getReconciliationRetryOutcomeTrend, listHighRiskReconciliationAlerts, listPaymentAlerts, listPaymentAuditEvents, listPaymentReconciliationExceptions, listPaymentStateApprovalPolicies, listPendingOfflinePayments, listReceiptScanHistory, markPaymentAlertRead, PAYMENT_APPROVAL_ROLES, PAYMENT_JURISDICTIONS, processDueGatewayVerificationRetries, processDueHighRiskAlertEscalations, recordPaymentAuditExport, recordReconciliationExceptionExport, resolvePaymentReconciliationException, reviewOfflinePayment, submitOfflinePayment, triggerManualGatewayVerificationRetry, updatePaymentStateApprovalPolicy, verifyReceiptAndRecordScan } from "./offlinePaymentRepository";
import { getGatewayActivationStatus } from "./paymentGatewayConfig";
import { attestDiagnosticExport, getDiagnosticAttestationStatus } from "./diagnosticExportAttestation";
import { bulkRevokeDiagnosticAttestations, exportDiagnosticAttestations, getDiagnosticAttestationDetail, getDiagnosticAttestationStatusByReceiptId, listDiagnosticAttestations, listReceiptRevocationNotifications, markReceiptRevocationNotificationRead, revokeDiagnosticAttestation, setReceiptRevocationNotificationArchive } from "./diagnosticAttestationRepository";
import { approveRecoveryAuthorization, completeEnrollment, createRecoveryAuthorization, generateEnrollmentChallenge, getRecoveryAuthorization, getRecoveryControllerStatus, listEnrolledCredentials, listRecoveryAuditEvents, revokeCredential, verifyRecoveryAuditChain, type RecoveryApproverRole } from "./recoveryRepository";

import type { RegistrationResponseJSON as ServerRegistrationResponseJSON } from "@simplewebauthn/server";

const PERMIT_AGENCY_ROLES = ["applicant", "mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"] as const;
type PermitAgencyRole = (typeof PERMIT_AGENCY_ROLES)[number];

function currentPermitRole(roles: EnterpriseAgencyRole[]): PermitAgencyRole {
  const role = roles.find((candidate): candidate is PermitAgencyRole => (PERMIT_AGENCY_ROLES as readonly string[]).includes(candidate));
  if (!role) throw new TRPCError({ code: "FORBIDDEN", message: "The authenticated enterprise role is not permitted to perform permit-workflow actions." });
  return role;
}

const registrationResponseSchema = z.object({
  id: z.string().min(1).max(2048),
  rawId: z.string().min(1).max(2048),
  type: z.literal("public-key"),
  response: z.object({
    attestationObject: z.string().min(1).max(65_536),
    clientDataJSON: z.string().min(1).max(16_384),
    transports: z.array(z.string()).optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: z.string().optional(),
    authenticatorData: z.string().optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()),
  authenticatorAttachment: z.string().optional(),
});

const recoveryAssertionSchema = z.object({
  id: z.string().min(1).max(2048),
  rawId: z.string().min(1).max(2048),
  type: z.literal("public-key"),
  response: z.object({
    authenticatorData: z.string().min(1).max(16_384),
    clientDataJSON: z.string().min(1).max(16_384),
    signature: z.string().min(1).max(16_384),
    userHandle: z.string().max(2048).optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()),
});

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
      analysisProvenance: z.enum(["model_assisted", "document_intelligence", "manual_review", "unavailable"]).optional(),
      analysisReason: z.string().nullable().optional(),
      uploadedAt: z.string(),
    }),
  ),
});
const stakeholderReplaySchema = z.object({
  idempotencyKey: z.string().uuid(),
  payload: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("profile"), profile: businessProfileSchema }),
    z.object({ kind: z.literal("identity_document"), type: z.string().min(1), fileName: z.string().min(1), mimeType: z.string().min(1), base64Data: z.string().min(32) }),
    z.object({ kind: z.literal("business_document"), type: z.string().min(1), fileName: z.string().min(1), mimeType: z.string().min(1), base64Data: z.string().min(32) }),
  ]),
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
  fieldEvidence: router({
    list: publicProcedure.input(z.object({ missionId: z.string().optional() }).optional()).query(({ input }) => listFieldEvidence(input?.missionId)),
    record: publicProcedure
      .input(z.object({
        id: z.string().min(8),
        missionId: z.string().min(1),
        parcelId: z.number().int().positive(),
        observationType: z.enum(["boundary_marker", "occupancy", "encroachment", "infrastructure", "community_engagement", "other"]),
        notes: z.string().min(3).max(5000),
        capturedAt: z.string(),
        coordinateSource: z.enum(["parcel_reference", "operator_entered", "unavailable"]),
        latitude: z.number().nullable(),
        longitude: z.number().nullable(),
        attachmentCount: z.number().int().min(0),
        attachments: z.array(z.object({
          id: z.string().min(8),
          kind: z.enum(["photo", "file"]),
          name: z.string().min(1).max(200),
          mimeType: z.string().nullable(),
          size: z.number().int().nonnegative().nullable(),
          localUri: z.string().min(1),
          persistence: z.enum(["app_document_directory", "browser_session"]),
          capturedAt: z.string(),
        })).max(10),
        verificationState: z.literal("unverified"),
        origin: z.enum(["offline_queue", "online"]),
      }))
      .mutation(({ input }) => recordFieldEvidence(input)),
    review: adminProcedure
      .input(z.object({ id: z.string().min(8), decision: z.enum(["approved", "rejected"]), reason: z.string().min(3).max(2000) }))
      .mutation(({ ctx, input }) => reviewFieldEvidence({ ...input, reviewer: ctx.user.openId })),
    assign: adminProcedure
      .input(z.object({ id: z.string().min(8), supervisor: z.string().min(3).max(200) }))
      .mutation(({ ctx, input }) => assignFieldEvidenceSupervisor({ ...input, assignedBy: ctx.user.openId })),
    escalate: adminProcedure.input(z.object({ id: z.string().min(8) })).mutation(({ ctx, input }) => escalateFieldEvidence({ ...input, escalatedBy: ctx.user.openId })),
    acknowledgeEscalation: adminProcedure.input(z.object({ id: z.string().min(8), status: z.enum(["acknowledged", "resolved"]), note: z.string().min(3).max(2000), owner: z.string().min(2).max(200).optional(), handoffDate: z.string().nullable().optional() })).mutation(({ ctx, input }) => acknowledgeFieldEvidenceEscalation({ ...input, owner: input.owner ?? ctx.user.openId, handoffDate: input.handoffDate ?? null, updatedBy: ctx.user.openId })),
  }),
  localPolicy: router({
    list: publicProcedure.query(() => listLocalPolicies()),
    exportPdf: adminProcedure.mutation(() => exportLocalPolicyHistoryPdf()),
    update: adminProcedure
      .input(z.object({ jurisdiction: z.enum(["lagos", "fct", "kano", "ogun", "rivers"]), slaHours: z.number().int().min(1).max(720), checklist: z.array(z.string().min(3).max(300)).min(1).max(12), reason: z.string().min(3).max(1000) }))
      .mutation(({ ctx, input }) => updateLocalPolicy({ ...input, updatedBy: ctx.user.openId })),
  }),
  paymentOperations: router({
    gatewayActivation: adminProcedure.input(z.object({ provider: z.enum(["paystack", "flutterwave"]).optional() })).query(({ input }) => getGatewayActivationStatus(input.provider)),
    gatewayHealth: adminProcedure.query(() => getPaymentGatewayOperationalHealth()),
    reconciliationRetryTrend: adminProcedure.input(z.object({ days: z.number().int().min(1).max(31).default(7) })).query(({ input }) => getReconciliationRetryOutcomeTrend(input.days)),
    recordReconciliationExport: adminProcedure.input(z.object({ status: z.string(), retryOnly: z.boolean(), rowCount: z.number().int().min(0) })).mutation(({ ctx, input }) => recordReconciliationExceptionExport({ ...input, actorOpenId: ctx.user.openId })),
    highRiskReconciliationAlerts: enterpriseProcedure.input(z.object({ role: z.enum(PAYMENT_APPROVAL_ROLES), limit: z.number().int().min(1).max(100).default(50) })).query(({ ctx, input }) => { assertEnterpriseRole(ctx.enterprise, [input.role]); return listHighRiskReconciliationAlerts(input.role, input.limit); }),
    acknowledgeHighRiskAlert: enterpriseProcedure.input(z.object({ alertId: z.string().uuid(), role: z.enum(PAYMENT_APPROVAL_ROLES) })).mutation(({ ctx, input }) => { assertEnterpriseRole(ctx.enterprise, [input.role]); return acknowledgeHighRiskReconciliationAlert({ ...input, actorOpenId: ctx.user!.openId }); }),
    processDueRetries: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(50).default(10) })).mutation(({ input }) => processDueGatewayVerificationRetries(input.limit)),
    processDueHighRiskEscalations: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(50) })).mutation(({ input }) => processDueHighRiskAlertEscalations(input.limit)),
    triggerManualRetry: adminProcedure.input(z.object({ deliveryId: z.string().uuid() })).mutation(({ ctx, input }) => triggerManualGatewayVerificationRetry({ ...input, actorOpenId: ctx.user.openId })),
    reconciliationExceptions: adminProcedure.input(z.object({ status: z.enum(["open", "resolved", "dismissed", "all"]).default("open"), limit: z.number().int().min(1).max(500).default(100) })).query(({ input }) => listPaymentReconciliationExceptions(input)),
    resolveReconciliationException: adminProcedure.input(z.object({ deliveryId: z.string().uuid(), decision: z.enum(["resolved", "dismissed"]), note: z.string().min(3).max(2000) })).mutation(({ ctx, input }) => resolvePaymentReconciliationException({ ...input, actorOpenId: ctx.user.openId })),
    statePolicies: adminProcedure.query(() => listPaymentStateApprovalPolicies()),
    updateStatePolicy: adminProcedure
      .input(z.object({ jurisdiction: z.enum(PAYMENT_JURISDICTIONS), highValueThresholdKobo: z.number().int().positive(), firstApproverRole: z.enum(PAYMENT_APPROVAL_ROLES), secondApproverRole: z.enum(PAYMENT_APPROVAL_ROLES) }))
      .mutation(({ ctx, input }) => updatePaymentStateApprovalPolicy({ ...input, updatedBy: ctx.user.openId })),
    submitOfflinePayment: protectedProcedure
      .input(z.object({ jurisdiction: z.enum(PAYMENT_JURISDICTIONS), reference: z.string().min(3).max(120), amountKobo: z.number().int().positive(), service: z.string().min(3).max(200), evidenceDescription: z.string().min(3).max(2000) }))
      .mutation(({ ctx, input }) => submitOfflinePayment({ ...input, applicantOpenId: ctx.user.openId, applicantName: ctx.user.name ?? null })),
    myAlerts: protectedProcedure.query(({ ctx }) => listPaymentAlerts(ctx.user.openId)),
    markAlertRead: protectedProcedure.input(z.object({ alertId: z.string().min(8) })).mutation(({ ctx, input }) => markPaymentAlertRead({ applicantOpenId: ctx.user.openId, alertId: input.alertId })),
    pendingSummary: adminProcedure.query(() => getOfflinePaymentSummary()),
    listPending: adminProcedure.query(() => listPendingOfflinePayments()),
    review: enterpriseProcedure
      .input(z.object({ paymentId: z.string().min(8), decision: z.enum(["approved", "rejected"]), reviewerRole: z.enum(PAYMENT_APPROVAL_ROLES), reason: z.string().min(3).max(2000) }))
      .mutation(({ ctx, input }) => { assertEnterpriseRole(ctx.enterprise, [input.reviewerRole]); return reviewOfflinePayment({ ...input, reviewerOpenId: ctx.user!.openId }); }),
    verifyReceiptAndLog: adminProcedure.input(z.object({ reference: z.string().min(3).max(500) })).mutation(({ ctx, input }) => verifyReceiptAndRecordScan({ ...input, scannedBy: ctx.user.openId })),
    scanHistory: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(25) })).query(({ ctx, input }) => listReceiptScanHistory(ctx.user.openId, input.limit)),
    auditEvents: adminProcedure
      .input(z.object({ aggregateType: z.string().min(1).max(80).nullable().optional(), eventType: z.string().min(1).max(120).nullable().optional(), actorOpenId: z.string().min(1).max(255).nullable().optional(), from: z.string().datetime().nullable().optional(), to: z.string().datetime().nullable().optional(), limit: z.number().int().min(1).max(500).default(100) }))
      .query(({ input }) => listPaymentAuditEvents(input)),
    exportAuditEvents: adminProcedure
      .input(z.object({ aggregateType: z.string().min(1).max(80).nullable().optional(), eventType: z.string().min(1).max(120).nullable().optional(), actorOpenId: z.string().min(1).max(255).nullable().optional(), from: z.string().datetime().nullable().optional(), to: z.string().datetime().nullable().optional() }))
      .mutation(async ({ ctx, input }) => {
        const events = await listPaymentAuditEvents({ ...input, limit: 500 });
        const escape = (value: string | number | null) => `"${String(value ?? "").replace(/"/g, '""')}"`;
        const header = "event_id,aggregate_type,aggregate_id,sequence_number,event_type,actor_open_id,occurred_at,previous_event_hash,event_hash,payload_json";
        const rows = events.map((event) => [event.eventId, event.aggregateType, event.aggregateId, event.sequenceNumber, event.eventType, event.actorOpenId, event.occurredAt, event.previousEventHash, event.eventHash, JSON.stringify(event.payload)].map(escape).join(","));
        const exported = await recordPaymentAuditExport({ actorOpenId: ctx.user.openId, filter: input, rowCount: events.length });
        return { filename: `payment-audit-events-${exported.occurredAt.slice(0, 10)}.csv`, csv: [header, ...rows].join("\n"), rowCount: events.length, exportedAt: exported.occurredAt };
      }),
  }),
  trust: router({
    providerHealth: publicProcedure.query(() => getProviderHealth()),
    verifyNationalIdentity: enterpriseProcedure
      .input(z.object({ nin: z.string().min(11), legalName: z.string().nullable().optional(), dateOfBirth: z.string().nullable().optional() }))
      .mutation(({ ctx, input }) => {
        assertEnterpriseRole(ctx.enterprise, ["mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"]);
        return verifyNationalIdentity(input);
      }),
    verifyBusinessRegistration: enterpriseProcedure
      .input(z.object({ rcNumber: z.string().min(3), companyName: z.string().nullable().optional() }))
      .mutation(({ ctx, input }) => {
        assertEnterpriseRole(ctx.enterprise, ["mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"]);
        return verifyBusinessRegistration(input);
      }),
    verifyRegistryTitle: enterpriseProcedure
      .input(z.object({ state: z.string().min(2), registryReference: z.string().min(3), parcelNumber: z.string().nullable().optional() }))
      .mutation(({ ctx, input }) => {
        assertEnterpriseRole(ctx.enterprise, ["planning_supervisor"]);
        return verifyRegistryTitle(input);
      }),
  }),
  integrationSettings: router({
    status: publicProcedure.query(() => getIntegrationSettingsStatus()),
    save: adminProcedure
      .input(z.object(Object.fromEntries(INTEGRATION_FIELDS.map((field) => [field, z.string().max(5000).optional()]))))
      .mutation(({ ctx, input }) => saveIntegrationSettings(input, ctx.user.openId)),
    audit: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(250).default(100) })).query(({ input }) => listSecurityAuditEvents(input.limit)),
    openSiemCorrelation: adminProcedure.input(z.object({ auditEventId: z.string().uuid() })).mutation(({ ctx, input }) => {
      const template = getConfiguredIntegrationValue("SIEM_CORRELATION_URL_TEMPLATE")?.trim(); const allowlist = (getConfiguredIntegrationValue("SECURITY_TELEMETRY_ALLOWED_HOSTS") ?? process.env.SECURITY_TELEMETRY_ALLOWED_HOSTS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
      if (!template || !template.includes("{eventId}")) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "SIEM correlation is not configured." });
      const url = new URL(template.replaceAll("{eventId}", encodeURIComponent(input.auditEventId))); if (url.protocol !== "https:" || !allowlist.includes(url.hostname.toLowerCase())) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "SIEM correlation endpoint is not allowlisted." });
      const audit = recordSiemCorrelationOpen({ actor: ctx.user.openId, auditEventId: input.auditEventId, destinationHost: url.hostname }); return { url: url.toString(), audit };
    }),
  }),
  recovery: router({
    status: protectedProcedure.query(() => getRecoveryControllerStatus()),
    enrollmentChallenge: enterpriseProcedure.mutation(async ({ ctx }) => generateEnrollmentChallenge(ctx.enterprise)),
    completeEnrollment: enterpriseProcedure
      .input(z.object({ response: registrationResponseSchema, expectedChallenge: z.string().min(16).max(512) }))
      .mutation(async ({ ctx, input }) => {
        const response = input.response as unknown as ServerRegistrationResponseJSON;
        return completeEnrollment(ctx.enterprise, response, input.expectedChallenge);
      }),
    credentials: enterpriseProcedure.query(async ({ ctx }) => listEnrolledCredentials(ctx.enterprise.subject)),
    revokeCredential: enterpriseProcedure
      .input(z.object({ credentialId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => revokeCredential(ctx.enterprise, input.credentialId)),
    authorization: enterpriseProcedure
      .input(z.object({ authorizationId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const authorization = await getRecoveryAuthorization(input.authorizationId);
        if (!authorization) return null;
        const isApprover = ctx.enterprise.agencyRoles.some((role) => role === "security_engineer" || role === "planning_supervisor");
        if (authorization.ownerSubject !== ctx.enterprise.subject && !isApprover) throw new TRPCError({ code: "FORBIDDEN", message: "Recovery authorization visibility is limited to the request owner and designated recovery approvers." });
        return authorization;
      }),
    request: enterpriseProcedure
      .input(z.object({ queueId: z.string().min(1).max(512), payloadHash: z.string().regex(/^[a-f0-9]{64}$/i), idempotencyKey: z.string().uuid(), targetDeviceFingerprint: z.string().regex(/^[a-f0-9]{64}$/i), kmsCiphertext: z.string().min(24).max(32_768) }))
      .mutation(async ({ ctx, input }) => createRecoveryAuthorization({ principal: ctx.enterprise, ...input, payloadHash: input.payloadHash.toLowerCase(), targetDeviceFingerprint: input.targetDeviceFingerprint.toLowerCase() })),
    approve: enterpriseProcedure
      .input(z.object({ authorizationId: z.string().uuid(), approvalRole: z.enum(["security_engineer", "planning_supervisor"]), assertion: recoveryAssertionSchema }))
      .mutation(async ({ ctx, input }) => approveRecoveryAuthorization({ principal: ctx.enterprise, authorizationId: input.authorizationId, approvalRole: input.approvalRole as RecoveryApproverRole, assertion: input.assertion })),
    auditTimeline: enterpriseProcedure
      .input(z.object({ authorizationId: z.string().uuid(), limit: z.number().int().min(1).max(500).default(100) }))
      .query(async ({ ctx, input }) => {
        const isApprover = ctx.enterprise.agencyRoles.some((role) => role === "security_engineer" || role === "planning_supervisor");
        if (!isApprover) throw new TRPCError({ code: "FORBIDDEN", message: "Recovery audit visibility is limited to designated recovery approvers." });
        const events = await listRecoveryAuditEvents(input.authorizationId, input.limit);
        const integrity = verifyRecoveryAuditChain(events);
        return { events, integrity };
      }),
  }),
  diagnosticExports: router({
    attestationStatus: publicProcedure.query(() => getDiagnosticAttestationStatus()),
    receiptStatus: publicProcedure.input(z.object({ receiptId: z.string().uuid() })).query(({ input }) => getDiagnosticAttestationStatusByReceiptId(input.receiptId)),
    listAttestations: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(250).default(100), query: z.string().max(255).optional(), status: z.enum(["all", "active", "revoked"]).default("all"), from: z.string().datetime().nullable().optional(), to: z.string().datetime().nullable().optional() })).query(({ input }) => listDiagnosticAttestations(input)),
    attestationDetail: adminProcedure.input(z.object({ receiptId: z.string().uuid() })).query(({ input }) => getDiagnosticAttestationDetail(input.receiptId)),
    revokeAttestation: adminProcedure.input(z.object({ receiptId: z.string().uuid(), reason: z.string().min(3).max(1000) })).mutation(({ ctx, input }) => revokeDiagnosticAttestation({ ...input, actorOpenId: ctx.user.openId })),
    bulkRevokeAttestations: adminProcedure.input(z.object({ receiptIds: z.array(z.string().uuid()).min(1).max(50), reason: z.string().min(3).max(1000) })).mutation(({ ctx, input }) => bulkRevokeDiagnosticAttestations({ ...input, actorOpenId: ctx.user.openId })),
    exportAttestations: adminProcedure.input(z.object({ receiptIds: z.array(z.string().uuid()).min(1).max(250) })).mutation(({ input }) => exportDiagnosticAttestations(input.receiptIds)),
    myRevocationNotifications: protectedProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(25), readStatus: z.enum(["all", "unread", "acknowledged"]).default("all"), archiveStatus: z.enum(["active", "archived", "all"]).default("active"), sort: z.enum(["newest", "oldest"]).default("newest") })).query(({ ctx, input }) => listReceiptRevocationNotifications({ ...input, recipientSubject: ctx.user.openId })),
    markRevocationNotificationRead: protectedProcedure.input(z.object({ notificationId: z.string().uuid() })).mutation(({ ctx, input }) => markReceiptRevocationNotificationRead({ ...input, recipientSubject: ctx.user.openId })),
    setRevocationNotificationArchive: protectedProcedure.input(z.object({ notificationId: z.string().uuid(), archived: z.boolean() })).mutation(({ ctx, input }) => setReceiptRevocationNotificationArchive({ ...input, recipientSubject: ctx.user.openId })),
    attest: protectedProcedure
      .input(z.object({ packageType: z.enum(["passphrase_encrypted", "administrative_public_key"]), packageSha256: z.string().regex(/^[a-f0-9]{64}$/i) }))
      .mutation(({ ctx, input }) => attestDiagnosticExport({ ...input, packageSha256: input.packageSha256.toLowerCase(), attestedForSubject: ctx.user.openId })),
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
    setActiveAgencyUser: enterpriseProcedure
      .input(z.object({ userId: z.string() }))
      .mutation(({ ctx, input }) => {
        assertEnterpriseRole(ctx.enterprise, ["planning_supervisor"]);
        return setActiveAgencyUser(input);
      }),
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
    updateCaseStage: enterpriseProcedure
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
      .mutation(({ ctx, input }) => {
        assertEnterpriseRole(ctx.enterprise, ["mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"]);
        return updatePermitCaseStage(input);
      }),
    updateFormSections: enterpriseProcedure
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
                  source: z.enum(["manual", "ai", "heuristic"]),
                }),
              ),
            }),
          ),
        }),
      )
      .mutation(({ ctx, input }) => {
        const actorRole = input.actorRole ?? currentPermitRole(ctx.enterprise.agencyRoles);
        assertEnterpriseRole(ctx.enterprise, [actorRole]);
        return updatePermitFormSections({ ...input, actorRole });
      }),
    addReviewNote: enterpriseProcedure
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
      .mutation(({ ctx, input }) => {
        assertEnterpriseRole(ctx.enterprise, ["mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"]);
        const role = currentPermitRole(ctx.enterprise.agencyRoles);
        return appendPermitReviewNote({
          ...input,
          author: ctx.user?.name ?? ctx.enterprise.subject,
          role,
          agencyId: ctx.enterprise.agencyId,
        });
      }),
    extractDocumentToForm: enterpriseProcedure
      .input(
        z.object({
          caseId: z.string(),
          documentName: z.string(),
          documentText: z.string().min(20),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnterpriseRole(ctx.enterprise, ["mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"]);
        return extractPermitDocumentToForm(input);
      }),
    uploadDocumentAndExtract: enterpriseProcedure
      .input(
        z.object({
          caseId: z.string(),
          fileName: z.string(),
          mimeType: z.string(),
          base64Data: z.string().min(32),
          uploadedByRole: z.enum(["applicant", "mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const role = currentPermitRole(ctx.enterprise.agencyRoles);
        assertEnterpriseRole(ctx.enterprise, [role]);
        return uploadPermitDocumentAndExtract({ ...input, uploadedByRole: role });
      }),
    exportAuditHistory: publicProcedure
      .input(
        z.object({
          caseId: z.string(),
          format: z.enum(["markdown", "csv"]),
        }),
      )
      .query(({ input }) => exportPermitAuditHistory(input)),
    overrideAssignment: enterpriseProcedure
      .input(
        z.object({
          caseId: z.string(),
          assignedUserId: z.string(),
          actorName: z.string(),
          actorRole: z.enum(["applicant", "mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"]),
          reason: z.string().min(3),
        }),
      )
      .mutation(({ ctx, input }) => {
        assertEnterpriseRole(ctx.enterprise, ["planning_supervisor"]);
        return overridePermitAssignment({ ...input, actorName: ctx.user?.name ?? ctx.enterprise.subject, actorRole: "planning_supervisor" });
      }),
    advanceHandoff: enterpriseProcedure
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
      .mutation(({ ctx, input }) => {
        const role = input.actorRole;
        assertEnterpriseRole(ctx.enterprise, [role]);
        return advancePermitHandoff({ ...input, actorName: ctx.user?.name ?? ctx.enterprise.subject });
      }),
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
    revokeSigningKey: enterpriseProcedure
      .input(
        z.object({
          keyId: z.string(),
          reason: z.string().min(3),
          actorName: z.string(),
        }),
      )
      .mutation(({ ctx, input }) => {
        assertEnterpriseRole(ctx.enterprise, ["planning_supervisor"]);
        return revokeSigningKey({ ...input, actorName: ctx.user?.name ?? ctx.enterprise.subject });
      }),
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
    replayStakeholderSubmission: publicProcedure.input(stakeholderReplaySchema).mutation(({ input }) => replayStakeholderSubmission(input)),
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
    approveIdentityDocument: enterpriseProcedure.input(z.object({ documentId: z.string() })).mutation(({ ctx, input }) => {
      assertEnterpriseRole(ctx.enterprise, ["mining_reviewer", "petroleum_reviewer", "environment_reviewer", "planning_supervisor"]);
      return approveIdentityDocument(input);
    }),
  }),
  legal: router({
    list: publicProcedure.query(() => listLegalWorkflows()),
    advance: enterpriseProcedure
      .input(
        z.object({
          workflowId: z.string(),
          status: z.enum(["draft", "pending_review", "approved", "signed", "registered", "rejected"]),
          reviewedBy: z.string().nullable().optional(),
          registryReference: z.string().min(3).nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        assertEnterpriseRole(ctx.enterprise, ["planning_supervisor"]);
        return updateLegalWorkflowStatus({ ...input, reviewedBy: ctx.user?.name ?? ctx.enterprise.subject });
      }),
    approveFromInbox: enterpriseProcedure
      .input(
        z.object({
          workflowId: z.string(),
          reviewedBy: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        assertEnterpriseRole(ctx.enterprise, ["planning_supervisor"]);
        return updateLegalWorkflowStatus({ workflowId: input.workflowId, status: "approved", reviewedBy: ctx.user?.name ?? ctx.enterprise.subject });
      }),
  }),
});

export type AppRouter = typeof appRouter;
