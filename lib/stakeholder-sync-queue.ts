import AsyncStorage from "@react-native-async-storage/async-storage";

export type PendingStakeholderSyncItem = {
  id: string;
  kind: "profile" | "identity_document" | "business_document";
  label: string;
  queuedAt: string;
  status: "pending" | "retrying" | "failed";
};

const QUEUE_KEY = "idlr_pts_mobile.pending_stakeholder_sync.v1";

export async function getPendingStakeholderSyncItems(): Promise<PendingStakeholderSyncItem[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const items = JSON.parse(raw) as unknown;
    return Array.isArray(items) ? items.filter((item): item is PendingStakeholderSyncItem => Boolean(item && typeof item === "object" && "id" in item && "kind" in item && "label" in item && "queuedAt" in item && "status" in item)) : [];
  } catch {
    return [];
  }
}
