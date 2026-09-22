// Bump VERSION whenever you add, rename or remove files.
const VERSION = 'v10';
const CACHE = `pips-pond-${VERSION}`;
const FONT_CACHE = 'pips-pond-fonts';
const LIB_CACHE = 'pips-pond-libs';

const SHELL = [
  './', './index.html', './manifest.json',
  './css/tokens.css', './css/base.css', './css/components.css',
  './js/main.js', './js/router.js', './js/config.js',
  './js/core/dates.js', './js/core/calc.js', './js/core/weights.js', './js/core/semester.js',
  './js/data/db.js', './js/data/importExport.js', './js/data/supabase.js', './js/data/sync.js',
  './js/data/auth.js', './js/data/social.js', './js/data/push.js',
  './js/pip/frog.js', './js/pip/mood.js', './js/pip/lines.js',
  './js/ui/dom.js', './js/ui/toast.js', './js/ui/info.js', './js/ui/sound.js', './js/ui/widgets.js', './js/ui/report.js',
  './js/ui/lock.js', './js/ui/status.js',
  './js/views/pond.js', './js/views/log.js', './js/views/feed.js', './js/views/favorites.js',
  './js/views/settings.js', './js/views/tutorial.js', './js/views/semesters.js', './js/views/data.js',
  './js/views/login.js', './js/views/signup.js', './js/views/friends.js', './js/views/addFriend.js',   './js/views/study.js', './js/views/courseSetup.js', './js/views/decks.js', './js/ui/sheet.js',
  './assets/icons/icon-180.png', './assets/icons/icon-192.png', './assets/icons/icon-512.png',
  './assets/sounds/ribbit.mp3', './assets/sounds/splash.mp3', './assets/sounds/chorus.mp3',
  './js/data/study.js', './js/data/decks.js', './js/core/grades.js', './js/views/course.js', './js/data/dining.js', './js/views/dining.js', './js/data/share.js',
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
      .filter((k) => k.startsWith('pips-pond-') && ![CACHE, FONT_CACHE, LIB_CACHE].includes(k))
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

async function cacheFirst(request, name = FONT_CACHE) {
  const cache = await caches.open(name);
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
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(request, LIB_CACHE)); // the sign-in / sync library
  }
});

// ---------- notifications ----------
self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data?.json() ?? {}; } catch { msg = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(msg.title || 'Pip’s Pond', {
    body: msg.body || '',
    tag: msg.tag || 'pond',
    icon: './assets/icons/icon-192.png',
    badge: './assets/icons/icon-192.png',
    data: { url: msg.url || './' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = open.find((c) => c.url.startsWith(self.registration.scope));
    if (existing) { await existing.focus(); return; }
    await self.clients.openWindow(target);
  })());
});