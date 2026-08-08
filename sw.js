/* Cricket Connect service worker.
   Strategy: stale-while-revalidate for our own files, so the app opens
   instantly and works with no signal at the ground, while still picking up
   new versions in the background.

   After you deploy a change, bump VERSION so phones fetch the new files. */

const VERSION = 'v11';
const CACHE = 'cricket-connect-' + VERSION;

const SHELL = [
  './',
  './index.html',
  './live.html',
  './styles.css',
  './app.js',
  './engine.js',
  './cloud.js',
  './tournament.js',
  './avatars.js',
  './stats.js',
  './social.js',
  './privacy.html',
  './supabase-config.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(c=>c.addAll(SHELL))
      .then(()=>self.skipWaiting())
      .catch(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k !== CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', (event)=>{
  const req = event.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache cross-origin traffic (Supabase auth/API/realtime) — it must
  // always hit the network.
  if(url.origin !== location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache)=>{
      const cached = await cache.match(req);
      const network = fetch(req).then(res=>{
        if(res && res.status === 200) cache.put(req, res.clone());
        return res;
      }).catch(()=>null);

      if(cached){
        event.waitUntil(network);   // refresh in the background
        return cached;
      }
      const res = await network;
      return res || new Response('Offline', { status: 503, statusText: 'Offline' });
    })
  );
});
