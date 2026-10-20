/**
 * AutoBE service worker.
 *
 * AutoBE does all of its work locally, so the only thing the network is needed
 * for is loading the app shell. Strategy:
 *   - precache the shell on install
 *   - cache-first for same-origin assets (instant, works offline)
 *   - network-first with cache fallback for navigation requests
 *
 * Nothing about a user's packs ever touches the network.
 */

const CACHE = 'autobe-v1';

const PRECACHE = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => {
        /* a missing shell entry must not abort installation */
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only handle our own origin; third-party scripts are left to the network.
  if (url.origin !== self.location.origin) return;

  // SPA navigations: try the network so updates land, fall back to the cache.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || caches.match('./')))
    );
    return;
  }

  // Everything else: cache first.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => hit);
    })
  );
});