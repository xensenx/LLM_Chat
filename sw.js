// sw.js

// Versioning the cache
const CACHE_NAME = 'v1';
const CACHE_ASSETS = [
    '/favicon.ico',
    '/manifest.json',
    // additional assets can be added here
];

// Install event for caching assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(CACHE_ASSETS);
        })
    );
});

// Fetch event for network-first strategy
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request)  // Try the network first
            .then((response) => {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseClone);  // Cache the response
                });
                return response;  // Return the network response
            })
            .catch(() => {
                return caches.match(event.request);  // If network fails, serve cached content
            })
    );
});

// Activate event for cleaning up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (CACHE_NAME !== cacheName) {
                        return caches.delete(cacheName);  // Delete old caches
                    }
                })
            );
        })
    );
});
