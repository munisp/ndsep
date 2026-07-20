import AsyncStorage from "@react-native-async-storage/async-storage";

export type ActivityCategory = "field" | "onboarding" | "legal" | "geospatial" | "system";
export type ActivityTone = "info" | "success" | "warning";

export type ActivityRecord = {
  id: string;
  title: string;
  description: string;
  category: ActivityCategory;
  tone: ActivityTone;
  timestamp: string;
  route?: "/(tabs)/field" | "/onboarding" | "/legal-workflow" | "/geolibre-launch" | "/parcel/[id]";
  routeParams?: Record<string, string>;
};

const STORAGE_KEY = "idlr_pts_mobile.activity_feed.v1";
const MAX_ITEMS = 40;

export const defaultActivityFeed: ActivityRecord[] = [
  {
    id: "activity-seed-1",
    title: "Field evidence prioritized",
    description: "Parcel LG-EPE-2026-006 remains active with a low sync-risk field mission.",
    category: "field",
    tone: "info",
    timestamp: "2026-07-20T03:05:00Z",
    route: "/(tabs)/field",
  },
  {
    id: "activity-seed-2",
    title: "Onboarding readiness in review",
    description: "Business verification for Crest Holdings Ltd still needs liveness completion.",
    category: "onboarding",
    tone: "warning",
    timestamp: "2026-07-20T02:10:00Z",
    route: "/onboarding",
  },
  {
    id: "activity-seed-3",
    title: "C of O registration preserved",
    description: "The latest Certificate of Occupancy workflow is retained for parcel LG-EPE-2026-006.",
    category: "legal",
    tone: "success",
    timestamp: "2026-07-20T01:15:00Z",
    route: "/legal-workflow",
  },
];

export async function getActivityFeed() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultActivityFeed;
    const parsed = JSON.parse(raw) as ActivityRecord[];
    return parsed.length > 0 ? parsed : defaultActivityFeed;
  } catch {
    return defaultActivityFeed;
  }
}

export async function saveActivityFeed(feed: ActivityRecord[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(feed.slice(0, MAX_ITEMS)));
}

export async function prependActivity(record: Omit<ActivityRecord, "id" | "timestamp"> & { id?: string; timestamp?: string }) {
  const current = await getActivityFeed();
  const next: ActivityRecord = {
    id: record.id ?? `activity-${Date.now()}`,
    timestamp: record.timestamp ?? new Date().toISOString(),
    ...record,
  };
  const merged = [next, ...current.filter((item) => item.id !== next.id)].slice(0, MAX_ITEMS);
  await saveActivityFeed(merged);
  return merged;
}
