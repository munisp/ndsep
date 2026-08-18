import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "idlr_pts_mobile.stakeholder_sync_preferences.v1";
export type StakeholderSyncPreferences = { pauseOnCellular: boolean; wifiOnlyDocumentUpload: boolean };
const DEFAULTS: StakeholderSyncPreferences = { pauseOnCellular: false, wifiOnlyDocumentUpload: false };
export async function getStakeholderSyncPreferences(): Promise<StakeholderSyncPreferences> { try { const stored = await AsyncStorage.getItem(KEY); return stored ? { ...DEFAULTS, ...(JSON.parse(stored) as Partial<StakeholderSyncPreferences>) } : DEFAULTS; } catch { return DEFAULTS; } }
export async function setStakeholderSyncPreferences(update: Partial<StakeholderSyncPreferences>) { const next = { ...(await getStakeholderSyncPreferences()), ...update }; await AsyncStorage.setItem(KEY, JSON.stringify(next)); return next; }
