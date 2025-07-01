// Service Worker for offline capabilities
const CACHE_NAME = 'midi-generator-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  'https://cdn.skypack.dev/tone@14.7.77',
  'https://esm.sh/@tonejs/midi@2.0.28'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      }
    )
  );
});