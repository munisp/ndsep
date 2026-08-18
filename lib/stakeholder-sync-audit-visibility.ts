import type { PendingStakeholderSyncItem } from "./stakeholder-sync-index";
export function shouldShowTechnicalRetryAudit(simplifiedView: boolean, item: Pick<PendingStakeholderSyncItem, "retryAudit">) { return !simplifiedView && Boolean(item.retryAudit?.length); }
