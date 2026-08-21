import crypto from "crypto";
import { z } from "zod";
import { generateRopaPdf } from "./ropaPdf";
import { storagePut } from "./storage";
import { workflowRouter } from "./routers/workflows";
import { publishPenaltyIssued, publishEnforcementCaseOpened, publishCitizenRightsRequest, kafkaSmokeTest, getKafkaProducerStatus, kafkaProduce } from "./kafka";
import { startWorkflow, describeWorkflow, listWorkflows as temporalListWorkflows, getTemporalConfig, temporalSmokeTest } from "./temporal";
import { dispatch as dispatchCommand } from "./cqrs/commandBus";
import { emitMutationEvent, EVENTS } from "./middlewareIntegration";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router, canAccessOrg, deleteProcedure, exportProcedure, approveProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { invokeLLM } from "./_core/llm";
import { notifyOwner } from "./_core/notification";
import {
  getDashboardStats, getOrganizations, getOrganizationById,
  getOrganizationWithDetails, getAssets, getAssetsByType,
  getCompliancePolicies, getComplianceViolations, getEnforcementActions,
  getDataCatalogEntries, getDataResidencyMap, getSecurityAlerts,
  getThreatIntelligence, getAuditLogs, getNetworkEvents, getNetworkStats,
  getFinancialPenalties, getPenaltySummary, getStreamingEvents,
  getStreamingTopicStats, getMlPredictions,
  listUsers, updateUserRole,
  createEnforcementAction, updateEnforcementStatus,
  createFinancialPenalty, updatePenaltyStatus, getOrganizationsForSelect,
  getBgpRoutes, getBgpStats, getBgpRouteHistory,
  getResidencyChecks, getResidencyStats,
  getLedgerTransactions, getLedgerSummary,
  getWorkersStatus,
  createPortalSubmission, getPortalSubmissions, getPortalSubmission, getPortalStats,
  createTransferApproval, getTransferApprovals, reviewTransferApproval, deleteTransferApproval,
  getMonitoringSnapshots, getSlaBreaches, getDriftAlerts, getMonitoringStats,
  getOrgScores, resolveDriftAlertById, resolveSlaBreachById,
  getAlertTrendByHour, getAlertTypeBreakdown,
  getNetworkTrafficByHour, getIxpSiteStats,
  getFinancialMonthlyTrend, getViolationTrendByWeek, getOrgRiskScores,
  reviewPortalSubmission,
  createPenaltyAppeal, getPenaltyAppeals, reviewPenaltyAppeal,
  getLeaderboard, getLeaderboardStats,
  getPortalSubmissionByCertToken, getPortalSubmissionById,
  getOrgScoreTrend,
  getSectorAvgTrend,
  getPenaltyReceipt,
  getViolationsReport,
  getPenaltiesReport,
  getComplianceScoresReport,
  resolveSecurityAlert,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  createAsset,
  updateAsset,
  deleteAsset,
  createCatalogEntry,
  updateCatalogEntry,
  deleteCatalogEntry,
  createAuditLog,
  listPolicyTemplates, createPolicyTemplate, instantiatePolicyTemplate,
  listAiSystems, createAiSystem, updateAiSystem,
  listEvidencePackages, createEvidencePackage,
  listSectors, createSector, getSectorStats, getSectorBenchmark,
  listCitizenRequests, createCitizenRequest, updateCitizenRequest,
  listConfigSnapshots, createConfigSnapshot,
  listTiaAssessments, createTiaAssessment, updateTiaAssessment,
  listRemediationWorkflows, createRemediationWorkflow, updateRemediationWorkflow,
  blockNetworkIp, reportBgpHijack,
  getEnforcementCases, createEnforcementCase, updateEnforcementCase,
  getCaseTimeline, addCaseTimelineEntry,
  getExpiringCertificates, getHijackedBgpRoutes,
  getOnboardingPhases, updateOnboardingPhase, listOnboardingPhases,
  getNotificationSettings, upsertNotificationSettings,
  createInAppNotification, getInAppNotifications, markNotificationRead, markAllNotificationsRead, getUnreadNotificationCount,
  listConsentRecords, createConsentRecord, updateConsentRecord, getConsentStats,
  listBreachIncidents, createBreachIncident, updateBreachIncident,
  listDpoAppointments, createDpoAppointment, updateDpoAppointment,
  listDpiaAssessments, createDpiaAssessment, updateDpiaAssessment,
  listRopaRecords, createRopaRecord, updateRopaRecord,
  listRetentionPolicies, createRetentionPolicy, updateRetentionPolicy,
  listDpoReports, createDpoReport, updateDpoReport,
  listComplianceAuditReturns, createComplianceAuditReturn, updateComplianceAuditReturn,
  listAdequacyDeterminations, createAdequacyDetermination, updateAdequacyDetermination,
  listDataProcessingAgreements, createDataProcessingAgreement, updateDataProcessingAgreement,
  listPrivacyNotices, createPrivacyNotice, updatePrivacyNotice,
  listCookieConsentRecords, createCookieConsentRecord, getCookieConsentStats,
  listAutomatedDecisions, createAutomatedDecision, updateAutomatedDecision,
  listParentalConsents, createParentalConsent, updateParentalConsent,
  listStaffTraining, createStaffTraining, updateStaffTraining,
  listTransferInstruments, createTransferInstrument, updateTransferInstrument,
  listDataExportJobs, createDataExportJob, updateDataExportJob,
  listDcpmiThresholds, createDcpmiThreshold, evaluateDcpmiStatus, deleteDcpmiThreshold,
  getNdpaComplianceIndex, getBreachTimeline,
  getNdpaComplianceTrend, saveNdpaComplianceSnapshot,
  getBreachSlaHeatmap, generateAuditReturnData, getBreachesForDay,
  deleteConsentRecord,
  deleteBreachIncident,
  deleteDpoAppointment,
  deleteDpiaAssessment,
  deleteRopaRecord,
  deleteRetentionPolicy,
  deleteDpoReport,
  deleteComplianceAuditReturn,
  deleteAdequacyDetermination,
  deleteDataProcessingAgreement,
  deletePrivacyNotice,
  deleteCookieConsentRecord,
  deleteAutomatedDecision,
  deleteParentalConsent,
  deleteStaffTraining,
  deleteTransferInstrument,
  deleteDataExportJob,
  deleteAiSystem,
  deletePolicyTemplate,
  deleteEvidencePackage,
  deleteTiaAssessment,
  deleteRemediationWorkflow,
  deleteEnforcementCase,
  deleteCitizenRequest,
  deleteConfigSnapshot,
  getPool,
  listOrganizationUsers,
  getOrganizationUserByUserId,
  createOrganizationUser,
  updateOrganizationUserRole,
  deleteOrganizationUser,
  listSectorComplianceEvents,
  createSectorComplianceEvent,
  resolveSectorComplianceEvent,
  getSectorComplianceEventStats,
} from "./db";
import { requirePermission, permifyWriteRelationship } from "./permify";
import { sendCertificateGranted, sendPortalPhaseUpdate, sendAppealUpdate, sendPenaltyNotice, sendCitizenRequestUpdate, sendEnforcementCaseOpened } from "./emailNotification";
import { broadcast } from "./websocket";
import { cacheGet, cacheSet, cacheDel, cacheGetJson, cacheSetJson } from "./cache";
import { withCache, withSWR, CK, TTL, invalidateOrgCaches, invalidateComplianceCaches, invalidateCertificateCaches, invalidateAccreditationCaches, invalidateBgpCaches } from "./queryCache";
import { dpcoRouter } from "./routers/dpco";
import { billingRouter } from "./routers/billing";
import { pushRouter } from "./routers/push";
import { accreditationRouter } from "./routers/accreditation";
import { dpcoAiRouter } from "./routers/dpcoAi";
import { dsarRouter, dpiaRouter, aiGovernanceRouter, sectorBenchmarkRouter, webhookRouter, searchRouter, i18nRouter, carAutomationRouter, openApiRouter, aiSystemsRouter, auditLogsRouter, compliancePoliciesRouter, configSnapshotsRouter, dataCatalogRouter, dpcoAuditLogsRouter, dpcoPerformanceMetricsRouter, enforcementActionsRouter, evidencePackagesRouter, mlRiskPredictionsRouter, penaltyAppealsRouter, policyTemplatesRouter, streamingEventsDbRouter, threatIntelligenceRouter, tiaAssessmentsRouter, transferImpactRouter } from "./routers/enhancements";
import { daprPublish, daprStateSet } from "./dapr";
import { getActiveJurisdiction } from "./jurisdiction";
import { createTigerBeetleTransaction, getTigerBeetleBalance, isTigerBeetleHealthy } from "./tigerbeetle";
import { verifyKeycloakToken, isKeycloakHealthy, getKeycloakRealmInfo, mapKeycloakRoleToNdsep } from "./keycloak";
import { bankingServicesRouter } from "./routers/banking";
import {
  ndpaComplianceDashboardRouter,
  breachIncidentRouter,
  consentRecordRouter,
  dpoAppointmentRouter,
  publicRegistryRouter,
  penaltyCalculatorRouter,
  riskScorecardRouter,
  enforcementTimelineRouter,
  complianceCalendarRouter,
  notificationCenterRouter,
  advancedAnalyticsRouter,
  article40TrackerRouter,
  ndpaSnapshotsRouter,
} from "./routers/newFeatures";
import { telecomRouter } from "./routers/telecom";
import { livenessRouter } from "./routers/liveness";
import {
  smsAlertsRouter,
  pdfGenerationRouter,
  documentVaultRouter,
  aiRiskScoringRouter,
  apiKeyManagementRouter,
  webhookDeliveryRouter,
  crossSectorSharingRouter,
  retentionEnforcementRouter,
  certVerificationRouter,
  complianceRescoringRouter,
} from "./routers/productionFeatures";
import { healthcareRouter, energyRouter, insuranceRouter, fintechRouter } from "./routers/sectors";
import { widgetDashboardRouter, chatSupportRouter, tutorialRouter } from "./routers/phase5Features";
import { emailDigestRouter, onboardingChecklistRouter } from "./routers/phase6Features";
import { changelogRouter, sparklineRouter, themePrefsRouter } from "./routers/phase7Features";
import {
  qdrantRouter,
  knowledgeGraphRouter,
  ollamaRouter,
  artRouter,
  featureStoreRouter,
  modelRegistryRouter,
  anomalyAlertsRouter as aiAnomalyAlertsRouter,
  cocoIndexRouter,
  rssFeedRouter,
  aiHealthRouter,
  lakehouseAnalyticsRouter,
  mlProductionRouter,
  gnnRouter,
} from "./routers/aimlRouter";
import { wirediggRouter } from "./routers/wiredigg";
import { nocRouter } from "./routers/noc";
import { nocAgentRouter } from "./routers/nocAgent";
import { platformIntelligenceRouter } from "./routers/platformIntelligence";
import { changelogAdminRouter, complianceTrendRouter } from "./routers/phase8Features";
import {
  securityAuditRouter,
  anomalyAlertsRouter,
  rssRouter,
  trendCompareRouter,
  dsarLifecycleRouter,
  breachWorkflowRouter,
  consentAnalyticsRouter,
  auditExportRouter,
  sectorReportRouter,
  userManagementRouter,
  apiHealthRouter,
  leaderboardExportRouter,
  nipReconciliationRouter,
  transferAutoApprovalRouter,
  retentionSchedulerRouter,
  platformStatsRouter,
  transferApprovalRulesRouter } from "./routers/production9Features";
import { fluvioHealth, fluvioListTopics, fluvioProduce, fluvioSmokeTest } from "./fluvio";
import { apisixHealth, apisixListRoutes, apisixSyncNdsepRoutes, apisixSmokeTest } from "./apisix";
import { lakehouseHealth, lakehouseListTables, lakehouseQuery, lakehouseIngest, lakehouseSmokeTest } from "./lakehouse";
import {
  checkOrchestrationHealth,
  getOrchestrationStatus,
  j04_penaltyIssued,
  j05_penaltyPaid,
  j06_transferRequested,
  j14_riskScoreUpdated,
  j15_auditTrail,
  j17_certificateIssued,
  j18_revenueDistribution,
  j19_triggerWorkflow,
  j20_penaltyDisputed,
  j25_financialReconciliation,
} from "./orchestration";
import {
  rssFeedRouter as p11RssFeedRouter,
  dsarAutomationRouter,
  breachLifecycleRouter,
  certLifecycleRouter,
  sectorBenchmarkRouter as p11SectorBenchmarkRouter,
  sbomRouter,
  slaEnforcementRouter,
  complianceCalendarRouter as p11ComplianceCalendarRouter,
  finePaymentRouter,
  pwaRouter,
  onboardingAutomationRouter,
  apiGatewayRouter,
} from "./routers/phase11Features";
import { phase12Router } from "./routers/phase12Features";
import { phase13Router } from "./routers/phase13Features";
import { productionReadinessRouter } from "./routers/productionReadiness";
import { temporalRouter, searchRouter as opensearchRouter, wafRouter, gatewayRouter, authzRouter, kafkaMetricsRouter, ledgerRouter } from "./routers/middlewareWiring";
import { osirisIntelRouter } from "./routers/osirisIntel";
import { socintRouter } from "./routers/socint";
import { phantomTideRouter } from "./routers/phantomTide";
import { wazuhRouter } from "./routers/wazuh";
import { sigintRouter } from "./routers/sigint";
import { estoridesRouter } from "./routers/estorides";
import { getIntelSummary, getCrossplatformCorrelations, getNocThreatFeed, enrichBankingWithMaritime, enrichComplianceWithSiem } from "./intelAggregator";
import { logger } from "./logger";

