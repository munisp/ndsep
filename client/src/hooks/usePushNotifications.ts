/**
 * usePushNotifications
 *
 * Manages Web Push subscription state for the current user.
 * - Fetches the VAPID public key from the server
 * - Subscribes/unsubscribes via the service worker PushManager
 * - Persists the subscription to the server via tRPC
 */
import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const buf = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < rawData.length; i++) view[i] = rawData.charCodeAt(i);
  return view;
}

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

export interface UsePushNotificationsResult {
  permission: PushPermission;
  isSubscribed: boolean;
  isLoading: boolean;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  sendTest: () => Promise<void>;
}

export function usePushNotifications(): UsePushNotificationsResult {
  const [permission, setPermission] = useState<PushPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);

  const vapidQuery = trpc.push.getVapidPublicKey.useQuery(undefined, {
    staleTime: Infinity,
  });

  const subscribeMutation = trpc.push.subscribe.useMutation();
  const unsubscribeMutation = trpc.push.unsubscribe.useMutation();
  const sendTestMutation = trpc.push.sendTestNotification.useMutation();

  // Check current permission and subscription state on mount
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPermission("unsupported");
      return;
    }

    setPermission(Notification.permission as PushPermission);

    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        if (sub) {
          setIsSubscribed(true);
          setCurrentEndpoint(sub.endpoint);
        }
      });
    });
  }, []);

  const subscribe = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast.error("Push notifications are not supported in this browser.");
      return;
    }

    if (!vapidQuery.data?.publicKey) {
      toast.error("Push configuration not available. Please try again.");
      return;
    }

    setIsLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as PushPermission);

      if (perm !== "granted") {
        toast.error("Notification permission denied. Please enable it in browser settings.");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidQuery.data.publicKey),
      });

      const key = sub.getKey("p256dh");
      const authKey = sub.getKey("auth");

      if (!key || !authKey) throw new Error("Failed to get push subscription keys");

      const p256dh = btoa(String.fromCharCode(...Array.from(new Uint8Array(key as ArrayBuffer))));
      const auth = btoa(String.fromCharCode(...Array.from(new Uint8Array(authKey as ArrayBuffer))));

      await subscribeMutation.mutateAsync({
        endpoint: sub.endpoint,
        p256dh,
        auth,
        userAgent: navigator.userAgent.slice(0, 200),
      });

      setIsSubscribed(true);
      setCurrentEndpoint(sub.endpoint);
      toast.success("Push notifications enabled! You'll receive alerts for overdue invoices and audit deadlines.");
    } catch (err: unknown) {
      console.error("[Push] Subscribe error:", err);
      toast.error(`Failed to enable push notifications: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsLoading(false);
    }
  }, [vapidQuery.data, subscribeMutation]);

  const unsubscribe = useCallback(async () => {
    setIsLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (sub) {
        await sub.unsubscribe();
        if (currentEndpoint) {
          await unsubscribeMutation.mutateAsync({ endpoint: currentEndpoint });
        }
      }

      setIsSubscribed(false);
      setCurrentEndpoint(null);
      toast.success("Push notifications disabled.");
    } catch (err: unknown) {
      console.error("[Push] Unsubscribe error:", err);
      toast.error(`Failed to disable push notifications: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsLoading(false);
    }
  }, [currentEndpoint, unsubscribeMutation]);

  const sendTest = useCallback(async () => {
    try {
      const result = await sendTestMutation.mutateAsync();
      if (result.sent > 0) {
        toast.success(`Test notification sent to ${result.sent} device${result.sent > 1 ? "s" : ""}.`);
      } else {
        toast.info("No active subscriptions found. Please subscribe first.");
      }
    } catch (err: unknown) {
      toast.error(`Failed to send test: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [sendTestMutation]);

  return { permission, isSubscribed, isLoading, subscribe, unsubscribe, sendTest };
}
