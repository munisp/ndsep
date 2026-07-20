import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";

import type { BusinessProfileRecord, MobilePlatformBundle } from "@/lib/mobile-data";
import { cloneSeedBundle } from "@/lib/mobile-data";
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

  useEffect(() => {
    loadCachedBundle()
      .then((bundle) => {
        setCachedBundle(bundle);
        setCacheLoaded(true);
      })
      .catch(() => {
        setCacheLoaded(true);
      });
  }, []);

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
    if (liveQuery.data) return liveQuery.data;
    if (cachedBundle) {
      return {
        ...cachedBundle,
        syncMeta: {
          ...cachedBundle.syncMeta,
          source: "offline_cache" as const,
        },
      };
    }
    return cloneSeedBundle();
  }, [cachedBundle, liveQuery.data]);

  const updateMissionStatus = trpc.sync.updateMissionStatus.useMutation({
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
