import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import pg from "pg";
import { emitEvent, logAuditEvent, broadcastEvent, cacheGetJson, cacheSetJson, cacheDel, triggerWorkflow } from "../middlewareHelpers";
import { emitComplianceEvent, opensearchIndex, lakehouseIngest, daprPublish, fluvioPublish, permifyCheck } from "../middlewareExtensions";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { getPgSslConfig } from "../dbSslConfig";
import { getDatabaseUrl } from "../config";
import { logger } from "../logger";
const { Pool } = pg;
let _aiPool: InstanceType<typeof Pool> | null = null;
function getPool() {
  if (!_aiPool) {
    _aiPool = new Pool({ connectionString: getDatabaseUrl(), max: 5, ssl: getPgSslConfig() });
  }
  return _aiPool;
}

const q = async (sql: string, params: unknown[] = []) => {
  const res = await getPool().query(sql, params);
  return res.rows;
};

// ─── NDPA 2023 Control Framework ─────────────────────────────────────────────
const NDPA_CONTROLS = [
  { id: "C01", name: "Lawful Basis for Processing", ref: "§24", description: "Organisation has identified and documented a lawful basis for each processing activity." },
  { id: "C02", name: "Data Subject Consent Management", ref: "§25", description: "Consent is freely given, specific, informed, and unambiguous. Withdrawal mechanism exists." },
  { id: "C03", name: "Data Minimisation & Purpose Limitation", ref: "§26", description: "Only data necessary for the stated purpose is collected. Data is not processed beyond original purpose." },
  { id: "C04", name: "Data Subject Rights", ref: "§27", description: "Organisation can fulfil access, erasure, portability, and objection requests within required timelines." },
  { id: "C05", name: "Cross-border Transfer Controls", ref: "§28", description: "Transfers to third countries use approved mechanisms (adequacy, SCCs, binding corporate rules)." },
  { id: "C06", name: "Staff Training & Awareness", ref: "§32", description: "All staff handling personal data receive regular data protection training. Records are maintained." },
  { id: "C07", name: "DPO Appointment & Independence", ref: "§33", description: "A qualified DPO is appointed, has access to senior management, and operates independently." },
  { id: "C08", name: "Data Protection Impact Assessment", ref: "§35", description: "DPIAs are conducted for high-risk processing activities before commencement." },
  { id: "C09", name: "Breach Detection & 72h NDPC Notification", ref: "§40", description: "Breach detection procedures exist. NDPC is notified within 72 hours of becoming aware of a breach." },
  { id: "C10", name: "Record of Processing Activities (ROPA)", ref: "§41", description: "ROPA is maintained, up-to-date, and available for NDPC inspection." },
  { id: "C11", name: "Privacy Notices & Transparency", ref: "§24(2)", description: "Privacy notices are clear, accessible, and contain all required information." },
  { id: "C12", name: "Processor Agreements & Third-party Controls", ref: "§29", description: "Written DPA agreements exist with all processors. Third-party risk assessments are conducted." },
  { id: "C13", name: "Retention Policies & Secure Disposal", ref: "§26(e)", description: "Retention schedules exist. Data is securely deleted at end of retention period." },
  { id: "C14", name: "Automated Decision-making & Profiling Safeguards", ref: "§37", description: "Safeguards exist for automated decisions with significant effects. Human review is available." },
  { id: "C15", name: "Children's Data & Parental Consent", ref: "§34", description: "Age verification mechanisms exist. Parental consent is obtained for children under 13." },
];

