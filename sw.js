/* CoupleLife Service Worker - 离线缓存核心资源 */
const CACHE_NAME = 'couplelife-v3';
const CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* 页面导航：网络优先，失败回退缓存（保证总是最新版本） */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 不缓存 Supabase API 请求
  if (url.hostname.includes('supabase')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put('./index.html', clone));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 图片类：先查缓存
  if (req.destination === 'image') {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // JS/CSS 等：缓存优先，后台静默更新
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        fetch(req).then((res) => {
          if (res.ok) caches.open(CACHE_NAME).then((c) => c.put(req, res));
        }).catch(() => {});
        return hit;
      }
      return fetch(req).then((res) => {
        if (res.ok && (req.destination === 'script' || req.destination === 'style')) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => hit);
    })
  );
});
