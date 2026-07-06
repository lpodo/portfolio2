// SINGLE SOURCE OF TRUTH for the app version. Bump this on EVERY deploy.
// Format: portfolio-YYYY-MM-DD-vN (bump vN for multiple deploys same day).
// index.html reads this value back via postMessage and shows it as the version
// stamp bottom-left, and registers with reg.update() + auto-reload so a bumped
// version here forces: fresh SW → old cache wiped → page reloads → fresh
// index.html + fresh stamp. Change the version ONLY here.
var CACHE = 'portfolio-2026-07-06-v395';

self.addEventListener('install', function(e) {
  // Pre-cache with cache:'reload' on each Request — forces network bypass of
  // browser HTTP cache. Without this, addAll() respects Cache-Control max-age
  // from GitHub Pages (10 min default), and a brand-new SW install would
  // simply repopulate its cache with the same stale files the disk cache
  // still has — defeating the whole point of bumping the version.
  e.waitUntil(
    caches.open(CACHE).then(function(c) {
      return c.addAll([
        new Request('./index.html',     { cache: 'reload' }),
        new Request('./manifest.json',  { cache: 'reload' }),
        new Request('./icon-192.png',   { cache: 'reload' }),
        new Request('./fundamentals.js',{ cache: 'reload' })
      ]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// The page asks 'getVersion'; reply with CACHE so it can show the version
// stamp reflecting the ACTUALLY ACTIVE service worker (not what's on the
// server). Strip the 'portfolio-' prefix for display.
self.addEventListener('message', function(e) {
  if (e.data === 'getVersion' && e.source) {
    e.source.postMessage({ type: 'swVersion', value: CACHE.replace(/^portfolio-/, '') });
  }
});

// Stale-while-revalidate: serve cached response immediately (fast first paint),
// fetch fresh in background and update cache for next time.
//
// IMPORTANT: the background fetch uses {cache:'no-cache'} to bypass the
// browser's HTTP cache. Without this flag, fetch(e.request) respects the
// original request's cache mode — and GitHub Pages serves with
// Cache-Control: max-age=600, so the browser HTTP cache returns the OLD
// copy to the SW's "fresh" fetch, which gets stored back into the SW cache.
// Net effect: stale-while-revalidate quietly re-caches the stale version
// for 10 minutes. {cache:'no-cache'} sends a conditional request
// (If-Modified-Since / ETag) so the origin can return 304 (unchanged, no
// body) or 200 (with the fresh body), bypassing HTTP cache entirely.
self.addEventListener('fetch', function(e) {
  // Never cache API requests
  if (e.request.url.includes('workers.dev') ||
      e.request.url.includes('finnhub.io') ||
      e.request.url.includes('jsonbin.io') ||
      e.request.url.includes('financialmodelingprep.com')) return;

  // Only intercept GET (POST/PUT/DELETE bypass cache entirely)
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.open(CACHE).then(function(cache) {
      return cache.match(e.request).then(function(cached) {
        // Always fetch fresh in parallel; update cache on success.
        // {cache:'no-cache'} forces conditional revalidation past the
        // browser HTTP cache so we actually see new deployments.
        var networkPromise = fetch(e.request, { cache: 'no-cache' }).then(function(resp) {
          if (resp && resp.status === 200) {
            // Clone before caching — body can only be read once
            cache.put(e.request, resp.clone());
          }
          return resp;
        }).catch(function() { return null; });

        // Keep SW alive until background fetch completes (otherwise the
        // browser may kill the worker before the cache is updated)
        e.waitUntil(networkPromise.catch(function() {}));

        // Return cached version immediately if present; otherwise wait for
        // network. If both fail (offline + cache miss), fall back to index.
        return cached || networkPromise.then(function(resp) {
          return resp || caches.match('./index.html');
        });
      });
    })
  );
});
