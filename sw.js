var CACHE = 'portfolio-v224';

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) {
      return c.addAll(['./index.html', './manifest.json', './icon-192.png']);
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

self.addEventListener('fetch', function(e) {
  // Never cache API requests
  if (e.request.url.includes('workers.dev') ||
      e.request.url.includes('finnhub.io') ||
      e.request.url.includes('jsonbin.io') ||
      e.request.url.includes('financialmodelingprep.com')) return;
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request).then(function(resp) {
        return caches.open(CACHE).then(function(c) {
          c.put(e.request, resp.clone());
          return resp;
        });
      });
    }).catch(function() {
      return caches.match('./index.html');
    })
  );
});