export const dpcoAiRouter = router({
  // ─── AI Gap Analysis ───────────────────────────────────────────────────────
  runGapAnalysis: protectedProcedure
    .input(z.object({
      engagementId: z.number().int(),
      evidenceText: z.string().min(10).max(50000).describe("Concatenated text from uploaded evidence documents"),
      organisationName: z.string(),
      sector: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const systemPrompt = `You are an expert NDPA 2023 data protection auditor. You will analyse evidence documents provided by a regulated Nigerian organisation and assess their compliance against each of the 15 NDPA 2023 controls. 

For each control, provide:
1. A rating: "compliant", "partially_compliant", "non_compliant", or "not_applicable"
2. A confidence score (0.0 to 1.0)
3. A brief rationale (1-2 sentences) citing specific evidence found or absent
4. Key findings (array of strings, max 3)

Be precise, evidence-based, and conservative — if evidence is ambiguous, rate as partially_compliant rather than compliant.`;

      const userPrompt = `Organisation: ${input.organisationName}
Sector: ${input.sector || "General"}

Evidence Documents (concatenated text):
---
${input.evidenceText.substring(0, 40000)}
---

Assess compliance against all 15 NDPA 2023 controls. Return a JSON object with a "ratings" array.`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "gap_analysis_result",
            strict: true,
            schema: {
              type: "object",
              properties: {
                ratings: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      controlId: { type: "string" },
                      rating: { type: "string", enum: ["compliant", "partially_compliant", "non_compliant", "not_applicable"] },
                      confidence: { type: "number" },
                      rationale: { type: "string" },
                      keyFindings: { type: "array", items: { type: "string" } },
                    },
                    required: ["controlId", "rating", "confidence", "rationale", "keyFindings"],
                    additionalProperties: false,
                  },
                },
                overallScore: { type: "number" },
                executiveSummary: { type: "string" },
              },
              required: ["ratings", "overallScore", "executiveSummary"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices[0]?.message?.content as string;
      if (!content) throw new Error("AI gap analysis returned no content");

      const result = JSON.parse(content);

      // Save AI-generated ratings to the database for auditor review
      await q(
        `INSERT INTO dpco_ai_gap_analyses 
          (engagement_id, overall_score, executive_summary, ratings_json, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (engagement_id) DO UPDATE SET
           overall_score = EXCLUDED.overall_score,
           executive_summary = EXCLUDED.executive_summary,
           ratings_json = EXCLUDED.ratings_json,
           updated_at = NOW()`,
        [input.engagementId, result.overallScore, result.executiveSummary, JSON.stringify(result.ratings)]
      );

      emitMutationEvent("ndsep.ai.mutation", { action: "dpcoAi", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return {
        success: true,
        overallScore: result.overallScore,
        executiveSummary: result.executiveSummary,
        ratings: result.ratings,
        controlCount: result.ratings.length,
      };
    }),

  // ─── Get Saved Gap Analysis ────────────────────────────────────────────────
  getGapAnalysis: protectedProcedure
    .input(z.object({ engagementId: z.number().int() }))
    .query(async ({ input }) => {
      const [row] = await q(
        `SELECT * FROM dpco_ai_gap_analyses WHERE engagement_id = $1`,
        [input.engagementId]
      );
      if (!row) return null;
      return {
        overallScore: row.overall_score,
        executiveSummary: row.executive_summary,
        ratings: JSON.parse(row.ratings_json || "[]"),
        updatedAt: row.updated_at || row.created_at,
      };
    }),

  // ─── CAR Narrative Generation ──────────────────────────────────────────────
  generateCarNarrative: protectedProcedure
    .input(z.object({
      engagementId: z.number().int(),
      organisationName: z.string(),
      sector: z.string().optional(),
      auditPeriod: z.string().describe("e.g. January 2025 – December 2025"),
      leadAuditorName: z.string(),
      dpcoName: z.string(),
      controlRatings: z.array(z.object({
        controlId: z.string(),
        rating: z.string(),
        notes: z.string().optional(),
      })),
      overallComplianceScore: z.number().min(0).max(100),
    }))
    .mutation(async ({ input }) => {
      const ratingsText = input.controlRatings.map(r => {
        const control = NDPA_CONTROLS.find(c => c.id === r.controlId);
        emitMutationEvent("ndsep.ai.mutation", { action: "dpcoAi", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return `${r.controlId} (${control?.name || r.controlId}): ${r.rating}${r.notes ? ` — ${r.notes}` : ""}`;
      }).join("\n");

      const systemPrompt = `You are a senior data protection auditor writing a formal Compliance Audit Return (CAR) narrative for submission to the Nigeria Data Protection Commission (NDPC) under the Nigeria Data Protection Act 2023. 

Write in formal, professional regulatory language. Be specific, factual, and structured. The narrative must be suitable for direct submission to the NDPC.`;

      const userPrompt = `Generate a complete CAR narrative for the following audit:

Organisation: ${input.organisationName}
Sector: ${input.sector || "General"}
Audit Period: ${input.auditPeriod}
Lead Auditor: ${input.leadAuditorName}
DPCO: ${input.dpcoName}
Overall Compliance Score: ${input.overallComplianceScore}/100

Control Assessment Results:
${ratingsText}

Generate the following sections:
1. Executive Summary (2-3 paragraphs)
2. Audit Scope and Methodology
3. Key Findings (for each non-compliant and partially compliant control)
4. Recommendations (prioritised by risk)
5. Auditor's Declaration

Return as JSON with these section keys.`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "car_narrative",
            strict: true,
            schema: {
              type: "object",
              properties: {
                executiveSummary: { type: "string" },
                scopeAndMethodology: { type: "string" },
                keyFindings: { type: "string" },
                recommendations: { type: "string" },
                auditorDeclaration: { type: "string" },
              },
              required: ["executiveSummary", "scopeAndMethodology", "keyFindings", "recommendations", "auditorDeclaration"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices[0]?.message?.content as string;
      if (!content) throw new Error("AI CAR narrative generation returned no content");

      const narrative = JSON.parse(content);

      // Save to database
      await q(
        `INSERT INTO dpco_car_narratives 
          (engagement_id, executive_summary, scope_and_methodology, key_findings, recommendations, auditor_declaration, generated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (engagement_id) DO UPDATE SET
           executive_summary = EXCLUDED.executive_summary,
           scope_and_methodology = EXCLUDED.scope_and_methodology,
           key_findings = EXCLUDED.key_findings,
           recommendations = EXCLUDED.recommendations,
           auditor_declaration = EXCLUDED.auditor_declaration,
           generated_at = NOW()`,
        [
          input.engagementId,
          narrative.executiveSummary,
          narrative.scopeAndMethodology,
          narrative.keyFindings,
          narrative.recommendations,
          narrative.auditorDeclaration,
        ]
      );

      emitMutationEvent("ndsep.ai.mutation", { action: "dpcoAi", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, narrative };
    }),

  // ─── Get Saved CAR Narrative ───────────────────────────────────────────────
  getCarNarrative: protectedProcedure
    .input(z.object({ engagementId: z.number().int() }))
    .query(async ({ input }) => {
      const [row] = await q(
        `SELECT * FROM dpco_car_narratives WHERE engagement_id = $1`,
        [input.engagementId]
      );
      if (!row) return null;
      return {
        executiveSummary: row.executive_summary,
        scopeAndMethodology: row.scope_and_methodology,
        keyFindings: row.key_findings,
        recommendations: row.recommendations,
        auditorDeclaration: row.auditor_declaration,
        generatedAt: row.generated_at,
      };
    }),

  // ─── Client Risk Prediction ────────────────────────────────────────────────
  predictClientRisk: protectedProcedure
    .input(z.object({
      organisationId: z.number().int(),
      organisationName: z.string(),
      sector: z.string(),
      employeeCount: z.number().int().optional(),
      dataSubjectCount: z.number().int().optional(),
      lastAuditScore: z.number().min(0).max(100).optional(),
      daysSinceLastAudit: z.number().int().optional(),
      openFindings: z.number().int().optional(),
      breachCount12m: z.number().int().optional(),
      crossBorderTransfers: z.boolean().optional(),
      processesChildrenData: z.boolean().optional(),
      processesSensitiveData: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const systemPrompt = `You are an NDPA 2023 compliance risk analyst. Analyse the provided organisational profile and predict the data protection compliance risk level. 

Use the DCPMI (Data Compliance Penalty Matrix Index) framework which considers:
- Processing volume and sensitivity
- Historical compliance performance  
- Sector-specific risk factors
- Time since last audit
- Open findings and breach history

Return a structured risk assessment.`;

      const userPrompt = `Predict compliance risk for:

Organisation: ${input.organisationName}
Sector: ${input.sector}
Employees: ${input.employeeCount ?? "Unknown"}
Data Subjects: ${input.dataSubjectCount ?? "Unknown"}
Last Audit Score: ${input.lastAuditScore ?? "No prior audit"}/100
Days Since Last Audit: ${input.daysSinceLastAudit ?? "N/A"}
Open Findings: ${input.openFindings ?? 0}
Breach Count (12m): ${input.breachCount12m ?? 0}
Cross-border Transfers: ${input.crossBorderTransfers ? "Yes" : "No"}
Processes Children's Data: ${input.processesChildrenData ? "Yes" : "No"}
Processes Sensitive Data: ${input.processesSensitiveData ? "Yes" : "No"}

Provide a risk score (0-100), risk level, primary risk factors, and recommended audit priority.`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "risk_prediction",
            strict: true,
            schema: {
              type: "object",
              properties: {
                riskScore: { type: "number" },
                riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"] },
                primaryRiskFactors: { type: "array", items: { type: "string" } },
                auditPriority: { type: "string", enum: ["routine", "elevated", "urgent", "immediate"] },
                recommendedAuditFrequency: { type: "string" },
                mitigationActions: { type: "array", items: { type: "string" } },
                dcpmiExposureEstimate: { type: "string" },
              },
              required: ["riskScore", "riskLevel", "primaryRiskFactors", "auditPriority", "recommendedAuditFrequency", "mitigationActions", "dcpmiExposureEstimate"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices[0]?.message?.content as string;
      if (!content) throw new Error("AI risk prediction returned no content");

      const prediction = JSON.parse(content);

      // Save prediction to database
      await q(
        `INSERT INTO dpco_risk_predictions
          (organisation_id, risk_score, risk_level, primary_risk_factors, audit_priority, 
           recommended_audit_frequency, mitigation_actions, dcpmi_exposure_estimate, predicted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          input.organisationId,
          prediction.riskScore,
          prediction.riskLevel,
          JSON.stringify(prediction.primaryRiskFactors),
          prediction.auditPriority,
          prediction.recommendedAuditFrequency,
          JSON.stringify(prediction.mitigationActions),
          prediction.dcpmiExposureEstimate,
        ]
      );

      emitMutationEvent("ndsep.ai.mutation", { action: "dpcoAi", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, prediction };
    }),

  // ─── Get Latest Risk Prediction ────────────────────────────────────────────
  getLatestRiskPrediction: protectedProcedure
    .input(z.object({ organisationId: z.number().int() }))
    .query(async ({ input }) => {
      const [row] = await q(
        `SELECT * FROM dpco_risk_predictions WHERE organisation_id = $1 ORDER BY predicted_at DESC LIMIT 1`,
        [input.organisationId]
      );
      if (!row) return null;
      return {
        riskScore: row.risk_score,
        riskLevel: row.risk_level,
        primaryRiskFactors: JSON.parse(row.primary_risk_factors || "[]"),
        auditPriority: row.audit_priority,
        recommendedAuditFrequency: row.recommended_audit_frequency,
        mitigationActions: JSON.parse(row.mitigation_actions || "[]"),
        dcpmiExposureEstimate: row.dcpmi_exposure_estimate,
        predictedAt: row.predicted_at,
      };
    }),

  // ─── Get NDPA Controls Reference ──────────────────────────────────────────
  getNdpaControls: protectedProcedure
    .query(() => NDPA_CONTROLS),
});
