import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";

import type { BusinessProfileRecord, MobilePlatformBundle } from "@/lib/mobile-data";
import { cloneSeedBundle } from "@/lib/mobile-data";
import { registerFieldSyncBackgroundTask } from "@/lib/background-sync";
import { prependActivity } from "@/lib/mobile-activity";
import { ensureNotificationPermissions, scheduleFieldUpdateNotification } from "@/lib/mobile-notifications";
import { getQueuedFieldMutations, queueMissionStatusMutation, replayQueuedFieldMutations } from "@/lib/mobile-sync-replay";
import { trpc } from "@/lib/trpc";

const CACHE_KEY = "idlr_pts_mobile.platform_bundle.v1";

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

  const rawMissionStatusMutation = trpc.sync.updateMissionStatus.useMutation({
    onSuccess: async () => {
      await utils.sync.getBundle.invalidate();
    },
  });

  const submitBusinessProfile = trpc.onboarding.submitBusinessProfile.useMutation({
    onSuccess: async () => {
      await utils.sync.getBundle.invalidate();
    },
  });

  const analyzeIdentityDocument = trpc.onboarding.analyzeIdentityDocument.useMutation({
    onSuccess: async () => {
      await utils.sync.getBundle.invalidate();
    },
  });

  const analyzeBusinessDocument = trpc.onboarding.analyzeBusinessDocument.useMutation({
    onSuccess: async () => {
      await utils.sync.getBundle.invalidate();
    },
  });

  const startLiveness = trpc.onboarding.startLiveness.useMutation();

  const completeLiveness = trpc.onboarding.completeLiveness.useMutation({
    onSuccess: async () => {
      await utils.sync.getBundle.invalidate();
    },
  });

  const approveIdentityDocument = trpc.onboarding.approveIdentityDocument.useMutation({
    onSuccess: async () => {
      await utils.sync.getBundle.invalidate();
    },
  });

  const advanceLegalWorkflow = trpc.legal.advance.useMutation({
    onSuccess: async () => {
      await utils.sync.getBundle.invalidate();
    },
  });

  const approveLegalWorkflow = trpc.legal.approveFromInbox.useMutation({
    onSuccess: async () => {
      await utils.sync.getBundle.invalidate();
    },
  });

  async function updateMissionStatus(input: { missionId: string; status: "queued" | "active" | "synced" }) {
    const mission = bundle.missions.find((item) => item.id === input.missionId);
    const parcel = mission ? bundle.parcels.find((item) => item.id === mission.parcelId) : undefined;

    try {
      const result = await rawMissionStatusMutation.mutateAsync(input);
      await scheduleFieldUpdateNotification({
        title: "Field update synchronized",
        body: `Mission ${input.missionId} moved to ${input.status}.`,
        category: "field",
        parcelId: parcel?.id,
        data: input,
      });
      await prependActivity({
        title: "Field update synchronized",
        description: `Mission ${input.missionId} moved to ${input.status} and was written to the live platform bundle.`,
        category: "field",
        tone: "success",
        route: "/(tabs)/field",
        parcelId: parcel?.id,
        parcelNumber: parcel?.parcelNumber,
      });
      return result;
    } catch (error) {
      const queued = await queueMissionStatusMutation({
        type: "mission_status",
        missionId: input.missionId,
        status: input.status,
      });
      setQueuedMutations((current) => current + 1);

      const optimisticBundle = {
        ...bundle,
        missions: bundle.missions.map((missionItem) =>
          missionItem.id === input.missionId ? { ...missionItem, status: input.status, lastUpdated: queued.queuedAt } : missionItem,
        ),
        syncMeta: {
          ...bundle.syncMeta,
          source: bundle.syncMeta.source,
          pendingMutations: Math.max(bundle.syncMeta.pendingMutations + 1, queuedMutations + 1),
        },
      } satisfies MobilePlatformBundle;

      setCachedBundle(optimisticBundle);
      await persistBundle(optimisticBundle);
      await scheduleFieldUpdateNotification({
        title: "Field update queued offline",
        body: `Mission ${input.missionId} will replay automatically when connectivity is available.`,
        category: "field",
        parcelId: parcel?.id,
        data: input,
      });
      await prependActivity({
        title: "Field update queued offline",
        description: `Mission ${input.missionId} was stored locally and will replay through background sync when connectivity returns.`,
        category: "field",
        tone: "warning",
        route: "/(tabs)/field",
        parcelId: parcel?.id,
        parcelNumber: parcel?.parcelNumber,
      });
      throw error;
    }
  }

  return {
    bundle,
    cacheLoaded,
    isLoading: liveQuery.isLoading && !cachedBundle,
    isRefetching: liveQuery.isRefetching,
    hasLiveConnection: Boolean(liveQuery.data),
    refresh: liveQuery.refetch,
    updateMissionStatus,
    submitBusinessProfile: async (profile: BusinessProfileRecord) => {
      const result = await submitBusinessProfile.mutateAsync(profile);
      await prependActivity({
        title: "Business onboarding submitted",
        description: `${profile.companyName ?? "Business profile"} was submitted for KYB review and onboarding readiness recalculation.`,
        category: "onboarding",
        tone: "info",
        route: "/onboarding",
      });
      await scheduleFieldUpdateNotification({
        title: "Business onboarding updated",
        body: `${profile.companyName ?? "Business profile"} was submitted for review.`,
        category: "onboarding",
      });
      return result;
    },
    analyzeIdentityDocument,
    analyzeBusinessDocument,
    startLiveness,
    completeLiveness: {
      ...completeLiveness,
      mutateAsync: async (...args: Parameters<typeof completeLiveness.mutateAsync>) => {
        const result = await completeLiveness.mutateAsync(...args);
        await prependActivity({
          title: "Liveness review completed",
          description: `The most recent liveness session finished with status ${result.analysis.status}.`,
          category: "onboarding",
          tone: result.analysis.status === "verified" ? "success" : "warning",
          route: "/onboarding",
        });
        await scheduleFieldUpdateNotification({
          title: "Liveness review updated",
          body: `Liveness session finished with status ${result.analysis.status}.`,
          category: "onboarding",
        });
        return result;
      },
    },
    approveIdentityDocument: async (documentId: string) => {
      const result = await approveIdentityDocument.mutateAsync({ documentId });
      await prependActivity({
        title: "KYC document approved",
        description: `${result.document.type} was approved directly from the mobile inbox.`,
        category: "onboarding",
        tone: "success",
        route: "/onboarding",
      });
      await scheduleFieldUpdateNotification({
        title: "KYC document approved",
        body: `${result.document.type} was approved from the mobile inbox.`,
        category: "onboarding",
      });
      return result;
    },
    advanceLegalWorkflow: {
      ...advanceLegalWorkflow,
      mutateAsync: async (...args: Parameters<typeof advanceLegalWorkflow.mutateAsync>) => {
        const result = await advanceLegalWorkflow.mutateAsync(...args);
        const parcel = bundle.parcels.find((item) => item.id === result.parcelId);
        await prependActivity({
          title: "Legal workflow advanced",
          description: `${result.type} moved to ${result.status}${result.registrationNumber ? ` with registration ${result.registrationNumber}` : ""}.`,
          category: "legal",
          tone: result.status === "registered" ? "success" : "info",
          route: "/legal-workflow",
          parcelId: result.parcelId,
          parcelNumber: parcel?.parcelNumber,
        });
        await scheduleFieldUpdateNotification({
          title: "Legal workflow updated",
          body: `${result.type} for parcel ${parcel?.parcelNumber ?? result.parcelId} moved to ${result.status}.`,
          category: "legal",
          parcelId: result.parcelId,
        });
        return result;
      },
    },
    approveLegalWorkflow: async (workflowId: string) => {
      const result = await approveLegalWorkflow.mutateAsync({ workflowId, reviewedBy: "Mobile Inbox" });
      const parcel = bundle.parcels.find((item) => item.id === result.parcelId);
      await prependActivity({
        title: "Legal workflow approved",
        description: `${result.type} for parcel ${result.parcelId} was approved from the notifications inbox.`,
        category: "legal",
        tone: "success",
        route: "/legal-workflow",
        parcelId: result.parcelId,
        parcelNumber: parcel?.parcelNumber,
      });
      await scheduleFieldUpdateNotification({
        title: "Legal workflow approved",
        body: `${result.type} for parcel ${parcel?.parcelNumber ?? result.parcelId} was approved from the inbox.`,
        category: "legal",
        parcelId: result.parcelId,
      });
      return result;
    },
  };
}
