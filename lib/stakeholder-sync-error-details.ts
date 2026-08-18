import type { PendingStakeholderSyncItem } from "./stakeholder-sync-index";

export function describeStakeholderSyncFailure(item: PendingStakeholderSyncItem) {
  const detail = item.lastErrorMessage ? ` Details: ${item.lastErrorMessage}` : "";
  if (item.lastErrorCode === "payload_decryption_failed") return `This encrypted submission cannot be opened with this device's protected key and remains quarantined.${detail}`;
  if (item.lastErrorCode === "replay_rejected") return `The server rejected this submission because its corrected data or idempotency record was not accepted.${detail}`;
  return `The app could not reach the synchronization service. The submission remains encrypted on this device and can be retried.${detail}`;
}
