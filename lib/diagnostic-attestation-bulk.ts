export type SelectableAttestation = { receiptId: string; status: "active" | "revoked" };
export function toggleAttestationSelection(selectedIds: string[], receiptId: string) { return selectedIds.includes(receiptId) ? selectedIds.filter((id) => id !== receiptId) : [...selectedIds, receiptId]; }
export function activeAttestationIds(items: SelectableAttestation[], selectedIds: string[]) { const activeIds = new Set(items.filter((item) => item.status === "active").map((item) => item.receiptId)); return selectedIds.filter((id) => activeIds.has(id)); }
export function bulkRevocationConfirmationPhrase(activeReceiptCount: number) { return `REVOKE ${activeReceiptCount}`; }
