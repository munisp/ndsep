import type { PendingStakeholderSyncItem } from "./stakeholder-sync-index";

const BACKOFF_MINUTES = [5, 15, 60] as const;
export function getNextStakeholderRetryAt(retryCount: number, now = Date.now()) { const minutes = BACKOFF_MINUTES[Math.min(Math.max(retryCount - 1, 0), BACKOFF_MINUTES.length - 1)]; return new Date(now + minutes * 60_000).toISOString(); }
export function isStakeholderItemDueForAutomaticRetry(item: PendingStakeholderSyncItem, now = Date.now()) { return item.status === "pending" || (item.status === "failed" && (!item.nextRetryAt || new Date(item.nextRetryAt).getTime() <= now)); }
export function describeStakeholderRetrySchedule(item: PendingStakeholderSyncItem, now = Date.now()) { if (item.status === "paused") return "Automatic retry is paused. You can resume with a manual retry."; if (item.status !== "failed" || !item.nextRetryAt) return null; const milliseconds = new Date(item.nextRetryAt).getTime() - now; return milliseconds <= 0 ? "Automatic retry is due now when internet is available." : `Next automatic retry in ${Math.ceil(milliseconds / 60_000)} minute${Math.ceil(milliseconds / 60_000) === 1 ? "" : "s"}.`; }
