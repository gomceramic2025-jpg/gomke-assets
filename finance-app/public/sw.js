/* Service worker tối thiểu: giúp mở lại ứng dụng khi ngoại tuyến.
 * - Chỉ cache GET cùng nguồn (giao diện). KHÔNG cache lời gọi API/Supabase/Google và không bao giờ lưu dữ liệu tài chính ở đây
 *   (dữ liệu nằm trong IndexedDB).
 * - Điều hướng: ưu tiên mạng, rơi về bản đã cache khi mất mạng. Tài nguyên băm tên: ưu tiên cache. */
const CACHE = 'gomke-fin-shell-v1';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); return r; }).catch(() => caches.match('/')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return r; })));
});
