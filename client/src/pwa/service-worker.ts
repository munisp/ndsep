/**
 * NDSEP Progressive Web App Service Worker
 * ==========================================
 * Enables offline-first operation, background sync, and push notifications.
 *
 * Caching strategy:
 * - Static assets: Cache-first (versioned by build hash)
 * - API responses: Network-first with stale-while-revalidate fallback
 * - Compliance data: Background sync when offline mutations queued
 */

/// <reference lib="webworker" />
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const self: ServiceWorkerGlobalScope;

// Extended types for Background Sync API and Notification actions
interface SyncEvent extends ExtendableEvent {
  tag: string;
}
interface SyncManager {
  register(tag: string): Promise<void>;
}
declare global {
  interface ServiceWorkerRegistration {
    sync: SyncManager;
  }
}

const CACHE_VERSION = "ndsep-v2.1.0";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;
const FONT_CACHE = `${CACHE_VERSION}-fonts`;
const OFFLINE_QUEUE = "ndsep-offline-queue";

// Assets to precache on install
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/offline.html",
];

// ── Install ─────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

// ── Activate ────────────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== API_CACHE && key !== FONT_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch Strategy ──────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (mutations go to background sync)
  if (request.method !== "GET") {
    if (!navigator.onLine) {
      event.respondWith(queueOfflineMutation(request));
    }
    return;
  }

  // Google Fonts: cache-first (immutable)
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  // Static assets: cache-first
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // API calls: network-first with cache fallback
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // HTML navigation: network-first, offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html") as Promise<Response>)
    );
    return;
  }

  // Default: network with cache fallback
  event.respondWith(networkFirst(request, STATIC_CACHE));
});

// ── Background Sync ─────────────────────────────────────────────────────────

self.addEventListener("sync", ((event: SyncEvent) => {
  if (event.tag === "ndsep-offline-mutations") {
    event.waitUntil(processOfflineQueue());
  }
}) as any);

// ── Push Notifications ──────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options: NotificationOptions & { actions?: any[]; vibrate?: number[] } = {
    body: data.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    tag: data.tag || "ndsep-notification",
    data: { url: data.url || "/" },
    actions: data.actions || [],
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      const existing = clients.find((c) => c.url === url);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function isStaticAsset(url: URL): boolean {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".svg")
  );
}

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request: Request, cacheName: string): Promise<Response> {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: "offline", cached: false }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function queueOfflineMutation(request: Request): Promise<Response> {
  const body = await request.clone().text();
  const entry = {
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    timestamp: Date.now(),
  };

  // Store in IndexedDB via broadcast to main thread
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: "QUEUE_MUTATION", payload: entry });
  });

  // Register for background sync
  await self.registration.sync.register("ndsep-offline-mutations");

  return new Response(JSON.stringify({ queued: true, syncPending: true }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
}

async function processOfflineQueue(): Promise<void> {
  // Retrieve queued mutations from IndexedDB and replay
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: "PROCESS_OFFLINE_QUEUE" });
  });
}

export {};
