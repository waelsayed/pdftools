/* pdftools service worker — offline support.
   Caches the app shell + CDN libraries so the tool keeps working
   after the page was loaded once, even with no connection. */
var CACHE = 'pdftools-v3';
var CORE = [
  '/',
  '/en/',
  '/privacy.html',
  '/en/privacy.html',
  '/css/style.css',
  '/js/app.js',
  '/js/i18n.js',
  '/images/logo.webp',
  '/og-image.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(CORE); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);

  if (url.origin === self.location.origin) {
    // Same-origin: network first (fresh deploys win), cache fallback offline.
    e.respondWith(
      fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () { return caches.match(e.request); })
    );
  } else {
    // CDN libraries: cache first, network fallback.
    e.respondWith(
      caches.match(e.request).then(function (hit) {
        if (hit) return hit;
        return fetch(e.request).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
          return res;
        });
      })
    );
  }
});
