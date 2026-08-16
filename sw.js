/* Cricket Connect service worker.
   Strategy: stale-while-revalidate for our own files, so the app opens
   instantly and works with no signal at the ground, while still picking up
   new versions in the background.

   After you deploy a change, bump VERSION so phones fetch the new files. */

const VERSION = 'v22';
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
  './team-logos.js',
  './broadcast-events.js',
  './overlays.js',
  './recorder.js',
  './privacy.html',
  './supabase-config.js',
  './firebase-messaging-config.js',
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

/* ---------------- push notifications ----------------
   Deliberately no Firebase SDK loaded in here — once a browser has an FCM
   registration token (obtained in app.js via firebase/messaging, see
   initPushNotifications), the actual delivery to this service worker is
   just the standard Web Push API. `event.data` is exactly the payload
   built server-side in supabase/functions/_shared/fcm.ts's sendToDevice():
   { notification: {title, body, image}, data: {notification_id, deep_link} }.
   This app's *own* SW (this file) already controls the whole origin (see
   the registration in index.html), so there's no separate
   firebase-messaging-sw.js to keep in sync — one service worker, one place
   this logic lives. */
self.addEventListener('push', (event)=>{
  if(!event.data) return;
  let payload;
  try{ payload = event.data.json(); }
  catch(e){ payload = { notification: { title: 'Cricket Connect', body: event.data.text() } }; }

  const n = payload.notification || {};
  const data = payload.data || {};
  const title = n.title || 'Cricket Connect';
  const options = {
    body: n.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    image: n.image || undefined,
    data: { deepLink: data.deep_link || './index.html', notificationId: data.notification_id || null },
    tag: data.notification_id || undefined,  // replaces, rather than stacks, a re-delivered copy of the same notification
    renotify: !!data.notification_id
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/* Focuses an already-open tab and hands it the deep link if one exists
   (index.html's own boot() picks up ?tour=/?player=/?go=notifications the
   same way it already handles every other deep link — nothing new to teach
   it), otherwise opens a fresh one. Never opens a link this service worker
   didn't itself construct from the push payload above. */
self.addEventListener('notificationclick', (event)=>{
  event.notification.close();
  const deepLink = (event.notification.data && event.notification.data.deepLink) || './index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients)=>{
      for(const client of clients){
        if('focus' in client){
          client.focus();
          if('navigate' in client) client.navigate(deepLink).catch(()=>{});
          return;
        }
      }
      return self.clients.openWindow(deepLink);
    })
  );
});
