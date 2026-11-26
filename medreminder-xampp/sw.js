const CACHE = 'medreminder-v2';
const SHELL = [
  './',
  './index.html',
  './pasien/',
  './pasien/index.html',
  './pasien/app.js',
  './pengawas/',
  './pengawas/index.html',
  './pengawas/app.js',
  './shared/common.js',
  './shared/style.css',
  './icon.svg',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(u))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') {
          if (url.pathname.includes('/pasien')) return caches.match('./pasien/index.html');
          if (url.pathname.includes('/pengawas')) return caches.match('./pengawas/index.html');
          return caches.match('./index.html');
        }
        return new Response('', { status: 504 });
      })
  );
});
