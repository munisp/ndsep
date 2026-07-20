import AsyncStorage from "@react-native-async-storage/async-storage";

export type ActivityCategory = "field" | "onboarding" | "legal" | "geospatial" | "system";
export type ActivityTone = "info" | "success" | "warning";
export type ActivityFilter = "all" | ActivityCategory | "unread";
export type ActivityRoute = "/(tabs)/field" | "/onboarding" | "/legal-workflow" | "/geolibre-launch" | "/parcel/[id]" | "/notifications-preferences";
export type ActivityActionKind = "approve_kyc" | "approve_legal";

export type ActivityAction = {
  kind: ActivityActionKind;
  label: string;
  onboardingDocumentId?: string;
  legalWorkflowId?: string;
};

export type ActivityRecord = {
  id: string;
  title: string;
  description: string;
  category: ActivityCategory;
  tone: ActivityTone;
  timestamp: string;
  unread: boolean;
  parcelId?: number;
  parcelNumber?: string;
  route?: ActivityRoute;
  routeParams?: Record<string, string>;
  action?: ActivityAction;
};

const STORAGE_KEY = "idlr_pts_mobile.activity_feed.v2";
const LEGACY_STORAGE_KEY = "idlr_pts_mobile.activity_feed.v1";
const MAX_ITEMS = 60;
const listeners = new Set<() => void>();

export const defaultActivityFeed: ActivityRecord[] = [
  {
    id: "activity-seed-1",
    title: "Field evidence prioritized",
    description: "Parcel LG-EPE-2026-006 remains active with a low sync-risk field mission.",
    category: "field",
    tone: "info",
    timestamp: "2026-07-20T03:05:00Z",
    unread: true,
    parcelId: 6,
    parcelNumber: "LG-EPE-2026-006",
    route: "/(tabs)/field",
  },
  {
    id: "activity-seed-2",
    title: "Onboarding readiness in review",
    description: "Business verification for Crest Holdings Ltd still needs liveness completion.",
    category: "onboarding",
    tone: "warning",
    timestamp: "2026-07-20T02:10:00Z",
    unread: true,
    parcelId: 11,
    parcelNumber: "FC-AMAC-2026-011",
    route: "/onboarding",
    action: {
      kind: "approve_kyc",
      label: "Approve KYC document",
      onboardingDocumentId: "kyc-seed-11",
    },
  },
  {
    id: "activity-seed-3",
    title: "C of O registration preserved",
    description: "The latest Certificate of Occupancy workflow is retained for parcel LG-EPE-2026-006.",
    category: "legal",
    tone: "success",
    timestamp: "2026-07-20T01:15:00Z",
    unread: false,
    parcelId: 6,
    parcelNumber: "LG-EPE-2026-006",
    route: "/legal-workflow",
    action: {
      kind: "approve_legal",
      label: "Approve legal workflow",
      legalWorkflowId: "legal-cofo-6",
    },
  },
];

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

export function subscribeActivityFeed(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function normalizeRecord(record: Partial<ActivityRecord> & Pick<ActivityRecord, "title" | "description" | "category" | "tone">): ActivityRecord {
  return {
    id: record.id ?? `activity-${Date.now()}`,
    title: record.title,
    description: record.description,
    category: record.category,
    tone: record.tone,
    timestamp: record.timestamp ?? new Date().toISOString(),
    unread: record.unread ?? true,
    parcelId: record.parcelId,
    parcelNumber: record.parcelNumber,
    route: record.route,
    routeParams: record.routeParams,
    action: record.action,
  };
}

async function loadRawFeed(key: string) {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  return JSON.parse(raw) as Array<Partial<ActivityRecord> & Pick<ActivityRecord, "title" | "description" | "category" | "tone">>;
}

export async function getActivityFeed() {
  try {
    const current = await loadRawFeed(STORAGE_KEY);
    if (current && current.length > 0) return current.map(normalizeRecord);

    const legacy = await loadRawFeed(LEGACY_STORAGE_KEY);
    if (legacy && legacy.length > 0) {
      const migrated = legacy.map(normalizeRecord);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }

    return defaultActivityFeed;
  } catch {
    return defaultActivityFeed;
  }
}

export async function saveActivityFeed(feed: ActivityRecord[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(feed.slice(0, MAX_ITEMS)));
  notifyListeners();
}

export async function prependActivity(
  record: Partial<ActivityRecord> & Pick<ActivityRecord, "title" | "description" | "category" | "tone">,
) {
  const current = await getActivityFeed();
  const next = normalizeRecord(record);
  const merged = [next, ...current.filter((item) => item.id !== next.id)].slice(0, MAX_ITEMS);
  await saveActivityFeed(merged);
  return merged;
}

export async function markActivityRead(id: string) {
  const current = await getActivityFeed();
  const next = current.map((item) => (item.id === id ? { ...item, unread: false } : item));
  await saveActivityFeed(next);
  return next;
}

export async function dismissActivity(id: string) {
  const current = await getActivityFeed();
  const next = current.filter((item) => item.id !== id);
  await saveActivityFeed(next);
  return next;
}

export async function markAllActivitiesRead() {
  const current = await getActivityFeed();
  const next = current.map((item) => ({ ...item, unread: false }));
  await saveActivityFeed(next);
  return next;
}

export async function getUnreadActivityCount() {
  const current = await getActivityFeed();
  return current.filter((item) => item.unread).length;
}

export function filterActivities(feed: ActivityRecord[], filter: ActivityFilter, searchTerm: string) {
  const normalizedTerm = searchTerm.trim().toLowerCase();

  return feed.filter((item) => {
    const matchesFilter =
      filter === "all"
        ? true
        : filter === "unread"
          ? item.unread
          : item.category === filter;

    if (!matchesFilter) return false;
    if (!normalizedTerm) return true;

    const haystack = [item.title, item.description, item.category, item.parcelNumber ?? "", item.action?.label ?? ""]
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedTerm);
  });
}
