const CACHE_NAME = 'besoul-pwa-icons-v8';
const CORE_ASSETS = [
  './',
  './index.html',
  './agenda.html',
  './crm.html',
  './finanzas.html',
  './dashboard.html',
  './portal-cliente.html',
  './manifest.json',
  './manifest-portal.json',
  './besoul-icon-192.png',
  './besoul-icon-512.png'
];
// HARDENING-PRE-BASELINE-v3.2.1 (PWA-CLIENT): páginas cuyo fallback offline debe ser ELLAS
// MISMAS, no index.html (login PT/admin) -- portal-cliente.html se identifica por su propio
// pathname, nunca por el token de la query string (que varía por cliente).
const FALLBACK_PROPIO = ['./portal-cliente.html'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(k => k !== CACHE_NAME)
            .map(k => caches.delete(k))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME)
          .then(cache => cache.put(req, copy))
          .catch(() => null);
        return res;
      })
      .catch(() => {
        // ignoreSearch: req para portal-cliente.html siempre lleva ?t=<token> (distinto por
        // cliente) -- sin esto, nunca coincidía con la entrada precacheada (sin query string) y
        // el fallback caía siempre en index.html, incluso para el propio Portal.
        return caches.match(req, { ignoreSearch: true }).then(cached => {
          if (cached) return cached;
          const propio = FALLBACK_PROPIO.find(p => req.url.includes(p.slice(2)));
          return caches.match(propio || './index.html');
        });
      })
  );
});
