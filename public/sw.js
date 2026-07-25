const CACHE_NAME = 'mci-triage-v1';
const ASSETS = [
  'index.html',
  'officer.html',
  'style.css',
  'dashboard.js',
  'officer.js',
  'manifest.json',
  'icon.svg'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app assets');
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event (Network-first with Cache Fallback)
self.addEventListener('fetch', (event) => {
  // Only cache GET requests (exclude WebSockets and API POST/POSTs)
  if (event.request.method !== 'GET' || event.request.url.includes('/api/') || event.request.url.startsWith('ws')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Update cache with fresh version
        if (networkResponse.status === 200) {
          const cacheCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, cacheCopy);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Fallback to cache if offline
        console.log('[Service Worker] Serving from cache:', event.request.url);
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If not in cache, return simple offline error
          if (event.request.headers.get('accept').includes('text/html')) {
            return caches.match('officer.html');
          }
        });
      })
  );
});
