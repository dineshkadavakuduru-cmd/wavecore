/**
 * Service Worker for Wavecore PWA
 *
 * Caches the app shell and demo tracks for offline playback.
 * Uses cache-first for static assets, network-first for nothing (no API).
 *
 * Version: increment when changing cached assets.
 */
const CACHE_VERSION = "v1";
const CACHE_NAME = `wavecore-${CACHE_VERSION}`;

// Assets to cache on install (app shell)
const APP_SHELL = [
  "/",
  "/manifest.json",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/apple-touch-icon.png",
  "/og-image.png",
];

// Demo tracks to cache for offline playback (compressed OGG only ~2 MB total)
const DEMO_TRACKS = [
  "/tracks/subsurface.ogg",
  "/tracks/ion-drift.ogg",
  "/tracks/chromagrid.ogg",
];

const ALL_ASSETS = [...APP_SHELL, ...DEMO_TRACKS];

/** Install: cache the app shell and demo tracks */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Caching app shell and demo tracks");
      return cache.addAll(ALL_ASSETS);
    }),
  );
  // Skip waiting so the new SW activates immediately
  self.skipWaiting();
});

/** Activate: clean up old caches */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log("[SW] Deleting old cache:", key);
            return caches.delete(key);
          }),
      );
    }),
  );
  // Claim clients so the new SW controls the page immediately
  self.clients.claim();
});

/** Fetch: cache-first strategy for all assets */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  // HTML navigation: network-first with cache fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache the fresh response
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          return response;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Optionally update cache in background (stale-while-revalidate)
        event.waitUntil(
          fetch(request)
            .then((response) => {
              if (response.ok) {
                caches.open(CACHE_NAME).then((cache) => cache.put(request, response));
              }
            })
            .catch(() => {
              // Ignore network errors
            }),
        );
        return cached;
      }

      // Not in cache: fetch and cache
      return fetch(request).then((response) => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        }
        return response;
      });
    }),
  );
});

/** Handle messages from the client (e.g., skip waiting) */
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") {
    self.skipWaiting();
  }
});