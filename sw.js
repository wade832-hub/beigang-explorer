/* 離線快取：更新程式時請把 CACHE 版本號 +1 */
const CACHE = 'bgx-v17';
const ASSETS = ['./', './index.html', './app.js', './style.css', './activity.json',
  './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './vendor/html2canvas.min.js', './vendor/jspdf.umd.min.js', './assets/map-v1.png', './assets/ctg-plan-v3.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;           // 雲端同步等外部請求不攔截
  if (url.pathname.endsWith('/activity.json')) {         // 活動檔：有網路取最新，沒網路用快取
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put('./activity.json', cp)); }
      return r;
    }).catch(() => caches.match('./activity.json')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit ||
    fetch(req).catch(() => req.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
});
self.addEventListener('message', e => { if (e.data === 'assets') e.source.postMessage({ type: 'assets', cache: CACHE, assets: ASSETS }); });
