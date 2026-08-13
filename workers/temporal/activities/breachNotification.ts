import { database, postRequiredWebhook } from "./common";

export async function notifyDpo(params: { breachId: number; email: string; severity: string; deadline: string }): Promise<void> {
  await postRequiredWebhook("breach-dpo", params);
}

export async function escalateToCeo(params: { breachId: number; email: string; hoursRemaining: number }): Promise<void> {
  await postRequiredWebhook("breach-ceo-escalation", params);
}

export async function submitNdpcNotification(params: { breachId: number; orgId: number }): Promise<{ referenceNumber: string; submittedAt: string }> {
  const response = await postRequiredWebhook("breach-ndpc-submission", params);
  const referenceNumber = typeof response.referenceNumber === "string" ? response.referenceNumber : null;
  const submittedAt = typeof response.submittedAt === "string" ? response.submittedAt : new Date().toISOString();
  if (!referenceNumber) throw new Error("Regulatory notification response did not include a referenceNumber");
  const result = await database().query(
    `UPDATE breach_incidents SET ndpc_notified_at = $1, ndpc_reference_number = $2,
       breach_incident_status = 'notified', updated_at = NOW() WHERE id = $3 AND organization_id = $4`,
    [submittedAt, referenceNumber, params.breachId, params.orgId],
  );
  if (result.rowCount !== 1) throw new Error(`Breach ${params.breachId} was not found for organization ${params.orgId}`);
  return { referenceNumber, submittedAt };
}

export async function updateBreachStatus(params: { breachId: number; stage: string; notes?: string }): Promise<void> {
  const statusMap: Record<string, string> = {
    discovered: "detected",
    internal_assessment: "assessing",
    remediation_in_progress: "contained",
    ndpc_notification_pending: "assessing",
    ndpc_notified: "notified",
    post_incident_review: "investigating",
    closed: "resolved",
  };
  const result = await database().query(
    `UPDATE breach_incidents SET breach_incident_status = $1, remediation_actions = COALESCE($2, remediation_actions),
       resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END, updated_at = NOW() WHERE id = $3`,
    [statusMap[params.stage] ?? "assessing", params.notes ?? null, params.breachId],
  );
  if (result.rowCount !== 1) throw new Error(`Breach ${params.breachId} was not found`);
}

export async function assessPenaltyRisk(params: { breachId: number; notifiedAt?: string; discoveredAt: string; severity: string; affectedRecords: number }): Promise<{ penaltyRisk: boolean; estimatedPenalty?: number; reasoning: string }> {
  const discoveredAt = Date.parse(params.discoveredAt);
  if (Number.isNaN(discoveredAt)) throw new Error("Invalid breach discovery timestamp");
  const notifiedAt = params.notifiedAt ? Date.parse(params.notifiedAt) : Number.NaN;
  const late = Number.isNaN(notifiedAt) || notifiedAt - discoveredAt > 72 * 60 * 60 * 1000;
  const severe = ["high", "critical"].includes(params.severity);
  const penaltyRisk = late || severe || params.affectedRecords >= 10_000;
  const estimatedPenalty = penaltyRisk ? Math.max(0, Math.round((late ? 1_000_000 : 0) + (severe ? 500_000 : 0) + params.affectedRecords * 5)) : undefined;
  return { penaltyRisk, estimatedPenalty, reasoning: late ? "NDPC notification missed or exceeded the 72-hour deadline" : penaltyRisk ? "Severity or affected-record volume exceeds configured regulatory risk threshold" : "No timing, severity, or volume risk threshold was breached" };
}

export async function generatePostIncidentReport(breachId: number): Promise<{ reportUrl: string }> {
  const response = await postRequiredWebhook("breach-post-incident-report", { breachId });
  if (typeof response.reportUrl !== "string" || !response.reportUrl) throw new Error("Post-incident reporting endpoint did not return reportUrl");
  return { reportUrl: response.reportUrl };
}
