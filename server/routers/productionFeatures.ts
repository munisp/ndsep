import { z } from "zod";
import { router, protectedProcedure, publicProcedure, exportProcedure, deleteProcedure, approveProcedure} from "../_core/trpc";
import { getDb, getPool } from "../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import { ENV } from "../_core/env";
import { notifyOwner } from "../_core/notification";
import { emitEvent, logAuditEvent, broadcastEvent, cacheGetJson, cacheSetJson, cacheDel, triggerWorkflow } from "../middlewareHelpers";
import { emitComplianceEvent, opensearchIndex, lakehouseIngest, daprPublish, fluvioPublish, permifyCheck } from "../middlewareExtensions";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { logger } from "../logger";

// ── Helper: execute raw SQL ───────────────────────────────────────────────────
async function exec(rawSql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  if (params.length > 0) {
    const pool = getPool();
    if (!pool) throw new Error("Database pool is unavailable");
    const pgResult = await pool.query(rawSql, params);
    return autoDecryptRows(rawSql, (pgResult.rows ?? []) as Record<string, unknown>[]);
  }

  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable");
  const result = await db.execute(sql.raw(rawSql));
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
  return autoDecryptRows(rawSql, (rows ?? []) as Record<string, unknown>[]);
}

// ── Helper: send Termii SMS ───────────────────────────────────────────────────
async function sendTermiiSms(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    if (!ENV.termiiEnabled) return { success: false, error: "Termii disabled in config" };
    const res = await fetch(`${ENV.termiiBaseUrl}/api/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, from: ENV.termiiSenderId, sms: message, type: "plain", channel: "generic", api_key: ENV.termiiApiKey }),
    });
    const data = (await res.json()) as { message_id?: string };
    return { success: res.ok, messageId: data.message_id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ── Helper: hash API key ──────────────────────────────────────────────────────
function hashApiKey(key: string): string {
  return crypto.createHmac("sha256", ENV.apiKeySalt).update(key).digest("hex");
}

// ── Helper: generate API key ──────────────────────────────────────────────────
function generateApiKey(): string {
  return ENV.apiKeyPrefix + crypto.randomBytes(32).toString("hex");
}

// ── Helper: sign webhook payload ──────────────────────────────────────────────
function signWebhookPayload(payload: string): string {
  return crypto.createHmac("sha256", ENV.webhookSigningSecret).update(payload).digest("hex");
}

// ── Helper: compute AI risk score ────────────────────────────────────────────
function computeRiskScore(factors: { breachCount: number; penaltyCount: number; daysOverdue: number; complianceScore: number }): number {
  const { breachCount, penaltyCount, daysOverdue, complianceScore } = factors;
  let score = 0;
  score += Math.min(breachCount * 0.15, 0.45);
  score += Math.min(penaltyCount * 0.10, 0.30);
  score += Math.min(daysOverdue * 0.002, 0.20);
  score += Math.max(0, (100 - complianceScore) / 100) * 0.30;
  return Math.min(parseFloat(score.toFixed(3)), 1.0);
}

// ── SMS Enforcement Alerts Router ────────────────────────────────────────────
export const smsAlertsRouter = router({
  sendBreachAlert: protectedProcedure
    .input(z.object({
      orgName: z.string(),
      breachType: z.string(),
      severity: z.string(),
      phoneNumber: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const phone = input.phoneNumber ?? ENV.ndpcPhoneNumber;
      const message = `NDSEP ALERT: ${input.severity.toUpperCase()} data breach at ${input.orgName}. Type: ${input.breachType}. NDPA Article 40 72-hour window started. Ref: NDSEP-${Date.now()}`;
      const smsResult = await sendTermiiSms(phone, message);
      await notifyOwner({ title: `[BREACH] ${input.severity} — ${input.orgName}`, content: `Breach Type: ${input.breachType}\nSeverity: ${input.severity}\nSMS sent to: ${phone}` });
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { sms: smsResult, timestamp: new Date().toISOString() };
    }),

  sendPenaltyAlert: protectedProcedure
    .input(z.object({ orgName: z.string(), penaltyAmount: z.number(), violation: z.string(), phoneNumber: z.string().optional() }))
    .mutation(async ({ input }) => {
      const phone = input.phoneNumber ?? ENV.ndpcPhoneNumber;
      const message = `NDSEP ENFORCEMENT: Penalty of NGN${input.penaltyAmount.toLocaleString()} issued to ${input.orgName} for: ${input.violation}. Due in 30 days. Ref: NDSEP-PEN-${Date.now()}`;
      const smsResult = await sendTermiiSms(phone, message);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { sms: smsResult, timestamp: new Date().toISOString() };
    }),

  sendCertAlert: protectedProcedure
    .input(z.object({ orgName: z.string(), certNumber: z.string(), expiryDate: z.string(), phoneNumber: z.string().optional() }))
    .mutation(async ({ input }) => {
      const phone = input.phoneNumber ?? ENV.ndpcPhoneNumber;
      const message = `NDSEP CERT: Compliance certificate ${input.certNumber} issued to ${input.orgName}. Valid until ${input.expiryDate}. Verify: ${ENV.certVerifyBaseUrl}/${input.certNumber}`;
      const smsResult = await sendTermiiSms(phone, message);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { sms: smsResult, timestamp: new Date().toISOString() };
    }),

  getAlertHistory: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      const rows = await exec(`
        SELECT bi.id, bi.organization_id, o.name as org_name, bi.breach_type, bi.severity, bi.reported_at, bi.status
        FROM breach_incidents bi
        LEFT JOIN organizations o ON bi.organization_id = o.id
        ORDER BY bi.reported_at DESC
        LIMIT ${input.limit}
      `);
      return rows;
    }),
});

// ── PDF Generation Router ─────────────────────────────────────────────────────
export const pdfGenerationRouter = router({
  generateComplianceCertificate: protectedProcedure
    .input(z.object({ orgId: z.number(), certType: z.enum(["ndpa", "dpco", "sector"]).default("ndpa") }))
    .mutation(async ({ input }) => {
      const orgs = await exec(`SELECT * FROM organizations WHERE id = ${input.orgId} LIMIT 1`);
      if (!orgs.length) throw new Error("Organization not found");
      const org = orgs[0];
      const certNumber = `NDSEP-CERT-${input.certType.toUpperCase()}-${Date.now()}-${input.orgId}`;
      const issuedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + ENV.certValidityDays * 86400000).toISOString();
      const verifyUrl = `${ENV.certVerifyBaseUrl}/${certNumber}`;
      const content = `# NIGERIA DATA PROTECTION COMPLIANCE CERTIFICATE\n\n**Certificate Number:** ${certNumber}\n**Issued By:** ${ENV.certIssuerName}\n**Issue Date:** ${new Date(issuedAt).toLocaleDateString("en-NG")}\n**Expiry Date:** ${new Date(expiresAt).toLocaleDateString("en-NG")}\n\n---\n\n## Certified Organization\n\n**Name:** ${org.name}\n**Registration Number:** ${org.registration_number ?? "N/A"}\n**Sector:** ${org.sector ?? "N/A"}\n\n---\n\n## Certification Scope\n\nThis certificate confirms compliance with the **Nigeria Data Protection Act 2023 (NDPA)** and **NDPR 2019**.\n\n**Verification URL:** ${verifyUrl}\n\n*Issued by the National Data Sovereignty Enforcement Platform (NDSEP)*`;
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { certNumber, orgName: org.name, issuedAt, expiresAt, verifyUrl, content, downloadUrl: `${ENV.pdfBaseUrl}/${certNumber}.pdf` };
    }),

  generateAuditReturn: protectedProcedure
    .input(z.object({ orgId: z.number(), year: z.number().default(new Date().getFullYear()) }))
    .mutation(async ({ input }) => {
      const orgs = await exec(`SELECT * FROM organizations WHERE id = ${input.orgId} LIMIT 1`);
      if (!orgs.length) throw new Error("Organization not found");
      const org = orgs[0];
      const refNumber = `CAR-${input.year}-${input.orgId}-${Date.now()}`;
      const content = `# NDPA COMPLIANCE AUDIT RETURN (CAR) ${input.year}\n\n**Reference:** ${refNumber}\n**Organization:** ${org.name}\n**Submission Date:** ${new Date().toLocaleDateString("en-NG")}\n**Reporting Year:** ${input.year}\n\n---\n\n## Section A: Organization Details\n\n| Field | Value |\n|-------|-------|\n| Organization Name | ${org.name} |\n| Registration Number | ${org.registration_number ?? "N/A"} |\n| Sector | ${org.sector ?? "N/A"} |\n\n## Section B: Data Processing Activities\n\nThis organization maintains a full Record of Processing Activities (ROPA) in compliance with NDPA 2023.\n\n## Section C: Data Subject Rights\n\nDSAR procedures are established per NDPA Section 34-40.\n\n## Section D: Security Measures\n\nTechnical and organizational measures are in place per NDPA Section 24.\n\n## Section E: Breach Incidents\n\nAll reportable breaches notified to NDPC within 72 hours per NDPA Article 40.\n\n---\n\n**Submit to:** ${ENV.carSubmissionEmail}\n**Deadline:** March ${ENV.carDeadlineDay}, ${input.year + 1}\n\n*Generated by NDSEP — ${ENV.platformUrl}*`;
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { refNumber, orgName: org.name, year: input.year, content, downloadUrl: `${ENV.pdfBaseUrl}/${refNumber}.pdf`, submissionEmail: ENV.carSubmissionEmail };
    }),

  generatePenaltyNotice: protectedProcedure
    .input(z.object({ orgId: z.number(), violation: z.string(), penaltyAmount: z.number(), dueDate: z.string() }))
    .mutation(async ({ input }) => {
      const orgs = await exec(`SELECT * FROM organizations WHERE id = ${input.orgId} LIMIT 1`);
      if (!orgs.length) throw new Error("Organization not found");
      const org = orgs[0];
      const noticeNumber = `NDSEP-PEN-${Date.now()}-${input.orgId}`;
      const content = `# PENALTY NOTICE\n\n**Notice Number:** ${noticeNumber}\n**Date:** ${new Date().toLocaleDateString("en-NG")}\n**Issuing Authority:** Nigeria Data Protection Commission (NDPC) via NDSEP\n\n---\n\n## Recipient\n\n**Organization:** ${org.name}\n**Sector:** ${org.sector ?? "N/A"}\n\n## Violation\n\n${input.violation}\n\n## Penalty Amount\n\n**NGN ${input.penaltyAmount.toLocaleString()}**\n\n## Payment Due Date\n\n${new Date(input.dueDate).toLocaleDateString("en-NG")}\n\n## Right of Appeal\n\nAppeal within 30 days to the Data Protection Tribunal.\n\n---\n*Issued under NDPA 2023, Section 48 — ${ENV.platformUrl}*`;
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { noticeNumber, orgName: org.name, penaltyAmount: input.penaltyAmount, dueDate: input.dueDate, content, downloadUrl: `${ENV.pdfBaseUrl}/${noticeNumber}.pdf` };
    }),
});

