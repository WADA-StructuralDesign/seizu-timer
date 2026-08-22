/* ============================================================================
 * Service Worker ─ オフライン動作を担当する
 * ----------------------------------------------------------------------------
 *  ・初回アクセス時に下記のファイルを端末内へ保存する。
 *  ・2回目以降は保存済みのファイルを返すため、通信がなくても起動する。
 *  ・app.js などを更新したら CACHE の版番号を上げること。
 *    版番号が変わると古いキャッシュが破棄され、新しいファイルが読み込まれる。
 * ========================================================================== */
const CACHE = "seizu-timer-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// キャッシュ優先。未保存のものだけ通信し、取得できたら保存する。
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
