import { condition, defineQuery, defineSignal, proxyActivities, setHandler } from "@temporalio/workflow";
import type * as activities from "../activities/breachNotification";

export interface BreachNotificationInput {
  breachId: number;
  orgId: number;
  dpoEmail: string;
  ceoEmail: string;
  discoveredAt: string;
  severity: "low" | "medium" | "high" | "critical";
  estimatedAffectedRecords: number;
}

export interface BreachNotificationResult {
  breachId: number;
  ndpcNotifiedAt?: string;
  notificationStatus: "submitted_on_time" | "submitted_late" | "missed_deadline" | "not_required";
  penaltyRisk: boolean;
  completedAt: string;
}

export type BreachNotificationStage = "discovered" | "internal_assessment" | "remediation_in_progress" | "ndpc_notification_pending" | "ndpc_notified" | "post_incident_review" | "closed";

export const ndpcNotificationSubmittedSignal = defineSignal<[{ referenceNumber: string; submittedAt?: string }]>("ndpcNotificationSubmitted");
export const breachContainedSignal = defineSignal("breachContained");
export const getStageQuery = defineQuery<BreachNotificationStage>("getStage");

const acts = proxyActivities<typeof activities>({ startToCloseTimeout: "10 minutes", retry: { maximumAttempts: 3 } });

export async function breachNotificationWorkflow(input: BreachNotificationInput): Promise<BreachNotificationResult> {
  let stage: BreachNotificationStage = "discovered";
  let notification: { referenceNumber: string; submittedAt?: string } | undefined;
  let contained = false;
  setHandler(getStageQuery, () => stage);
  setHandler(ndpcNotificationSubmittedSignal, (value) => { notification = value; });
  setHandler(breachContainedSignal, () => { contained = true; });

  const discoveredAt = Date.parse(input.discoveredAt);
  if (Number.isNaN(discoveredAt)) throw new Error("Invalid discoveredAt timestamp");
  const deadline = new Date(discoveredAt + 72 * 60 * 60 * 1000).toISOString();
  await acts.notifyDpo({ breachId: input.breachId, email: input.dpoEmail, severity: input.severity, deadline });
  await acts.updateBreachStatus({ breachId: input.breachId, stage });

  stage = "internal_assessment";
  const assessedWithin24h = await condition(() => contained || notification !== undefined, "24 hours");
  if (!assessedWithin24h) await acts.escalateToCeo({ breachId: input.breachId, email: input.ceoEmail, hoursRemaining: 48 });
  await acts.updateBreachStatus({ breachId: input.breachId, stage });

  stage = "remediation_in_progress";
  const containedWithin60h = await condition(() => contained || notification !== undefined, "36 hours");
  if (!containedWithin60h && !notification) await acts.escalateToCeo({ breachId: input.breachId, email: input.ceoEmail, hoursRemaining: 12 });
  await acts.updateBreachStatus({ breachId: input.breachId, stage });

  stage = "ndpc_notification_pending";
  const submittedByDeadline = await condition(() => notification !== undefined, "12 hours");
  if (!submittedByDeadline) {
    // The configured regulatory activity is the only path that may claim a submission.
    notification = await acts.submitNdpcNotification({ breachId: input.breachId, orgId: input.orgId });
  }
  const notifiedAt = notification?.submittedAt ?? new Date().toISOString();
  stage = "ndpc_notified";
  await acts.updateBreachStatus({ breachId: input.breachId, stage, notes: `NDPC reference ${notification?.referenceNumber ?? "unknown"}` });
  const risk = await acts.assessPenaltyRisk({ breachId: input.breachId, notifiedAt, discoveredAt: input.discoveredAt, severity: input.severity, affectedRecords: input.estimatedAffectedRecords });

  stage = "post_incident_review";
  await acts.generatePostIncidentReport(input.breachId);
  stage = "closed";
  await acts.updateBreachStatus({ breachId: input.breachId, stage });
  const onTime = Date.parse(notifiedAt) - discoveredAt <= 72 * 60 * 60 * 1000;
  return { breachId: input.breachId, ndpcNotifiedAt: notifiedAt, notificationStatus: onTime ? "submitted_on_time" : "submitted_late", penaltyRisk: risk.penaltyRisk, completedAt: new Date().toISOString() };
}

export const BREACH_WORKFLOW_ID_PREFIX = "breach-";
export const BREACH_TASK_QUEUE = "ndsep-breach";
export const NDPC_NOTIFICATION_DEADLINE_HOURS = 72;
export const POST_INCIDENT_REPORT_DEADLINE_DAYS = 30;
export const ESCALATION_TO_DPO_HOURS = 24;
export const ESCALATION_TO_CEO_HOURS = 60;
