/**
 * PWA Registration + Push Notification Subscription
 * Registers the service worker and subscribes to push notifications.
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";
const SW_PATH = "/service-worker.js";

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) {
    console.warn("[PWA] Service workers not supported");
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
    console.info("[PWA] Service worker registered", { scope: registration.scope });

    // Listen for updates
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          // New content available — notify user
          dispatchEvent(new CustomEvent("sw-update-available"));
        }
      });
    });

    return registration;
  } catch (err) {
    console.error("[PWA] Service worker registration failed", err);
    return null;
  }
}

export async function subscribeToPush(registration: ServiceWorkerRegistration): Promise<PushSubscription | null> {
  if (!("PushManager" in window)) {
    console.warn("[PWA] Push notifications not supported");
    return null;
  }

  if (!VAPID_PUBLIC_KEY) {
    console.debug("[PWA] VAPID key not configured — push disabled");
    return null;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.info("[PWA] Notification permission denied");
      return null;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    // Send subscription to backend
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription),
    }).catch(() => {}); // Fire-and-forget

    console.info("[PWA] Push subscription active");
    return subscription;
  } catch (err) {
    console.error("[PWA] Push subscription failed", err);
    return null;
  }
}

export async function registerBackgroundSync(tag: string = "ndsep-offline-mutations"): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    if ("sync" in registration) {
      await (registration as any).sync.register(tag);
      return true;
    }
  } catch {
    // Background sync not supported
  }
  return false;
}

export async function initPWA(): Promise<void> {
  const registration = await registerServiceWorker();
  if (registration) {
    // Subscribe to push after a brief delay (don't block initial render)
    setTimeout(() => subscribeToPush(registration), 3000);
  }
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer as ArrayBuffer;
}
