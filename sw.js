// Service worker: permite instalar la app y abrirla sin conexión (red primero, caché de respaldo)
const CACHE = 'fotocaza-v2';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'osm.js', 'cloud.js', 'config.js', 'icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'api.github.com' || url.hostname.startsWith('overpass')) return; // siempre de la red
  // Archivos propios: siempre se comprueba si hay versión nueva (para que las actualizaciones lleguen enseguida)
  const peticion = url.origin === location.origin ? fetch(req.url, { cache: 'no-cache' }) : fetch(req);
  e.respondWith(
    peticion.then(res => {
      if (res.ok && (url.origin === location.origin || url.hostname === 'unpkg.com')) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