export const appRouter = router({
  dpco: dpcoRouter,
  billing: billingRouter,
  push: pushRouter,
  accreditation: accreditationRouter,
  dpcoAi: dpcoAiRouter,
  dsar: dsarRouter,
  dpiaWizard: dpiaRouter,
  aiGovernanceScoring: aiGovernanceRouter,
  aiGovernance: aiSystemsRouter,
  sectorBenchmarks: sectorBenchmarkRouter,
  webhooks: webhookRouter,
  search: searchRouter,
  i18n: i18nRouter,
  carAutomation: carAutomationRouter,
  openApi: openApiRouter,
  aiSystems: aiSystemsRouter,
  auditLogs: auditLogsRouter,
  compliancePolicies: compliancePoliciesRouter,
  configSnapshots: configSnapshotsRouter,
  dataCatalog: dataCatalogRouter,
  dpcoAuditLogs: dpcoAuditLogsRouter,
  dpcoPerformanceMetrics: dpcoPerformanceMetricsRouter,
  enforcementActions: enforcementActionsRouter,
  evidencePackages: evidencePackagesRouter,
  mlRiskPredictions: mlRiskPredictionsRouter,
  penaltyAppeals: penaltyAppealsRouter,
  policyTemplates: policyTemplatesRouter,
  streamingEvents: streamingEventsDbRouter,
  threatIntelligence: threatIntelligenceRouter,
  osirisIntel: osirisIntelRouter,
  socint: socintRouter,
  phantomTide: phantomTideRouter,
  wazuh: wazuhRouter,
  sigint: sigintRouter,
  estorides: estoridesRouter,
  intelAggregator: router({
    summary: protectedProcedure.query(async () => getIntelSummary()),
    correlations: protectedProcedure.query(async () => getCrossplatformCorrelations()),
    nocFeed: protectedProcedure.query(async () => getNocThreatFeed()),
    enrichBanking: protectedProcedure
      .input(z.object({ entityName: z.string() }))
      .query(async ({ input }) => enrichBankingWithMaritime(input.entityName)),
    enrichCompliance: protectedProcedure.query(async () => enrichComplianceWithSiem()),
  }),
  tiaAssessments: tiaAssessmentsRouter,
  transferImpact: transferImpactRouter,
  system: systemRouter,
  banking: bankingServicesRouter,
  telecom: telecomRouter,
  liveness: livenessRouter,
  healthcare: healthcareRouter,
  energy: energyRouter,
  insurance: insuranceRouter,
  fintech: fintechRouter,
  workflows: workflowRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      // Blacklist the JWT token so it cannot be reused even before expiry
      if (ctx.user) {
        try {
          const cookieHeader = ctx.req.headers.cookie ?? "";
          const cookieMatch = cookieHeader.match(/ndsep_session=([^;]+)/);
          if (cookieMatch?.[1]) {
            const { sdk } = await import("./_core/sdk");
            const session = await sdk.verifySession(cookieMatch[1]);
            if (session?.jti && session?.exp) {
              const { blacklistToken } = await import("./sessionBlacklist");
              await blacklistToken(session.jti, session.exp);
            }
          }
        } catch (e) { logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[Auth] Token blacklist on logout failed (non-fatal)"); }
      }
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  dashboard: router({
    stats: protectedProcedure.query(async () =>
      withSWR(CK.dashboardStats(), TTL.DASHBOARD, TTL.DASHBOARD * 10, getDashboardStats)
    ),
    mlPredictions: protectedProcedure.query(async () =>
      withCache(CK.riskScore(0), TTL.RISK_SCORE, getMlPredictions)
    ),
    violationTrend: protectedProcedure.query(async () =>
      withCache("ndsep:dashboard:violation-trend", TTL.COMPLIANCE, getViolationTrendByWeek)
    ),
    orgRiskScores: protectedProcedure.query(async () =>
      withCache("ndsep:dashboard:org-risk-scores", TTL.RISK_SCORE, getOrgRiskScores)
    ),
    frameworkReport: protectedProcedure
      .input(z.object({ framework: z.string() }))
      .mutation(async ({ input }) => {
        const stats = await getDashboardStats();
        const violations = await getComplianceViolations(500);
        const orgs = await getOrganizations(100);
        const complianceRate = ((stats as Record<string, Record<string, unknown>> | null)?.orgStats?.avgScore as number) ?? 72;
        const criticalCount = (violations as Record<string, unknown>[]).filter((v: Record<string, unknown>) => v.severity === "critical").length;
        const highCount = (violations as Record<string, unknown>[]).filter((v: Record<string, unknown>) => v.severity === "high").length;
        const now = new Date().toISOString().split("T")[0];
        const reportData = {
          framework: input.framework,
          generatedAt: now,
          complianceRate: Math.round(complianceRate),
          totalOrganizations: (orgs as Record<string, unknown>[]).length,
          totalViolations: (violations as Record<string, unknown>[]).length,
          criticalFindings: criticalCount,
          highFindings: highCount,
          markdownReport: [
            `# NDSEP Framework Compliance Report`,
            `**Framework:** ${input.framework}  `,
            `**Generated:** ${now}  `,
            `**Authority:** NITDA / National Data Sovereignty Enforcement Platform`,
            ``,
            `---`,
            ``,
            `## Executive Summary`,
            ``,
            `This report presents the compliance posture of **${(orgs as Record<string, unknown>[]).length} registered organizations** against the **${input.framework}** framework as of ${now}.`,
            ``,
            `| Metric | Value |`,
            `|--------|-------|`,
            `| Overall Compliance Rate | ${Math.round(complianceRate)}% |`,
            `| Organizations Monitored | ${(orgs as Record<string, unknown>[]).length} |`,
            `| Open Violations | ${(violations as Record<string, unknown>[]).length} |`,
            `| Critical Findings | ${criticalCount} |`,
            `| High Severity Findings | ${highCount} |`,
            ``,
            `## Compliance Status`,
            ``,
            `The national average compliance score is **${Math.round(complianceRate)}%**. ` +
            (complianceRate >= 80 ? "The overall posture is **COMPLIANT** with minor gaps requiring attention." :
              complianceRate >= 60 ? "The overall posture is **PARTIALLY COMPLIANT** and requires remediation actions." :
              "The overall posture is **NON-COMPLIANT** and requires immediate enforcement action."),
            ``,
            `## Critical Findings`,
            ``,
            criticalCount === 0 ? "No critical findings at this time." :
              `There are **${criticalCount} critical violations** requiring immediate attention across monitored organizations.`,
            ``,
            `## Recommendations`,
            ``,
            `1. Organizations with compliance scores below 60% should be placed under enhanced monitoring.`,
            `2. Cross-border data transfers must be reviewed against ${input.framework} transfer controls.`,
            `3. All critical violations must be remediated within 30 days per NDPR enforcement guidelines.`,
            `4. Evidence packages should be generated for all compliant organizations to support audit trails.`,
            ``,
            `---`,
            `*This report was automatically generated by NDSEP. For official submissions, obtain a certified copy from NITDA.*`,
          ].join("\n"),
        };
        // Email the report summary to the platform owner
        notifyOwner({
          title: `[NDSEP] ${input.framework} Compliance Report — ${now}`,
          content: [
            `Framework: ${input.framework}`,
            `Generated: ${now}`,
            `Overall Compliance Rate: ${Math.round(complianceRate)}%`,
            `Organizations Monitored: ${(orgs as Record<string, unknown>[]).length}`,
            `Open Violations: ${(violations as Record<string, unknown>[]).length}`,
            `Critical Findings: ${criticalCount}`,
            `High Severity Findings: ${highCount}`,
            `Status: ${complianceRate >= 80 ? 'COMPLIANT' : complianceRate >= 60 ? 'PARTIALLY COMPLIANT' : 'NON-COMPLIANT'}`,
            ``,
            `Download the full report from the NDSEP Framework Dashboard.`,
          ].join("\n"),
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return reportData;
      }),
  }),
  organizations: router({
    list: protectedProcedure
      .input(z.object({ limit: z.number().default(50), offset: z.number().default(0) }).optional())
      .query(async ({ input }) => getOrganizations(input?.limit, input?.offset)),
    byId: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => getOrganizationById(input.id)),
    withDetails: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => getOrganizationWithDetails(input.id)),
    create: adminProcedure
      .input(z.object({
        name: z.string().min(1).max(256),
        sector: z.string().optional(),
        country: z.string().optional(),
        city: z.string().optional(),
        registrationNumber: z.string().optional(),
        contactEmail: z.string().email().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createOrganization(input);
        createAuditLog({ userId: ctx.user.id, action: "org.create", resourceType: "organization", resourceId: result?.id, details: `Created organization: ${input.name}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // Sync Permify — creator becomes org owner
        permifyWriteRelationship("organization", String(result?.id ?? 0), "owner", "user", String(ctx.user.id)).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "permify fire-and-forget"));
        emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "org.create", entityId: result?.id, orgName: input.name, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget"));
        return result;
      }),
    update: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).optional(),
        sector: z.string().optional(),
        country: z.string().optional(),
        city: z.string().optional(),
        complianceStatus: z.enum(["compliant", "non_compliant", "under_review", "remediation"]).optional(),
        contactEmail: z.string().email().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const result = await updateOrganization(id, data);
        createAuditLog({ userId: ctx.user.id, action: "org.update", resourceType: "organization", resourceId: id, details: `Updated organization #${id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteOrganization(input.id);
        createAuditLog({ userId: ctx.user.id, action: "org.delete", resourceType: "organization", resourceId: input.id, details: `Deleted organization #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),
  assets: router({
    list: protectedProcedure
      .input(z.object({ orgId: z.number().optional(), limit: z.number().default(50) }).optional())
      .query(async ({ input, ctx }) => {
        // Org admins can only see their own org's assets
        if (ctx.user && ctx.user.role === 'org_admin' && ctx.user.organizationId) {
          return getAssets(ctx.user.organizationId, input?.limit);
        }
        return getAssets(input?.orgId, input?.limit);
      }),
    byType: protectedProcedure.query(async () => getAssetsByType()),
    create: adminProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        name: z.string().min(1).max(256),
        assetType: z.enum(["hardware", "software", "cloud", "network", "database", "saas"]),
        ipAddress: z.string().optional(),
        hostname: z.string().optional(),
        location: z.string().optional(),
        isWithinBorders: z.boolean().default(true),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createAsset(input);
        createAuditLog({ userId: ctx.user.id, organizationId: input.organizationId, action: "asset.create", resourceType: "asset", resourceId: result?.id, details: `Created asset: ${input.name}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    update: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        name: z.string().optional(),
        status: z.enum(["active", "inactive", "quarantined", "decommissioned"]).optional(),
        isWithinBorders: z.boolean().optional(),
        location: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const result = await updateAsset(id, data);
        createAuditLog({ userId: ctx.user.id, action: "asset.update", resourceType: "asset", resourceId: id, details: `Updated asset #${id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteAsset(input.id);
        createAuditLog({ userId: ctx.user.id, action: "asset.delete", resourceType: "asset", resourceId: input.id, details: `Deleted asset #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),
  compliance: router({
    policies: protectedProcedure.query(async () => getCompliancePolicies()),
    violations: protectedProcedure
      .input(z.object({ limit: z.number().default(50), severity: z.string().optional() }).optional())
      .query(async ({ input, ctx }) => {
        // Org admins only see their own org's violations
        if (ctx.user && ctx.user.role === 'org_admin' && ctx.user.organizationId) {
          const all = await getComplianceViolations(input?.limit ?? 50, input?.severity);
          return (all as Record<string, unknown>[]).filter((v: Record<string, unknown>) => v.organizationId === ctx.user!.organizationId);
        }
        return getComplianceViolations(input?.limit, input?.severity);
      }),
    enforcementActions: protectedProcedure
      .input(z.object({ limit: z.number().default(20) }).optional())
      .query(async ({ input }) => getEnforcementActions(input?.limit)),
    createAction: protectedProcedure
      .input(z.object({
        organizationId: z.number(),
        violationId: z.number(),
        actionType: z.enum(["notice", "audit", "penalty", "suspension", "revocation"]),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createEnforcementAction(input);
        createAuditLog({ userId: ctx.user.id, action: "enforcement.action.create", resourceType: "enforcement_action", details: `Enforcement action: ${input.actionType} for org #${input.organizationId}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    updateStatus: protectedProcedure
      .input(z.object({
        actionId: z.number().int().positive(),
        status: z.enum(["pending", "notice_sent", "audit_scheduled", "penalty_imposed", "settled", "escalated"]),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await updateEnforcementStatus(input.actionId, input.status);
        createAuditLog({ userId: ctx.user.id, action: "enforcement.status.update", resourceType: "enforcement_action", resourceId: input.actionId, details: `Enforcement action #${input.actionId} → ${input.status}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    deletePolicy: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const { deleteCompliancePolicy } = await import("./db");
        return deleteCompliancePolicy(input.id);
      }),
    createViolation: protectedProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        policyId: z.number().int().positive().optional(),
        assetId: z.number().int().positive().optional(),
        title: z.string().min(3).max(256),
        description: z.string().max(1000).optional(),
        severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      }))
      .mutation(async ({ input, ctx }) => {
        const { createComplianceViolation } = await import("./db");
        const result = await createComplianceViolation(input);
        createAuditLog({ userId: ctx.user.id, organizationId: input.organizationId, action: "violation.create", resourceType: "violation", resourceId: result?.id, details: `Manual violation: ${input.title}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // Publish violation event via Dapr pub/sub (Kafka topic: ndsep.violation.detected)
        daprPublish("ndsep.violation.detected", {
          violationId: result?.id,
          organizationId: input.organizationId,
          severity: input.severity,
          title: input.title,
          createdBy: ctx.user.id,
          ts: new Date().toISOString(),
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // Invalidate dashboard cache
        invalidateComplianceCaches(input.organizationId).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    resolveViolation: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), notes: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const { resolveComplianceViolation } = await import("./db");
        const result = await resolveComplianceViolation(input.id, input.notes);
        createAuditLog({ userId: ctx.user.id, action: "violation.resolve", resourceType: "violation", resourceId: input.id, details: input.notes ?? "Resolved" }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),
  users: router({
    list: protectedProcedure.query(async () => listUsers()),
    updateRole: protectedProcedure
      .input(z.object({
        userId: z.number(),
        role: z.enum(["user", "admin", "auditor", "org_admin"]),
      }))
      .mutation(async ({ input, ctx }) => {
        await requirePermission(ctx.user.id, "assign_role", "user", input.userId);
        const result = await updateUserRole(input.userId, input.role);
        // Sync to Permify: admin/auditor/government_staff get admin relation on the platform entity
        if (["admin", "auditor", "government_staff"].includes(input.role)) {
          await permifyWriteRelationship("organization", "platform", "admin", "user", input.userId);
        }
        // Notify platform owner of privilege change (fire-and-forget)
        notifyOwner({
          title: `[NDSEP] Role change: User #${input.userId} → ${input.role}`,
          content: `Actor: User #${ctx.user.id} (${ctx.user.name ?? ctx.user.email ?? "unknown"}) changed User #${input.userId}'s role to "${input.role}" at ${new Date().toISOString()}.`,
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),
  catalog: router({
    entries: protectedProcedure
      .input(z.object({ limit: z.number().default(50) }).optional())
      .query(async ({ input }) => getDataCatalogEntries(input?.limit)),
    residencyMap: protectedProcedure.query(async () => getDataResidencyMap()),
    create: adminProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        name: z.string().min(1).max(256),
        description: z.string().optional(),
        dataType: z.string().optional(),
        classification: z.enum(["tier1_pii", "tier2_financial", "tier3_health", "tier4_government", "tier5_public"]).optional(),
        storageLocation: z.string().optional(),
        isWithinBorders: z.boolean().default(true),
        rowCount: z.number().int().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createCatalogEntry(input);
        createAuditLog({ userId: ctx.user.id, organizationId: input.organizationId, action: "catalog.create", resourceType: "catalog_entry", resourceId: result?.id, details: `Created catalog entry: ${input.name}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    update: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        name: z.string().optional(),
        description: z.string().optional(),
        storageLocation: z.string().optional(),
        isWithinBorders: z.boolean().optional(),
        qualityScore: z.number().min(0).max(100).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const result = await updateCatalogEntry(id, data);
        createAuditLog({ userId: ctx.user.id, action: "catalog.update", resourceType: "catalog_entry", resourceId: id, details: `Updated catalog entry #${id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteCatalogEntry(input.id);
        createAuditLog({ userId: ctx.user.id, action: "catalog.delete", resourceType: "catalog_entry", resourceId: input.id, details: `Deleted catalog entry #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),
  siem: router({
    alertTrend: protectedProcedure.query(async () => getAlertTrendByHour()),
    alertTypeBreakdown: protectedProcedure.query(async () => getAlertTypeBreakdown()),
    alerts: protectedProcedure
      .input(z.object({ limit: z.number().default(50), resolved: z.boolean().optional() }).optional())
      .query(async ({ input }) => getSecurityAlerts(input?.limit, input?.resolved)),
    resolveAlert: protectedProcedure
      .input(z.object({ alertId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await resolveSecurityAlert(input.alertId, ctx.user.id);
        createAuditLog({ userId: ctx.user.id, action: "siem.resolveAlert", resourceType: "security_alert", resourceId: input.alertId, details: `Resolved security alert #${input.alertId}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    bulkResolveAlerts: protectedProcedure
      .input(z.object({ alertIds: z.array(z.number().int().positive()).min(1).max(100) }))
      .mutation(async ({ input, ctx }) => {
        await Promise.all(input.alertIds.map(id => resolveSecurityAlert(id, ctx.user.id)));
        createAuditLog({ userId: ctx.user.id, action: "siem.bulkResolveAlerts", resourceType: "security_alert", resourceId: input.alertIds[0], details: `Bulk resolved ${input.alertIds.length} alerts: [${input.alertIds.join(", ")}]` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return { resolved: input.alertIds.length };
      }),
    createAlert: protectedProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        severity: z.enum(["low", "medium", "high", "critical"]),
        alertType: z.string().min(1).max(100),
        title: z.string().min(1).max(200),
        description: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { createSecurityAlert } = await import("./db");
        const alert = await createSecurityAlert(input);
        createAuditLog({ userId: ctx.user.id, action: "siem.createAlert", resourceType: "security_alert", resourceId: alert.id, details: `Manual alert created: ${input.alertType} (${input.severity})` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return alert;
      }),
    threatIntel: protectedProcedure
      .input(z.object({ limit: z.number().default(50) }).optional())
      .query(async ({ input }) => getThreatIntelligence(input?.limit)),
    auditLogs: protectedProcedure
      .input(z.object({
        limit: z.number().default(100),
        search: z.string().optional(),
        action: z.string().optional(),
        resourceType: z.string().optional(),
        resourceId: z.number().optional(),
        userId: z.number().optional(),
      }).optional())
      .query(async ({ input }) => getAuditLogs(
        input?.limit,
        input?.search,
        { action: input?.action, resourceType: input?.resourceType, resourceId: input?.resourceId, userId: input?.userId }
      )),
  }),
  network: router({
    trafficByHour: protectedProcedure.query(async () => getNetworkTrafficByHour()),
    ixpSites: protectedProcedure.query(async () => getIxpSiteStats()),
    events: protectedProcedure
      .input(z.object({ limit: z.number().default(50), crossBorderOnly: z.boolean().default(false), orgId: z.number().optional() }).optional())
      .query(async ({ input, ctx }) => {
        const events = await getNetworkEvents(input?.limit, input?.crossBorderOnly);
        // Org admins only see their own org's network events
        if (ctx.user && ctx.user.role === 'org_admin' && ctx.user.organizationId) {
          return (events as Record<string, unknown>[]).filter((e: Record<string, unknown>) => e.organizationId === ctx.user!.organizationId);
        }
        if (input?.orgId) return (events as Record<string, unknown>[]).filter((e: Record<string, unknown>) => e.organizationId === input.orgId);
        return events;
      }),
    stats: protectedProcedure.query(async () => getNetworkStats()),
    blockIp: protectedProcedure
      .input(z.object({
        orgId: z.number().int().positive(),
        ipAddress: z.string().min(7).max(64),
        reason: z.string().min(3).max(256),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await blockNetworkIp(input.orgId, input.ipAddress, input.reason, ctx.user.id);
        createAuditLog({ userId: ctx.user.id, organizationId: input.orgId, action: "network.blockIp", resourceType: "network_event", details: `Blocked IP ${input.ipAddress}: ${input.reason}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        notifyOwner({ title: `[NDSEP] IP Blocked: ${input.ipAddress}`, content: `Org #${input.orgId} | Reason: ${input.reason} | By: User #${ctx.user.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),
  financial: router({
    monthlyTrend: protectedProcedure.query(async () => getFinancialMonthlyTrend()),
    penalties: protectedProcedure
      .input(z.object({ limit: z.number().default(50) }).optional())
      .query(async ({ input }) => getFinancialPenalties(input?.limit)),
    summary: protectedProcedure.query(async () => getPenaltySummary()),
    orgsForSelect: protectedProcedure.query(async () => getOrganizationsForSelect()),
    createPenalty: protectedProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        violationId: z.number().int().positive().optional(),
        amount: z.number().positive(),
        currency: z.string().default("USD"),
        description: z.string().min(1).max(500),
        dueDate: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        await requirePermission(ctx.user.id, "issue_penalty", "organization", input.organizationId);
        const penalty = await createFinancialPenalty({
          organizationId: input.organizationId,
          violationId: input.violationId,
          amount: input.amount,
          currency: input.currency,
          description: input.description,
          dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
        });
        // Fire-and-forget email notification to org contact
        getOrganizationById(input.organizationId).then(org => {
          const orgRec = (org ?? {}) as Record<string, unknown>;
          if (orgRec.contactEmail) {
            sendPenaltyNotice({
              to: String(orgRec.contactEmail),
              orgName: String(orgRec.name),
              penaltyId: penalty?.id ?? 0,
              amount: input.amount,
              currency: input.currency,
              dueDate: input.dueDate ? new Date(input.dueDate) : new Date(Date.now() + 30 * 86_400_000),
              description: input.description,
              portalUrl: `${process.env.VITE_OAUTH_PORTAL_URL ?? ""}/portal`,
            }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          }
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // Notify platform owner
        notifyOwner({
          title: `[NDSEP] Penalty Issued: ${input.amount.toLocaleString()} ${input.currency}`,
          content: `Org #${input.organizationId} | Amount: ${input.amount} ${input.currency} | By: User #${ctx.user.id} | ${input.description}`,
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // Publish penalty event via Dapr pub/sub (Kafka topic: ndsep.penalty.issued)
        daprPublish("ndsep.penalty.issued", {
          penaltyId: penalty?.id,
          organizationId: input.organizationId,
          amount: input.amount,
          currency: input.currency,
          issuedBy: ctx.user.id,
          ts: new Date().toISOString(),
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // Publish directly to Kafka (dual-write for reliability)
        publishPenaltyIssued({
          penaltyId: penalty?.id ?? 0,
          orgId: input.organizationId,
          amount: input.amount,
          currency: input.currency,
          reason: input.description,
          issuedBy: String(ctx.user.id),
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // Create double-entry ledger record in TigerBeetle (fire-and-forget)
        createTigerBeetleTransaction({
          orgId: String(input.organizationId),
          penaltyId: String(penalty?.id ?? 0),
          amountUsd: input.amount,
          currency: input.currency,
          type: "penalty",
          description: input.description,
          issuedBy: String(ctx.user.id),
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // Invalidate dashboard cache
        invalidateCertificateCaches(input.organizationId).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // Create in-app notification (fire-and-forget)
        createInAppNotification({
          title: `Penalty Issued: ${input.currency} ${input.amount.toLocaleString()}`,
          message: `A penalty of ${input.currency} ${input.amount.toLocaleString()} was issued to organisation #${input.organizationId}. ${input.description}`,
          severity: input.amount >= 10_000_000 ? "critical" : "warning",
          category: "penalty",
          organizationId: input.organizationId,
          userId: ctx.user.id,
          actionUrl: "/financial",
          metadata: { penaltyId: penalty?.id, amount: input.amount, currency: input.currency },
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return penalty;
      }),
    updatePenaltyStatus: protectedProcedure
      .input(z.object({
        penaltyId: z.number().int().positive(),
        status: z.enum(["pending", "processing", "completed", "failed", "overdue"]),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await updatePenaltyStatus(input.penaltyId, input.status);
        createAuditLog({ userId: ctx.user.id, action: "financial.penalty.updateStatus", resourceType: "financial_penalty", resourceId: input.penaltyId, details: `Penalty #${input.penaltyId} → ${input.status}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    receipt: protectedProcedure
      .input(z.object({ penaltyId: z.number().int().positive() }))
      .query(async ({ input }) => getPenaltyReceipt(input.penaltyId)),
    /** Bulk import penalties from CSV rows — validates each row and returns preview or commits */
    bulkImportPenalties: protectedProcedure
      .input(z.object({
        rows: z.array(z.object({
          orgName: z.string().min(1),
          amount: z.number().positive(),
          currency: z.string().default("USD"),
          description: z.string().min(1),
          dueDate: z.string().optional(),
        })),
        commit: z.boolean().default(false),
      }))
      .mutation(async ({ input }) => {
        const orgs = await getOrganizationsForSelect();
        const orgMap = new Map(orgs.map((o: { id: number; name: string }) => [o.name.toLowerCase(), o.id]));
        const results = input.rows.map((row, idx) => {
          const orgId = orgMap.get(row.orgName.toLowerCase());
          const error = !orgId ? `Row ${idx + 1}: Organisation "${row.orgName}" not found` : null;
          return { ...row, orgId: orgId ?? null, rowIndex: idx + 1, error };
        });
        const valid = results.filter(r => !r.error);
        const invalid = results.filter(r => r.error);
        if (!input.commit) {
          return { preview: true, valid: valid.length, invalid: invalid.length, rows: results };
        }
        // Commit valid rows
        const created: number[] = [];
        for (const row of valid) {
          if (!row.orgId) continue;
          const penalty = await createFinancialPenalty({
            organizationId: row.orgId,
            amount: row.amount,
            currency: row.currency,
            description: row.description,
            dueDate: row.dueDate ? new Date(row.dueDate) : undefined,
          });
          if (penalty?.id) created.push(penalty.id);
        }
        return { preview: false, created: created.length, skipped: invalid.length, rows: results };
      }),
    appeals: protectedProcedure
      .input(z.object({ orgId: z.number().int().positive().optional() }).optional())
      .query(async ({ input }) => getPenaltyAppeals(input?.orgId)),
    createAppeal: protectedProcedure
      .input(z.object({
        penaltyId: z.number().int().positive(),
        organizationId: z.number().int().positive(),
        submittedBy: z.string().min(1),
        contactEmail: z.string().email(),
        groundsForAppeal: z.string().min(10).max(2000),
        evidenceSummary: z.string().optional(),
        requestedOutcome: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createPenaltyAppeal(input);
        createAuditLog({ userId: ctx.user.id, action: "financial.penalty.appeal", resourceType: "penalty_appeal", details: `Penalty appeal filed for penalty #${input.penaltyId}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    reviewAppeal: protectedProcedure
      .input(z.object({
        appealId: z.number().int().positive(),
        decision: z.enum(["upheld", "dismissed", "under_review"]),
        reviewNotes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await reviewPenaltyAppeal(input.appealId, input.decision, ctx.user.id, input.reviewNotes);
        // TigerBeetle: if appeal upheld, create a settlement (refund) ledger entry
        const resRec = (result ?? {}) as Record<string, unknown>;
        if (input.decision === "upheld" && resRec.penaltyId) {
          createTigerBeetleTransaction({
            orgId: String(resRec.organizationId ?? 0),
            penaltyId: String(resRec.penaltyId),
            amountUsd: Number(resRec.amount ?? 0),
            currency: String(resRec.currency ?? "USD"),
            type: "settlement",
            description: `Appeal ${input.appealId} upheld — penalty settled`,
            issuedBy: String(ctx.user.id),
          }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        createAuditLog({ userId: ctx.user.id, action: "financial.reviewAppeal", resourceType: "penalty_appeal", resourceId: input.appealId, details: `Appeal decision: ${input.decision}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    payPenalty: protectedProcedure
      .input(z.object({
        penaltyId: z.number().int().positive(),
        orgId: z.number().int().positive(),
        paymentMethod: z.enum(["bank_transfer", "card", "ussd", "crypto", "other"]),
        paymentRef: z.string().min(4).max(100),
        contactEmail: z.string().email().optional(),
      }))
      .mutation(async ({ input }) => {
        // Update penalty status to processing and fire orchestration event
        await updatePenaltyStatus(input.penaltyId, "processing");
        // Fire TigerBeetle / orchestration event (fire-and-forget)
        j05_penaltyPaid({
          penaltyId: String(input.penaltyId),
          orgId: String(input.orgId),
          amountUsd: 0, // amount fetched inside orchestration from DB
          paymentMethod: input.paymentMethod,
          paymentRef: input.paymentRef,
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        if (input.contactEmail) {
          sendPenaltyNotice({
            to: input.contactEmail,
            orgName: "Your Organisation",
            penaltyId: input.penaltyId,
            amount: 0,
            currency: "USD",
            dueDate: new Date(),
            description: "Payment received — processing",
            portalUrl: `${process.env.VITE_OAUTH_PORTAL_URL ?? ""}/portal`,
          }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        return { success: true, status: "processing" };
      }),
    bulkIssuePenalties: protectedProcedure
      .input(z.object({
        organizationIds: z.array(z.number().int().positive()).min(1).max(50),
        amount: z.number().positive(),
        currency: z.string().default("NGN"),
        description: z.string().min(1).max(500),
        dueDate: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const results: Array<{ orgId: number; penaltyId?: number; error?: string }> = [];
        for (const orgId of input.organizationIds) {
          try {
            await requirePermission(ctx.user.id, "issue_penalty", "organization", orgId);
            const penalty = await createFinancialPenalty({
              organizationId: orgId,
              amount: input.amount,
              currency: input.currency,
              description: input.description,
              dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
            });
            getOrganizationById(orgId).then(org => {
              const orgBulk = (org ?? {}) as Record<string, unknown>;
              if (orgBulk.contactEmail) {
                sendPenaltyNotice({
                  to: String(orgBulk.contactEmail),
                  orgName: String(orgBulk.name),
                  penaltyId: penalty?.id ?? 0,
                  amount: input.amount,
                  currency: input.currency,
                  dueDate: input.dueDate ? new Date(input.dueDate) : new Date(Date.now() + 30 * 86_400_000),
                  description: input.description,
                  portalUrl: `${process.env.VITE_OAUTH_PORTAL_URL ?? ""}/portal`,
                }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
              }
            }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
            results.push({ orgId, penaltyId: penalty?.id });
          } catch (e: unknown) {
            results.push({ orgId, error: e instanceof Error ? e.message : "Failed" });
          }
        }
        // TigerBeetle: create ledger entries for all successfully issued penalties
        for (const r of results.filter(res => res.penaltyId)) {
          createTigerBeetleTransaction({
            orgId: String(r.orgId),
            penaltyId: String(r.penaltyId),
            amountUsd: input.amount,
            currency: input.currency,
            type: "penalty",
            description: input.description,
            issuedBy: String(ctx.user.id),
          }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        createAuditLog({ userId: ctx.user.id, action: "financial.bulkIssuePenalties", resourceType: "penalty", resourceId: 0, details: `Bulk issued ${results.filter(r => r.penaltyId).length}/${input.organizationIds.length} penalties: ${input.description}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        notifyOwner({ title: "Bulk Penalty Issuance", content: `${results.filter(r => r.penaltyId).length} penalties of ${input.currency} ${input.amount.toLocaleString()} issued by ${ctx.user.name ?? ctx.user.id}.` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return { issued: results.filter(r => r.penaltyId).length, failed: results.filter(r => r.error).length, results };
      }),
  }),
  streaming: router({
    events: protectedProcedure
      .input(z.object({ limit: z.number().default(30) }).optional())
      .query(async ({ input }) => getStreamingEvents(input?.limit)),
    topicStats: protectedProcedure.query(async () => getStreamingTopicStats()),
    /** Returns the current Kafka producer connection status and broker metadata. */
    kafkaStatus: protectedProcedure.query(async () => getKafkaProducerStatus()),
    /**
     * Admin-only: runs a live Kafka smoke-test by publishing a canary event
     * to ndsep.penalties.issued and measuring round-trip latency.
     * Use in staging CI to assert broker connectivity end-to-end.
     */
    kafkaSmokeTest: adminProcedure.mutation(async () => kafkaSmokeTest()),
  }),
  bgp: router({
    routes: protectedProcedure
      .input(z.object({ limit: z.number().default(50), hijackedOnly: z.boolean().default(false) }).optional())
      .query(async ({ input }) => getBgpRoutes(input?.limit, input?.hijackedOnly)),
    stats: protectedProcedure.query(async () => getBgpStats()),
    history: protectedProcedure.query(async () => getBgpRouteHistory()),
    hijacked: protectedProcedure
      .input(z.object({ limit: z.number().default(5) }).optional())
      .query(async ({ input }) => getHijackedBgpRoutes(input?.limit ?? 5)),
    reportHijack: protectedProcedure
      .input(z.object({
        prefix: z.string().min(7),
        hijackingAsn: z.number().int().positive(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const title = `[REPORTED] BGP Hijack: ${input.prefix} by AS${input.hijackingAsn}`;
        const desc = `Manual hijack report. Prefix: ${input.prefix}, Hijacking ASN: AS${input.hijackingAsn}${input.notes ? `. Notes: ${input.notes}` : ''}`;
        await reportBgpHijack(0, input.prefix, String(input.hijackingAsn), input.notes ?? '', 0);
        return { success: true, prefix: input.prefix, title, desc };
      }),
  }),
  residency: router({
    checks: protectedProcedure
      .input(z.object({ limit: z.number().default(50), violationsOnly: z.boolean().default(false) }).optional())
      .query(async ({ input }) => getResidencyChecks(input?.limit, input?.violationsOnly)),
    stats: protectedProcedure.query(async () => getResidencyStats()),
  }),
  ledger: router({
    transactions: protectedProcedure
      .input(z.object({ limit: z.number().default(50), status: z.string().optional() }).optional())
      .query(async ({ input }) => getLedgerTransactions(input?.limit, input?.status)),
    summary: protectedProcedure.query(async () => getLedgerSummary()),
  }),
  workers: router({
    status: protectedProcedure.query(async () => getWorkersStatus()),
    restart: protectedProcedure
      .input(z.object({ workerId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        createAuditLog({ userId: ctx.user.id, action: "worker.restart", resourceType: "worker", details: `Worker restart requested: ${input.workerId}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        const { restartWorker } = await import("./workerManager.js");
        const ok = restartWorker(input.workerId);
        return { success: ok, workerId: input.workerId };
      }),
    metrics: protectedProcedure
      .input(z.object({ workerId: z.string() }))
      .query(async ({ input }) => {
        const { getWorkerMetrics } = await import("./workerManager.js");
        return getWorkerMetrics(input.workerId);
      }),
    /** Fetch real-time Prometheus metrics from the prometheus_exporter worker (port 8098) */
    prometheusMetrics: protectedProcedure.query(async () => {
      try {
        const res = await fetch("http://localhost:8098/metrics", { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    }),
    /** Fetch live PCAP sessions from the arkime_pcap worker (port 8099) */
    arkimeSessions: protectedProcedure
      .input(z.object({
        limit: z.number().int().min(1).max(200).default(80),
        protocol: z.string().optional(),
        anomalousOnly: z.boolean().optional(),
        crossBorderOnly: z.boolean().optional(),
        search: z.string().optional(),
      }))
      .query(async ({ input }) => {
        try {
          const url = new URL("http://localhost:8099/sessions");
          if (input.limit) url.searchParams.set("limit", String(input.limit));
          if (input.protocol) url.searchParams.set("protocol", input.protocol);
          if (input.anomalousOnly) url.searchParams.set("anomalous", "true");
          if (input.crossBorderOnly) url.searchParams.set("cross_border", "true");
          if (input.search) url.searchParams.set("q", input.search);
          const res = await fetch(url.toString(), { signal: AbortSignal.timeout(3000) });
          if (!res.ok) return { sessions: [] };
          return await res.json();
        } catch {
          return { sessions: [] };
        }
      }),
    /** Fetch live Temporal workflow runs from the orchestration worker (port 8095) */
    temporalRuns: protectedProcedure
      .input(z.object({
        limit: z.number().int().min(1).max(100).default(24),
        status: z.string().optional(),
        workflowType: z.string().optional(),
      }))
      .query(async ({ input }) => {
        try {
          const url = new URL("http://localhost:8095/workflows");
          if (input.limit) url.searchParams.set("limit", String(input.limit));
          if (input.status) url.searchParams.set("status", input.status);
          if (input.workflowType) url.searchParams.set("type", input.workflowType);
          const res = await fetch(url.toString(), { signal: AbortSignal.timeout(3000) });
          if (!res.ok) return { runs: [] };
          return await res.json();
        } catch {
          return { runs: [] };
        }
      }),
  }),
  portal: router({
    requestAudit: protectedProcedure
      .input(z.object({
        orgName: z.string().min(2),
        contactEmail: z.string().email(),
        contactName: z.string().min(2),
        orgSector: z.string(),
        orgCountry: z.string(),
        reason: z.string().min(10).max(500),
      }))
      .mutation(async ({ input }) => {
        // Create a new portal submission in phase 1 as a re-audit request
        const result = await createPortalSubmission({
          orgName: input.orgName,
          orgSector: input.orgSector,
          orgCountry: input.orgCountry,
          contactName: input.contactName,
          contactEmail: input.contactEmail,
          assets: [],
          datasets: [],
          selfAssessmentScore: 0,
          assessmentAnswers: {},
        });
        return result;
      }),
    register: protectedProcedure
      .input(z.object({
        orgName: z.string().min(2),
        orgSector: z.string(),
        orgCountry: z.string(),
        regulatoryId: z.string().optional(),
        contactName: z.string().min(2),
        contactEmail: z.string().email(),
        contactPhone: z.string().optional(),
        assets: z.array(z.object({ type: z.string(), name: z.string(), count: z.number(), location: z.string() })),
        datasets: z.array(z.object({ name: z.string(), classification: z.string(), storageLocation: z.string(), containsPii: z.boolean(), crossBorder: z.boolean(), recordCount: z.string() })),
        selfAssessmentScore: z.number(),
        assessmentAnswers: z.record(z.string(), z.boolean()),
      }))
      .mutation(async ({ input }) => createPortalSubmission(input)),
    list: protectedProcedure
      .input(z.object({ limit: z.number().default(50), sector: z.string().optional(), phase: z.string().optional() }).optional())
      .query(async ({ input }) => getPortalSubmissions(input?.limit, input?.sector, input?.phase)),
    get: protectedProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => getPortalSubmission(input.token)),
    stats: protectedProcedure.query(async () => getPortalStats()),
    review: protectedProcedure
      .input(z.object({ id: z.number(), decision: z.enum(["advance", "reject", "certify"]), notes: z.string().default("") }))
      .mutation(async ({ input, ctx }) => {
        // Fetch submission details for email notification before updating
        const sub = await getPortalSubmissionById(input.id);
        const result = await reviewPortalSubmission(input.id, input.decision, input.notes, ctx.user.id);
        // Fire-and-forget email notifications
        if (sub?.contactEmail) {
          const portalUrl = `${process.env.VITE_OAUTH_PORTAL_URL ?? ""}/portal`;
          if (input.decision === "certify") {
            sendCertificateGranted({
              to: sub.contactEmail,
              orgName: sub.orgName ?? "Your Organisation",
              certToken: sub.submissionToken ?? "",
              complianceScore: sub.complianceScore ?? 0,
              certifiedAt: new Date(),
              verifyBaseUrl: portalUrl.replace("/portal", ""),
            }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          } else {
            sendPortalPhaseUpdate({
              to: sub.contactEmail,
              orgName: sub.orgName ?? "Your Organisation",
              submissionToken: sub.submissionToken ?? "",
              newPhase: result?.newPhase ?? input.decision,
              notes: input.notes || undefined,
              portalUrl,
            }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          }
        }
        // Broadcast real-time portal update to org portal subscribers
        broadcast("org_portal", {
          type: "org_portal_update",
          payload: {
            submissionToken: sub?.submissionToken ?? "",
            orgName: sub?.orgName ?? "Organisation",
            newPhase: result?.newPhase ?? input.decision,
            decision: input.decision,
            notes: input.notes || undefined,
          },
        });
        return result;
      }),
    submitAppeal: protectedProcedure
      .input(z.object({
        penaltyId: z.number(),
        organizationId: z.number(),
        submittedBy: z.string().min(2),
        contactEmail: z.string().email(),
        groundsForAppeal: z.string().min(20),
        evidenceSummary: z.string().optional(),
        requestedOutcome: z.enum(["full_waiver", "reduction", "payment_plan", "extension"]).default("reduction"),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createPenaltyAppeal(input);
        createAuditLog({ userId: ctx.user.id, action: "financial.penalty.appeal", resourceType: "penalty_appeal", details: `Penalty appeal filed for penalty #${input.penaltyId}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    listAppeals: protectedProcedure
      .input(z.object({ organizationId: z.number().optional(), limit: z.number().default(50) }).optional())
      .query(async ({ input }) => getPenaltyAppeals(input?.organizationId, input?.limit ?? 50)),
    reviewAppeal: protectedProcedure
      .input(z.object({ id: z.number(), decision: z.enum(["upheld", "dismissed", "under_review"]), notes: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const result = await reviewPenaltyAppeal(input.id, input.decision, ctx.user.id, input.notes);
        // Fire-and-forget email notification using contactEmail stored in the appeal row
        if (result?.contactEmail) {
          sendAppealUpdate({
            to: result.contactEmail,
            orgName: "Your Organisation",
            appealId: input.id,
            penaltyId: result.penaltyId,
            decision: input.decision,
            notes: input.notes,
            portalUrl: `${process.env.VITE_OAUTH_PORTAL_URL ?? ""}/portal`,
          }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        // Broadcast real-time appeal update to org portal subscribers
        broadcast("org_portal", {
          type: "appeal_update",
          payload: {
            orgId: result?.organizationId ?? 0,
            orgName: "Organisation",
            appealId: input.id,
            decision: input.decision,
            penaltyId: result?.penaltyId ?? 0,
          },
        });
        return result;
      }),
    // Mobile API: returns the current user's organization portal summary
    myOrg: protectedProcedure.query(async ({ ctx }) => {
      const dbPool = getPool();
      if (!dbPool) return null;
      // Find the organization linked to this user
      const orgRows = await dbPool.query(
        `SELECT o.* FROM organizations o
         JOIN organization_users ou ON ou.organization_id = o.id
         WHERE ou.user_id = $1 LIMIT 1`,
        [ctx.user.id]
      );
      const org = orgRows.rows[0] ?? null;
      if (!org) return null;
      // Portal phase (portal_submissions.org_name, current_phase)
      const phaseRows = await dbPool.query(
        `SELECT org_name, current_phase FROM portal_submissions WHERE org_name = $1 ORDER BY submitted_at DESC LIMIT 1`,
        [org.name]
      );
      const phase = phaseRows.rows[0] ?? null;
      // Pending penalties (financial_penalties table)
      const penaltyRows = await dbPool.query(
        `SELECT id, amount, currency, payment_status AS status, description AS reason FROM financial_penalties WHERE organization_id = $1 AND payment_status = 'pending' LIMIT 10`,
        [org.id]
      );
      // Open violations (compliance_violations table)
      const violationRows = await dbPool.query(
        `SELECT id, title, severity, enforcement_status AS status FROM compliance_violations WHERE organization_id = $1 AND enforcement_status = 'pending' LIMIT 10`,
        [org.id]
      );
      return {
        organization: org,
        phase: phase ? { phaseName: phase.current_phase, status: 'active' } : null,
        penalties: penaltyRows.rows,
        violations: violationRows.rows,
        certificates: [],
      };
    }),
  
    // ─── Organization Users ─────────────────────────────────────────────────────
    listOrgUsers: protectedProcedure
      .input(z.object({ organizationId: z.number() }))
      .query(async ({ input, ctx }) => {
        if (!canAccessOrg(ctx.user, input.organizationId)) throw new TRPCError({ code: "FORBIDDEN" });
        return listOrganizationUsers(input.organizationId);
      }),
    addOrgUser: protectedProcedure
      .input(z.object({ organizationId: z.number(), userId: z.number(), role: z.string().default("member") }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin" && !canAccessOrg(ctx.user, input.organizationId)) throw new TRPCError({ code: "FORBIDDEN" });
        const result = await createOrganizationUser({ organizationId: input.organizationId, userId: input.userId, role: input.role });
        // Sync Permify — user becomes org member with role
        permifyWriteRelationship("organization", String(input.organizationId), input.role, "user", String(input.userId)).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "permify fire-and-forget"));
        return result;
      }),
    updateOrgUserRole: protectedProcedure
      .input(z.object({ id: z.number(), role: z.string() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        return updateOrganizationUserRole(input.id, input.role);
      }),
    removeOrgUser: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        return deleteOrganizationUser(input.id);
      }),
  }),
  transfers: router({
    create: protectedProcedure
      .input(z.object({
        organizationId: z.number(),
        submissionId: z.number().optional(),
        datasetName: z.string(),
        datasetId: z.number().optional(),
        sourceCountry: z.string(),
        destinationCountry: z.string(),
        destinationEntity: z.string(),
        volumeGb: z.number(),
        dataClassification: z.string(),
        businessJustification: z.string(),
        transferMethod: z.string().optional(),
        encryptionMethod: z.string().optional(),
      }))
      .mutation(async ({ input }) => createTransferApproval(input)),
    list: protectedProcedure
      .input(z.object({ limit: z.number().default(50), status: z.string().optional() }).optional())
      .query(async ({ input }) => getTransferApprovals(input?.limit, input?.status)),
    review: protectedProcedure
      .input(z.object({ id: z.number(), decision: z.enum(["approved", "denied"]), notes: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        await requirePermission(ctx.user.id, "approve_transfer", "transfer", input.id);
        return reviewTransferApproval(input.id, input.decision, ctx.user.id, input.notes);
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteTransferApproval(input.id);
        createAuditLog({ userId: ctx.user.id, action: "transfer.delete", resourceType: "transfer_approval", resourceId: input.id, details: `Deleted transfer approval #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    pendingCount: protectedProcedure.query(async () => {
      const all = await getTransferApprovals(500, "pending");
      return { count: (all as any[]).length };
    }),
  }),
  monitoring: router({
    snapshots: protectedProcedure
      .input(z.object({ limit: z.number().default(100), orgId: z.number().optional(), snapshotType: z.string().optional() }).optional())
      .query(async ({ input }) => getMonitoringSnapshots(input?.limit, input?.orgId, input?.snapshotType)),
    slaBreaches: protectedProcedure
      .input(z.object({ limit: z.number().default(50), status: z.string().optional() }).optional())
      .query(async ({ input }) => getSlaBreaches(input?.limit, input?.status)),
    driftAlerts: protectedProcedure
      .input(z.object({ limit: z.number().default(50), status: z.string().optional() }).optional())
      .query(async ({ input }) => getDriftAlerts(input?.limit, input?.status)),
    stats: protectedProcedure.query(async () => getMonitoringStats()),
    orgScores: protectedProcedure.query(async () => getOrgScores()),
    resolveDrift: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => resolveDriftAlertById(input.id)),
    resolveSla: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => resolveSlaBreachById(input.id)),
  }),
  ai: router({
    query: protectedProcedure
      .input(z.object({ question: z.string().min(1).max(1000) }))
      .mutation(async ({ input }) => {
        const stats = await getDashboardStats();
        const orgs = await getOrganizations(8);
        const violations = await getComplianceViolations(5);
        const alerts = await getSecurityAlerts(5, false);
                const orgLines = orgs.slice(0, 5).map((o: Record<string, unknown>) => `- ${o.name}: Risk ${Number(o.riskScore ?? 0).toFixed(1)}, Compliance ${Number(o.complianceScore ?? 0).toFixed(1)}, Status: ${o.complianceStatus}`).join("\n");
        const violLines = violations.filter((v: Record<string, unknown>) => v.severity === "critical").slice(0, 3).map((v: Record<string, unknown>) => `- ${v.title}: ${String(v.description ?? "").substring(0, 100)}`).join("\n");
        const alertLines = alerts.slice(0, 3).map((a: Record<string, unknown>) => `- [${String(a.severity ?? "").toUpperCase()}] ${a.title} (${a.source})`).join("\n");
        const context = [
          "You are the NDSEP AI Compliance Advisor for the National Data Sovereignty Enforcement Platform.",
          "",
          "CURRENT PLATFORM STATUS:",
          `- Organizations monitored: ${stats?.orgStats?.total ?? 0}`,
          `- Compliant: ${stats?.orgStats?.compliant ?? 0}, Non-compliant: ${stats?.orgStats?.nonCompliant ?? 0}`,
          `- Average compliance score: ${Number(stats?.orgStats?.avgScore ?? 0).toFixed(1)}/100`,
          `- Average national risk score: ${Number(stats?.orgStats?.avgRisk ?? 0).toFixed(1)}/100`,
          `- Total assets tracked: ${stats?.assetStats?.total ?? 0}`,
          `- Assets outside borders: ${stats?.assetStats?.outsideBorders ?? 0}`,
          `- Open violations: ${stats?.violationStats?.open ?? 0} (${stats?.violationStats?.critical ?? 0} critical)`,
          `- Unresolved security alerts: ${stats?.alertStats?.unresolved ?? 0}`,
          `- Pending penalties: $${Number(stats?.penaltyStats?.pendingAmount ?? 0).toLocaleString()}`,
          "",
          "TOP ORGANIZATIONS BY RISK:",
          orgLines,
          "",
          "RECENT CRITICAL VIOLATIONS:",
          violLines,
          "",
          "ACTIVE SECURITY ALERTS:",
          alertLines,
          "",
          "Provide precise, actionable, professional advice. Reference specific organizations and metrics where relevant.",
        ].join("\n");
        const response = await invokeLLM({
          messages: [
            { role: "system", content: context },
            { role: "user", content: input.question },
          ],
        });
        return {
          answer: response.choices[0]?.message?.content ?? "Unable to generate response.",
          timestamp: new Date().toISOString(),
        };
      }),
  }),
  orchestration: router({
    health: protectedProcedure.query(async () => checkOrchestrationHealth()),
    status: protectedProcedure.query(async () => getOrchestrationStatus()),
    issuePenalty: protectedProcedure
      .input(z.object({ penaltyId: z.string(), orgId: z.string(), violationId: z.string(), amountUsd: z.number().positive(), currency: z.string().default("USD") }))
      .mutation(async ({ input }) => j04_penaltyIssued(input)),
    payPenalty: protectedProcedure
      .input(z.object({ penaltyId: z.string(), orgId: z.string(), amountUsd: z.number().positive(), paymentMethod: z.string(), paymentRef: z.string() }))
      .mutation(async ({ input }) => j05_penaltyPaid(input)),
    assessTransferRisk: protectedProcedure
      .input(z.object({ transferId: z.string(), orgId: z.string(), destinationCountry: z.string(), dataClassification: z.string(), volumeGb: z.number(), purpose: z.string(), recipientType: z.string() }))
      .mutation(async ({ input }) => j06_transferRequested(input)),
    updateRiskScore: protectedProcedure
      .input(z.object({ orgId: z.string(), complianceScore: z.number(), violationCount30d: z.number().default(0), penaltyAmountYtd: z.number().default(0), transferCount30d: z.number().default(0), rejectedTransferRate: z.number().default(0), networkAnomalyCount7d: z.number().default(0), slaBreach90d: z.number().default(0), daysSinceLastAudit: z.number().default(30), sectorRiskMultiplier: z.number().default(1), dataVolumeTb: z.number().default(0) }))
      .mutation(async ({ input }) => j14_riskScoreUpdated(input)),
    auditTrail: protectedProcedure
      .input(z.object({ actorId: z.string(), actorRole: z.string(), action: z.string(), resourceType: z.string(), resourceId: z.string(), outcome: z.enum(["success", "failure", "denied"]), ipAddress: z.string().optional() }))
      .mutation(async ({ input }) => j15_auditTrail(input)),
    issueCertificate: protectedProcedure
      .input(z.object({ submissionId: z.string(), orgId: z.string(), orgName: z.string(), reviewerId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        await requirePermission(ctx.user.id, "issue_certificate", "organization", input.orgId);
        return j17_certificateIssued(input);
      }),
    runDistribution: protectedProcedure
      .input(z.object({ periodMonth: z.string(), allocations: z.array(z.object({ recipientId: z.string(), recipientName: z.string(), amountUsd: z.number(), percentage: z.number() })) }))
      .mutation(async ({ input }) => j18_revenueDistribution(input)),
    triggerWorkflow: protectedProcedure
      .input(z.object({ workflowType: z.string(), workflowId: z.string(), input: z.record(z.string(), z.unknown()) }))
      .mutation(async ({ input }) => j19_triggerWorkflow(input)),
    listWorkflows: protectedProcedure
      .input(z.object({
        limit: z.number().int().min(1).max(200).default(50),
        status: z.string().optional(),
        workflowType: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
        // First try the workers.temporalRuns endpoint (live Temporal data)
        try {
          const url = new URL("http://localhost:8095/workflows");
          if (input?.limit) url.searchParams.set("limit", String(input.limit));
          if (input?.status) url.searchParams.set("status", input.status);
          if (input?.workflowType) url.searchParams.set("type", input.workflowType);
          const res = await fetch(url.toString(), { signal: AbortSignal.timeout(2000) });
          if (res.ok) {
            const data = await res.json();
            if (data.runs?.length > 0) return data;
          }
        } catch { /* worker not running, fall through to DB */ }
        // Fallback: return remediation workflows from DB as workflow runs
        const dbWorkflows = await listRemediationWorkflows(undefined, input?.status as any);
        const runs = dbWorkflows.slice(0, input?.limit ?? 50).map((w: Record<string, unknown>) => ({
          workflowId: `remediation-${w.id}`,
          type: { id: "remediation", name: "Remediation Workflow", steps: ["detect", "assign", "remediate", "verify", "close"] },
          status: w.status === "resolved" ? "COMPLETED" : w.status === "in_progress" ? "RUNNING" : w.status === "open" ? "RUNNING" : "COMPLETED",
          currentStep: w.status === "resolved" ? 5 : w.status === "in_progress" ? 2 : 1,
          startedAt: w.createdAt,
          duration: w.resolvedAt ? Math.round((new Date(String(w.resolvedAt)).getTime() - new Date(String(w.createdAt)).getTime()) / 1000) : null,
          orgName: w.orgName ?? "Unknown Org",
        }));
        return { runs };
      }),
    disputePenalty: protectedProcedure
      .input(z.object({ penaltyId: z.string(), orgId: z.string(), amountUsd: z.number().positive(), disputeRef: z.string() }))
      .mutation(async ({ input }) => j20_penaltyDisputed(input)),
    reconcile: protectedProcedure
      .mutation(async () => j25_financialReconciliation()),
    middlewareHealth: protectedProcedure.query(async () => {
      // Returns health status for all 10 middleware services
      const allHealth = await checkOrchestrationHealth();
      const middlewareNames = new Set([
        "kafka", "daprSidecar", "fluvio", "temporal",
        "keycloak", "permify", "redis", "apisix",
        "tigerBeetleHttp", "icebergCatalog",
      ]);
      const mw = allHealth.filter((h) => middlewareNames.has(h.service));
      const online = mw.filter((h) => h.status === "healthy").length;
      return {
        middleware: mw,
        online,
        total: mw.length,
        healthPct: Math.round((online / Math.max(mw.length, 1)) * 100),
        checkedAt: new Date().toISOString(),
      };
    }),
    /** Returns Temporal Cloud/self-hosted connection configuration. */
    temporalConfig: protectedProcedure.query(async () => getTemporalConfig()),
    /**
     * Admin-only: runs a Temporal smoke-test (list workflows) and returns
     * latency + connection metadata. Use in staging CI.
     */
    temporalSmokeTest: adminProcedure.mutation(async () => temporalSmokeTest()),
    /**
     * Start a Temporal workflow via the native SDK (Cloud-aware).
     * Falls back to HTTP API if SDK is unavailable.
     */
    startTemporalWorkflow: protectedProcedure
      .input(z.object({
        workflowType: z.string().min(1),
        workflowId: z.string().min(1),
        input: z.record(z.string(), z.unknown()).optional(),
        taskQueue: z.string().optional(),
        executionTimeoutSeconds: z.number().int().positive().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await startWorkflow(input.workflowType, {
          workflowId: input.workflowId,
          input: input.input,
          taskQueue: input.taskQueue,
          executionTimeoutSeconds: input.executionTimeoutSeconds,
        });
        createAuditLog({
          userId: ctx.user.id,
          action: "temporal.workflow.start",
          resourceType: "temporal_workflow",
          resourceId: 0,
          details: `Started workflow type=${input.workflowType} id=${input.workflowId} via Temporal SDK (isCloud=${result.isCloud})`,
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    /** Describe a Temporal workflow execution by workflowId. */
    describeTemporalWorkflow: protectedProcedure
      .input(z.object({ workflowId: z.string().min(1), runId: z.string().optional() }))
      .query(async ({ input }) => describeWorkflow(input.workflowId, input.runId)),
    /** List recent Temporal workflow executions (SDK-based, Cloud-aware). */
    listTemporalWorkflows: protectedProcedure
      .input(z.object({
        pageSize: z.number().int().min(1).max(100).default(20),
        query: z.string().optional(),
      }).optional())
      .query(async ({ input }) => temporalListWorkflows({ pageSize: input?.pageSize, query: input?.query })),

    // ── Orchestration Service Health & Status ──────────────────────────────
    apiGatewayStatus: protectedProcedure.query(async () => {
      try {
        const res = await fetch("http://localhost:8130/health", { signal: AbortSignal.timeout(2000) });
        if (!res.ok) return { status: "unreachable", routes: 0 };
        return await res.json();
      } catch (e) { logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[Health] API Gateway unreachable"); return { status: "unreachable", routes: 0 }; }
    }),
    apiGatewaySync: adminProcedure.mutation(async () => {
      try {
        const res = await fetch("http://localhost:8130/sync", { method: "POST", signal: AbortSignal.timeout(5000) });
        if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
        return await res.json();
      } catch (e: unknown) { return { success: false, error: e instanceof Error ? e.message : String(e) }; }
    }),
    eventBusStatus: protectedProcedure.query(async () => {
      try {
        const res = await fetch("http://localhost:8160/health", { signal: AbortSignal.timeout(2000) });
        if (!res.ok) return { status: "unreachable", kafka: false, fluvio: false };
        return await res.json();
      } catch (e) { logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[Health] Event Bus unreachable"); return { status: "unreachable", kafka: false, fluvio: false }; }
    }),
    eventBusPublish: protectedProcedure
      .input(z.object({ topic: z.string().min(1), event: z.record(z.string(), z.unknown()) }))
      .mutation(async ({ input }) => {
        try {
          const res = await fetch("http://localhost:8160/publish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
            signal: AbortSignal.timeout(5000),
          });
          if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
          return await res.json();
        } catch (e: unknown) { return { success: false, error: e instanceof Error ? e.message : String(e) }; }
      }),
    iamServiceStatus: protectedProcedure.query(async () => {
      try {
        const res = await fetch("http://localhost:8150/health", { signal: AbortSignal.timeout(2000) });
        if (!res.ok) return { status: "unreachable", keycloak: false, permify: false };
        return await res.json();
      } catch (e) { logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[Health] IAM Service unreachable"); return { status: "unreachable", keycloak: false, permify: false }; }
    }),
    iamValidateToken: protectedProcedure
      .input(z.object({ token: z.string().min(10) }))
      .mutation(async ({ input }) => {
        try {
          const res = await fetch("http://localhost:8150/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: input.token }),
            signal: AbortSignal.timeout(5000),
          });
          if (!res.ok) return { valid: false, error: `HTTP ${res.status}` };
          return await res.json();
        } catch (e: unknown) { return { valid: false, error: e instanceof Error ? e.message : String(e) }; }
      }),
    tigerbeetleStatus: protectedProcedure.query(async () => {
      try {
        const res = await fetch("http://localhost:8240/health", { signal: AbortSignal.timeout(2000) });
        if (!res.ok) return { status: "unreachable", entryCount: 0 };
        return await res.json();
      } catch (e) { logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[Health] TigerBeetle unreachable"); return { status: "unreachable", entryCount: 0 }; }
    }),
    tigerbeetleBalance: protectedProcedure
      .input(z.object({ orgId: z.string().min(1) }))
      .query(async ({ input }) => {
        return getTigerBeetleBalance(input.orgId);
      }),
    tigerbeetleCreateTransaction: adminProcedure
      .input(z.object({ orgId: z.string(), penaltyId: z.string(), amountUsd: z.number().positive(), currency: z.string().default("USD"), type: z.enum(["penalty", "fine", "settlement", "refund", "escrow"]).default("penalty") }))
      .mutation(async ({ input }) => {
        try {
          const res = await fetch("http://localhost:8240/transaction", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
            signal: AbortSignal.timeout(5000),
          });
          if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
          return await res.json();
        } catch (e: unknown) { return { success: false, error: e instanceof Error ? e.message : String(e) }; }
      }),
    workflowEngineStatus: protectedProcedure.query(async () => {
      try {
        const res = await fetch("http://localhost:8170/health", { signal: AbortSignal.timeout(2000) });
        if (!res.ok) return { status: "unreachable", connected: false };
        return await res.json();
      } catch (e) { logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[Health] Workflow Engine unreachable"); return { status: "unreachable", connected: false }; }
    }),
    daprBindingsStatus: protectedProcedure.query(async () => {
      try {
        const res = await fetch("http://localhost:8120/health", { signal: AbortSignal.timeout(2000) });
        if (!res.ok) return { status: "unreachable", pubsub: false, stateStore: false };
        return await res.json();
      } catch (e) { logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[Health] Dapr Bindings unreachable"); return { status: "unreachable", pubsub: false, stateStore: false }; }
    }),
    lakehouseStatus: protectedProcedure.query(async () => {
      const health = await lakehouseHealth();
      const tables = health.healthy ? await lakehouseListTables() : [];
      return { status: health.healthy ? "healthy" : "unreachable", tablesLoaded: tables.length, namespaces: health.namespaces ?? [], catalogUrl: health.catalogUrl, error: health.error };
    }),
    lakehouseQuery: adminProcedure
      .input(z.object({ sql: z.string().min(1), params: z.array(z.unknown()).optional() }))
      .mutation(async ({ input }) => {
        return lakehouseQuery(input.sql, input.params as unknown[] | undefined);
      }),
    lakehouseIngest: adminProcedure
      .input(z.object({ table: z.string(), namespace: z.string().default("ndsep"), records: z.array(z.record(z.string(), z.unknown())) }))
      .mutation(async ({ input }) => {
        return lakehouseIngest(input.table, input.records as Record<string, unknown>[], input.namespace);
      }),
    lakehouseSmokeTest: adminProcedure.mutation(async () => lakehouseSmokeTest()),
    fluvioStatus: protectedProcedure.query(async () => {
      const health = await fluvioHealth();
      const topics = health.healthy ? await fluvioListTopics() : [];
      return { status: health.healthy ? "healthy" : "unreachable", version: health.version, topics: topics.length, topicList: topics, error: health.error };
    }),
    fluvioProduce: adminProcedure
      .input(z.object({ topic: z.string(), key: z.string().optional(), value: z.record(z.string(), z.unknown()) }))
      .mutation(async ({ input }) => {
        return fluvioProduce(input.topic, [{ key: input.key, value: input.value as Record<string, unknown> }]);
      }),
    fluvioSmokeTest: adminProcedure.mutation(async () => fluvioSmokeTest()),
    apisixStatus: protectedProcedure.query(async () => {
      const health = await apisixHealth();
      const routes = health.healthy ? await apisixListRoutes() : [];
      return { status: health.healthy ? "healthy" : "unreachable", routes: routes.length, routeList: routes, error: health.error };
    }),
    apisixSyncRoutes: adminProcedure.mutation(async () => apisixSyncNdsepRoutes()),
    apisixSmokeTest: adminProcedure.mutation(async () => apisixSmokeTest()),
    mlPipelineStatus: protectedProcedure.query(async () => {
      try {
        const res = await fetch("http://localhost:8125/health", { signal: AbortSignal.timeout(2000) });
        if (!res.ok) return { status: "unreachable", modelVersion: null };
        return await res.json();
      } catch (e) { logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[Health] ML Pipeline unreachable"); return { status: "unreachable", modelVersion: null }; }
    }),
    /** Keycloak SSO: verify a JWT using the native keycloak.ts helper */
    keycloakVerifyToken: adminProcedure
      .input(z.object({ token: z.string().min(10) }))
      .mutation(async ({ input }) => {
        const kcUser = await verifyKeycloakToken(input.token);
        if (!kcUser) return { valid: false, user: null };
        return { valid: true, user: { sub: kcUser.sub, username: kcUser.username, email: kcUser.email, name: kcUser.name, roles: kcUser.roles, clientRoles: kcUser.clientRoles, ndsepRole: mapKeycloakRoleToNdsep(kcUser) } };
      }),
    /** Keycloak SSO: health check */
    keycloakHealth: protectedProcedure.query(async () => {
      const healthy = await isKeycloakHealthy();
      const realmInfo = healthy ? await getKeycloakRealmInfo() : null;
      return { healthy, realm: process.env.KEYCLOAK_REALM ?? "ndsep", url: process.env.KEYCLOAK_URL ?? "http://localhost:8080", realmInfo };
    }),
  }),
  leaderboard: router({
    list: protectedProcedure
      .input(z.object({
        sector: z.string().optional(),
        limit: z.number().default(50),
        anonymise: z.boolean().default(false),
      }).optional())
      .query(async ({ input }) => getLeaderboard(input?.sector, input?.limit, input?.anonymise)),
    stats: protectedProcedure
      .input(z.object({ sector: z.string().optional() }).optional())
      .query(async ({ input }) => getLeaderboardStats(input?.sector)),
    scoreTrend: protectedProcedure
      .input(z.object({ orgId: z.number() }))
      .query(async ({ input }) => getOrgScoreTrend(input.orgId)),
    sectorAvgTrend: protectedProcedure
      .input(z.object({ sector: z.string() }))
      .query(async ({ input }) => getSectorAvgTrend(input.sector)),
  }),
  verify: router({
    certificate: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const submission = await getPortalSubmissionByCertToken(input.token);
        if (!submission) return { valid: false, message: "Certificate not found" };
        if (submission.currentPhase !== "certified") {
          return { valid: false, message: "Organisation is not yet certified", phase: submission.currentPhase };
        }
        return {
          valid: true,
          orgName: submission.orgName,
          orgSector: submission.orgSector,
          orgCountry: submission.orgCountry,
          certifiedAt: submission.certifiedAt,
          complianceScore: submission.complianceScore,
          token: submission.submissionToken,
          message: "Certificate is valid and active",
        };
      }),
  }),
  reports: router({
    violations: protectedProcedure
      .input(z.object({
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
        sector: z.string().optional(),
        severity: z.string().optional(),
        limit: z.number().optional(),
      }))
      .query(async ({ input }) => getViolationsReport({
        fromDate: input.fromDate ? new Date(input.fromDate) : undefined,
        toDate: input.toDate ? new Date(input.toDate) : undefined,
        sector: input.sector,
        severity: input.severity,
        limit: input.limit,
      })),
    penalties: protectedProcedure
      .input(z.object({
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
        sector: z.string().optional(),
        paymentStatus: z.string().optional(),
        limit: z.number().optional(),
      }))
      .query(async ({ input }) => getPenaltiesReport({
        fromDate: input.fromDate ? new Date(input.fromDate) : undefined,
        toDate: input.toDate ? new Date(input.toDate) : undefined,
        sector: input.sector,
        paymentStatus: input.paymentStatus,
        limit: input.limit,
      })),
    complianceScores: protectedProcedure
      .input(z.object({ sector: z.string().optional(), limit: z.number().optional() }))
      .query(async ({ input }) => getComplianceScoresReport({ sector: input.sector, limit: input.limit })),
    generate: protectedProcedure
      .input(z.object({
        reportType: z.enum(["violations", "penalties", "compliance_scores", "full_audit", "executive_summary"]),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
        sector: z.string().optional(),
        format: z.enum(["json", "csv", "pdf"]).default("json"),
        title: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const now = new Date();
        const reportId = `RPT-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
        await createAuditLog({ userId: ctx.user.id, action: "generate_report", resourceType: "report", details: JSON.stringify({ reportType: input.reportType, format: input.format }) });
        return {
          reportId,
          reportType: input.reportType,
          title: input.title || `${input.reportType.replace(/_/g, " ").toUpperCase()} Report`,
          generatedAt: now.toISOString(),
          generatedBy: ctx.user.name,
          format: input.format,
          status: "generated",
          downloadUrl: `/api/reports/${reportId}.${input.format}`,
          filters: { fromDate: input.fromDate, toDate: input.toDate, sector: input.sector },
        };
      }),
    schedule: protectedProcedure
      .input(z.object({
        reportType: z.enum(["violations", "penalties", "compliance_scores", "full_audit", "executive_summary"]),
        frequency: z.enum(["daily", "weekly", "monthly", "quarterly"]),
        recipients: z.array(z.string().email()),
        sector: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        await createAuditLog({ userId: ctx.user.id, action: "schedule_report", resourceType: "report", details: JSON.stringify({ reportType: input.reportType, frequency: input.frequency }) });
        return {
          scheduleId: `SCH-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
          reportType: input.reportType,
          frequency: input.frequency,
          recipients: input.recipients,
          nextRunAt: new Date(Date.now() + 86400000).toISOString(),
          createdBy: ctx.user.name,
          status: "active",
        };
      }),
  }),
  sectors: router({
    list: protectedProcedure
      .input(z.object({ parentId: z.number().nullable().optional() }))
      .query(async ({ input }) => listSectors(input.parentId)),
    create: protectedProcedure
      .input(z.object({ name: z.string(), code: z.string(), description: z.string().optional(), parentId: z.number().optional(), regulatoryFramework: z.string().optional() }))
      .mutation(async ({ input }) => createSector(input)),
    stats: protectedProcedure.query(async () => getSectorStats()),
    benchmark: protectedProcedure.query(async () => getSectorBenchmark()),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const { deleteSector } = await import("./db");
        return deleteSector(input.id);
      }),
  }),
  citizenRights: router({
    list: protectedProcedure
      .input(z.object({ status: z.string().optional(), requestType: z.string().optional() }))
      .query(async ({ input }) => listCitizenRequests(input.status as any, input.requestType as any)),
    submit: protectedProcedure
      .input(z.object({ requestType: z.string(), citizenName: z.string(), citizenEmail: z.string(), citizenNin: z.string().optional(), description: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const result = await createCitizenRequest(input as any);
        const reqId = (result as any)?.id ?? 0;
        // Temporal: auto-trigger DSAR fulfillment workflow (30-day statutory deadline)
        if (input.requestType === "dsar" || input.requestType === "erasure" || input.requestType === "access") {
          startWorkflow("dsar-fulfillment", {
            workflowId: `dsar-${reqId}`,
            taskQueue: "ndsep-dsar",
            input: { requestId: String(reqId), requestType: input.requestType, citizenEmail: input.citizenEmail, deadlineDays: 30, steps: ["acknowledge", "identity-verify", "data-locate", "data-compile", "review", "deliver", "close"] },
          }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "temporal fire-and-forget"));
        }
        // CQRS command dispatch
        dispatchCommand({ type: "dsar.fulfill", aggregateType: "CitizenRequest", aggregateId: String(reqId), payload: { requestType: input.requestType, citizenEmail: input.citizenEmail }, metadata: { userId: ctx.user.id, source: "routers.citizenRights.submit" } }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "cqrs fire-and-forget"));
        return result;
      }),
    update: protectedProcedure
      .input(z.object({ id: z.number(), status: z.string(), responseNotes: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const result = await updateCitizenRequest(id, data as any);
        // Fire-and-forget email notification to citizen
        const req = result as any;
        if (req?.citizenEmail) {
          const portalUrl = `${process.env.PLATFORM_URL ?? ""}/citizen-rights`;
          sendCitizenRequestUpdate({
            to: req.citizenEmail,
            citizenName: req.citizenName ?? "Data Subject",
            requestType: req.requestType ?? "Data Rights Request",
            requestRef: `NDSEP-CR-${String(id).padStart(6, "0")}`,
            newStatus: input.status,
            orgName: req.orgName ?? "Organization",
            message: input.responseNotes,
            portalUrl,
          }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        createAuditLog({ userId: ctx.user.id, action: "citizen_request.update", resourceType: "citizen_request", resourceId: id, details: `Status updated to ${input.status}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // Publish to Kafka
        const req2 = result as any;
        publishCitizenRightsRequest({
          requestId: id,
          citizenId: req2?.citizenNin ?? String(id),
          requestType: req2?.requestType ?? "unknown",
          status: input.status,
          orgId: req2?.organizationId ?? 0,
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteCitizenRequest(input.id);
        createAuditLog({ userId: ctx.user.id, action: "citizen_request.delete", resourceType: "citizen_request", resourceId: input.id, details: `Deleted citizen_request #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),
  remediation: router({
    list: protectedProcedure
      .input(z.object({ orgId: z.number().optional(), status: z.string().optional() }))
      .query(async ({ input }) => listRemediationWorkflows(input.orgId, input.status as any)), // cast: zod string → enum
    create: protectedProcedure
      .input(z.object({
        orgId: z.number().int().positive(),
        actionType: z.string().min(1),
        priority: z.enum(["low", "medium", "high", "critical"]).optional(),
        description: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createRemediationWorkflow(input);
        createAuditLog({ userId: ctx.user.id, action: "remediation.create", resourceType: "remediation_workflow", resourceId: result?.id, details: `Created remediation workflow: ${input.actionType}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    update: protectedProcedure
      .input(z.object({ id: z.number(), status: z.string(), notes: z.string().optional() }))
      .mutation(async ({ input }) => updateRemediationWorkflow(input.id, { status: input.status as any, notes: input.notes })),
    stats: protectedProcedure.query(async () => {
      const workflows = await listRemediationWorkflows();
      return {
        total: workflows.length,
        open: workflows.filter((w: Record<string, unknown>) => w.status === "open").length,
        in_progress: workflows.filter((w: Record<string, unknown>) => w.status === "in_progress").length,
        resolved: workflows.filter((w: Record<string, unknown>) => w.status === "resolved").length,
      };
    }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteRemediationWorkflow(input.id);
        createAuditLog({ userId: ctx.user.id, action: "remediation.delete", resourceType: "remediation_workflow", resourceId: input.id, details: `Deleted remediation_workflow #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),
  tia: router({
    list: protectedProcedure
      .input(z.object({ orgId: z.number().optional() }))
      .query(async ({ input }) => listTiaAssessments(input.orgId)),
    create: protectedProcedure
      .input(z.object({
        organizationId: z.number(),
        destinationCountry: z.string(),
        dataCategories: z.array(z.string()).optional(),
        legalBasis: z.string(),
        riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
        tiaDocument: z.string().optional(),
        safeguards: z.string().optional(),
        transferApprovalId: z.number().optional(),
      }))
      .mutation(async ({ input }) => createTiaAssessment({
        ...input,
        dataCategories: input.dataCategories ?? [],
        riskLevel: input.riskLevel ?? "medium",
      })),
    stats: protectedProcedure.query(async () => {
      const assessments = await listTiaAssessments();
      return {
        total: assessments.length,
        high_risk: assessments.filter((a: Record<string, unknown>) => a.riskLevel === "high" || a.riskLevel === "critical").length,
        approved: assessments.filter((a: Record<string, unknown>) => a.status === "approved").length,
        pending: assessments.filter((a: Record<string, unknown>) => a.status === "draft" || a.status === "submitted").length,
      };
    }),
    submit: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => updateTiaAssessment(input.id, { status: "submitted" })),
    approve: approveProcedure
      .input(z.object({ id: z.number(), notes: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const result = await updateTiaAssessment(input.id, { status: "approved", reviewedBy: ctx.user.id });
        // Notify owner and attempt email to org
        try {
          const assessments = await listTiaAssessments();
          const assessment = assessments.find((a: Record<string, unknown>) => a.id === input.id);
          if (assessment) {
            const { getOrganizationById } = await import("./db");
            const org = await getOrganizationById((assessment as any).organizationId);
            const { notifyOwner } = await import("./_core/notification");
            await notifyOwner({
              title: `TIA-${String(input.id).padStart(5, "0")} Approved`,
              content: `Transfer Impact Assessment for ${org?.name ?? `Org #${(assessment as any).organizationId}`} → ${(assessment as any).destinationCountry} approved by reviewer #${ctx.user.id}. ${input.notes ?? ""}`
            });
          }
        } catch (e) { /* notification is best-effort */ }
        return result;
      }),
    reject: protectedProcedure
      .input(z.object({ id: z.number(), reason: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const result = await updateTiaAssessment(input.id, { status: "rejected", reviewedBy: ctx.user.id });
        try {
          const assessments = await listTiaAssessments();
          const assessment = assessments.find((a: Record<string, unknown>) => a.id === input.id);
          if (assessment) {
            const { getOrganizationById } = await import("./db");
            const org = await getOrganizationById((assessment as any).organizationId);
            const { notifyOwner } = await import("./_core/notification");
            await notifyOwner({
              title: `TIA-${String(input.id).padStart(5, "0")} Rejected`,
              content: `Transfer Impact Assessment for ${org?.name ?? `Org #${(assessment as any).organizationId}`} → ${(assessment as any).destinationCountry} rejected. Reason: ${input.reason}`
            });
          }
        } catch (e) { /* notification is best-effort */ }
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteTiaAssessment(input.id);
        createAuditLog({ userId: ctx.user.id, action: "tia.delete", resourceType: "tia_assessment", resourceId: input.id, details: `Deleted tia_assessment #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),
  gitopsConfig: router({
    list: protectedProcedure
      .input(z.object({ limit: z.number().optional() }))
      .query(async ({ input }) => listConfigSnapshots(input.limit)),
    snapshot: protectedProcedure
      .input(z.object({ configType: z.string() }))
      .mutation(async ({ input, ctx }) => createConfigSnapshot({
        snapshotName: `${input.configType}-snapshot-${Date.now()}`,
        source: (input.configType as "manual" | "git" | "api") ?? "manual",
        configData: JSON.stringify({ type: input.configType, capturedAt: new Date().toISOString() }),
        status: "pending",
        createdBy: ctx.user.id,
      })),
    applySnapshot: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { eq } = await import("drizzle-orm");
        const { configSnapshots } = await import("../drizzle/schema");
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.update(configSnapshots).set({ status: "synced" }).where(eq(configSnapshots.id, input.id));
        return { success: true };
      }),
    stats: protectedProcedure.query(async () => {
      const snaps = await listConfigSnapshots(1000);
      return {
        total: snaps.length,
        applied: snaps.filter((s: Record<string, unknown>) => s.status === "applied").length,
        pending: snaps.filter((s: Record<string, unknown>) => s.status === "pending").length,
      };
    }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteConfigSnapshot(input.id);
        createAuditLog({ userId: ctx.user.id, action: "config_snapshot.delete", resourceType: "config_snapshot", resourceId: input.id, details: `Deleted config_snapshot #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),
  enforcementCases: router({
    openCount: protectedProcedure
      .query(async () => {
        const cases = await getEnforcementCases(200);
        const count = (cases as any[]).filter((c: any) => !['settled', 'closed'].includes(c.status)).length;
        return { count };
      }),
    list: protectedProcedure
      .input(z.object({ limit: z.number().default(50) }).optional())
      .query(async ({ input }) => getEnforcementCases(input?.limit)),
    byOrg: protectedProcedure
      .input(z.object({ organizationId: z.number().int().positive(), limit: z.number().default(20) }))
      .query(async ({ input }) => getEnforcementCases(input.limit, input.organizationId)),
    create: adminProcedure
      .input(z.object({
        penaltyId: z.number().int().positive(),
        organizationId: z.number().int().positive(),
        escalationReason: z.string().optional(),
        assignedOfficerId: z.number().int().positive().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createEnforcementCase(input);
        createAuditLog({ userId: ctx.user.id, action: "enforcement.escalate", resourceType: "penalty", resourceId: input.penaltyId, details: `Escalated penalty #${input.penaltyId} to enforcement case` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        notifyOwner({ title: `[NDSEP] Penalty Escalated — Case Opened`, content: `Penalty #${input.penaltyId} for org #${input.organizationId} has been escalated. Case ref: ${result?.case_reference ?? 'N/A'}. Reason: ${input.escalationReason ?? 'Overdue payment'}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // Fire-and-forget email to organization DPO
        getOrganizationById(input.organizationId).then(org => {
          const o = org as any;
          if (o?.contactEmail) {
            sendEnforcementCaseOpened({
              to: o.contactEmail,
              orgName: o.name ?? `Organization #${input.organizationId}`,
              caseRef: result?.case_reference ?? `NDSEP-CASE-${String(result?.id ?? 0).padStart(6, "0")}`,
              caseTitle: input.escalationReason ?? "Penalty Non-Payment — Enforcement Escalation",
              severity: "high",
              portalUrl: `${process.env.PLATFORM_URL ?? ""}/enforcement-cases`,
            }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          }
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // Publish to Kafka
        publishEnforcementCaseOpened({
          caseId: result?.id ?? 0,
          orgId: input.organizationId,
          caseType: "penalty_escalation",
          severity: "high",
          openedBy: String(ctx.user.id),
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // Trigger Temporal enforcement-lifecycle workflow
        startWorkflow("enforcement-lifecycle", {
          workflowId: `enforcement-${result?.id ?? 0}`,
          taskQueue: "ndsep-enforcement",
          input: { caseId: String(result?.id ?? 0), orgId: input.organizationId, orgName: `Org-${input.organizationId}`, caseType: "penalty_escalation", severity: "high", steps: ["investigation", "evidence-collection", "hearing", "decision", "penalty-enforcement"] },
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "temporal fire-and-forget"));
        // CQRS command dispatch
        dispatchCommand({ type: "enforcement.create", aggregateType: "EnforcementCase", aggregateId: String(result?.id ?? 0), payload: { orgId: input.organizationId, penaltyId: input.penaltyId, reason: input.escalationReason }, metadata: { userId: ctx.user.id, source: "routers.enforcement.escalate" } }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "cqrs fire-and-forget"));
        // Create in-app notification (fire-and-forget)
        createInAppNotification({
          title: `Enforcement Case Opened: ${result?.case_reference ?? `NDSEP-CASE-${String(result?.id ?? 0).padStart(6, "0")}`}`,
          message: `Penalty #${input.penaltyId} for organisation #${input.organizationId} has been escalated to an enforcement case. Reason: ${input.escalationReason ?? "Overdue payment"}.`,
          severity: "critical",
          category: "enforcement",
          organizationId: input.organizationId,
          userId: ctx.user.id,
          actionUrl: "/enforcement-cases",
          metadata: { caseId: result?.id, caseRef: result?.case_reference, penaltyId: input.penaltyId },
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    update: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        status: z.enum(["open", "under_investigation", "notice_issued", "escalated_to_nitda", "settled", "closed"]).optional(),
        nitdaReferenceNumber: z.string().optional(),
        resolutionNotes: z.string().optional(),
        assignedOfficerId: z.number().int().positive().optional(),
        note: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Fetch current case to record fromStatus in timeline
        const allCases = await getEnforcementCases(200);
        const current = (allCases as any[]).find((c: any) => c.id === input.id);
        const result = await updateEnforcementCase(input);
        // Write timeline entry if status changed
        if (input.status && current?.status !== input.status) {
          addCaseTimelineEntry({
            caseId: input.id,
            changedByUserId: ctx.user.id,
            changedByName: ctx.user.name ?? ctx.user.email ?? 'Officer',
            fromStatus: current?.status ?? null,
            toStatus: input.status,
            note: input.note ?? input.resolutionNotes ?? null,
            nitdaRef: input.nitdaReferenceNumber ?? null,
          }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        createAuditLog({ userId: ctx.user.id, action: "enforcement.update", resourceType: "enforcement_case", resourceId: input.id, details: `Updated enforcement case #${input.id} status: ${input.status ?? 'unchanged'}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    timeline: protectedProcedure
      .input(z.object({ caseId: z.number().int().positive() }))
      .query(async ({ input }) => getCaseTimeline(input.caseId)),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteEnforcementCase(input.id);
        createAuditLog({ userId: ctx.user.id, action: "enforcement_case.delete", resourceType: "enforcement_case", resourceId: input.id, details: `Deleted enforcement_case #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),
  certificates: router({
    expiring: protectedProcedure
      .input(z.object({ withinDays: z.number().default(90) }).optional())
      .query(async ({ input }) => getExpiringCertificates(input?.withinDays ?? 90)),
  }),
  onboarding: router({
    getPhases: protectedProcedure
      .input(z.object({ submissionId: z.number().int().positive() }))
      .query(async ({ input }) => getOnboardingPhases(input.submissionId)),
    updatePhase: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        status: z.enum(["pending", "in_progress", "completed", "failed"]),
        notes: z.string().optional(),
        workerResults: z.any().optional(),
      }))
      .mutation(async ({ input }) => updateOnboardingPhase(input)),
    listAll: protectedProcedure
      .query(async () => listOnboardingPhases()),
  }),
  notifications: router({
    list: protectedProcedure
      .input(z.object({ limit: z.number().int().positive().max(100).default(50), onlyUnread: z.boolean().default(false) }))
      .query(async ({ input }) => getInAppNotifications(input.limit, input.onlyUnread)),
    unreadCount: protectedProcedure
      .query(async () => getUnreadNotificationCount()),
    markRead: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => { await markNotificationRead(input.id); return { success: true }; }),
    markAllRead: protectedProcedure
      .mutation(async () => { await markAllNotificationsRead(); return { success: true }; }),
  }),
  notificationSettings: router({
    get: protectedProcedure
      .input(z.object({ organizationId: z.number().int().positive() }))
      .query(async ({ input, ctx }) => {
        if (!canAccessOrg(ctx.user, input.organizationId)) throw new TRPCError({ code: "FORBIDDEN" });
        return getNotificationSettings(input.organizationId);
      }),
    upsert: protectedProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        penaltyIssued: z.boolean().optional(),
        penaltyPaid: z.boolean().optional(),
        penaltyAppealFiled: z.boolean().optional(),
        penaltyAppealDecision: z.boolean().optional(),
        enforcementCaseOpened: z.boolean().optional(),
        certificateGranted: z.boolean().optional(),
        portalPhaseUpdate: z.boolean().optional(),
        citizenRequestUpdate: z.boolean().optional(),
        slaBreachWarning: z.boolean().optional(),
        complianceScoreChange: z.boolean().optional(),
        dpoEmail: z.string().email().optional().nullable(),
        technicalEmail: z.string().email().optional().nullable(),
        legalEmail: z.string().email().optional().nullable(),
        digestFrequency: z.enum(["immediate", "daily", "weekly"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { organizationId, ...settings } = input;
        if (!canAccessOrg(ctx.user, organizationId)) throw new TRPCError({ code: "FORBIDDEN" });
        createAuditLog({ userId: ctx.user.id, action: "settings.notification.update", resourceType: "organization", resourceId: organizationId, details: `Updated notification settings for org #${organizationId}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return upsertNotificationSettings(organizationId, settings);
      }),
  }),
  // Gap 1: Consent Management (NDPA S.25–27, GAID Art. 16–20)
  consent: router({
    list: protectedProcedure
      .input(z.object({ orgId: z.number().optional(), status: z.string().optional(), limit: z.number().default(100) }).optional())
      .query(async ({ input }) => listConsentRecords(input?.orgId, input?.status, input?.limit)),
    stats: protectedProcedure
      .input(z.object({ orgId: z.number().optional() }).optional())
      .query(async ({ input }) => getConsentStats(input?.orgId)),
    create: protectedProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        dataSubjectName: z.string().min(1).max(256),
        dataSubjectEmail: z.string().email(),
        dataSubjectNin: z.string().max(64).optional(),
        purpose: z.string().min(1),
        lawfulBasis: z.enum(["consent", "contract", "legal_obligation", "vital_interest", "public_interest", "legitimate_interest"]),
        dataCategories: z.array(z.string()).optional(),
        processingActivities: z.array(z.string()).optional(),
        thirdPartySharing: z.boolean().optional(),
        crossBorderTransfer: z.boolean().optional(),
        evidenceRef: z.string().optional(),
        expiresAt: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // BUSINESS RULE: Cross-border transfers require adequacy check
        if (input.crossBorderTransfer) {
          kafkaProduce("ndsep.consent.cross_border_check", `consent-xb-${Date.now()}`, { orgId: input.organizationId, email: input.dataSubjectEmail, requiresAdequacy: true, jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        // BUSINESS RULE: Third-party sharing requires explicit consent basis
        if (input.thirdPartySharing && input.lawfulBasis !== "consent") {
          kafkaProduce("ndsep.consent.third_party_warning", `consent-tp-${Date.now()}`, { orgId: input.organizationId, email: input.dataSubjectEmail, basis: input.lawfulBasis, warning: "Third-party sharing without explicit consent basis", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        const result = await createConsentRecord(input);
        createAuditLog({ userId: ctx.user.id, organizationId: input.organizationId, action: "consent.create", resourceType: "consent_record", resourceId: result?.id, details: `Consent recorded for ${input.dataSubjectEmail}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        kafkaProduce("ndsep.consent.created", `consent-${result?.id}`, { consentId: result?.id, orgId: input.organizationId, email: input.dataSubjectEmail, basis: input.lawfulBasis, jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        daprPublish("ndsep.consent.created", { consentId: result?.id, orgId: input.organizationId, basis: input.lawfulBasis }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        daprStateSet(`consent:${input.organizationId}:${input.dataSubjectEmail}`, JSON.stringify({ status: "active", basis: input.lawfulBasis, id: result?.id }), 86400).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        consentStatus: z.enum(["active", "withdrawn", "expired", "pending"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const withdrawnAt = input.consentStatus === "withdrawn" ? new Date() : undefined;
        const result = await updateConsentRecord(input.id, { consentStatus: input.consentStatus, consentWithdrawnAt: withdrawnAt });
        createAuditLog({ userId: ctx.user.id, action: "consent.update", resourceType: "consent_record", resourceId: input.id, details: `Consent status changed to ${input.consentStatus}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        if (input.consentStatus === "withdrawn") {
          // BUSINESS RULE: Consent withdrawal triggers data deletion cascade (NDPA S.27)
          kafkaProduce("ndsep.consent.withdrawn", `consent-${input.id}`, { consentId: input.id, status: input.consentStatus, jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          // Trigger data deletion workflow via Dapr
          daprPublish("ndsep.consent.data_deletion_required", { consentId: input.id, withdrawnAt: new Date().toISOString(), slaDeadlineDays: getActiveJurisdiction().consentWithdrawalDays ?? 30 }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          // Notify third parties to cease processing
          daprPublish("ndsep.consent.third_party_cease_processing", { consentId: input.id }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          // Update Dapr state to revoked
          daprStateSet(`consent:revoked:${input.id}`, JSON.stringify({ revokedAt: new Date().toISOString(), reason: "withdrawal" }), 2592000).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteConsentRecord(input.id);
        createAuditLog({ userId: ctx.user.id, action: "consent.delete", resourceType: "consent_record", resourceId: input.id, details: `Deleted consent_record #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),

  // Gap 2: Data Breach Notification (NDPA S.47, GAID Art. 31–36)
  breaches: router({
    list: protectedProcedure
      .input(z.object({ orgId: z.number().optional(), status: z.string().optional(), limit: z.number().default(50) }).optional())
      .query(async ({ input }) => listBreachIncidents(input?.orgId, input?.status, input?.limit)),
    create: protectedProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        title: z.string().min(1).max(512),
        description: z.string().optional(),
        severity: z.enum(["low", "medium", "high", "critical"]).optional(),
        dataTypesAffected: z.array(z.string()).optional(),
        breachCause: z.string().optional(),
        affectedIndividualsCount: z.number().int().optional(),
        reportedBy: z.number().int().optional(),
        assignedTo: z.number().int().optional(),
        securityAlertId: z.number().int().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const jurisdiction = getActiveJurisdiction();
        const breachDeadlineHours = jurisdiction.breachNotificationHours ?? 72;
        const result = await createBreachIncident(input);
        createAuditLog({ userId: ctx.user.id, organizationId: input.organizationId, action: "breach.create", resourceType: "breach_incident", resourceId: result?.id, details: `Breach incident reported: ${input.title}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // Permify: reporter owns the breach incident, org has viewer access
        permifyWriteRelationship("breach_incident", String(result?.id ?? 0), "owner", "user", String(ctx.user.id)).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "permify fire-and-forget"));
        permifyWriteRelationship("breach_incident", String(result?.id ?? 0), "viewer", "organization", String(input.organizationId)).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "permify fire-and-forget"));
        // Temporal: auto-trigger breach-response workflow
        startWorkflow("breach-response", {
          workflowId: `breach-main-${result?.id ?? 0}`,
          taskQueue: "ndsep-breach",
          input: { breachId: String(result?.id ?? 0), orgId: input.organizationId, severity: input.severity ?? "medium", title: input.title, deadlineHours: breachDeadlineHours, steps: ["containment", "assessment", "ndpc-notification", "individual-notification", "remediation", "post-mortem"] },
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "temporal fire-and-forget"));
        // CQRS command dispatch
        dispatchCommand({ type: "breach.report", aggregateType: "BreachIncident", aggregateId: String(result?.id ?? 0), payload: { orgId: input.organizationId, severity: input.severity, title: input.title }, metadata: { userId: ctx.user.id, source: "routers.breach.create" } }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "cqrs fire-and-forget"));
        // BUSINESS RULE: Start 72-hour NDPC notification countdown (NDPA S.47)
        kafkaProduce("ndsep.breach.detected", `breach-${result?.id}`, {
          breachId: result?.id, orgId: input.organizationId, severity: input.severity ?? "medium",
          title: input.title, deadlineHours: breachDeadlineHours,
          ndpcDeadline: new Date(Date.now() + breachDeadlineHours * 3600000).toISOString(),
          jurisdiction: jurisdiction.code, ts: new Date().toISOString(),
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        daprPublish("ndsep.breach.detected", { breachId: result?.id, organizationId: input.organizationId, severity: input.severity ?? "medium", title: input.title, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // BUSINESS RULE: Critical/High severity triggers immediate escalation
        if (input.severity === "critical" || input.severity === "high") {
          kafkaProduce("ndsep.breach.escalation", `breach-esc-${result?.id}`, { breachId: result?.id, severity: input.severity, orgId: input.organizationId, requiresImmediateAction: true, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.breach.escalation", { breachId: result?.id, severity: input.severity, orgId: input.organizationId });
        }
        // BUSINESS RULE: If affected individuals > 1000, auto-escalate to NDPC priority review
        if ((input.affectedIndividualsCount ?? 0) > 1000) {
          kafkaProduce("ndsep.breach.mass_impact", `breach-mass-${result?.id}`, { breachId: result?.id, affected: input.affectedIndividualsCount, threshold: 1000, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        broadcast("org_portal", { type: "new_alert", payload: { id: result?.id ?? 0, title: input.title, severity: input.severity ?? "medium", source: "breach_notification", organizationId: input.organizationId, detectedAt: new Date() } });
        return result;
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        status: z.enum(["detected", "assessing", "ndpc_notified", "individuals_notified", "contained", "resolved", "closed"]).optional(),
        ndpcReferenceNumber: z.string().optional(),
        remediationActions: z.string().optional(),
        affectedIndividualsCount: z.number().int().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const ndpcNotifiedAt = input.status === "ndpc_notified" ? new Date() : undefined;
        const individualsNotifiedAt = input.status === "individuals_notified" ? new Date() : undefined;
        const containedAt = input.status === "contained" ? new Date() : undefined;
        const resolvedAt = input.status === "resolved" || input.status === "closed" ? new Date() : undefined;
        const result = await updateBreachIncident(id, { ...data, ndpcNotifiedAt, individualsNotifiedAt, containedAt, resolvedAt });
        createAuditLog({ userId: ctx.user.id, action: "breach.update", resourceType: "breach_incident", resourceId: id, details: `Breach #${id} status: ${input.status}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // BUSINESS RULE: Status transition events
        if (input.status === "ndpc_notified") {
          kafkaProduce("ndsep.breach.ndpc_notified", `breach-ndpc-${id}`, { breachId: id, ndpcRef: input.ndpcReferenceNumber, notifiedAt: new Date().toISOString(), jurisdiction: getActiveJurisdiction().code }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.breach.ndpc_notified", { breachId: id, ndpcRef: input.ndpcReferenceNumber }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        if (input.status === "individuals_notified") {
          kafkaProduce("ndsep.breach.individuals_notified", `breach-ind-${id}`, { breachId: id, affectedCount: input.affectedIndividualsCount, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        if (input.status === "contained") {
          kafkaProduce("ndsep.breach.contained", `breach-cont-${id}`, { breachId: id, containedAt: new Date().toISOString(), remediation: input.remediationActions }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        if (input.status === "resolved" || input.status === "closed") {
          kafkaProduce("ndsep.breach.resolved", `breach-res-${id}`, { breachId: id, status: input.status, resolvedAt: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.breach.resolved", { breachId: id, status: input.status }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteBreachIncident(input.id);
        createAuditLog({ userId: ctx.user.id, action: "breach.delete", resourceType: "breach_incident", resourceId: input.id, details: `Deleted breach_incident #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    activeCount: protectedProcedure.query(async () => {
      const all = await listBreachIncidents(undefined, undefined, 500);
      const count = (all as any[]).filter((b: any) => !["resolved", "closed"].includes(b.status)).length;
      return { count };
    }),
  }),

  // Gap 3: DPO Registry (GAID Art. 11–14)
  dpoRegistry: router({
    list: protectedProcedure
      .input(z.object({ orgId: z.number().optional(), limit: z.number().default(100) }).optional())
      .query(async ({ input }) => listDpoAppointments(input?.orgId, input?.limit)),
    create: adminProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        dpoName: z.string().min(1).max(256),
        dpoEmail: z.string().email(),
        dpoPhone: z.string().optional(),
        dpcoId: z.string().optional(),
        dpcoName: z.string().optional(),
        certificationExpiresAt: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createDpoAppointment(input);
        createAuditLog({ userId: ctx.user.id, organizationId: input.organizationId, action: "dpo.appoint", resourceType: "dpo_appointment", resourceId: result?.id, details: `DPO appointed: ${input.dpoName}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        kafkaProduce("ndsep.dpo.appointed", `dpo-${result?.id}`, { dpoId: result?.id, orgId: input.organizationId, name: input.dpoName, email: input.dpoEmail, jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    update: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        credentialStatus: z.enum(["pending", "verified", "expired", "revoked"]).optional(),
        independenceVerified: z.boolean().optional(),
        trainingHoursCompleted: z.number().optional(),
        isActive: z.boolean().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const result = await updateDpoAppointment(id, data);
        createAuditLog({ userId: ctx.user.id, action: "dpo.update", resourceType: "dpo_appointment", resourceId: id, details: `DPO record #${id} updated` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // BUSINESS RULE: Credential status changes trigger compliance events
        if (data.credentialStatus === "expired" || data.credentialStatus === "revoked") {
          kafkaProduce("ndsep.dpo.credential_alert", `dpo-cred-${id}`, { dpoId: id, credentialStatus: data.credentialStatus, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.dpo.credential_alert", { dpoId: id, status: data.credentialStatus, alert: "DPO credential no longer valid — organization compliance at risk" }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        // BUSINESS RULE: DPO deactivation requires replacement check
        if (data.isActive === false) {
          kafkaProduce("ndsep.dpo.deactivated", `dpo-deact-${id}`, { dpoId: id, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.dpo.replacement_required", { dpoId: id, alert: "Organization must appoint a replacement DPO per GAID Art. 11" }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteDpoAppointment(input.id);
        createAuditLog({ userId: ctx.user.id, action: "dpo.delete", resourceType: "dpo_appointment", resourceId: input.id, details: `Deleted dpo_appointment #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),

  // Gap 4: DPIA Assessments (GAID Art. 28)
  dpia: router({
    list: protectedProcedure
      .input(z.object({ orgId: z.number().optional(), status: z.string().optional(), limit: z.number().default(50) }).optional())
      .query(async ({ input }) => listDpiaAssessments(input?.orgId, input?.status, input?.limit)),
    create: protectedProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        title: z.string().min(1).max(512),
        processingDescription: z.string().min(1),
        triggerCategory: z.string().min(1),
        riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
        dataCategories: z.array(z.string()).optional(),
        purposeOfProcessing: z.string().optional(),
        necessityAssessment: z.string().optional(),
        riskAssessment: z.string().optional(),
        mitigationMeasures: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // BUSINESS RULE: Critical risk DPIAs automatically require NDPC consultation (GAID Art. 28)
        const result = await createDpiaAssessment(input);
        createAuditLog({ userId: ctx.user.id, organizationId: input.organizationId, action: "dpia.create", resourceType: "dpia_assessment", resourceId: result?.id, details: `DPIA created: ${input.title}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // Permify: creator owns the DPIA, org has viewer access
        permifyWriteRelationship("dpia", String(result?.id ?? 0), "owner", "user", String(ctx.user.id)).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "permify fire-and-forget"));
        permifyWriteRelationship("dpia", String(result?.id ?? 0), "viewer", "organization", String(input.organizationId)).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "permify fire-and-forget"));
        kafkaProduce("ndsep.dpia.submitted", `dpia-${result?.id}`, { dpiaId: result?.id, orgId: input.organizationId, title: input.title, riskLevel: input.riskLevel ?? "medium", jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        daprPublish("ndsep.dpia.submitted", { dpiaId: result?.id, orgId: input.organizationId, riskLevel: input.riskLevel ?? "medium" }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // BUSINESS RULE: High/Critical DPIAs trigger compliance review workflow
        if (input.riskLevel === "high" || input.riskLevel === "critical") {
          kafkaProduce("ndsep.dpia.high_risk", `dpia-hr-${result?.id}`, { dpiaId: result?.id, riskLevel: input.riskLevel, orgId: input.organizationId, requiresConsultation: input.riskLevel === "critical", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.dpia.compliance_review_required", { dpiaId: result?.id, riskLevel: input.riskLevel, orgId: input.organizationId }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        return result;
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        status: z.enum(["draft", "in_review", "approved", "rejected", "requires_ndpc_consultation"]).optional(),
        riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
        reviewedBy: z.number().int().optional(),
        mitigationMeasures: z.string().optional(),
        residualRisk: z.string().optional(),
        ndpcConsultationRequired: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const approvedAt = input.status === "approved" ? new Date() : undefined;
        // BUSINESS RULE: Cannot approve critical-risk DPIA without mitigation measures
        if (input.status === "approved" && input.riskLevel === "critical" && !input.mitigationMeasures) {
          throw new Error("Critical-risk DPIAs cannot be approved without documented mitigation measures");
        }
        // BUSINESS RULE: Rejected DPIAs trigger remediation workflow
        if (input.status === "rejected") {
          kafkaProduce("ndsep.dpia.rejected", `dpia-rej-${id}`, { dpiaId: id, riskLevel: input.riskLevel, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.dpia.remediation_required", { dpiaId: id }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        // BUSINESS RULE: Approved DPIAs set next review date
        if (input.status === "approved") {
          kafkaProduce("ndsep.dpia.approved", `dpia-app-${id}`, { dpiaId: id, approvedAt: new Date().toISOString(), reviewedBy: ctx.user.id }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        const result = await updateDpiaAssessment(id, { ...data, approvedAt });
        createAuditLog({ userId: ctx.user.id, action: "dpia.update", resourceType: "dpia_assessment", resourceId: id, details: `DPIA #${id} status: ${input.status}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteDpiaAssessment(input.id);
        createAuditLog({ userId: ctx.user.id, action: "dpia.delete", resourceType: "dpia_assessment", resourceId: input.id, details: `Deleted dpia_assessment #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),

  // Gap 5: ROPA (NDPA S.44)
  ropa: router({
    list: protectedProcedure
      .input(z.object({ orgId: z.number().optional(), limit: z.number().default(100) }).optional())
      .query(async ({ input }) => listRopaRecords(input?.orgId, input?.limit)),
    create: protectedProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        processingActivityName: z.string().min(1).max(512),
        purpose: z.string().min(1),
        lawfulBasis: z.enum(["consent", "contract", "legal_obligation", "vital_interest", "public_interest", "legitimate_interest"]),
        dataCategories: z.array(z.string()).optional(),
        dataSubjectCategories: z.array(z.string()).optional(),
        recipients: z.array(z.string()).optional(),
        crossBorderTransfers: z.boolean().optional(),
        transferDestinations: z.array(z.string()).optional(),
        retentionPeriodDays: z.number().int().optional(),
        securityMeasures: z.string().optional(),
        dpiaRequired: z.boolean().optional(),
        dpiaId: z.number().int().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createRopaRecord(input);
        createAuditLog({ userId: ctx.user.id, organizationId: input.organizationId, action: "ropa.create", resourceType: "ropa_record", resourceId: result?.id, details: `ROPA entry: ${input.processingActivityName}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        kafkaProduce("ndsep.ropa.updated", `ropa-${result?.id}`, { ropaId: result?.id, orgId: input.organizationId, activity: input.processingActivityName, basis: input.lawfulBasis, jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        isActive: z.boolean().optional(),
        dpoReviewed: z.boolean().optional(),
        retentionPeriodDays: z.number().int().optional(),
        securityMeasures: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const lastReviewedAt = data.dpoReviewed ? new Date() : undefined;
        const result = await updateRopaRecord(id, { ...data, lastReviewedAt });
        createAuditLog({ userId: ctx.user.id, action: "ropa.update", resourceType: "ropa_record", resourceId: id, details: `ROPA #${id} updated` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // BUSINESS RULE: DPO review triggers compliance checkpoint event
        if (data.dpoReviewed) {
          kafkaProduce("ndsep.ropa.dpo_reviewed", `ropa-rev-${id}`, { ropaId: id, reviewedAt: new Date().toISOString(), jurisdiction: getActiveJurisdiction().code }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        // BUSINESS RULE: Deactivating a ROPA entry triggers data handling review
        if (data.isActive === false) {
          kafkaProduce("ndsep.ropa.deactivated", `ropa-deact-${id}`, { ropaId: id, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.ropa.cessation_review", { ropaId: id }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteRopaRecord(input.id);
        createAuditLog({ userId: ctx.user.id, action: "ropa.delete", resourceType: "ropa_record", resourceId: input.id, details: `Deleted ropa_record #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    export: exportProcedure
      .input(z.object({ orgId: z.number().int().positive().optional(), format: z.enum(["pdf", "json"]).default("pdf") }))
      .mutation(async ({ input, ctx }) => {
        const records = await listRopaRecords(input.orgId, 500);
        const orgName = records[0]?.org_name ?? "Unknown Organisation";
        if (input.format === "json") {
          const json = JSON.stringify(records, null, 2);
          const key = `ropa-exports/${ctx.user.id}-${Date.now()}.json`;
          const { url } = await storagePut(key, Buffer.from(json), "application/json");
          createAuditLog({ userId: ctx.user.id, action: "ropa.export", resourceType: "ropa_records", details: `Exported ${records.length} ROPA records as JSON` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          return { url, format: "json", count: records.length };
        }
        const pdfData = {
          organizationName: orgName,
          generatedAt: new Date().toISOString(),
          records: records.map((r: Record<string, unknown>) => ({
            id: r.id as number,
            activity_name: (r.processing_activity_name ?? r.processing_activity ?? r.activity_name ?? "Unnamed Activity") as string,
            processing_purpose: (r.purpose ?? r.purposes) as string | undefined,
            lawful_basis: (r.ropa_lawful_basis ?? r.legal_basis) as string | undefined,
            data_categories: Array.isArray(r.data_categories) ? (r.data_categories as string[]).join(", ") : r.data_categories as string | undefined,
            data_subject_categories: Array.isArray(r.data_subject_categories) ? (r.data_subject_categories as string[]).join(", ") : r.data_subjects as string | undefined,
            recipients: Array.isArray(r.recipients) ? (r.recipients as string[]).join(", ") : r.recipients as string | undefined,
            retention_period: r.retention_period as string | undefined ?? (r.retention_period_days ? `${r.retention_period_days} days` : undefined),
            security_measures: r.security_measures as string | undefined,
            cross_border_transfer: !!(r.cross_border_transfers ?? r.cross_border_transfers_bool),
            dpia_required: !!(r.dpia_required),
            ropa_status: (r.is_active !== false ? "active" : "inactive"),
            org_name: r.org_name as string | undefined,
          })),
        };
        const pdfBuffer = await generateRopaPdf(pdfData);
        const filename = `NDSEP-ROPA-${orgName.replace(/[^a-zA-Z0-9]/g, "-")}-${new Date().toISOString().split("T")[0]}.pdf`;
        const key = `ropa-exports/${ctx.user.id}-${Date.now()}.pdf`;
        const { url } = await storagePut(key, pdfBuffer, "application/pdf");
        createAuditLog({ userId: ctx.user.id, action: "ropa.export", resourceType: "ropa_records", details: `Exported ${records.length} ROPA records as PDF: ${filename}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        kafkaProduce("ndsep.ropa.exported", `ropa-export-${ctx.user.id}`, { userId: ctx.user.id, orgId: input.orgId, count: records.length, format: "pdf", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return { url, format: "pdf", count: records.length, filename };
      }),
  }),
  // Gap 6: Retention Policiess
  retention: router({
    list: protectedProcedure
      .input(z.object({ orgId: z.number().optional(), limit: z.number().default(100) }).optional())
      .query(async ({ input }) => listRetentionPolicies(input?.orgId, input?.limit)),
    create: adminProcedure
      .input(z.object({
        organizationId: z.number().int().optional(),
        name: z.string().min(1).max(256),
        dataCategory: z.string().min(1),
        retentionPeriodDays: z.number().int().positive(),
        archivalAction: z.enum(["delete", "anonymize", "archive"]).optional(),
        legalBasis: z.string().optional(),
        isGlobal: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createRetentionPolicy(input);
        createAuditLog({ userId: ctx.user.id, action: "retention.create", resourceType: "retention_policy", resourceId: result?.id, details: `Retention policy: ${input.name}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        kafkaProduce("ndsep.retention.created", `retention-${result?.id}`, { policyId: result?.id, name: input.name, retentionDays: input.retentionPeriodDays, action: input.archivalAction ?? "delete", jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // BUSINESS RULE: Schedule retention execution via Dapr workflow
        daprPublish("ndsep.retention.schedule_execution", { policyId: result?.id, retentionDays: input.retentionPeriodDays, archivalAction: input.archivalAction ?? "delete", dataCategory: input.dataCategory }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    update: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        isActive: z.boolean().optional(),
        retentionPeriodDays: z.number().int().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const result = await updateRetentionPolicy(id, data);
        createAuditLog({ userId: ctx.user.id, action: "retention.update", resourceType: "retention_policy", resourceId: id, details: `Retention policy #${id} updated` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // BUSINESS RULE: Deactivating a retention policy triggers compliance alert
        if (data.isActive === false) {
          kafkaProduce("ndsep.retention.deactivated", `retention-deact-${id}`, { policyId: id, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.retention.compliance_alert", { policyId: id, alert: "Retention policy deactivated — data may exceed legal retention limits" }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteRetentionPolicy(input.id);
        createAuditLog({ userId: ctx.user.id, action: "retention.delete", resourceType: "retention_policy", resourceId: input.id, details: `Deleted retention_policy #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),

  // Gap 7: DPO Reports (semi-annual, GAID Art. 12)
  dpoReports: router({
    list: protectedProcedure
      .input(z.object({ orgId: z.number().optional(), limit: z.number().default(50) }).optional())
      .query(async ({ input }) => listDpoReports(input?.orgId, input?.limit)),
    create: protectedProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        dpoAppointmentId: z.number().int().optional(),
        reportPeriodStart: z.string(),
        reportPeriodEnd: z.string(),
        privacyNoticesReview: z.string().optional(),
        dataProcessingCategories: z.string().optional(),
        lawfulBasesReview: z.string().optional(),
        dpiaReview: z.string().optional(),
        rightsExerciseReview: z.string().optional(),
        complaintHandling: z.string().optional(),
        securityMeasuresReview: z.string().optional(),
        crossBorderReview: z.string().optional(),
        breachNotifications: z.string().optional(),
        trainingActivities: z.string().optional(),
        recommendations: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createDpoReport(input);
        createAuditLog({ userId: ctx.user.id, organizationId: input.organizationId, action: "dpo_report.create", resourceType: "dpo_report", resourceId: result?.id, details: `DPO report for period ${input.reportPeriodStart} to ${input.reportPeriodEnd}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        kafkaProduce("ndsep.dpo.report_due", `report-${result?.id}`, { reportId: result?.id, orgId: input.organizationId, periodStart: input.reportPeriodStart, periodEnd: input.reportPeriodEnd, jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        status: z.enum(["draft", "submitted", "under_review", "accepted", "rejected"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const submittedAt = input.status === "submitted" ? new Date() : undefined;
        const result = await updateDpoReport(input.id, { status: input.status, submittedAt });
        createAuditLog({ userId: ctx.user.id, action: "dpo_report.update", resourceType: "dpo_report", resourceId: input.id, details: `DPO report #${input.id} status: ${input.status}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // BUSINESS RULE: DPO report submission triggers NDPC notification (GAID Art. 12)
        if (input.status === "submitted") {
          kafkaProduce("ndsep.dpo.report_submitted", `report-sub-${input.id}`, { reportId: input.id, submittedAt: new Date().toISOString(), jurisdiction: getActiveJurisdiction().code }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.dpo.report_submitted", { reportId: input.id }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        // BUSINESS RULE: Rejected reports trigger remediation requirement
        if (input.status === "rejected") {
          kafkaProduce("ndsep.dpo.report_rejected", `report-rej-${input.id}`, { reportId: input.id, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteDpoReport(input.id);
        createAuditLog({ userId: ctx.user.id, action: "dpo_report.delete", resourceType: "dpo_report", resourceId: input.id, details: `Deleted dpo_report #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),

  // Gap 8: Compliance Audit Returns (CAR)
  auditReturns: router({
    list: protectedProcedure
      .input(z.object({ orgId: z.number().optional(), status: z.string().optional(), limit: z.number().default(50) }).optional())
      .query(async ({ input }) => listComplianceAuditReturns(input?.orgId, input?.status, input?.limit)),
    create: protectedProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        auditPeriodStart: z.string(),
        auditPeriodEnd: z.string(),
        dpcoId: z.string().optional(),
        dpcoName: z.string().optional(),
        complianceScore: z.number().optional(),
        findingsSummary: z.string().optional(),
        nonConformities: z.array(z.string()).optional(),
        correctiveActions: z.array(z.string()).optional(),
        dataProtectionPoliciesReview: z.string().optional(),
        securityMeasuresAssessment: z.string().optional(),
        staffTrainingAssessment: z.string().optional(),
        incidentResponseAssessment: z.string().optional(),
        crossBorderAssessment: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createComplianceAuditReturn(input);
        createAuditLog({ userId: ctx.user.id, organizationId: input.organizationId, action: "car.create", resourceType: "compliance_audit_return", resourceId: result?.id, details: `CAR filed for period ${input.auditPeriodStart} to ${input.auditPeriodEnd}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        kafkaProduce("ndsep.car.submitted", `car-${result?.id}`, { carId: result?.id, orgId: input.organizationId, periodStart: input.auditPeriodStart, periodEnd: input.auditPeriodEnd, score: input.complianceScore, jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // Temporal: auto-trigger compliance-audit workflow
        startWorkflow("compliance-audit", {
          workflowId: `audit-${result?.id ?? 0}`,
          taskQueue: "ndsep-compliance",
          input: { carId: String(result?.id ?? 0), orgId: input.organizationId, periodStart: input.auditPeriodStart, periodEnd: input.auditPeriodEnd, steps: ["document-review", "evidence-gathering", "control-testing", "gap-analysis", "scoring", "report-generation", "recommendation"] },
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "temporal fire-and-forget"));
        // CQRS command dispatch
        dispatchCommand({ type: "audit.start", aggregateType: "ComplianceAudit", aggregateId: String(result?.id ?? 0), payload: { orgId: input.organizationId, periodStart: input.auditPeriodStart, periodEnd: input.auditPeriodEnd, score: input.complianceScore }, metadata: { userId: ctx.user.id, source: "routers.car.create" } }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "cqrs fire-and-forget"));
        // Permify: org owns the audit return
        permifyWriteRelationship("compliance_audit", String(result?.id ?? 0), "owner", "organization", String(input.organizationId)).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "permify fire-and-forget"));
        // BUSINESS RULE: Low compliance scores auto-trigger enforcement review
        if (input.complianceScore !== undefined && input.complianceScore < 50) {
          kafkaProduce("ndsep.car.low_score_alert", `car-low-${result?.id}`, { carId: result?.id, orgId: input.organizationId, score: input.complianceScore, threshold: 50, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.car.enforcement_review_required", { carId: result?.id, orgId: input.organizationId, score: input.complianceScore }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        return result;
      }),
    update: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        status: z.enum(["draft", "submitted", "under_review", "accepted", "rejected", "requires_remediation"]).optional(),
        reviewNotes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await updateComplianceAuditReturn(input.id, { status: input.status, reviewedBy: ctx.user.id, reviewNotes: input.reviewNotes });
        createAuditLog({ userId: ctx.user.id, action: "car.review", resourceType: "compliance_audit_return", resourceId: input.id, details: `CAR #${input.id} reviewed: ${input.status}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // BUSINESS RULE: Rejected CARs trigger remediation workflow with deadline
        if (input.status === "rejected" || input.status === "requires_remediation") {
          kafkaProduce("ndsep.car.remediation_required", `car-rem-${input.id}`, { carId: input.id, status: input.status, reviewNotes: input.reviewNotes, remediationDeadline: new Date(Date.now() + 30 * 24 * 3600000).toISOString(), ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.car.remediation_workflow", { carId: input.id, deadline: new Date(Date.now() + 30 * 24 * 3600000).toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        // BUSINESS RULE: Accepted CARs update org compliance status
        if (input.status === "accepted") {
          kafkaProduce("ndsep.car.accepted", `car-acc-${input.id}`, { carId: input.id, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.car.compliance_certified", { carId: input.id }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteComplianceAuditReturn(input.id);
        createAuditLog({ userId: ctx.user.id, action: "audit_return.delete", resourceType: "audit_return", resourceId: input.id, details: `Deleted audit_return #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),

  // Gap 9: Adequacy Registry
  adequacy: router({
    list: publicProcedure
      .input(z.object({ limit: z.number().default(200) }).optional())
      .query(async ({ input }) => listAdequacyDeterminations(input?.limit)),
    create: adminProcedure
      .input(z.object({
        countryCode: z.string().min(2).max(3),
        countryName: z.string().min(1).max(128),
        status: z.enum(["adequate", "partially_adequate", "not_adequate", "pending", "under_review"]).optional(),
        dataProtectionLaw: z.string().optional(),
        supervisoryAuthority: z.string().optional(),
        requiresAdditionalSafeguards: z.boolean().optional(),
        approvedTransferInstruments: z.array(z.string()).optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createAdequacyDetermination(input);
        createAuditLog({ userId: ctx.user.id, action: "adequacy.create", resourceType: "adequacy_determination", resourceId: result?.id, details: `Adequacy determination for ${input.countryName}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        kafkaProduce("ndsep.adequacy.evaluated", `adequacy-${result?.id}`, { id: result?.id, countryCode: input.countryCode, countryName: input.countryName, status: input.status ?? "pending", jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        daprStateSet(`adequacy:${input.countryCode}`, JSON.stringify({ status: input.status ?? "pending", name: input.countryName }), 7200).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    update: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        status: z.enum(["adequate", "partially_adequate", "not_adequate", "pending", "under_review"]).optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await updateAdequacyDetermination(input.id, { status: input.status, notes: input.notes });
        createAuditLog({ userId: ctx.user.id, action: "adequacy.update", resourceType: "adequacy_determination", resourceId: input.id, details: `Adequacy status updated: ${input.status}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteAdequacyDetermination(input.id);
        createAuditLog({ userId: ctx.user.id, action: "adequacy.delete", resourceType: "adequacy_determination", resourceId: input.id, details: `Deleted adequacy_determination #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),

  // Gap 10: Data Processing Agreements
  dpa: router({
    list: protectedProcedure
      .input(z.object({ orgId: z.number().optional(), status: z.string().optional(), limit: z.number().default(50) }).optional())
      .query(async ({ input }) => listDataProcessingAgreements(input?.orgId, input?.status, input?.limit)),
    create: protectedProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        processorName: z.string().min(1).max(256),
        processorCountry: z.string().optional(),
        processingPurpose: z.string().optional(),
        dataCategories: z.array(z.string()).optional(),
        subProcessors: z.array(z.string()).optional(),
        securityMeasures: z.string().optional(),
        crossBorderTransfer: z.boolean().optional(),
        agreementDate: z.string().optional(),
        expiryDate: z.string().optional(),
        documentUrl: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createDataProcessingAgreement(input);
        createAuditLog({ userId: ctx.user.id, organizationId: input.organizationId, action: "dpa.create", resourceType: "data_processing_agreement", resourceId: result?.id, details: `DPA with ${input.processorName}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        kafkaProduce("ndsep.dpa.signed", `dpa-${result?.id}`, { dpaId: result?.id, orgId: input.organizationId, processor: input.processorName, crossBorder: input.crossBorderTransfer ?? false, jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        status: z.enum(["draft", "active", "expired", "terminated", "under_review"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await updateDataProcessingAgreement(input.id, { status: input.status, reviewedBy: ctx.user.id });
        createAuditLog({ userId: ctx.user.id, action: "dpa.update", resourceType: "data_processing_agreement", resourceId: input.id, details: `DPA #${input.id} status: ${input.status}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteDataProcessingAgreement(input.id);
        createAuditLog({ userId: ctx.user.id, action: "dpa.delete", resourceType: "dpa", resourceId: input.id, details: `Deleted dpa #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),

  // Gap 11: Privacy Notices
  privacyNotices: router({
    list: protectedProcedure
      .input(z.object({ orgId: z.number().optional(), status: z.string().optional(), limit: z.number().default(50) }).optional())
      .query(async ({ input }) => listPrivacyNotices(input?.orgId, input?.status, input?.limit)),
    create: protectedProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        title: z.string().min(1).max(512),
        content: z.string().min(1),
        noticeType: z.enum(["general", "employee", "customer", "website", "mobile_app", "service_specific"]).optional(),
        version: z.string().optional(),
        dataControllerInfo: z.string().optional(),
        dpoContactInfo: z.string().optional(),
        purposesOfProcessing: z.array(z.string()).optional(),
        lawfulBases: z.array(z.string()).optional(),
        dataRetentionInfo: z.string().optional(),
        rightsInfo: z.string().optional(),
        crossBorderInfo: z.string().optional(),
        cookieInfo: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createPrivacyNotice(input);
        createAuditLog({ userId: ctx.user.id, organizationId: input.organizationId, action: "privacy_notice.create", resourceType: "privacy_notice", resourceId: result?.id, details: `Privacy notice: ${input.title}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        kafkaProduce("ndsep.privacy_notice.published", `notice-${result?.id}`, { noticeId: result?.id, orgId: input.organizationId, title: input.title, type: input.noticeType ?? "general", jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        status: z.enum(["draft", "published", "archived", "under_review"]).optional(),
        content: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const publishedAt = input.status === "published" ? new Date() : undefined;
        const result = await updatePrivacyNotice(input.id, { status: input.status, publishedAt, approvedBy: ctx.user.id, content: input.content });
        createAuditLog({ userId: ctx.user.id, action: "privacy_notice.update", resourceType: "privacy_notice", resourceId: input.id, details: `Privacy notice #${input.id} status: ${input.status}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deletePrivacyNotice(input.id);
        createAuditLog({ userId: ctx.user.id, action: "privacy_notice.delete", resourceType: "privacy_notice", resourceId: input.id, details: `Deleted privacy_notice #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),

  // Gap 12: Cookie Consent
  cookieConsent: router({
    list: protectedProcedure
      .input(z.object({ orgId: z.number().optional(), limit: z.number().default(100) }).optional())
      .query(async ({ input }) => listCookieConsentRecords(input?.orgId, input?.limit)),
    stats: protectedProcedure
      .input(z.object({ orgId: z.number().optional() }).optional())
      .query(async ({ input }) => getCookieConsentStats(input?.orgId)),
    create: publicProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        domain: z.string().min(1),
        visitorId: z.string().optional(),
        consentGiven: z.boolean(),
        analyticalCookies: z.boolean().optional(),
        marketingCookies: z.boolean().optional(),
        functionalCookies: z.boolean().optional(),
        ipAddress: z.string().optional(),
        userAgent: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const result = await createCookieConsentRecord(input);
        kafkaProduce("ndsep.cookie.consent_updated", `cookie-${result?.id}`, { recordId: result?.id, orgId: input.organizationId, domain: input.domain, consentGiven: input.consentGiven, jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteCookieConsentRecord(input.id);
        createAuditLog({ userId: ctx.user.id, action: "cookie_consent.delete", resourceType: "cookie_consent_record", resourceId: input.id, details: `Deleted cookie_consent_record #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),

  // Gap 13: Automated Decisions (NDPA S.36)
  automatedDecisions: router({
    list: protectedProcedure
      .input(z.object({ orgId: z.number().optional(), limit: z.number().default(50) }).optional())
      .query(async ({ input }) => listAutomatedDecisions(input?.orgId, input?.limit)),
    create: protectedProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        aiSystemId: z.number().int().optional(),
        dataSubjectEmail: z.string().email().optional(),
        decisionType: z.string().min(1),
        decisionOutcome: z.string().min(1),
        significantEffect: z.boolean().optional(),
        logicExplanation: z.string().optional(),
        inputDataSummary: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createAutomatedDecision(input);
        createAuditLog({ userId: ctx.user.id, organizationId: input.organizationId, action: "automated_decision.create", resourceType: "automated_decision", resourceId: result?.id, details: `Decision: ${input.decisionType} → ${input.decisionOutcome}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        kafkaProduce("ndsep.automated_decision.registered", `decision-${result?.id}`, { decisionId: result?.id, orgId: input.organizationId, type: input.decisionType, outcome: input.decisionOutcome, significantEffect: input.significantEffect ?? false, jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // BUSINESS RULE: Significant-effect decisions MUST offer human review right (NDPA S.36)
        if (input.significantEffect) {
          kafkaProduce("ndsep.automated_decision.significant_effect", `decision-sig-${result?.id}`, { decisionId: result?.id, orgId: input.organizationId, type: input.decisionType, requiresHumanReview: true, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.automated_decision.human_review_required", { decisionId: result?.id, orgId: input.organizationId, dataSubjectEmail: input.dataSubjectEmail }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        return result;
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        humanReviewRequested: z.boolean().optional(),
        humanReviewOutcome: z.string().optional(),
        optOutRequested: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const humanReviewCompletedAt = data.humanReviewOutcome ? new Date() : undefined;
        const optOutGrantedAt = data.optOutRequested ? new Date() : undefined;
        const result = await updateAutomatedDecision(id, { ...data, humanReviewCompletedAt, optOutGrantedAt });
        createAuditLog({ userId: ctx.user.id, action: "automated_decision.update", resourceType: "automated_decision", resourceId: id, details: `Decision #${id} review updated` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // BUSINESS RULE: Human review completion triggers notification to data subject
        if (data.humanReviewOutcome) {
          kafkaProduce("ndsep.automated_decision.review_completed", `decision-rev-${id}`, { decisionId: id, outcome: data.humanReviewOutcome, reviewedBy: ctx.user.id, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.automated_decision.notify_subject", { decisionId: id, outcome: data.humanReviewOutcome }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        // BUSINESS RULE: Opt-out triggers processing cessation workflow
        if (data.optOutRequested) {
          kafkaProduce("ndsep.automated_decision.opt_out", `decision-opt-${id}`, { decisionId: id, optOutAt: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.automated_decision.cease_automated_processing", { decisionId: id }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteAutomatedDecision(input.id);
        createAuditLog({ userId: ctx.user.id, action: "automated_decision.delete", resourceType: "automated_decision", resourceId: input.id, details: `Deleted automated_decision #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    requestReview: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        reviewNotes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await updateAutomatedDecision(input.id, { humanReviewRequested: true });
        createAuditLog({ userId: ctx.user.id, action: "automated_decision.request_review", resourceType: "automated_decision", resourceId: input.id, details: `Human review requested for decision #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        kafkaProduce("ndsep.automated_decision.review_requested", `decision-rev-req-${input.id}`, { decisionId: input.id, requestedBy: ctx.user.id, notes: input.reviewNotes, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        daprPublish("ndsep.automated_decision.human_review_required", { decisionId: input.id, requestedBy: ctx.user.id, notes: input.reviewNotes }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    completeReview: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        outcome: z.string().min(1).max(1000),
        reviewNotes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await updateAutomatedDecision(input.id, { humanReviewOutcome: input.outcome, humanReviewCompletedAt: new Date() });
        createAuditLog({ userId: ctx.user.id, action: "automated_decision.complete_review", resourceType: "automated_decision", resourceId: input.id, details: `Human review completed for decision #${input.id}: ${input.outcome}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        kafkaProduce("ndsep.automated_decision.review_completed", `decision-rev-done-${input.id}`, { decisionId: input.id, outcome: input.outcome, reviewedBy: ctx.user.id, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        daprPublish("ndsep.automated_decision.notify_subject", { decisionId: input.id, outcome: input.outcome }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),
  // Gap 14: Children's Dataa / Parental Consent (NDPA S.35)
  parentalConsent: router({
    list: protectedProcedure
      .input(z.object({ orgId: z.number().optional(), limit: z.number().default(50) }).optional())
      .query(async ({ input }) => listParentalConsents(input?.orgId, input?.limit)),
    create: protectedProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        childName: z.string().optional(),
        childAge: z.number().int().min(0).max(17).optional(),
        parentName: z.string().min(1),
        parentEmail: z.string().email(),
        purpose: z.string().min(1),
        verificationMethod: z.enum(["email", "sms", "id_upload", "video_call", "in_person"]).optional(),
        ageVerificationMethod: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createParentalConsent(input);
        createAuditLog({ userId: ctx.user.id, organizationId: input.organizationId, action: "parental_consent.create", resourceType: "parental_consent", resourceId: result?.id, details: `Parental consent for ${input.childName ?? 'minor'}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        kafkaProduce("ndsep.parental_consent.verified", `parental-${result?.id}`, { recordId: result?.id, orgId: input.organizationId, parentEmail: input.parentEmail, verificationMethod: input.verificationMethod ?? "email", jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        consentStatus: z.enum(["pending", "granted", "denied", "withdrawn"]).optional(),
        parentIdVerified: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const consentGivenAt = data.consentStatus === "granted" ? new Date() : undefined;
        const consentWithdrawnAt = data.consentStatus === "withdrawn" ? new Date() : undefined;
        const result = await updateParentalConsent(id, { ...data, consentGivenAt, consentWithdrawnAt });
        createAuditLog({ userId: ctx.user.id, action: "parental_consent.update", resourceType: "parental_consent", resourceId: id, details: `Parental consent #${id} status: ${data.consentStatus}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // BUSINESS RULE: Denied/withdrawn parental consent blocks child data processing (NDPA S.35)
        if (data.consentStatus === "denied" || data.consentStatus === "withdrawn") {
          kafkaProduce("ndsep.parental_consent.processing_blocked", `parental-block-${id}`, { consentId: id, status: data.consentStatus, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.parental_consent.cease_processing", { consentId: id, action: "block_all_processing" }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        // BUSINESS RULE: Granted consent with verified parent triggers processing approval
        if (data.consentStatus === "granted" && data.parentIdVerified) {
          kafkaProduce("ndsep.parental_consent.processing_approved", `parental-app-${id}`, { consentId: id, verified: true, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteParentalConsent(input.id);
        createAuditLog({ userId: ctx.user.id, action: "parental_consent.delete", resourceType: "parental_consent", resourceId: input.id, details: `Deleted parental_consent #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),

  // Gap 15: Staff Training
  staffTraining: router({
    list: protectedProcedure
      .input(z.object({ orgId: z.number().optional(), status: z.string().optional(), limit: z.number().default(50) }).optional())
      .query(async ({ input }) => listStaffTraining(input?.orgId, input?.status, input?.limit)),
    create: protectedProcedure
      .input(z.object({
        organizationId: z.number().int().positive(),
        trainingTitle: z.string().min(1).max(512),
        trainingType: z.enum(["data_protection_basics", "ndpa_compliance", "breach_response", "dpia_methodology", "rights_handling", "security_awareness", "custom"]),
        description: z.string().optional(),
        scheduledDate: z.string().optional(),
        targetAudience: z.string().optional(),
        trainerName: z.string().optional(),
        durationHours: z.number().optional(),
        isRecurring: z.boolean().optional(),
        recurrenceMonths: z.number().int().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createStaffTraining(input);
        createAuditLog({ userId: ctx.user.id, organizationId: input.organizationId, action: "training.create", resourceType: "staff_training", resourceId: result?.id, details: `Training scheduled: ${input.trainingTitle}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        kafkaProduce("ndsep.training.scheduled", `training-${result?.id}`, { trainingId: result?.id, orgId: input.organizationId, title: input.trainingTitle, type: input.trainingType, jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]).optional(),
        participantCount: z.number().int().optional(),
        passRate: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const completedDate = data.status === "completed" ? new Date() : undefined;
        const result = await updateStaffTraining(id, { ...data, completedDate });
        createAuditLog({ userId: ctx.user.id, action: "training.update", resourceType: "staff_training", resourceId: id, details: `Training #${id} status: ${data.status}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        if (data.status === "completed") kafkaProduce("ndsep.training.completed", `training-${id}`, { trainingId: id, status: "completed", participants: data.participantCount, passRate: data.passRate, jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteStaffTraining(input.id);
        createAuditLog({ userId: ctx.user.id, action: "staff_training.delete", resourceType: "staff_training_record", resourceId: input.id, details: `Deleted staff_training_record #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),

  // Gap 16: Transfer Instruments (BCR/SCC)
  transferInstruments: router({
    list: publicProcedure
      .input(z.object({ type: z.string().optional(), status: z.string().optional(), limit: z.number().default(50) }).optional())
      .query(async ({ input }) => listTransferInstruments(input?.type, input?.status, input?.limit)),
    create: adminProcedure
      .input(z.object({
        instrumentType: z.enum(["bcr", "scc", "adequacy_decision", "derogation", "ndpc_authorization"]),
        name: z.string().min(1).max(256),
        description: z.string().optional(),
        templateContent: z.string().optional(),
        applicableCountries: z.array(z.string()).optional(),
        organizationId: z.number().int().optional(),
        ndpcApprovalRef: z.string().optional(),
        effectiveDate: z.string().optional(),
        expiryDate: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createTransferInstrument(input);
        createAuditLog({ userId: ctx.user.id, action: "transfer_instrument.create", resourceType: "transfer_instrument", resourceId: result?.id, details: `Transfer instrument: ${input.name} (${input.instrumentType})` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        kafkaProduce("ndsep.transfer_instrument.approved", `ti-${result?.id}`, { instrumentId: result?.id, type: input.instrumentType, name: input.name, countries: input.applicableCountries, jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // Permify: creator owns the transfer instrument, org has viewer access
        permifyWriteRelationship("transfer_instrument", String(result?.id ?? 0), "owner", "user", String(ctx.user.id)).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "permify fire-and-forget"));
        if (input.organizationId) permifyWriteRelationship("transfer_instrument", String(result?.id ?? 0), "viewer", "organization", String(input.organizationId)).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "permify fire-and-forget"));
        return result;
      }),
    update: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        status: z.enum(["draft", "active", "expired", "revoked", "pending_approval"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await updateTransferInstrument(input.id, { status: input.status, approvedBy: ctx.user.id });
        createAuditLog({ userId: ctx.user.id, action: "transfer_instrument.update", resourceType: "transfer_instrument", resourceId: input.id, details: `Transfer instrument #${input.id} status: ${input.status}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteTransferInstrument(input.id);
        createAuditLog({ userId: ctx.user.id, action: "transfer_instrument.delete", resourceType: "transfer_instrument", resourceId: input.id, details: `Deleted transfer_instrument #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),

  // Gap 17: Data Portability / Export Jobs
  dataExport: router({
    list: protectedProcedure
      .input(z.object({ orgId: z.number().optional(), limit: z.number().default(50) }).optional())
      .query(async ({ input }) => listDataExportJobs(input?.orgId, input?.limit)),
    create: protectedProcedure
      .input(z.object({
        citizenRequestId: z.number().int().optional(),
        organizationId: z.number().int().positive(),
        dataSubjectEmail: z.string().email(),
        exportFormat: z.enum(["json", "csv", "xml", "pdf"]).optional(),
        dataCategories: z.array(z.string()).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createDataExportJob(input);
        createAuditLog({ userId: ctx.user.id, organizationId: input.organizationId, action: "export.create", resourceType: "data_export_job", resourceId: result?.id, details: `Export job for ${input.dataSubjectEmail}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // BUSINESS RULE: Data export has 30-day SLA per NDPA S.46
        const slaDeadline = new Date(Date.now() + 30 * 24 * 3600000);
        kafkaProduce("ndsep.export.requested", `export-${result?.id}`, { exportJobId: result?.id, orgId: input.organizationId, email: input.dataSubjectEmail, format: input.exportFormat ?? "json", slaDeadline: slaDeadline.toISOString(), jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        daprPublish("ndsep.export.requested", { exportJobId: result?.id, organizationId: input.organizationId, email: input.dataSubjectEmail, format: input.exportFormat ?? "json", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // Schedule SLA deadline monitoring
        daprPublish("ndsep.export.sla_monitor", { exportJobId: result?.id, slaDeadline: slaDeadline.toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        status: z.enum(["pending", "processing", "completed", "failed", "expired"]).optional(),
        fileSizeBytes: z.number().int().optional(),
        downloadUrl: z.string().optional(),
        errorMessage: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const processedAt = data.status === "completed" || data.status === "failed" ? new Date() : undefined;
        const downloadExpiresAt = data.status === "completed" ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : undefined;
        const result = await updateDataExportJob(id, { ...data, processedAt, downloadExpiresAt });
        createAuditLog({ userId: ctx.user.id, action: "export.update", resourceType: "data_export_job", resourceId: id, details: `Export job #${id} status: ${data.status}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        // BUSINESS RULE: Completed exports notify data subject with download link
        if (data.status === "completed") {
          kafkaProduce("ndsep.export.completed", `export-done-${id}`, { exportJobId: id, downloadUrl: data.downloadUrl, expiresAt: downloadExpiresAt?.toISOString(), ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.export.notify_subject", { exportJobId: id, downloadUrl: data.downloadUrl }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        // BUSINESS RULE: Failed exports trigger retry or escalation
        if (data.status === "failed") {
          kafkaProduce("ndsep.export.failed", `export-fail-${id}`, { exportJobId: id, error: data.errorMessage, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
          daprPublish("ndsep.export.retry_or_escalate", { exportJobId: id, errorMessage: data.errorMessage }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        }
        return result;
      }),
    delete: deleteProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteDataExportJob(input.id);
        createAuditLog({ userId: ctx.user.id, action: "data_export.delete", resourceType: "data_export_job", resourceId: input.id, details: `Deleted data_export_job #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),

  // Gap 18: DCPMI Thresholds
  dcpmi: router({
    thresholds: publicProcedure
      .input(z.object({ sectorCode: z.string().optional() }).optional())
      .query(async ({ input }) => listDcpmiThresholds(input?.sectorCode)),
    create: adminProcedure
      .input(z.object({
        sectorCode: z.string().optional(),
        criterionName: z.string().min(1),
        criterionDescription: z.string().optional(),
        thresholdValue: z.number(),
        thresholdUnit: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createDcpmiThreshold(input);
        createAuditLog({ userId: ctx.user.id, action: "dcpmi.create", resourceType: "dcpmi_threshold", resourceId: result?.id, details: `DCPMI threshold: ${input.criterionName}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        kafkaProduce("ndsep.dcpmi.threshold_breached", `dcpmi-${result?.id}`, { thresholdId: result?.id, sectorCode: input.sectorCode, criterion: input.criterionName, value: input.thresholdValue, unit: input.thresholdUnit, jurisdiction: getActiveJurisdiction().code, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
    evaluate: protectedProcedure
      .input(z.object({ orgId: z.number().int().positive() }))
      .query(async ({ input }) => evaluateDcpmiStatus(input.orgId)),
    delete: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const result = await deleteDcpmiThreshold(input.id);
        createAuditLog({ userId: ctx.user.id, action: "dcpmi.delete", resourceType: "dcpmi_threshold", resourceId: input.id, details: `Deleted DCPMI threshold #${input.id}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return result;
      }),
  }),
  certRotation: router({
    getCertInfo: protectedProcedure.query(async () => {
      const { getSigningCertInfo } = await import("./pdfSigner");
      return getSigningCertInfo();
    }),
    rotateCert: protectedProcedure.mutation(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      const { rotateCertificate } = await import("./pdfSigner");
      const result = await rotateCertificate();
      createAuditLog({ userId: ctx.user.id, action: "cert.rotate", resourceType: "signing_certificate", resourceId: 0, details: `Certificate rotated. New serial: ${result.serialNumber}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),
  }),
  // ── Admin Platform Settings ────────────────────────────────────────────────────────────
  adminSettings: router({
    emailStatus: adminProcedure.query(async () => {
      const { activeTransport, testSmtpConnection } = await import("./mailer");
      const { ENV } = await import("./_core/env");
      const transport = activeTransport();
      const smtpTest = transport === "smtp" ? await testSmtpConnection() : null;
      return {
        activeTransport: transport,
        smtp: {
          configured: !!(ENV.smtpHost && ENV.smtpUser && ENV.smtpPass),
          host: ENV.smtpHost || null,
          port: ENV.smtpPort,
          secure: ENV.smtpSecure,
          from: ENV.smtpFrom,
          testResult: smtpTest,
        },
        resend: { configured: !!ENV.resendApiKey },
        forge: { configured: true, alwaysAvailable: true },
      };
    }),
    testEmail: adminProcedure
      .input(z.object({ toEmail: z.string().email() }))
      .mutation(async ({ input }) => {
        const { sendMail, activeTransport } = await import("./mailer");
        const result = await sendMail({
          to: input.toEmail,
          subject: "[NDSEP] Email Transport Test",
          html: `<div style="font-family:Arial,sans-serif;padding:24px"><h2>NDSEP Email Test</h2><p>This is a test email from the NDSEP platform.</p><p><strong>Transport:</strong> ${activeTransport()}</p><p><strong>Sent at:</strong> ${new Date().toISOString()}</p></div>`,
        });
        return result;
      }),
    stripeStatus: adminProcedure.query(async () => {
      const stripeKey = process.env.STRIPE_SECRET_KEY ?? "";
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
      const publishableKey = process.env.VITE_STRIPE_PUBLISHABLE_KEY ?? "";
      const isLive = stripeKey.startsWith("sk_live_");
      const isTest = stripeKey.startsWith("sk_test_");
      return {
        configured: isLive || isTest,
        mode: isLive ? "live" : isTest ? "test" : "unconfigured" as const,
        webhookConfigured: !!webhookSecret,
        publishableKeyConfigured: !!publishableKey,
        webhookEndpoint: "/api/stripe/webhook",
        testCard: "4242 4242 4242 4242",
        stripeClaimUrl: "https://dashboard.stripe.com/claim_sandbox/YWNjdF8xVEhyRGhHa2o4Z0VrQU9zLDE3NzU4NDI0NzIv100qbMS31KS",
      };
    }),
  }),
  widgetDashboard: widgetDashboardRouter,
  emailDigest: emailDigestRouter,
  onboardingChecklist: onboardingChecklistRouter,
  chatSupport: chatSupportRouter,
  tutorial: tutorialRouter,
  changelog: changelogRouter,
  changelogAdmin: changelogAdminRouter,
  complianceTrend: complianceTrendRouter,
  sparkline: sparklineRouter,
  themePrefs: themePrefsRouter,
  ndpaComplianceDashboard: ndpaComplianceDashboardRouter,
  breachIncidents: breachIncidentRouter,
  consentRecords: consentRecordRouter,
  dpoAppointments: dpoAppointmentRouter,
  publicRegistry: publicRegistryRouter,
  penaltyCalculator: penaltyCalculatorRouter,
  riskScorecard: riskScorecardRouter,
  enforcementTimeline: enforcementTimelineRouter,
  complianceCalendar: complianceCalendarRouter,
  notificationCenter: notificationCenterRouter,
  advancedAnalytics: advancedAnalyticsRouter,
  article40Tracker: article40TrackerRouter,
  ndpaSnapshots: ndpaSnapshotsRouter,
  smsAlerts: smsAlertsRouter,
  pdfGeneration: pdfGenerationRouter,
  documentVault: documentVaultRouter,
  aiRiskScoring: aiRiskScoringRouter,
  apiKeyManagement: apiKeyManagementRouter,
  webhookDelivery: webhookDeliveryRouter,
  crossSectorSharing: crossSectorSharingRouter,
  retentionEnforcement: retentionEnforcementRouter,
  certVerification: certVerificationRouter,
  complianceRescoring: complianceRescoringRouter,
  // ── Phase 9: Security, Analytics, Lifecycle, Export Routers ───────────────────
  securityAudit: securityAuditRouter,
  anomalyAlerts: anomalyAlertsRouter,
  rss: rssRouter,
  trendCompare: trendCompareRouter,
  dsarLifecycle: dsarLifecycleRouter,
  breachWorkflow: breachWorkflowRouter,
  consentAnalytics: consentAnalyticsRouter,
  auditExport: auditExportRouter,
  sectorReport: sectorReportRouter,
  userManagement: userManagementRouter,
  apiHealth: apiHealthRouter,
  leaderboardExport: leaderboardExportRouter,
  nipReconciliation: nipReconciliationRouter,
  transferApprovalRules: transferApprovalRulesRouter,
  transferAutoApproval: transferAutoApprovalRouter,
  retentionScheduler: retentionSchedulerRouter,
  platformStats: platformStatsRouter,
  // ── Phase 10: AI/ML/DL/GNN/LLM Routers ──────────────────────────────────────
  qdrant: qdrantRouter,
  knowledgeGraph: knowledgeGraphRouter,
  ollama: ollamaRouter,
  art: artRouter,
  featureStore: featureStoreRouter,
  modelRegistry: modelRegistryRouter,
  aiAnomalyAlerts: aiAnomalyAlertsRouter,
  cocoIndex: cocoIndexRouter,
  rssFeed: rssFeedRouter,
  aiHealth: aiHealthRouter,
  lakehouseAnalytics: lakehouseAnalyticsRouter,
  mlProduction: mlProductionRouter,
  gnn: gnnRouter,
  wiredigg: wirediggRouter,
  noc: nocRouter,
  nocAgent: nocAgentRouter,
  platformIntelligence: platformIntelligenceRouter,
  rssFeedP11: p11RssFeedRouter,
  dsarAutomation: dsarAutomationRouter,
  breachLifecycle: breachLifecycleRouter,
  certLifecycle: certLifecycleRouter,
  sectorBenchmarkP11: p11SectorBenchmarkRouter,
  sbom: sbomRouter,
  slaEnforcement: slaEnforcementRouter,
  complianceCalendarP11: p11ComplianceCalendarRouter,
  finePayment: finePaymentRouter,
  pwa: pwaRouter,
  onboardingAutomation: onboardingAutomationRouter,
  apiGateway: apiGatewayRouter,
  phase12: phase12Router,
  phase13: phase13Router,
  productionReadiness: productionReadinessRouter,
  temporal: temporalRouter,
  opensearch: opensearchRouter,
  waf: wafRouter,
  gateway: gatewayRouter,
  authz: authzRouter,
  kafkaMetrics: kafkaMetricsRouter,
  tigerbeetleLedger: ledgerRouter,
  sectorEvents: router({
    list: protectedProcedure
      .input(z.object({
        orgId: z.number().int().optional(),
        sector: z.string().optional(),
        severity: z.string().optional(),
        resolved: z.boolean().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }).optional())
      .query(async ({ input }) => listSectorComplianceEvents(input ?? {})),
    create: protectedProcedure
      .input(z.object({
        orgId: z.number().int().optional(),
        sector: z.string().min(1).max(64),
        eventType: z.string().min(1).max(64),
        severity: z.string().default("info"),
        title: z.string().min(1).max(255),
        description: z.string().optional(),
        details: z.record(z.string(), z.unknown()).optional(),
        workerName: z.string().optional(),
        ruleId: z.string().optional(),
      }))
      .mutation(async ({ input }) => createSectorComplianceEvent(input)),
    resolve: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input, ctx }) => resolveSectorComplianceEvent(input.id, ctx.user.id)),
    stats: protectedProcedure
      .query(async () => getSectorComplianceEventStats()),
  }),
  ndpaStats: router({
    index: protectedProcedure.query(async () => getNdpaComplianceIndex()),
    breachTimeline: protectedProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
      .query(async ({ input }) => getBreachTimeline(input?.limit ?? 20)),
    complianceTrend: protectedProcedure
      .input(z.object({ days: z.number().int().min(7).max(365).optional() }).optional())
      .query(async ({ input }) => getNdpaComplianceTrend(input?.days ?? 180)),
    saveSnapshot: protectedProcedure.mutation(async () => saveNdpaComplianceSnapshot()),
    breachSlaHeatmap: protectedProcedure
      .input(z.object({ days: z.number().int().min(30).max(365).optional() }).optional())
      .query(async ({ input }) => getBreachSlaHeatmap(input?.days ?? 365)),
    breachDrilldown: protectedProcedure
      .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
      .query(async ({ input }) => getBreachesForDay(input.date)),
    generateAuditReturn: protectedProcedure
      .input(z.object({ year: z.number().int().min(2020).max(2030) }))
      .query(async ({ input }) => generateAuditReturnData(input.year)),
  }),
});
// bgp router already defined above at line 639
export type AppRouter = typeof appRouter;

