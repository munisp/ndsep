import crypto from "node:crypto";
import { database, postRequiredWebhook } from "./common";

export async function validateDocuments(applicationId: number): Promise<{ valid: boolean; missing: string[] }> {
  const result = await database().query(
    `SELECT incorporation_doc_url, financial_statements_url, indemnity_insurance_url,
            audit_methodology_url, conflict_declaration
       FROM dpco_accreditation_applications WHERE id = $1`,
    [applicationId],
  );
  if (result.rowCount !== 1) throw new Error(`Accreditation application ${applicationId} was not found`);
  const application = result.rows[0] as Record<string, unknown>;
  const required = [
    ["incorporation_doc_url", "incorporation document"],
    ["financial_statements_url", "financial statements"],
    ["indemnity_insurance_url", "indemnity insurance"],
    ["audit_methodology_url", "audit methodology"],
  ] as const;
  const missing = required.filter(([field]) => !application[field]).map(([, label]) => label);
  if (application.conflict_declaration !== true) missing.push("signed conflict declaration");
  return { valid: missing.length === 0, missing };
}

export async function notifyApplicant(params: { applicationId: number; email: string; stage: string; message: string }): Promise<void> {
  await postRequiredWebhook("accreditation-applicant", params);
}

export async function updateApplicationStatus(params: { applicationId: number; status: string; notes?: string }): Promise<void> {
  const statusMap: Record<string, string> = {
    submitted: "submitted",
    document_review: "under_review",
    technical_assessment: "under_review",
    committee_review: "under_review",
    approved: "approved",
    rejected: "rejected",
  };
  const target = statusMap[params.status] ?? "under_review";
  const result = await database().query(
    `UPDATE dpco_accreditation_applications
        SET status = $1::accreditation_app_status,
            review_started_at = COALESCE(review_started_at, NOW()),
            decision_reason = CASE WHEN $1 IN ('approved', 'rejected') THEN $2 ELSE decision_reason END,
            updated_at = NOW()
      WHERE id = $3`,
    [target, params.notes ?? null, params.applicationId],
  );
  if (result.rowCount !== 1) throw new Error(`Accreditation application ${params.applicationId} was not found`);
}

export async function runTechnicalAssessment(applicationId: number): Promise<{ score: number; findings: Array<{ category: string; severity: "critical" | "major" | "minor"; description: string }>; passThreshold: boolean }> {
  const result = await database().query(
    `SELECT lead_auditors, sectors, conflict_declaration, incorporation_doc_url,
            financial_statements_url, indemnity_insurance_url, audit_methodology_url
       FROM dpco_accreditation_applications WHERE id = $1`,
    [applicationId],
  );
  if (result.rowCount !== 1) throw new Error(`Accreditation application ${applicationId} was not found`);
  const application = result.rows[0] as Record<string, unknown>;
  const findings: Array<{ category: string; severity: "critical" | "major" | "minor"; description: string }> = [];
  const documents = ["incorporation_doc_url", "financial_statements_url", "indemnity_insurance_url", "audit_methodology_url"];
  for (const field of documents) if (!application[field]) findings.push({ category: "documentation", severity: "major", description: `Missing ${field}` });
  if (application.conflict_declaration !== true) findings.push({ category: "governance", severity: "critical", description: "Conflict declaration has not been signed" });
  const auditors = Array.isArray(application.lead_auditors) ? application.lead_auditors : [];
  if (auditors.length === 0) findings.push({ category: "competence", severity: "major", description: "No lead auditors were submitted" });
  const score = Math.max(0, 100 - findings.reduce((total, finding) => total + (finding.severity === "critical" ? 45 : finding.severity === "major" ? 20 : 5), 0));
  return { score, findings, passThreshold: score >= 70 && !findings.some((finding) => finding.severity === "critical") };
}

export async function issueCertificate(params: { applicationId: number; dpcoOrgId: number; validityYears: number }): Promise<{ certificateToken: string; expiresAt: string }> {
  const token = crypto.randomBytes(24).toString("hex");
  const result = await database().query(
    `UPDATE dpco_accreditation_applications
        SET status = 'approved', decision = 'approved', decision_at = NOW(),
            issued_licence_number = $1, licence_issued_at = NOW(),
            licence_expires_at = NOW() + make_interval(years => $2::int), updated_at = NOW()
      WHERE id = $3
      RETURNING licence_expires_at`,
    [token, params.validityYears, params.applicationId],
  );
  if (result.rowCount !== 1) throw new Error(`Accreditation application ${params.applicationId} was not found`);
  return { certificateToken: token, expiresAt: new Date(result.rows[0].licence_expires_at).toISOString() };
}

export async function notifyOwner(params: { applicationId: number; outcome: "approved" | "rejected"; dpcoOrgId: number }): Promise<void> {
  await postRequiredWebhook("accreditation-owner", params);
}

export async function escalateOverdueReview(params: { applicationId: number; stage: string; daysPastSla: number }): Promise<void> {
  await postRequiredWebhook("accreditation-escalation", params);
}
