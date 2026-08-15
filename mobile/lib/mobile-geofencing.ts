import { Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { findParcel, type MobilePlatformBundle } from "@/lib/mobile-data";
import { appendActivityAudit, prependActivity } from "@/lib/mobile-activity";
import { scheduleFieldUpdateNotification } from "@/lib/mobile-notifications";
import { recordParcelGeofenceTrigger, shouldNotifyForParcel } from "@/lib/mobile-notification-preferences";
import { queueGeofenceEventMutation, replayQueuedFieldMutations } from "@/lib/mobile-sync-replay";

export const PARCEL_GEOFENCE_TASK = "idlr_pts_mobile.parcel_geofence";

export type GeofenceRuntimeResult = {
  status: "active" | "configured_only" | "permission_denied" | "unsupported" | "failed";
  reason: string | null;
  activeRegionCount: number;
  checkedAt: string;
};

if (Platform.OS !== "web") {
  try {
    TaskManager.defineTask(PARCEL_GEOFENCE_TASK, async ({ data, error }) => {
      if (error) {
        console.warn("[Geofence] Background task error:", error.message);
        return;
      }

      const geofencingEvent = data as
        | {
            eventType?: Location.GeofencingEventType;
            region?: Location.LocationRegion & { identifier?: string };
          }
        | undefined;

      const parcelId = Number(geofencingEvent?.region?.identifier ?? 0);
      const parcel = findParcel(parcelId);
      const transition = geofencingEvent?.eventType === Location.GeofencingEventType.Exit ? "exit" : "enter";
      if (!parcelId || !parcel) return;

      const shouldNotify = await shouldNotifyForParcel({
        parcelId,
        geofenceTransition: transition,
      });
      if (!shouldNotify) return;

      const triggeredAt = new Date().toISOString();
      await recordParcelGeofenceTrigger({
        parcelId,
        transition,
        triggeredAt,
      });

      const title = transition === "enter" ? "Entered parcel geofence" : "Exited parcel geofence";
      const description =
        transition === "enter"
          ? `You entered the monitored geofence for parcel ${parcel.parcelNumber}. Field and legal follow-up are now location-relevant.`
          : `You exited the monitored geofence for parcel ${parcel.parcelNumber}. Location-sensitive parcel work may need review before the next visit.`;

      const activityId = `geofence-${parcelId}-${triggeredAt}`;
      const radiusMeters = Math.round(Number(geofencingEvent?.region?.radius ?? 150));
      await prependActivity({
        id: activityId,
        title,
        description,
        category: "geospatial",
        tone: transition === "enter" ? "info" : "warning",
        parcelId,
        parcelNumber: parcel.parcelNumber,
        route: "/parcel/[id]",
        routeParams: { id: String(parcelId) },
        geofenceContext: {
          radiusMeters,
          transition,
          latitude: parcel.latitude,
          longitude: parcel.longitude,
          triggeredAt,
        },
      });

      await queueGeofenceEventMutation({
        type: "geofence_event",
        parcelId,
        transition,
        radiusMeters,
        latitude: parcel.latitude,
        longitude: parcel.longitude,
        triggeredAt,
        activityId,
      });
      await appendActivityAudit(activityId, {
        kind: "preference_synced",
        label: "Replay queued",
        actor: "system",
        detail: "This geofence event was queued locally and will replay against the synced parcel state when connectivity is available.",
        metadata: {
          parcelId,
          transition,
          radiusMeters,
        },
      });
      await replayQueuedFieldMutations().catch(async (replayError) => {
        await appendActivityAudit(activityId, {
          kind: "preference_synced",
          label: "Replay pending",
          actor: "system",
          detail: `The geofence event remains queued because replay failed: ${replayError instanceof Error ? replayError.message : "unknown error"}.`,
        });
      });

      await scheduleFieldUpdateNotification({
        title,
        body: description,
        category: "geospatial",
        parcelId,
        geofenceTransition: transition,
        data: {
          source: "parcel_geofence",
          parcelId,
          transition,
        },
      });
    });
  } catch {
    // Task may already be defined during fast refresh.
  }
}

export async function ensureGeofencePermissions() {
  if (Platform.OS === "web") return false;
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") return false;
  const background = await Location.requestBackgroundPermissionsAsync();
  return background.status === "granted";
}

export async function syncParcelGeofences(bundle: MobilePlatformBundle) {
  const checkedAt = new Date().toISOString();
  if (Platform.OS === "web") {
    return {
      status: "unsupported" as const,
      reason: "Background parcel geofencing is unavailable in the web runtime.",
      activeRegionCount: 0,
      checkedAt,
    };
  }

  const { notificationPreferences, parcels } = bundle;
  const activeSubscriptions = notificationPreferences.geofenceSubscriptions
    .filter((subscription) => subscription.enabled && notificationPreferences.followedParcelIds.includes(subscription.parcelId))
    .map((subscription) => {
      const parcel = parcels.find((item) => item.id === subscription.parcelId);
      if (!parcel) return null;
      return {
        identifier: String(parcel.id),
        latitude: parcel.latitude,
        longitude: parcel.longitude,
        radius: subscription.radiusMeters,
        notifyOnEnter: subscription.transition === "enter" || subscription.transition === "both",
        notifyOnExit: subscription.transition === "exit" || subscription.transition === "both",
      } satisfies Location.LocationRegion & { identifier: string; notifyOnEnter: boolean; notifyOnExit: boolean };
    })
    .filter((region): region is Location.LocationRegion & { identifier: string; notifyOnEnter: boolean; notifyOnExit: boolean } => Boolean(region));

  const alreadyStarted = await Location.hasStartedGeofencingAsync(PARCEL_GEOFENCE_TASK);
  if (!notificationPreferences.pushEnabled || !notificationPreferences.geofenceAlerts || activeSubscriptions.length === 0) {
    if (alreadyStarted) {
      await Location.stopGeofencingAsync(PARCEL_GEOFENCE_TASK);
    }
    return {
      status: "configured_only" as const,
      reason: "No enabled parcel geofence subscriptions are currently eligible for device registration.",
      activeRegionCount: 0,
      checkedAt,
    };
  }

  try {
    const granted = await ensureGeofencePermissions();
    if (!granted) {
      return {
        status: "permission_denied" as const,
        reason: "Foreground and background location permission are required before parcel monitoring can start.",
        activeRegionCount: 0,
        checkedAt,
      };
    }

    await Location.startGeofencingAsync(PARCEL_GEOFENCE_TASK, activeSubscriptions);
    const active = await Location.hasStartedGeofencingAsync(PARCEL_GEOFENCE_TASK);
    return active
      ? { status: "active" as const, reason: null, activeRegionCount: activeSubscriptions.length, checkedAt }
      : {
          status: "failed" as const,
          reason: "The device did not confirm that the parcel geofence task started.",
          activeRegionCount: 0,
          checkedAt,
        };
  } catch (error) {
    return {
      status: "failed" as const,
      reason: `Parcel geofence registration failed: ${error instanceof Error ? error.message : "unknown error"}`,
      activeRegionCount: 0,
      checkedAt,
    };
  }
}
