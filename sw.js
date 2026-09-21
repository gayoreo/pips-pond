// Bump VERSION whenever you add, rename or remove files.
const VERSION = 'v1';
const CACHE = `pips-pond-${VERSION}`;
const FONT_CACHE = 'pips-pond-fonts';

const SHELL = [
  './', './index.html', './manifest.json',
  './css/tokens.css', './css/base.css', './css/components.css',
  './js/main.js', './js/router.js',
  './js/core/dates.js', './js/core/calc.js',
  './js/data/db.js',
  './js/pip/frog.js', './js/pip/mood.js', './js/pip/lines.js',
  './js/ui/dom.js', './js/ui/toast.js',
  './js/views/pond.js', './js/views/log.js', './js/views/feed.js',
  './js/views/favorites.js', './js/views/settings.js', './js/views/tutorial.js',
  './assets/icons/icon-180.png', './assets/icons/icon-192.png', './assets/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('pips-pond-') && k !== CACHE && k !== FONT_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await Promise.race([fetch(request), timeout(3000)]);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') return (await cache.match('./index.html')) ?? Response.error();
    return Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request));
  }
});