// Service worker : l'app fonctionne hors-ligne et se met à jour dès qu'il y a du réseau.
const CACHE = 'chronotodo-v1';
const ASSETS = [
  './',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Réseau d'abord (version la plus récente), cache si hors-ligne ou réseau trop lent.
// L'API de synchro (/api/) n'est jamais mise en cache.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(networkFirst(req));
});

function networkFirst(req) {
  const fromCache = () => caches.match(req, { ignoreSearch: true })
    .then((r) => r || (req.mode === 'navigate' ? caches.match('./') : undefined));

  return new Promise((resolve) => {
    let settled = false;
    const finish = (res) => { if (!settled && res) { settled = true; resolve(res); } };
    const slow = setTimeout(() => fromCache().then(finish), 3000);

    fetch(req)
      .then((res) => {
        if (res.ok && !res.redirected) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        clearTimeout(slow);
        finish(res);
      })
      .catch(() => {
        clearTimeout(slow);
        fromCache().then((r) => finish(r || Response.error()));
      });
  });
}
