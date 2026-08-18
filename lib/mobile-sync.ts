import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";

import type { BusinessProfileRecord, GeofenceTransition, MobilePlatformBundle, NotificationPreferences, ParcelMuteDuration } from "@/lib/mobile-data";
import { cloneSeedBundle } from "@/lib/mobile-data";
import { registerFieldSyncBackgroundTask } from "@/lib/background-sync";
import { syncParcelGeofences, type GeofenceRuntimeResult } from "@/lib/mobile-geofencing";
import { buildActivityInteractionProfile, prependActivity, updateActivityInsight, type ActivityRecord } from "@/lib/mobile-activity";
import { ensureNotificationPermissions, scheduleFieldUpdateNotification } from "@/lib/mobile-notifications";
import { getQueuedFieldMutations, queueMissionStatusMutation, replayQueuedFieldMutations } from "@/lib/mobile-sync-replay";
import { enqueueStakeholderSubmission } from "@/lib/stakeholder-sync-queue";
import { trpc } from "@/lib/trpc";

const CACHE_KEY = "idlr_pts_mobile.platform_bundle.v1";
const isTransportFailure = (error: unknown) => /network|fetch|offline|timeout|connection|econn|502|503|504/i.test(error instanceof Error ? error.message : String(error));

async function loadCachedBundle() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as MobilePlatformBundle) : null;
  } catch {
    return null;
  }
}

async function persistBundle(bundle: MobilePlatformBundle) {
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(bundle));
}

