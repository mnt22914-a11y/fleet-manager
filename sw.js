// オフラインでも画面が開くようにする最小限のキャッシュ。
// 常にネットワークを優先し、つながらないときだけ保存済みのファイルを使う。
const CACHE = 'fleet-shell-v3';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    // サーバーに毎回「変わっていないか」を聞く(更新した版が 10 分も古いままにならないように)
    fetch(new Request(e.request, { cache: 'no-cache' }))
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
