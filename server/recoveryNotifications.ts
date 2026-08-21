import { notifyOwner } from "./_core/notification";

export type RecoveryNotificationType = "recovery_created" | "recovery_consumed" | "recovery_quorum_reached" | "recovery_expired";

type RecoveryNotificationInput = {
  type: RecoveryNotificationType;
  authorizationId: string;
  queueId: string;
  actorSubject?: string;
};

const TITLES: Record<RecoveryNotificationType, string> = {
  recovery_created: "Recovery authorization created",
  recovery_consumed: "Recovery replay completed",
  recovery_quorum_reached: "Recovery quorum authorized",
  recovery_expired: "Recovery authorization expired",
};

const CONTENT_TEMPLATES: Record<RecoveryNotificationType, (input: RecoveryNotificationInput) => string> = {
  recovery_created: (input) =>
    `A new dual-approval recovery authorization (${input.authorizationId.slice(0, 8)}…) was created for queue item "${input.queueId}" by ${input.actorSubject ?? "an authenticated security engineer"}. Two distinct passkey approvals are required before any KMS rewrap or replay can proceed.`,
  recovery_consumed: (input) =>
    `Recovery authorization ${input.authorizationId.slice(0, 8)}… for queue item "${input.queueId}" has been consumed. The re-encrypted envelope was delivered to the approved replay worker. The authorization is now permanently closed.`,
  recovery_quorum_reached: (input) =>
    `Both required recovery approvals have been verified for authorization ${input.authorizationId.slice(0, 8)}… (queue: "${input.queueId}"). The authorization is now eligible for KMS rewrap and controlled replay.`,
  recovery_expired: (input) =>
    `Recovery authorization ${input.authorizationId.slice(0, 8)}… for queue item "${input.queueId}" has expired without reaching the required approval quorum. A new authorization must be created to retry.`,
};

export async function sendRecoveryNotification(input: RecoveryNotificationInput): Promise<boolean> {
  const title = TITLES[input.type];
  const content = CONTENT_TEMPLATES[input.type](input);
  try {
    return await notifyOwner({ title, content });
  } catch {
    console.warn(`[RecoveryNotification] Failed to send ${input.type} notification for ${input.authorizationId}`);
    return false;
  }
}