export function useMobilePlatformBundle() {
  const utils = trpc.useUtils();
  const [cachedBundle, setCachedBundle] = useState<MobilePlatformBundle | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [queuedMutations, setQueuedMutations] = useState(0);
  const [geofenceRuntime, setGeofenceRuntime] = useState<GeofenceRuntimeResult>({
    status: "configured_only",
    reason: "Parcel geofence registration has not yet run on this device.",
    activeRegionCount: 0,
    checkedAt: new Date().toISOString(),
  });

  useEffect(() => {
    loadCachedBundle()
      .then((bundle) => {
        setCachedBundle(bundle);
        setCacheLoaded(true);
      })
      .catch(() => {
        setCacheLoaded(true);
      });

    getQueuedFieldMutations().then((queue) => setQueuedMutations(queue.length)).catch(() => undefined);
    ensureNotificationPermissions().catch(() => undefined);
    registerFieldSyncBackgroundTask().catch(() => undefined);
    replayQueuedFieldMutations()
      .then(async (result) => {
        if (result.replayed > 0) {
          setQueuedMutations((current) => Math.max(0, current - result.replayed));
          await prependActivity({
            title: "Offline field updates replayed",
            description: `${result.replayed} queued field update${result.replayed === 1 ? "" : "s"} synchronized successfully after connectivity returned.`,
            category: "field",
            tone: "success",
            route: "/(tabs)/field",
          });
          await utils.sync.getBundle.invalidate();
        }
      })
      .catch(() => undefined);
  }, [utils.sync.getBundle]);

  const liveQuery = trpc.sync.getBundle.useQuery(undefined, {
    refetchOnMount: true,
    refetchOnReconnect: true,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!liveQuery.data) return;
    setCachedBundle(liveQuery.data);
    persistBundle(liveQuery.data).catch(() => undefined);
  }, [liveQuery.data]);

  const bundle = useMemo(() => {
    const base = liveQuery.data
      ? liveQuery.data
      : cachedBundle
        ? {
            ...cachedBundle,
            syncMeta: {
              ...cachedBundle.syncMeta,
              source: "offline_cache" as const,
            },
          }
        : cloneSeedBundle();

    return {
      ...base,
      syncMeta: {
        ...base.syncMeta,
        pendingMutations: Math.max(base.syncMeta.pendingMutations, queuedMutations),
      },
    };
  }, [cachedBundle, liveQuery.data, queuedMutations]);

  useEffect(() => {
    let cancelled = false;
    syncParcelGeofences(bundle)
      .then((result) => {
        if (!cancelled) setGeofenceRuntime(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setGeofenceRuntime({
            status: "failed",
            reason: `Unexpected parcel geofence sync failure: ${error instanceof Error ? error.message : "unknown error"}`,
            activeRegionCount: 0,
            checkedAt: new Date().toISOString(),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bundle]);

  const rawMissionStatusMutation = trpc.sync.updateMissionStatus.useMutation({
    onSuccess: async () => {
      await utils.sync.getBundle.invalidate();
    },
  });

  const updatePreferencesMutation = trpc.notifications.updatePreferences.useMutation({
    onSuccess: async () => {
      await utils.sync.getBundle.invalidate();
    },
  });

  const toggleParcelSubscriptionMutation = trpc.notifications.toggleParcelSubscription.useMutation({
    onSuccess: async () => {
      await utils.sync.getBundle.invalidate();
    },
  });

  const setParcelMuteMutation = trpc.notifications.setParcelMute.useMutation({
    onSuccess: async () => {
      await utils.sync.getBundle.invalidate();
    },
  });

  const clearParcelMuteMutation = trpc.notifications.clearParcelMute.useMutation({
    onSuccess: async () => {
      await utils.sync.getBundle.invalidate();
    },
  });

  const updateParcelGeofenceMutation = trpc.notifications.updateParcelGeofence.useMutation({
    onSuccess: async () => {
      await utils.sync.getBundle.invalidate();
    },
  });

  const analyzeActivitiesMutation = trpc.notifications.analyzeActivities.useMutation();

  const submitBusinessProfile = trpc.onboarding.submitBusinessProfile.useMutation({ onSuccess: async () => void (await utils.sync.getBundle.invalidate()) });
  const analyzeIdentityDocument = trpc.onboarding.analyzeIdentityDocument.useMutation({ onSuccess: async () => void (await utils.sync.getBundle.invalidate()) });
  const analyzeBusinessDocument = trpc.onboarding.analyzeBusinessDocument.useMutation({ onSuccess: async () => void (await utils.sync.getBundle.invalidate()) });
  const startLiveness = trpc.onboarding.startLiveness.useMutation();
  const completeLiveness = trpc.onboarding.completeLiveness.useMutation({ onSuccess: async () => void (await utils.sync.getBundle.invalidate()) });
  const approveIdentityDocument = trpc.onboarding.approveIdentityDocument.useMutation({ onSuccess: async () => void (await utils.sync.getBundle.invalidate()) });
  const advanceLegalWorkflow = trpc.legal.advance.useMutation({ onSuccess: async () => void (await utils.sync.getBundle.invalidate()) });
  const approveLegalWorkflow = trpc.legal.approveFromInbox.useMutation({ onSuccess: async () => void (await utils.sync.getBundle.invalidate()) });

  async function updateMissionStatus(input: { missionId: string; status: "queued" | "active" | "synced" }) {
    const mission = bundle.missions.find((item) => item.id === input.missionId);
    const parcel = mission ? bundle.parcels.find((item) => item.id === mission.parcelId) : undefined;

    try {
      const result = await rawMissionStatusMutation.mutateAsync(input);
      await scheduleFieldUpdateNotification({ title: "Field update synchronized", body: `Mission ${input.missionId} moved to ${input.status}.`, category: "field", parcelId: parcel?.id, data: input });
      await prependActivity({ title: "Field update synchronized", description: `Mission ${input.missionId} moved to ${input.status} and was written to the live platform bundle.`, category: "field", tone: "success", route: "/(tabs)/field", parcelId: parcel?.id, parcelNumber: parcel?.parcelNumber });
      return result;
    } catch (error) {
      const queued = await queueMissionStatusMutation({ type: "mission_status", missionId: input.missionId, status: input.status });
      setQueuedMutations((current) => current + 1);

      const optimisticBundle = {
        ...bundle,
        missions: bundle.missions.map((missionItem) => (missionItem.id === input.missionId ? { ...missionItem, status: input.status, lastUpdated: queued.queuedAt } : missionItem)),
        syncMeta: {
          ...bundle.syncMeta,
          source: bundle.syncMeta.source,
          pendingMutations: Math.max(bundle.syncMeta.pendingMutations + 1, queuedMutations + 1),
        },
      } satisfies MobilePlatformBundle;

      setCachedBundle(optimisticBundle);
      await persistBundle(optimisticBundle);
      await scheduleFieldUpdateNotification({ title: "Field update queued offline", body: `Mission ${input.missionId} will replay automatically when connectivity is available.`, category: "field", parcelId: parcel?.id, data: input });
      await prependActivity({ title: "Field update queued offline", description: `Mission ${input.missionId} was stored locally and will replay through background sync when connectivity returns.`, category: "field", tone: "warning", route: "/(tabs)/field", parcelId: parcel?.id, parcelNumber: parcel?.parcelNumber });
      throw error;
    }
  }

  async function updateNotificationPreferences(input: Partial<NotificationPreferences>) {
    const result = await updatePreferencesMutation.mutateAsync(input);
    await prependActivity({
      title: "Notification preferences updated",
      description: "Cross-device alert preferences were updated and synchronized to the live mobile profile.",
      category: "system",
      tone: "info",
      route: "/notifications-preferences",
    });
    return result;
  }

  async function toggleParcelSubscription(parcelId: number) {
    const result = await toggleParcelSubscriptionMutation.mutateAsync({ parcelId });
    const parcel = bundle.parcels.find((item) => item.id === parcelId);
    await prependActivity({
      title: result.followedParcelIds.includes(parcelId) ? "Parcel alerts followed" : "Parcel alerts unfollowed",
      description: `${parcel?.parcelNumber ?? `Parcel ${parcelId}`} subscription preferences were updated across devices.`,
      category: "system",
      tone: "info",
      route: "/parcel/[id]",
      routeParams: { id: String(parcelId) },
      parcelId,
      parcelNumber: parcel?.parcelNumber,
    });
    return result;
  }

  async function setParcelMute(parcelId: number, duration: ParcelMuteDuration) {
    const result = await setParcelMuteMutation.mutateAsync({ parcelId, duration });
    const parcel = bundle.parcels.find((item) => item.id === parcelId);
    await prependActivity({
      title: "Parcel alerts muted",
      description: `${parcel?.parcelNumber ?? `Parcel ${parcelId}`} notifications were muted for ${duration === "1h" ? "1 hour" : duration === "1d" ? "1 day" : "the active workflow"}.`,
      category: "system",
      tone: "warning",
      route: "/parcel/[id]",
      routeParams: { id: String(parcelId) },
      parcelId,
      parcelNumber: parcel?.parcelNumber,
    });
    return result;
  }

  async function clearParcelMute(parcelId: number) {
    const result = await clearParcelMuteMutation.mutateAsync({ parcelId });
    const parcel = bundle.parcels.find((item) => item.id === parcelId);
    await prependActivity({
      title: "Parcel alerts unmuted",
      description: `${parcel?.parcelNumber ?? `Parcel ${parcelId}`} notifications are active again across devices.`,
      category: "system",
      tone: "success",
      route: "/parcel/[id]",
      routeParams: { id: String(parcelId) },
      parcelId,
      parcelNumber: parcel?.parcelNumber,
    });
    return result;
  }

  async function updateParcelGeofence(input: { parcelId: number; enabled?: boolean; radiusMeters?: number; transition?: GeofenceTransition }) {
    const result = await updateParcelGeofenceMutation.mutateAsync(input);
    const parcel = bundle.parcels.find((item) => item.id === input.parcelId);
    const geofence = result.geofenceSubscriptions.find((item) => item.parcelId === input.parcelId);
    await prependActivity({
      title: geofence?.enabled ? "Parcel geofence preference saved" : "Parcel geofence paused",
      description: `${parcel?.parcelNumber ?? `Parcel ${input.parcelId}`} is configured for ${geofence?.radiusMeters ?? input.radiusMeters ?? 150}m ${geofence?.transition ?? input.transition ?? "both"} transitions. Device monitoring is reported separately and is not assumed active from this preference alone.`,
      category: "geospatial",
      tone: geofence?.enabled ? "info" : "warning",
      route: "/parcel/[id]",
      routeParams: { id: String(input.parcelId) },
      parcelId: input.parcelId,
      parcelNumber: parcel?.parcelNumber,
    });
    return result;
  }

  async function analyzeActivities(items: ActivityRecord[]) {
    const candidates = items.filter((item) => !item.dismissedAt).slice(0, 12);
    if (candidates.length === 0) return [];

    const interactionProfile = buildActivityInteractionProfile(items);
    const result = await analyzeActivitiesMutation.mutateAsync({
      activities: candidates.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        category: item.category,
        tone: item.tone,
        unread: item.unread,
        parcelNumber: item.parcelNumber ?? null,
        actionLabel: item.action?.label ?? null,
        auditTrailSummary: item.auditHistory
          .slice(0, 3)
          .map((entry) => `${entry.label}: ${entry.detail}`)
          .join(" | ") || null,
      })),
      interactionProfile,
    });

    await Promise.all(
      result.map((analysis) =>
        updateActivityInsight(analysis.id, {
          summary: analysis.summary,
          priorityLevel: analysis.priorityLevel,
          priorityScore: analysis.priorityScore,
          rationale: analysis.rationale,
          analyzedAt: new Date().toISOString(),
          model: analysis.model,
          interactionWeight: analysis.interactionWeight,
          provenance: analysis.provenance,
          availability: analysis.availability,
          reason: analysis.reason,
        }),
      ),
    );

    return result;
  }

  return {
    bundle,
    cacheLoaded,
    isLoading: liveQuery.isLoading && !cachedBundle,
    isRefetching: liveQuery.isRefetching,
    hasLiveConnection: Boolean(liveQuery.data),
    geofenceRuntime,
    refresh: liveQuery.refetch,
    updateMissionStatus,
    updateNotificationPreferences,
    toggleParcelSubscription,
    setParcelMute,
    clearParcelMute,
    updateParcelGeofence,
    analyzeActivities,
    submitBusinessProfile: async (profile: BusinessProfileRecord) => {
      try { const result = await submitBusinessProfile.mutateAsync(profile); await prependActivity({ title: "Business onboarding submitted", description: `${profile.companyName ?? "Business profile"} was submitted for KYB review and onboarding readiness recalculation.`, category: "onboarding", tone: "info", route: "/onboarding" }); await scheduleFieldUpdateNotification({ title: "Business onboarding updated", body: `${profile.companyName ?? "Business profile"} was submitted for review.`, category: "onboarding" }); return { result, queuedOffline: false }; }
      catch (error) { if (!isTransportFailure(error)) throw error; const queued = await enqueueStakeholderSubmission({ kind: "profile", profile }); await prependActivity({ title: "Business profile queued securely", description: "The encrypted profile submission will replay when connectivity returns.", category: "onboarding", tone: "warning", route: "/onboarding" }); return { result: null, queuedOffline: true, queueId: queued.id }; }
    },
    submitStakeholderDocument: async (kind: "identity_document" | "business_document", input: { type: string; fileName: string; mimeType: string; base64Data: string }) => {
      try { const result = kind === "identity_document" ? await analyzeIdentityDocument.mutateAsync(input) : await analyzeBusinessDocument.mutateAsync(input); return { result, queuedOffline: false }; }
      catch (error) { if (!isTransportFailure(error)) throw error; const queued = await enqueueStakeholderSubmission({ kind, ...input }); await prependActivity({ title: "Document queued securely", description: "The encrypted document submission will replay when connectivity returns.", category: "onboarding", tone: "warning", route: "/onboarding" }); return { result: null, queuedOffline: true, queueId: queued.id }; }
    },
    startLiveness,
    completeLiveness: {
      ...completeLiveness,
      mutateAsync: async (...args: Parameters<typeof completeLiveness.mutateAsync>) => {
        const result = await completeLiveness.mutateAsync(...args);
        await prependActivity({ title: "Liveness screening completed", description: `The most recent liveness session finished with status ${result.analysis.status}. No single-image screening is treated as verified liveness.`, category: "onboarding", tone: "warning", route: "/onboarding" });
        await scheduleFieldUpdateNotification({ title: "Liveness review updated", body: `Liveness session finished with status ${result.analysis.status}.`, category: "onboarding" });
        return result;
      },
    },
    approveIdentityDocument: async (documentId: string) => {
      const result = await approveIdentityDocument.mutateAsync({ documentId });
      await prependActivity({ title: "KYC manual review requested", description: `${result.document.type} was routed for manual review from the mobile inbox. No automated or inbox action verified the identity document.`, category: "onboarding", tone: "warning", route: "/onboarding" });
      await scheduleFieldUpdateNotification({ title: "KYC review requested", body: `${result.document.type} requires an authorized manual verification decision.`, category: "onboarding" });
      return result;
    },
    advanceLegalWorkflow: {
      ...advanceLegalWorkflow,
      mutateAsync: async (...args: Parameters<typeof advanceLegalWorkflow.mutateAsync>) => {
        const result = await advanceLegalWorkflow.mutateAsync(...args);
        const parcel = bundle.parcels.find((item) => item.id === result.parcelId);
        await prependActivity({ title: "Legal workflow advanced", description: `${result.type} moved to ${result.status}${result.registrationNumber ? ` with registration ${result.registrationNumber}` : ""}.`, category: "legal", tone: result.status === "registered" ? "success" : "info", route: "/legal-workflow", parcelId: result.parcelId, parcelNumber: parcel?.parcelNumber });
        await scheduleFieldUpdateNotification({ title: "Legal workflow updated", body: `${result.type} for parcel ${parcel?.parcelNumber ?? result.parcelId} moved to ${result.status}.`, category: "legal", parcelId: result.parcelId, data: { workflowId: result.id } });
        return result;
      },
    },
    approveLegalWorkflow: async (workflowId: string) => {
      const result = await approveLegalWorkflow.mutateAsync({ workflowId, reviewedBy: "Mobile Inbox" });
      const parcel = bundle.parcels.find((item) => item.id === result.parcelId);
      await prependActivity({ title: "Legal workflow approved", description: `${result.type} for parcel ${result.parcelId} was approved from the notifications inbox.`, category: "legal", tone: "success", route: "/legal-workflow", parcelId: result.parcelId, parcelNumber: parcel?.parcelNumber });
      await scheduleFieldUpdateNotification({ title: "Legal workflow approved", body: `${result.type} for parcel ${parcel?.parcelNumber ?? result.parcelId} was approved from the inbox.`, category: "legal", parcelId: result.parcelId, data: { workflowId: result.id, workflowStatus: result.status } });
      return result;
    },
  };
}
