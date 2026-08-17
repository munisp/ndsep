import AsyncStorage from "@react-native-async-storage/async-storage";

export type StakeholderSyncKind = "profile" | "identity_document" | "business_document";
export type StakeholderSyncStatus = "pending" | "retrying" | "failed" | "dead_letter";
export type PendingStakeholderSyncItem = {
  id: string;
  idempotencyKey: string;
  kind: StakeholderSyncKind;
  label: string;
  queuedAt: string;
  status: StakeholderSyncStatus;
  retryCount: number;
  lastErrorCode?: "transport_failed" | "payload_decryption_failed" | "replay_rejected";
  payloadPath: string;
  payloadHash: string;
};
export const STAKEHOLDER_QUEUE_KEY = "idlr_pts_mobile.pending_stakeholder_sync.v2";

export async function readStakeholderSyncIndex(): Promise<PendingStakeholderSyncItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STAKEHOLDER_QUEUE_KEY);
    const items = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? items.filter((item): item is PendingStakeholderSyncItem => Boolean(item && typeof item === "object" && typeof item.id === "string" && typeof item.idempotencyKey === "string" && typeof item.payloadPath === "string" && typeof item.payloadHash === "string" && typeof item.status === "string")) : [];
  } catch { return []; }
}
export async function writeStakeholderSyncIndex(items: PendingStakeholderSyncItem[]) { await AsyncStorage.setItem(STAKEHOLDER_QUEUE_KEY, JSON.stringify(items)); }
