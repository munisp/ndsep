import AsyncStorage from "@react-native-async-storage/async-storage";

export type ActivityCategory = "field" | "onboarding" | "legal" | "geospatial" | "system";
export type ActivityTone = "info" | "success" | "warning";
export type ActivityFilter = "all" | ActivityCategory | "unread";
export type ActivityRoute = "/(tabs)/field" | "/onboarding" | "/legal-workflow" | "/geolibre-launch" | "/parcel/[id]" | "/notifications-preferences" | "/notification/[id]";
export type ActivityActionKind = "approve_kyc" | "approve_legal";
export type ActivityPriorityLevel = "low" | "medium" | "high";
export type ActivityAuditActor = "system" | "user" | "registry" | "ai" | "geofence";
export type ActivityAuditEventKind =
  | "created"
  | "delivered"
  | "opened"
  | "marked_read"
  | "dismissed"
  | "action_completed"
  | "preference_synced"
  | "geofence_enter"
  | "geofence_exit"
  | "ai_summarized"
  | "priority_ranked";
export type GeofenceTransitionEvent = "enter" | "exit";

export type ActivityAction = {
  kind: ActivityActionKind;
  label: string;
  onboardingDocumentId?: string;
  legalWorkflowId?: string;
};

export type ActivityAuditEvent = {
  id: string;
  kind: ActivityAuditEventKind;
  label: string;
  actor: ActivityAuditActor;
  timestamp: string;
  detail: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type ActivityAiInsight = {
  summary: string;
  priorityLevel: ActivityPriorityLevel;
  priorityScore: number;
  rationale: string;
  analyzedAt: string;
  model: string;
  interactionWeight: number;
};

export type ActivityGeofenceContext = {
  radiusMeters: number;
  transition: GeofenceTransitionEvent;
  latitude: number;
  longitude: number;
  triggeredAt: string;
};

export type ActivityRecord = {
  id: string;
  title: string;
  description: string;
  category: ActivityCategory;
  tone: ActivityTone;
  timestamp: string;
  unread: boolean;
  dismissedAt?: string | null;
  parcelId?: number;
  parcelNumber?: string;
  route?: ActivityRoute;
  routeParams?: Record<string, string>;
  action?: ActivityAction;
  auditHistory: ActivityAuditEvent[];
  aiInsight?: ActivityAiInsight | null;
  geofenceContext?: ActivityGeofenceContext | null;
};

export type ActivityInteractionProfile = {
  openedByCategory: Record<ActivityCategory, number>;
  dismissedByCategory: Record<ActivityCategory, number>;
  actionedByCategory: Record<ActivityCategory, number>;
  unreadResolvedByCategory: Record<ActivityCategory, number>;
  totalOpened: number;
  totalDismissed: number;
  totalActioned: number;
  totalUnreadResolved: number;
  preferredCategories: ActivityCategory[];
};

const STORAGE_KEY = "idlr_pts_mobile.activity_feed.v3";
const LEGACY_STORAGE_KEYS = ["idlr_pts_mobile.activity_feed.v2", "idlr_pts_mobile.activity_feed.v1"];
const MAX_ITEMS = 80;
const listeners = new Set<() => void>();

function categoryCounter(): Record<ActivityCategory, number> {
  return {
    field: 0,
    onboarding: 0,
    legal: 0,
    geospatial: 0,
    system: 0,
  };
}

function createAuditEvent(input: Omit<ActivityAuditEvent, "id"> & { id?: string }) {
  return {
    id: input.id ?? `audit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    ...input,
  } satisfies ActivityAuditEvent;
}

function defaultAuditTrail(record: Pick<ActivityRecord, "title" | "timestamp">) {
  return [
    createAuditEvent({
      kind: "created",
      label: "Alert created",
      actor: "system",
      timestamp: record.timestamp,
      detail: `${record.title} was generated for the mobile alert feed.`,
    }),
    createAuditEvent({
      kind: "delivered",
      label: "Alert delivered",
      actor: "system",
      timestamp: record.timestamp,
      detail: `${record.title} was delivered to the device inbox and made available for review.`,
    }),
  ];
}

function normalizeAuditTrail(record: Partial<ActivityRecord> & Pick<ActivityRecord, "title" | "timestamp">) {
  const auditHistory = Array.isArray(record.auditHistory) ? record.auditHistory : [];
  if (auditHistory.length > 0) return auditHistory;
  return defaultAuditTrail(record);
}

function normalizeRecord(record: Partial<ActivityRecord> & Pick<ActivityRecord, "title" | "description" | "category" | "tone">): ActivityRecord {
  const timestamp = record.timestamp ?? new Date().toISOString();
  const id = record.id ?? `activity-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const normalized: ActivityRecord = {
    id,
    title: record.title,
    description: record.description,
    category: record.category,
    tone: record.tone,
    timestamp,
    unread: record.unread ?? true,
    dismissedAt: record.dismissedAt ?? null,
    parcelId: record.parcelId,
    parcelNumber: record.parcelNumber,
    route: record.route,
    routeParams: record.routeParams,
    action: record.action,
    auditHistory: normalizeAuditTrail({ ...record, timestamp, title: record.title }).map((entry) => ({
      ...entry,
      id: entry.id ?? `audit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    })),
    aiInsight: record.aiInsight ?? null,
    geofenceContext: record.geofenceContext ?? null,
  };

  return normalized;
}

export const defaultActivityFeed: ActivityRecord[] = [
  normalizeRecord({
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
    aiInsight: {
      summary: "Low-risk field evidence remains active for parcel LG-EPE-2026-006 and should stay visible for field continuity.",
      priorityLevel: "medium",
      priorityScore: 68,
      rationale: "Unread field work with parcel context should stay near the top until a field officer advances the mission.",
      analyzedAt: "2026-07-20T03:05:00Z",
      model: "seeded-mobile-analysis",
      interactionWeight: 0.58,
    },
  }),
  normalizeRecord({
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
    aiInsight: {
      summary: "Onboarding remains blocked because liveness verification is incomplete for a parcel-linked business profile.",
      priorityLevel: "high",
      priorityScore: 88,
      rationale: "Unread onboarding work with an approval action and warning tone deserves faster review.",
      analyzedAt: "2026-07-20T02:10:00Z",
      model: "seeded-mobile-analysis",
      interactionWeight: 0.74,
    },
  }),
  normalizeRecord({
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
      legalWorkflowId: "cofo-epe-6",
    },
    aiInsight: {
      summary: "The Certificate of Occupancy registration trail is preserved and can be reviewed as supporting context.",
      priorityLevel: "low",
      priorityScore: 42,
      rationale: "This alert is already read and reflects a successful legal milestone rather than a blocking exception.",
      analyzedAt: "2026-07-20T01:15:00Z",
      model: "seeded-mobile-analysis",
      interactionWeight: 0.31,
    },
  }),
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

async function loadRawFeed(key: string) {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  return JSON.parse(raw) as Array<Partial<ActivityRecord> & Pick<ActivityRecord, "title" | "description" | "category" | "tone">>;
}

export async function getActivityFeed() {
  try {
    const current = await loadRawFeed(STORAGE_KEY);
    if (current && current.length > 0) return current.map(normalizeRecord);

    for (const legacyKey of LEGACY_STORAGE_KEYS) {
      const legacy = await loadRawFeed(legacyKey);
      if (legacy && legacy.length > 0) {
        const migrated = legacy.map(normalizeRecord);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    }

    return defaultActivityFeed;
  } catch {
    return defaultActivityFeed;
  }
}

export async function getActivityById(id: string) {
  const current = await getActivityFeed();
  return current.find((item) => item.id === id) ?? null;
}

export async function saveActivityFeed(feed: ActivityRecord[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(feed.slice(0, MAX_ITEMS)));
  notifyListeners();
}

async function updateActivity(id: string, updater: (record: ActivityRecord) => ActivityRecord | null) {
  const current = await getActivityFeed();
  let updated: ActivityRecord | null = null;
  const next = current
    .map((record) => {
      if (record.id !== id) return record;
      updated = updater(record);
      return updated;
    })
    .filter((record): record is ActivityRecord => record !== null);

  await saveActivityFeed(next);
  return updated;
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

export async function appendActivityAudit(
  id: string,
  event: Omit<ActivityAuditEvent, "id" | "timestamp"> & { id?: string; timestamp?: string },
) {
  return updateActivity(id, (record) => ({
    ...record,
    auditHistory: [
      createAuditEvent({
        ...event,
        timestamp: event.timestamp ?? new Date().toISOString(),
      }),
      ...record.auditHistory,
    ],
  }));
}

export async function recordActivityOpened(id: string) {
  return updateActivity(id, (record) => ({
    ...record,
    auditHistory: [
      createAuditEvent({
        kind: "opened",
        label: "Alert opened",
        actor: "user",
        timestamp: new Date().toISOString(),
        detail: `${record.title} was opened from the mobile inbox detail sheet.`,
      }),
      ...record.auditHistory,
    ],
  }));
}

export async function markActivityRead(id: string) {
  return updateActivity(id, (record) => ({
    ...record,
    unread: false,
    auditHistory: record.unread
      ? [
          createAuditEvent({
            kind: "marked_read",
            label: "Marked as read",
            actor: "user",
            timestamp: new Date().toISOString(),
            detail: `${record.title} was marked as read from the mobile inbox.`,
          }),
          ...record.auditHistory,
        ]
      : record.auditHistory,
  }));
}

export async function dismissActivity(id: string) {
  return updateActivity(id, (record) => ({
    ...record,
    unread: false,
    dismissedAt: new Date().toISOString(),
    auditHistory: [
      createAuditEvent({
        kind: "dismissed",
        label: "Dismissed",
        actor: "user",
        timestamp: new Date().toISOString(),
        detail: `${record.title} was dismissed from the visible inbox but remains available in its audit history.`,
      }),
      ...record.auditHistory,
    ],
  }));
}

export async function recordActivityAction(id: string, label: string) {
  return updateActivity(id, (record) => ({
    ...record,
    unread: false,
    auditHistory: [
      createAuditEvent({
        kind: "action_completed",
        label: "Action completed",
        actor: "user",
        timestamp: new Date().toISOString(),
        detail: `${label} was completed directly from the mobile notification workflow.`,
      }),
      ...record.auditHistory,
    ],
  }));
}

export async function updateActivityInsight(id: string, aiInsight: ActivityAiInsight) {
  return updateActivity(id, (record) => ({
    ...record,
    aiInsight,
    auditHistory: [
      createAuditEvent({
        kind: "priority_ranked",
        label: "Priority updated",
        actor: "ai",
        timestamp: aiInsight.analyzedAt,
        detail: `${record.title} received an AI priority score of ${aiInsight.priorityScore}.`,
        metadata: {
          priorityLevel: aiInsight.priorityLevel,
          priorityScore: aiInsight.priorityScore,
          interactionWeight: aiInsight.interactionWeight,
        },
      }),
      createAuditEvent({
        kind: "ai_summarized",
        label: "AI summary refreshed",
        actor: "ai",
        timestamp: aiInsight.analyzedAt,
        detail: aiInsight.summary,
        metadata: {
          model: aiInsight.model,
        },
      }),
      ...record.auditHistory.filter((event) => event.kind !== "priority_ranked" && event.kind !== "ai_summarized"),
    ],
  }));
}

export async function attachGeofenceAudit(
  id: string,
  geofenceContext: ActivityGeofenceContext,
  detail: string,
) {
  const kind: ActivityAuditEventKind = geofenceContext.transition === "enter" ? "geofence_enter" : "geofence_exit";
  const label = geofenceContext.transition === "enter" ? "Geofence entered" : "Geofence exited";

  return updateActivity(id, (record) => ({
    ...record,
    geofenceContext,
    auditHistory: [
      createAuditEvent({
        kind,
        label,
        actor: "geofence",
        timestamp: geofenceContext.triggeredAt,
        detail,
        metadata: {
          radiusMeters: geofenceContext.radiusMeters,
          latitude: geofenceContext.latitude,
          longitude: geofenceContext.longitude,
        },
      }),
      ...record.auditHistory,
    ],
  }));
}

export async function markAllActivitiesRead() {
  const current = await getActivityFeed();
  const timestamp = new Date().toISOString();
  const next = current.map((record) => {
    if (!record.unread) return record;
    return {
      ...record,
      unread: false,
      auditHistory: [
        createAuditEvent({
          kind: "marked_read",
          label: "Marked as read",
          actor: "user",
          timestamp,
          detail: `${record.title} was marked as read as part of a bulk inbox action.`,
        }),
        ...record.auditHistory,
      ],
    } satisfies ActivityRecord;
  });
  await saveActivityFeed(next);
  return next;
}

export async function getUnreadActivityCount() {
  const current = await getActivityFeed();
  return current.filter((item) => item.unread && !item.dismissedAt).length;
}

export function buildActivityInteractionProfile(feed: ActivityRecord[]): ActivityInteractionProfile {
  const openedByCategory = categoryCounter();
  const dismissedByCategory = categoryCounter();
  const actionedByCategory = categoryCounter();
  const unreadResolvedByCategory = categoryCounter();

  for (const record of feed) {
    for (const event of record.auditHistory) {
      if (event.kind === "opened") openedByCategory[record.category] += 1;
      if (event.kind === "dismissed") dismissedByCategory[record.category] += 1;
      if (event.kind === "action_completed") actionedByCategory[record.category] += 1;
      if (event.kind === "marked_read") unreadResolvedByCategory[record.category] += 1;
    }
  }

  const preferredCategories = Object.entries(openedByCategory)
    .sort(([, left], [, right]) => right - left)
    .map(([category]) => category as ActivityCategory)
    .filter((category) => openedByCategory[category] > 0);

  return {
    openedByCategory,
    dismissedByCategory,
    actionedByCategory,
    unreadResolvedByCategory,
    totalOpened: Object.values(openedByCategory).reduce((sum, value) => sum + value, 0),
    totalDismissed: Object.values(dismissedByCategory).reduce((sum, value) => sum + value, 0),
    totalActioned: Object.values(actionedByCategory).reduce((sum, value) => sum + value, 0),
    totalUnreadResolved: Object.values(unreadResolvedByCategory).reduce((sum, value) => sum + value, 0),
    preferredCategories,
  };
}

function computeInteractionWeight(record: ActivityRecord, profile: ActivityInteractionProfile) {
  const opens = profile.openedByCategory[record.category];
  const actions = profile.actionedByCategory[record.category];
  const dismisses = profile.dismissedByCategory[record.category];
  return Math.max(0, Math.min(1, 0.45 + opens * 0.06 + actions * 0.08 - dismisses * 0.05));
}

function computeFallbackPriorityScore(record: ActivityRecord, profile: ActivityInteractionProfile) {
  const unreadScore = record.unread ? 20 : 0;
  const actionScore = record.action ? 12 : 0;
  const toneScore = record.tone === "warning" ? 16 : record.tone === "success" ? 4 : 10;
  const categoryWeight = computeInteractionWeight(record, profile) * 25;
  const dismissalPenalty = record.dismissedAt ? 25 : 0;
  return Math.max(0, Math.min(100, Math.round(25 + unreadScore + actionScore + toneScore + categoryWeight - dismissalPenalty)));
}

export function rankActivitiesForInbox(feed: ActivityRecord[]) {
  const profile = buildActivityInteractionProfile(feed);

  return [...feed]
    .filter((item) => !item.dismissedAt)
    .sort((left, right) => {
      const leftScore = left.aiInsight?.priorityScore ?? computeFallbackPriorityScore(left, profile);
      const rightScore = right.aiInsight?.priorityScore ?? computeFallbackPriorityScore(right, profile);
      if (rightScore !== leftScore) return rightScore - leftScore;
      return new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
    });
}

export function filterActivities(feed: ActivityRecord[], filter: ActivityFilter, searchTerm: string) {
  const normalizedTerm = searchTerm.trim().toLowerCase();
  const ranked = rankActivitiesForInbox(feed);

  return ranked.filter((item) => {
    const matchesFilter =
      filter === "all"
        ? true
        : filter === "unread"
          ? item.unread
          : item.category === filter;

    if (!matchesFilter) return false;
    if (!normalizedTerm) return true;

    const haystack = [
      item.title,
      item.description,
      item.category,
      item.parcelNumber ?? "",
      item.action?.label ?? "",
      item.aiInsight?.summary ?? "",
      item.aiInsight?.rationale ?? "",
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedTerm);
  });
}