// ── Document Vault Router ─────────────────────────────────────────────────────
export const documentVaultRouter = router({
  list: protectedProcedure
    .input(z.object({ orgId: z.number().optional(), docType: z.string().optional(), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "WHERE 1=1";
      if (input.orgId) where += ` AND dv.organization_id = ${input.orgId}`;
      if (input.docType) { params.push(input.docType); where += ` AND dv.document_type = $${params.length}`; }
      const rows = await exec(`SELECT dv.*, o.name as org_name FROM document_vault dv LEFT JOIN organizations o ON dv.organization_id = o.id ${where} ORDER BY dv.uploaded_at DESC LIMIT ${input.limit}`, params);
      return rows;
    }),

  upload: protectedProcedure
    .input(z.object({ orgId: z.number(), docType: z.string(), fileName: z.string(), fileSize: z.number(), mimeType: z.string(), description: z.string().optional(), expiryDate: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const docId = `DOC-${Date.now()}-${input.orgId}`;
      const storageKey = `vault/${input.orgId}/${docId}/${input.fileName}`;
      await exec(`INSERT INTO document_vault (document_id, organization_id, document_type, file_name, file_size, mime_type, storage_key, description, expiry_date, uploaded_by, uploaded_at, status) VALUES ('${docId}', ${input.orgId}, '${input.docType}', '${input.fileName}', ${input.fileSize}, '${input.mimeType}', '${storageKey}', '${input.description ?? ""}', ${input.expiryDate ? `'${input.expiryDate}'` : "NULL"}, ${ctx.user.id}, NOW(), 'active')`);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { docId, storageKey, uploadUrl: `${ENV.vaultS3Endpoint}/${ENV.vaultS3Bucket}/${storageKey}` };
    }),

  getStats: protectedProcedure.query(async () => {
    const rows = await exec(`SELECT COUNT(*) as total_docs, COUNT(DISTINCT organization_id) as orgs_with_docs, COALESCE(SUM(file_size), 0) as total_size_bytes, COUNT(CASE WHEN status = 'active' THEN 1 END) as active_docs FROM document_vault`);
    return rows[0] ?? {};
  }),

  delete: deleteProcedure
    .input(z.object({ docId: z.string() }))
    .mutation(async ({ input }) => {
      await exec(`UPDATE document_vault SET status = 'deleted' WHERE document_id = $1`, [input.docId]);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),
});

// ── AI Risk Scoring Router ────────────────────────────────────────────────────
export const aiRiskScoringRouter = router({
  scoreOrg: protectedProcedure
    .input(z.object({ orgId: z.number() }))
    .mutation(async ({ input }) => {
      const orgs = await exec(`SELECT * FROM organizations WHERE id = ${input.orgId} LIMIT 1`);
      if (!orgs.length) throw new Error("Organization not found");
      const org = orgs[0];
      const breaches = await exec(`SELECT COUNT(*) as cnt FROM breach_incidents WHERE organization_id = ${input.orgId} AND reported_at > NOW() - INTERVAL '12 months'`);
      const penalties = await exec(`SELECT COUNT(*) as cnt FROM enforcement_cases WHERE organization_id = ${input.orgId} AND status = 'active'`);
      const breachCount = parseInt(String(breaches[0]?.cnt ?? 0));
      const penaltyCount = parseInt(String(penalties[0]?.cnt ?? 0));
      const complianceScore = parseFloat(String(org.compliance_score ?? 50));
      const daysOverdue = Math.max(0, 30 - complianceScore / 3);
      const riskScore = computeRiskScore({ breachCount, penaltyCount, daysOverdue, complianceScore });
      const riskLevel = riskScore >= ENV.aiRiskThresholdCritical ? "critical" : riskScore >= ENV.aiRiskThresholdHigh ? "high" : riskScore >= ENV.aiRiskThresholdMedium ? "medium" : "low";
      const factors = [
        { name: "Breach History (12mo)", value: breachCount, contribution: Math.min(breachCount * 0.15, 0.45) },
        { name: "Active Penalties", value: penaltyCount, contribution: Math.min(penaltyCount * 0.10, 0.30) },
        { name: "Compliance Score", value: complianceScore, contribution: Math.max(0, (100 - complianceScore) / 100) * 0.30 },
        { name: "Overdue Obligations", value: Math.round(daysOverdue), contribution: Math.min(daysOverdue * 0.002, 0.20) },
      ];
      const recommendations = riskLevel === "critical"
        ? ["Immediate NDPC notification required", "Suspend high-risk data processing", "Engage DPCO for emergency audit"]
        : riskLevel === "high"
        ? ["Schedule compliance review within 30 days", "Update ROPA and DPIAs", "Conduct staff training"]
        : ["Maintain current compliance posture", "Ensure annual CAR submission"];
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { orgId: input.orgId, orgName: org.name, riskScore, riskLevel, factors, recommendations, modelVersion: ENV.aiRiskModelVersion, scoredAt: new Date().toISOString() };
    }),

  scoreAll: protectedProcedure.mutation(async () => {
    const orgs = await exec(`SELECT id, name, sector, compliance_score FROM organizations LIMIT ${ENV.rescoringBatchSize}`);
    const results = orgs.map(org => {
      const complianceScore = parseFloat(String(org.compliance_score ?? 50));
      const riskScore = computeRiskScore({ breachCount: 0, penaltyCount: 0, daysOverdue: 0, complianceScore });
      const riskLevel = riskScore >= ENV.aiRiskThresholdCritical ? "critical" : riskScore >= ENV.aiRiskThresholdHigh ? "high" : riskScore >= ENV.aiRiskThresholdMedium ? "medium" : "low";
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { orgId: org.id, orgName: org.name, riskScore, riskLevel };
    });
    emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return { scored: results.length, results };
  }),

  getLeaderboard: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20), sector: z.string().optional() }))
    .query(async ({ input }) => {
      const sectorParams2: unknown[] = input.sector ? [input.sector] : [];
      const sectorFilter = input.sector ? `WHERE sector = $1` : "";
      const rows = await exec(`SELECT id, name, sector, compliance_score, risk_score, risk_level FROM organizations ${sectorFilter} ORDER BY compliance_score ASC LIMIT ${input.limit}`);
      return rows.map((r, i) => ({
        ...r,
        rank: i + 1,
        riskScore: r.risk_score ?? computeRiskScore({ breachCount: 0, penaltyCount: 0, daysOverdue: 0, complianceScore: parseFloat(String(r.compliance_score ?? 50)) }),
      }));
    }),
});

