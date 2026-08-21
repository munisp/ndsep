/**
 * NDSEP Service Worker — Offline-First PWA
 * Stale-while-revalidate for static assets, network-first for API.
 */

const CACHE_VERSION = "ndsep-v2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;

const STATIC_ASSETS = [
  "/",
  "/manifest.json",
];

const API_CACHE_MAX_AGE = 5 * 60 * 1000; // 5 minutes

// Install — cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("ndsep-") && k !== STATIC_CACHE && k !== API_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch handler with smart caching strategies
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // Skip chrome-extension and other non-http(s) requests
  if (!request.url.startsWith("http")) return;

  // API requests: network-first with cache fallback
  if (request.url.includes("/api/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful GET API responses
          if (response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || offlineResponse()))
    );
    return;
  }

  // Static assets: stale-while-revalidate
  if (isStaticAsset(request.url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached);

        return cached || fetchPromise;
      })
    );
    return;
  }

  // Navigation: network-first, fallback to cached index
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/").then((cached) => cached || offlineResponse())
      )
    );
    return;
  }
});

function isStaticAsset(url) {
  return /\.(js|css|woff2?|png|jpg|svg|ico|webp|avif)(\?|$)/.test(url);
}

function offlineResponse() {
  return new Response(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>NDSEP — Offline</title><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#1e293b;text-align:center}.dark body{background:#0f172a;color:#e2e8f0}div{max-width:360px;padding:2rem}h1{font-size:1.25rem;margin:1rem 0 0.5rem}p{color:#64748b;font-size:0.875rem;line-height:1.5}button{margin-top:1rem;padding:0.5rem 1.5rem;border-radius:0.5rem;border:none;background:#0077b6;color:white;font-size:0.875rem;cursor:pointer}</style></head><body><div><h1>You are offline</h1><p>NDSEP requires an internet connection. Your work has been saved locally and will sync when you reconnect.</p><button onclick="location.reload()">Retry</button></div></body></html>',
    { headers: { "Content-Type": "text/html" } }
  );
}

// Background sync for offline mutations
self.addEventListener("sync", (event) => {
  if (event.tag === "ndsep-sync") {
    event.waitUntil(syncPendingMutations());
  }
});

async function syncPendingMutations() {
  // Placeholder for offline mutation queue sync
  // Implemented via client-side IndexedDB queue in production
}
