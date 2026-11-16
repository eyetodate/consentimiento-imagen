/* Service worker: permite usar la app sin conexión.
 * Estrategia: responde desde la caché y actualiza en segundo plano
 * (la versión nueva se usa la siguiente vez que se abre la app). */
const CACHE = 'ci-imagen-v3';
const ARCHIVOS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'pdf.js',
  'zip.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ARCHIVOS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const clave = req.mode === 'navigate' ? 'index.html' : req;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const enCache = await cache.match(clave, { ignoreSearch: true });
      // 'no-cache' obliga a revalidar con el servidor para recibir siempre la última versión
      const red = fetch(typeof clave === 'string' ? clave : req.url, { cache: 'no-cache' })
        .then((resp) => {
          if (resp && resp.ok && resp.type === 'basic') cache.put(clave, resp.clone());
          return resp;
        })
        .catch(() => null);
      if (enCache) {
        e.waitUntil(red);
        return enCache;
      }
      const r = await red;
      return r || new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })
  );
});
