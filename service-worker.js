var CACHE = 'dsa-hub-v10';

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll([
        './index.html',
        './rosetta-dsa.html',
        './leetcode-200.html',
        './icon-192.png',
        './icon-512.png',
        './pdfs/DSA_Complete_Notes.pdf',
        './pdfs/OOP_Complete_Notes.pdf',
        './pdfs/SE_Complete_Notes.pdf',
        './pdfs/OS_Complete_Notes.pdf',
        './pdfs/COA_Complete_Notes.pdf',
        './pdfs/DBMS_Complete_Notes.pdf',
        './pdfs/CN_Complete_Notes.pdf'
      ]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).then(function (response) {
      if (response && response.status === 200) {
        var clone = response.clone();
        caches.open(CACHE).then(function (cache) {
          cache.put(event.request, clone);
        });
      }
      return response;
    }).catch(function () {
      return caches.match(event.request).then(function (cached) {
        return cached || caches.match('./index.html');
      });
    })
  );
});
