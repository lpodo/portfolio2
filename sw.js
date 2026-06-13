// Bump this when the install pre-cache list changes or when you want to
// force a full cache wipe. For routine content updates (index.html, fundamentals.js)
// the stale-while-revalidate strategy below picks them up automatically.
var CACHE = 'portfolio-v389';

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) {
      return c.addAll(['./index.html', './manifest.json', './icon-192.png', './fundamentals.js']);
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

// Stale-while-revalidate: serve cached response immediately (fast first paint),
// fetch fresh in background and update cache for next time.
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
        // Always fetch fresh in parallel; update cache on success
        var networkPromise = fetch(e.request).then(function(resp) {
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
