// Service worker: makes Chess Lab work offline and installable.
//
// Site files are fetched from the network first, so a new deploy shows up on the
// next load, and the cached copy is used only when there is no connection.
// Engine files never change under the same name, so they come from the cache first.
// The full Stockfish 19 for Deep check (about 95 MB, from unpkg.com) is kept in its
// own cache after the first download. Saved games are in localStorage, not here.
const CORE = 'cl-core-v1', EXT = 'cl-ext-v1', DEEP = 'cl-deep-v1';
const PRECACHE = [
  './', 'index.html', 'chess.js', 'train.js', 'openings.json', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png',
  'stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm',
  'stockfish-19-lite.js', 'stockfish-19-lite.wasm',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CORE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  const keep = [CORE, EXT, DEEP];
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => !keep.includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const isEngine = p => /\/stockfish[^/]*\.(js|wasm)$/.test(p);

async function networkFirst(req, cacheName, key) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key || req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key || req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (req.mode === 'navigate') { e.respondWith(networkFirst(req, CORE, new URL('index.html', self.registration.scope).href)); return; }
    e.respondWith(isEngine(url.pathname) ? cacheFirst(req, CORE) : networkFirst(req, CORE));
    return;
  }
  if (url.hostname === 'unpkg.com' && /\/stockfish@/.test(url.pathname)) { e.respondWith(cacheFirst(req, DEEP)); return; }
  if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || url.hostname === 'api.chess.com') { e.respondWith(networkFirst(req, EXT)); return; }
});
