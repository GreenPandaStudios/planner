const CACHE_NAME = 'focus-boundary-cache-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './favicon.svg',
  './icons.svg'
];

// Install Event: cache static shell assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: clear old caches and claim clients
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event
self.addEventListener('fetch', event => {
  // Only intercept GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Ignore browser extensions, hot-reloading (Vite Dev), or external third-party requests (like OpenAI API)
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/@vite/') || url.pathname.includes('/node_modules/')) return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      // 1. If cache hit, return cached version and update cache in the background (Stale-While-Revalidate)
      if (cachedResponse) {
        fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {/* Ignore network errors during silent background sync */});
        return cachedResponse;
      }

      // 2. Cache miss: fetch from network
      return fetch(event.request).then(networkResponse => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        // Cache the fresh resource dynamically
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(err => {
        // 3. Offline SPA fallback: serve index.html if navigating
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        throw err;
      });
    })
  );
});
