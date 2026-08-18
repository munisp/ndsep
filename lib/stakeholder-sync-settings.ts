import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "idlr_pts_mobile.stakeholder_sync_preferences.v1";
export type StakeholderSyncPreferences = { pauseOnCellular: boolean; wifiOnlyDocumentUpload: boolean; wifiOnlyAllQueuedMutations: boolean };
const DEFAULTS: StakeholderSyncPreferences = { pauseOnCellular: false, wifiOnlyDocumentUpload: false, wifiOnlyAllQueuedMutations: false };
export async function getStakeholderSyncPreferences(): Promise<StakeholderSyncPreferences> { try { const stored = await AsyncStorage.getItem(KEY); const saved = stored ? JSON.parse(stored) as Partial<StakeholderSyncPreferences> : {}; return { ...DEFAULTS, ...saved, wifiOnlyAllQueuedMutations: saved.wifiOnlyAllQueuedMutations ?? saved.wifiOnlyDocumentUpload ?? false }; } catch { return DEFAULTS; } }
export async function setStakeholderSyncPreferences(update: Partial<StakeholderSyncPreferences>) { const next = { ...(await getStakeholderSyncPreferences()), ...update }; await AsyncStorage.setItem(KEY, JSON.stringify(next)); return next; }
