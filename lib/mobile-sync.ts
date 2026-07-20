import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";

import type { BusinessProfileRecord, MobilePlatformBundle } from "@/lib/mobile-data";
import { cloneSeedBundle } from "@/lib/mobile-data";
import { registerFieldSyncBackgroundTask } from "@/lib/background-sync";
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

  const advanceLegalWorkflow = trpc.legal.advance.useMutation({
    onSuccess: async () => {
      await utils.sync.getBundle.invalidate();
    },
  });

  async function updateMissionStatus(input: { missionId: string; status: "queued" | "active" | "synced" }) {
    try {
      const result = await rawMissionStatusMutation.mutateAsync(input);
      await scheduleFieldUpdateNotification({
        title: "Field update synchronized",
        body: `Mission ${input.missionId} moved to ${input.status}.`,
        data: input,
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
        missions: bundle.missions.map((mission) =>
          mission.id === input.missionId ? { ...mission, status: input.status, lastUpdated: queued.queuedAt } : mission,
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
        data: input,
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
    submitBusinessProfile: (profile: BusinessProfileRecord) => submitBusinessProfile.mutateAsync(profile),
    analyzeIdentityDocument,
    analyzeBusinessDocument,
    startLiveness,
    completeLiveness,
    advanceLegalWorkflow,
  };
}
