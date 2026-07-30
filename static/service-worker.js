/* ═══════════════════════════════════════
   SmartAgro Service Worker
   Handles: offline cache, background sync
═══════════════════════════════════════ */

const CACHE_NAME = 'smartagro-v1';
const OFFLINE_URL = '/offline';

// Files to cache for offline use
const STATIC_ASSETS = [
    '/',
    '/diagnose',
    '/market',
    '/alerts',
    '/offline',
    '/static/css/main.css',
    '/static/css/dashboard.css',
    '/static/css/diagnose.css',
    '/static/css/market.css',
    '/static/css/alerts.css',
    '/static/js/main.js',
    '/static/js/dashboard.js',
    '/static/js/diagnose.js',
    '/static/js/market.js',
    '/static/js/alerts.js',
    '/static/js/translations.js',
    '/static/icons/icon-192.png',
    '/static/icons/icon-512.png',
    'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Inter:wght@300;400;500;600&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
];

// Install — cache all static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate — delete old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

// Fetch — serve from cache, fallback to network
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // API calls — always go to network, don't cache
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(request).catch(() =>
                new Response(JSON.stringify({ error: 'Offline — no internet connection' }), {
                    headers: { 'Content-Type': 'application/json' }
                })
            )
        );
        return;
    }

    // HTML pages — network first, fallback to cache, then offline page
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
            .then(res => {
                const clone = res.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                return res;
            })
            .catch(() =>
                caches.match(request).then(cached => cached || caches.match(OFFLINE_URL))
            )
        );
        return;
    }

    // Static assets — cache first, fallback to network
    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;
            return fetch(request).then(res => {
                const clone = res.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                return res;
            });
        })
    );
});