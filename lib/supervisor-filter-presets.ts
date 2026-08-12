import AsyncStorage from "@react-native-async-storage/async-storage";

export type SupervisorFilterPreset = { id: string; name: string; filter: "all" | "overdue" | "unassigned" | "pending"; sort: "priority" | "newest" };
const KEY = "idlr_pts_mobile.supervisor_filter_presets.v1";
export async function loadSupervisorFilterPresets() { try { const raw = await AsyncStorage.getItem(KEY); return raw ? JSON.parse(raw) as SupervisorFilterPreset[] : []; } catch { return []; } }
export async function saveSupervisorFilterPreset(preset: SupervisorFilterPreset) { const current = await loadSupervisorFilterPresets(); const next = [preset, ...current.filter((item) => item.name.toLowerCase() !== preset.name.toLowerCase())].slice(0, 8); await AsyncStorage.setItem(KEY, JSON.stringify(next)); return next; }
