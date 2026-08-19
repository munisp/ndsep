export type ReceiptRevocationNotificationView = { notificationId: string; receiptId: string; revocationReason: string; createdAt: string; readAt: string | null };
export function firstUnreadReceiptRevocation(items: ReceiptRevocationNotificationView[] | undefined) { return items?.find((item) => !item.readAt) ?? null; }
export function receiptRevocationSummary(item: ReceiptRevocationNotificationView) { return `Receipt ${item.receiptId} was revoked by an administrator. ${item.revocationReason}`; }
