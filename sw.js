/*
 * Service worker: приложение работает без интернета.
 * Стратегия: файлы приложения отдаются только из кэша своей версии (мгновенный запуск офлайн,
 * все файлы — гарантированно одной версии). Новая версия скачивается целиком при установке
 * нового service worker'а, затем у пользователя появляется плашка «Обновить».
 * (Фоновое обновление отдельных файлов в текущем кэше не используется: оно приводило
 * к смешиванию файлов разных версий, например новый index.html со старым app.js.)
 *
 * !!! При каждой публикации изменённых файлов увеличьте VERSION — иначе пользователи
 *     не получат обновление. Список ASSETS должен содержать все файлы приложения.
 */
var VERSION = 'v3.1.1';
var CACHE = 'food-diary-' + VERSION;

// Все пути относительные — работает и в подпапке (например, /food-diary/ на GitHub Pages)
var ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'css/photo.css',
  'js/foods.js',
  'js/search.js',
  'js/storage.js',
  'js/sync.js',
  'js/charts.js',
  'js/ai.js',
  'js/photo.js',
  'js/app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  // Новую версию не активируем сразу: пользователь сам нажмёт «Обновить».
  // cache: 'reload' — мимо HTTP-кэша браузера (GitHub Pages кэширует файлы на 10 минут),
  // иначе в кэш новой версии могли попасть старые файлы.
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(ASSETS.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf('food-diary-') === 0 && k !== CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Переходы по страницам приложения — всегда index.html этой версии
  var isNav = req.mode === 'navigate';
  var key = isNav ? 'index.html' : req;

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(key, { ignoreSearch: true }).then(function (cached) {
        // нет в кэше (чужой файл или кэш очищен) — просто сеть, без записи в кэш версии
        return cached || fetch(req);
      });
    })
  );
});
