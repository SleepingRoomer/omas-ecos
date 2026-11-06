// Service worker : garde une copie de l'application pour qu'un évaluateur puisse continuer à noter
// quand le wifi de la faculté décroche. Les grilles elles-mêmes attendent dans le téléphone (voir evaluator.js).
const CACHE = 'omas-v6';
const API_CACHED = /^\/api\/(me|eval\/(context|schedule|evaluations\/\d+))$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// Réseau d'abord, copie locale si le réseau ne répond pas
async function networkFirst(req, key = req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    // seules les données de la salle d'évaluation sont gardées hors connexion
    if (API_CACHED.test(url.pathname)) e.respondWith(networkFirst(req));
    return;
  }
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, '/')); return; }
  e.respondWith(networkFirst(req));
});
