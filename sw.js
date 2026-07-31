const CACHE_NAME = 'besoul-suite-v2-centros-qr';
const CORE_ASSETS = [
  './',
  './index.html',
  './agenda.html',
  './crm.html',
  './finanzas.html',
  './dashboard.html',
  './reservas.html',
  './prueba.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)).catch(() => null));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(fetch(req).then(res => {
    const copy = res.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => null);
    return res;
  }).catch(() => caches.match(req).then(cached => cached || caches.match('./index.html'))));
});

