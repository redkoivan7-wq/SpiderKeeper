const PREFIX = 'spiderkeeper-stage003-';
const CACHE = PREFIX + '1';
const url = path => new URL(path, self.registration.scope).href;
const entry = url('./');
const shell = [
  'index.html', 'styles.css', 'collection.css', 'model.js', 'strings.js', 'collection.js',
  'media.js', 'terraria.js', 'feed.js', 'analytics.js', 'care.js', 'app.js', 'ui.js', 'storage.js', 'catalog.js', 'game.js', 'pwa.js',
  'manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'
].map(url);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(
    shell.map(asset => new Request(asset, { cache: 'reload' }))
  )));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => (key.startsWith(PREFIX) || key.startsWith('spiderkeeper-stage002-')) && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(entry)) return;
  const target = new URL(request.url);
  const index = url('index.html');
  if (request.mode === 'navigate' && (target.pathname === new URL(entry).pathname ||
      target.pathname === new URL(index).pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(index)) || fetch(request)));
  } else if (shell.includes(request.url)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(request)) || fetch(request)));
  }
});
