import { condition, defineQuery, defineSignal, proxyActivities, setHandler } from "@temporalio/workflow";
import type * as activities from "../activities/accreditation";

export interface AccreditationInput {
  applicationId: number;
  dpcoOrgId: number;
  applicantEmail: string;
  submittedAt: string;
}

export interface AccreditationResult {
  applicationId: number;
  status: "approved" | "rejected" | "expired";
  certificateToken?: string;
  completedAt: string;
  durationDays: number;
}

export type AccreditationStage = "submitted" | "document_review" | "technical_assessment" | "committee_review" | "approved" | "rejected" | "certificate_issued";

export const documentReviewCompleteSignal = defineSignal<[{ approved: boolean; notes: string }]>("documentReviewComplete");
export const committeeDecisionSignal = defineSignal<[{ approved: boolean; notes: string }]>("committeeDecision");
export const getStateQuery = defineQuery<AccreditationStage>("getState");

const acts = proxyActivities<typeof activities>({ startToCloseTimeout: "10 minutes", retry: { maximumAttempts: 3 } });

export async function accreditationWorkflow(input: AccreditationInput): Promise<AccreditationResult> {
  let stage: AccreditationStage = "submitted";
  let documentDecision: { approved: boolean; notes: string } | undefined;
  let committeeDecision: { approved: boolean; notes: string } | undefined;
  setHandler(getStateQuery, () => stage);
  setHandler(documentReviewCompleteSignal, (decision) => { documentDecision = decision; });
  setHandler(committeeDecisionSignal, (decision) => { committeeDecision = decision; });

  stage = "document_review";
  await acts.updateApplicationStatus({ applicationId: input.applicationId, status: stage });
  await acts.notifyApplicant({ applicationId: input.applicationId, email: input.applicantEmail, stage, message: "Your accreditation documents are under review." });
  const documentValidation = await acts.validateDocuments(input.applicationId);
  if (!documentValidation.valid) {
    stage = "rejected";
    const notes = `Missing or invalid documents: ${documentValidation.missing.join(", ")}`;
    await acts.updateApplicationStatus({ applicationId: input.applicationId, status: stage, notes });
    await acts.notifyApplicant({ applicationId: input.applicationId, email: input.applicantEmail, stage, message: notes });
    await acts.notifyOwner({ applicationId: input.applicationId, outcome: "rejected", dpcoOrgId: input.dpcoOrgId });
    return { applicationId: input.applicationId, status: "rejected", completedAt: new Date().toISOString(), durationDays: Math.max(0, Math.ceil((Date.now() - Date.parse(input.submittedAt)) / 86_400_000)) };
  }

  const reviewedWithinSla = await condition(() => documentDecision !== undefined, "5 days");
  if (!reviewedWithinSla) await acts.escalateOverdueReview({ applicationId: input.applicationId, stage, daysPastSla: 5 });
  await condition(() => documentDecision !== undefined);
  if (!documentDecision!.approved) {
    stage = "rejected";
    await acts.updateApplicationStatus({ applicationId: input.applicationId, status: stage, notes: documentDecision!.notes });
    await acts.notifyApplicant({ applicationId: input.applicationId, email: input.applicantEmail, stage, message: documentDecision!.notes });
    await acts.notifyOwner({ applicationId: input.applicationId, outcome: "rejected", dpcoOrgId: input.dpcoOrgId });
    return { applicationId: input.applicationId, status: "rejected", completedAt: new Date().toISOString(), durationDays: Math.max(0, Math.ceil((Date.now() - Date.parse(input.submittedAt)) / 86_400_000)) };
  }

  stage = "technical_assessment";
  await acts.updateApplicationStatus({ applicationId: input.applicationId, status: stage });
  const assessment = await acts.runTechnicalAssessment(input.applicationId);
  if (!assessment.passThreshold) {
    stage = "rejected";
    const notes = `Technical assessment score ${assessment.score}: ${assessment.findings.map((finding) => finding.description).join("; ")}`;
    await acts.updateApplicationStatus({ applicationId: input.applicationId, status: stage, notes });
    await acts.notifyApplicant({ applicationId: input.applicationId, email: input.applicantEmail, stage, message: notes });
    await acts.notifyOwner({ applicationId: input.applicationId, outcome: "rejected", dpcoOrgId: input.dpcoOrgId });
    return { applicationId: input.applicationId, status: "rejected", completedAt: new Date().toISOString(), durationDays: Math.max(0, Math.ceil((Date.now() - Date.parse(input.submittedAt)) / 86_400_000)) };
  }

  stage = "committee_review";
  await acts.updateApplicationStatus({ applicationId: input.applicationId, status: stage });
  await acts.notifyApplicant({ applicationId: input.applicationId, email: input.applicantEmail, stage, message: "Your application is awaiting committee decision." });
  const decidedWithinSla = await condition(() => committeeDecision !== undefined, "5 days");
  if (!decidedWithinSla) await acts.escalateOverdueReview({ applicationId: input.applicationId, stage, daysPastSla: 5 });
  await condition(() => committeeDecision !== undefined);
  if (!committeeDecision!.approved) {
    stage = "rejected";
    await acts.updateApplicationStatus({ applicationId: input.applicationId, status: stage, notes: committeeDecision!.notes });
    await acts.notifyApplicant({ applicationId: input.applicationId, email: input.applicantEmail, stage, message: committeeDecision!.notes });
    await acts.notifyOwner({ applicationId: input.applicationId, outcome: "rejected", dpcoOrgId: input.dpcoOrgId });
    return { applicationId: input.applicationId, status: "rejected", completedAt: new Date().toISOString(), durationDays: Math.max(0, Math.ceil((Date.now() - Date.parse(input.submittedAt)) / 86_400_000)) };
  }

  stage = "approved";
  await acts.updateApplicationStatus({ applicationId: input.applicationId, status: stage, notes: committeeDecision!.notes });
  const certificate = await acts.issueCertificate({ applicationId: input.applicationId, dpcoOrgId: input.dpcoOrgId, validityYears: 2 });
  stage = "certificate_issued";
  await acts.notifyApplicant({ applicationId: input.applicationId, email: input.applicantEmail, stage, message: `Accreditation approved. Licence expires ${certificate.expiresAt}.` });
  await acts.notifyOwner({ applicationId: input.applicationId, outcome: "approved", dpcoOrgId: input.dpcoOrgId });
  return { applicationId: input.applicationId, status: "approved", certificateToken: certificate.certificateToken, completedAt: new Date().toISOString(), durationDays: Math.max(0, Math.ceil((Date.now() - Date.parse(input.submittedAt)) / 86_400_000)) };
}

export const ACCREDITATION_WORKFLOW_ID_PREFIX = "accreditation-";
export const ACCREDITATION_TASK_QUEUE = "ndsep-accreditation";
export const ACCREDITATION_SLA_DAYS = 90;
export const DOCUMENT_REVIEW_SLA_DAYS = 5;
export const TECHNICAL_ASSESSMENT_SLA_DAYS = 10;
export const COMMITTEE_REVIEW_SLA_DAYS = 5;
