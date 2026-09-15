const CACHE_NAME = 'randogeol-cache-v5';
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './data/departments.json',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  let pathname;
  try {
    pathname = new URL(request.url).pathname;
  } catch (e) {
    pathname = '';
  }
  const isAppShell = PRECACHE_ASSETS.some((asset) => pathname.endsWith(asset.replace('./', '/')));

  // Network-first pour la coquille de l'application (HTML/JS/CSS/manifest)
  if (request.mode === 'navigate' || isAppShell) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first pour le reste (tuiles OSM/IGN/BRGM, icônes Leaflet, etc.)
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