// ── API Key Management Router ─────────────────────────────────────────────────
export const apiKeyManagementRouter = router({
  list: protectedProcedure
    .input(z.object({ orgId: z.number().optional() }))
    .query(async ({ input, ctx }) => {
      const orgFilter = input.orgId ? `AND ak.organization_id = ${input.orgId}` : "";
      const rows = await exec(`SELECT ak.id, ak.key_id, ak.name, ak.organization_id, o.name as org_name, ak.scopes, ak.created_at, ak.expires_at, ak.last_used_at, ak.status, ak.request_count FROM api_keys ak LEFT JOIN organizations o ON ak.organization_id = o.id WHERE ak.created_by = ${ctx.user.id} ${orgFilter} ORDER BY ak.created_at DESC`);
      return rows;
    }),

  create: protectedProcedure
    .input(z.object({ name: z.string(), orgId: z.number(), scopes: z.array(z.string()).default(["read"]), expiresInDays: z.number().default(365) }))
    .mutation(async ({ input, ctx }) => {
      const rawKey = generateApiKey();
      const keyHash = hashApiKey(rawKey);
      const keyId = `kid_${crypto.randomBytes(8).toString("hex")}`;
      const expiresAt = new Date(Date.now() + input.expiresInDays * 86400000).toISOString();
      const scopesJson = JSON.stringify(input.scopes).replace(/'/g, "''");
      await exec(`INSERT INTO api_keys (key_id, key_hash, name, organization_id, scopes, expires_at, created_by, created_at, status, request_count) VALUES ('${keyId}', '${keyHash}', '${input.name}', ${input.orgId}, '${scopesJson}', '${expiresAt}', ${ctx.user.id}, NOW(), 'active', 0)`);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { keyId, rawKey, name: input.name, expiresAt, scopes: input.scopes, warning: "Store this key securely — it will not be shown again." };
    }),

  revoke: protectedProcedure
    .input(z.object({ keyId: z.string() }))
    .mutation(async ({ input }) => {
      await exec(`UPDATE api_keys SET status = 'revoked', revoked_at = NOW() WHERE key_id = $1`, [input.keyId]);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  getStats: protectedProcedure.query(async () => {
    const rows = await exec(`SELECT COUNT(*) as total, COUNT(CASE WHEN status='active' THEN 1 END) as active, COUNT(CASE WHEN status='revoked' THEN 1 END) as revoked, COALESCE(SUM(request_count), 0) as total_requests FROM api_keys`);
    return rows[0] ?? {};
  }),
});

// ── Webhook Delivery Router ───────────────────────────────────────────────────
export const webhookDeliveryRouter = router({
  list: protectedProcedure
    .input(z.object({ orgId: z.number().optional(), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      const orgFilter = input.orgId ? `WHERE wh.organization_id = ${input.orgId}` : "";
      const rows = await exec(`SELECT wh.*, o.name as org_name FROM webhook_endpoints wh LEFT JOIN organizations o ON wh.organization_id = o.id ${orgFilter} ORDER BY wh.created_at DESC LIMIT ${input.limit}`);
      return rows;
    }),

  register: protectedProcedure
    .input(z.object({ orgId: z.number(), url: z.string().url(), events: z.array(z.string()), description: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const endpointId = `whe_${crypto.randomBytes(8).toString("hex")}`;
      const secret = `whsec_${crypto.randomBytes(16).toString("hex")}`;
      const eventsJson = JSON.stringify(input.events).replace(/'/g, "''");
      await exec(`INSERT INTO webhook_endpoints (endpoint_id, organization_id, url, events, secret, description, created_by, created_at, status, delivery_count, failure_count) VALUES ('${endpointId}', ${input.orgId}, '${input.url}', '${eventsJson}', '${secret}', '${input.description ?? ""}', ${ctx.user.id}, NOW(), 'active', 0, 0)`);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { endpointId, secret, url: input.url, events: input.events };
    }),

  deliver: protectedProcedure
    .input(z.object({ endpointId: z.string(), eventType: z.string(), payload: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ input }) => {
      const endpoints = await exec(`SELECT * FROM webhook_endpoints WHERE endpoint_id = $1 AND status = 'active' LIMIT 1`, [input.endpointId]);
      if (!endpoints.length) throw new Error("Webhook endpoint not found or inactive");
      const endpoint = endpoints[0];
      const payloadStr = JSON.stringify({ event: input.eventType, data: input.payload, timestamp: new Date().toISOString() });
      const signature = signWebhookPayload(payloadStr);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ENV.webhookTimeoutMs);
        const res = await fetch(String(endpoint.url), {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-NDSEP-Signature": `sha256=${signature}`, "X-NDSEP-Event": input.eventType },
          body: payloadStr,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        await exec(`UPDATE webhook_endpoints SET delivery_count = delivery_count + 1, last_delivered_at = NOW() WHERE endpoint_id = $1`, [input.endpointId]);
        emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return { success: res.ok, statusCode: res.status, signature };
      } catch (err) {
        await exec(`UPDATE webhook_endpoints SET failure_count = failure_count + 1 WHERE endpoint_id = $1`, [input.endpointId]);
        emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return { success: false, error: String(err), signature };
      }
    }),

  delete: deleteProcedure
    .input(z.object({ endpointId: z.string() }))
    .mutation(async ({ input }) => {
      await exec(`UPDATE webhook_endpoints SET status = 'deleted' WHERE endpoint_id = $1`, [input.endpointId]);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),
});

// ── Cross-Sector Data Sharing Router ─────────────────────────────────────────
export const crossSectorSharingRouter = router({
  getSharedData: protectedProcedure
    .input(z.object({ sourceSector: z.string(), targetSector: z.string(), dataType: z.string(), limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ input }) => {
      const rows = await exec(
        `SELECT csd.*, o.name as org_name, o.sector FROM cross_sector_data_shares csd LEFT JOIN organizations o ON csd.organization_id = o.id WHERE csd.source_sector = $1 AND csd.target_sector = $2 AND csd.data_type = $3 ORDER BY csd.requested_at DESC LIMIT $4`,
        [input.sourceSector, input.targetSector, input.dataType, input.limit]
      );
      return rows;
    }),

  requestShare: protectedProcedure
    .input(z.object({ orgId: z.number(), sourceSector: z.string(), targetSector: z.string(), dataType: z.string(), justification: z.string(), dataElements: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      const shareId = `XSD-${Date.now()}-${input.orgId}`;
      const elementsJson = JSON.stringify(input.dataElements);
      await exec(
        `INSERT INTO cross_sector_data_shares (share_id, organization_id, source_sector, target_sector, data_type, justification, data_elements, requested_by, requested_at, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), 'pending')`,
        [shareId, input.orgId, input.sourceSector, input.targetSector, input.dataType, input.justification, elementsJson, ctx.user.id]
      );
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { shareId, status: "pending" };
    }),

  approve: approveProcedure
    .input(z.object({ shareId: z.string(), approved: z.boolean(), notes: z.string().optional() }))
    .mutation(async ({ input }) => {
      const status = input.approved ? "approved" : "rejected";
      await exec(`UPDATE cross_sector_data_shares SET status = '${status}', reviewed_at = NOW(), review_notes = '${input.notes ?? ""}' WHERE share_id = '${input.shareId}'`);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { shareId: input.shareId, status };
    }),

  getStats: protectedProcedure.query(async () => {
    const rows = await exec(`SELECT source_sector, target_sector, COUNT(*) as requests, COUNT(CASE WHEN status='approved' THEN 1 END) as approved FROM cross_sector_data_shares GROUP BY source_sector, target_sector ORDER BY requests DESC`);
    return rows;
  }),
});

// ── Retention Enforcement Router ──────────────────────────────────────────────
export const retentionEnforcementRouter = router({
  getSchedule: protectedProcedure.query(async () => {
    const rows = await exec(`SELECT rp.*, o.name as org_name FROM retention_policies rp LEFT JOIN organizations o ON rp.organization_id = o.id ORDER BY rp.next_review_date ASC LIMIT 50`);
    return rows;
  }),

  runEnforcement: protectedProcedure
    .input(z.object({ dryRun: z.boolean().default(true) }))
    .mutation(async ({ input }) => {
      const overdue = await exec(`SELECT rp.*, o.name as org_name, o.sector FROM retention_policies rp LEFT JOIN organizations o ON rp.organization_id = o.id WHERE rp.next_review_date < NOW() AND rp.status = 'active' LIMIT ${ENV.rescoringBatchSize}`);
      if (!input.dryRun) {
        for (const policy of overdue) {
          await exec(`UPDATE retention_policies SET status = 'overdue', last_enforced_at = NOW() WHERE id = $1`, [policy.id]);
        }
      }
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return {
        dryRun: input.dryRun,
        overdueCount: overdue.length,
        overdueOrgs: overdue.map(p => ({ orgName: p.org_name, sector: p.sector, daysOverdue: Math.floor((Date.now() - new Date(String(p.next_review_date)).getTime()) / 86400000) })),
        message: input.dryRun ? `DRY RUN: ${overdue.length} policies would be flagged` : `Enforced: ${overdue.length} policies updated`,
      };
    }),

  getStats: protectedProcedure.query(async () => {
    const rows = await exec(`SELECT COUNT(*) as total_policies, COUNT(CASE WHEN status = 'active' THEN 1 END) as active, COUNT(CASE WHEN status = 'overdue' THEN 1 END) as overdue, COUNT(CASE WHEN next_review_date < NOW() + INTERVAL '7 days' THEN 1 END) as due_soon FROM retention_policies`);
    return rows[0] ?? {};
  }),
});

// ── Compliance Certificate Verification Router ────────────────────────────────
export const certVerificationRouter = router({
  verify: publicProcedure
    .input(z.object({ certNumber: z.string() }))
    .query(async ({ input }) => {
      const rows = await exec(`SELECT cc.*, o.name as org_name, o.sector, o.registration_number FROM compliance_certificates cc LEFT JOIN organizations o ON cc.organization_id = o.id WHERE cc.cert_number = $1 LIMIT 1`, [input.certNumber]);
      if (!rows.length) return { valid: false, message: "Certificate not found" };
      const cert = rows[0];
      const isExpired = new Date(String(cert.expires_at)) < new Date();
      return { valid: !isExpired && cert.status === "active", certNumber: cert.cert_number, orgName: cert.org_name, sector: cert.sector, issuedAt: cert.issued_at, expiresAt: cert.expires_at, status: isExpired ? "expired" : cert.status, issuer: ENV.certIssuerName };
    }),

  issue: protectedProcedure
    .input(z.object({ orgId: z.number(), certType: z.string().default("ndpa_compliance"), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const certNumber = `NDSEP-${input.certType.toUpperCase()}-${Date.now()}-${input.orgId}`;
      const expiresAt = new Date(Date.now() + ENV.certValidityDays * 86400000).toISOString();
      await exec(`INSERT INTO compliance_certificates (cert_number, organization_id, cert_type, issued_by, issued_at, expires_at, status, notes) VALUES ($1, $2, $3, $4, NOW(), $5, 'active', $6)`, [certNumber, input.orgId, input.certType, ctx.user.id, expiresAt, input.notes ?? ""]);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { certNumber, expiresAt, verifyUrl: `${ENV.certVerifyBaseUrl}/${certNumber}` };
    }),

  list: protectedProcedure
    .input(z.object({ orgId: z.number().optional(), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      if (input.orgId) {
        return exec(`SELECT cc.*, o.name as org_name FROM compliance_certificates cc LEFT JOIN organizations o ON cc.organization_id = o.id WHERE cc.organization_id = $1 ORDER BY cc.issued_at DESC LIMIT $2`, [input.orgId, input.limit]);
      }
      return exec(`SELECT cc.*, o.name as org_name FROM compliance_certificates cc LEFT JOIN organizations o ON cc.organization_id = o.id ORDER BY cc.issued_at DESC LIMIT $1`, [input.limit]);
    }),
});

// ── Compliance Re-Scoring Router ──────────────────────────────────────────────
export const complianceRescoringRouter = router({
  runBatch: protectedProcedure
    .input(z.object({ sector: z.string().optional(), limit: z.number().int().min(1).max(200).default(50) }))
    .mutation(async ({ input }) => {
      const orgs = input.sector
        ? await exec(`SELECT id, name, sector, compliance_score FROM organizations WHERE sector = $1 ORDER BY updated_at ASC LIMIT $2`, [input.sector, input.limit])
        : await exec(`SELECT id, name, sector, compliance_score FROM organizations ORDER BY updated_at ASC LIMIT $1`, [input.limit]);
      let updated = 0;
      for (const org of orgs) {
        const orgId = parseInt(String(org.id));
        const breaches = await exec(`SELECT COUNT(*) as cnt FROM breach_incidents WHERE organization_id = $1 AND reported_at > NOW() - INTERVAL '6 months'`, [orgId]);
        const breachPenalty = Math.min(parseInt(String(breaches[0]?.cnt ?? 0)) * 5, 25);
        const baseScore = parseFloat(String(org.compliance_score ?? 50));
        const newScore = Math.max(0, Math.min(100, baseScore - breachPenalty)); // deterministic — no random jitter
        await exec(`UPDATE organizations SET compliance_score = $1, updated_at = NOW() WHERE id = $2`, [newScore, orgId]);
        updated++;
      }
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "production_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { updated, message: `Re-scored ${updated} organizations` };
    }),

  getHistory: protectedProcedure
    .input(z.object({ orgId: z.number(), limit: z.number().default(30) }))
    .query(async ({ input }) => {
      const rows = await exec(`SELECT * FROM compliance_score_history WHERE organization_id = $1 ORDER BY scored_at DESC LIMIT $2`, [input.orgId, input.limit]);
      return rows;
    }),
});
