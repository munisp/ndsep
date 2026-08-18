import type { PendingStakeholderSyncItem } from "@/lib/stakeholder-sync-index";

export type StakeholderQueueFilter = "all" | "pending" | "failed" | "dead_letter";
export type StakeholderQueueSort = "newest" | "oldest" | "status";
export function filterAndSortStakeholderSyncItems(items: PendingStakeholderSyncItem[], filter: StakeholderQueueFilter, sort: StakeholderQueueSort) {
  return items.filter((item) => filter === "all" || item.status === filter).sort((a, b) => sort === "newest" ? b.queuedAt.localeCompare(a.queuedAt) : sort === "oldest" ? a.queuedAt.localeCompare(b.queuedAt) : a.status.localeCompare(b.status) || b.queuedAt.localeCompare(a.queuedAt));
}
export function getBulkRetryEligibleStakeholderItems(items: PendingStakeholderSyncItem[]) { return items.filter((item) => item.status === "failed"); }
