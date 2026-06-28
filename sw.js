// SeismoSense Service Worker v2.0
// Push notifications reales via Firebase FCM + Web Push API

const CACHE_NAME = 'seismosense-v2';
const VAPID_PUBLIC_KEY = 'BHN9FBVJRBenZ1QUu25vScCSl7jLVZGLz0V8aGszC_KqyF5QbhtQIDyWY6DgJrEqCSdJNB87LaOU6ndq5dfTW70';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// ── Install ──
self.addEventListener('install', event => {
  console.log('[SW] Instalando v2.0...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: Network-first con fallback ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // APIs sísmicas: siempre red
  if (url.hostname.includes('earthquake.usgs.gov') ||
      url.hostname.includes('seismicportal.eu') ||
      url.hostname.includes('ingv.it')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ features: [], error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Tiles de mapa: cache-first
  if (url.hostname.includes('carto') || url.hostname.includes('openstreetmap')) {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return res;
        })
      )
    );
    return;
  }

  // Resto: network-first
  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

// ══════════════════════════════════════════════════════
//  PUSH NOTIFICATIONS — Firebase FCM + Web Push
// ══════════════════════════════════════════════════════

self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: '⚠ SeismoSense', body: event.data.text(), type: 'earthquake' }; }

  const isLarge = (payload.magnitude || 0) >= 6.5;
  const isCritical = (payload.magnitude || 0) >= 7.0 || payload.type === 'critical';

  const options = {
    body: payload.body || payload.place || 'Actividad sísmica detectada',
    icon: '/icons/icon-192.svg',
    badge: '/icons/badge-96.svg',
    tag: payload.tag || `eq-${Date.now()}`,
    renotify: true,
    requireInteraction: isCritical,
    silent: false,
    vibrate: isCritical
      ? [300, 100, 300, 100, 600, 100, 600]
      : isLarge
        ? [200, 100, 200, 100, 400]
        : [200, 100, 200],
    data: {
      url: payload.url || '/?tab=events',
      magnitude: payload.magnitude,
      place: payload.place,
      zone: payload.zone,
      probability: payload.probability,
      timestamp: Date.now()
    },
    actions: [
      { action: 'view', title: '🗺 Ver en mapa' },
      { action: 'dismiss', title: 'Cerrar' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || '⚠ Alerta Sísmica — SeismoSense', options)
  );
});

// ── Click en notificación ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'NAVIGATE', url: targetUrl, data: event.notification.data });
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── Mensajes desde la app ──
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();

  if (event.data?.type === 'SUBSCRIBE_PUSH') {
    // La app pide suscripción — devolver el endpoint
    self.registration.pushManager.getSubscription().then(sub => {
      event.ports[0]?.postMessage({ subscription: sub ? sub.toJSON() : null });
    });
  }

  if (event.data?.type === 'TEST_NOTIFICATION') {
    // Verificar que no se haya enviado ya en los últimos 10 segundos
    const now = Date.now();
    if (self._lastTestNotif && (now - self._lastTestNotif) < 10000) return;
    self._lastTestNotif = now;

    self.registration.showNotification('🌍 SeismoSense — Alertas activadas', {
      body: 'Recibirás notificaciones de sismos M5.5+ en tiempo real, aunque el celular esté bloqueado.',
      icon: '/icons/icon-192.svg',
      badge: '/icons/badge-96.svg',
      tag: 'seismosense-test', // tag único evita duplicados
      vibrate: [200, 100, 200],
      data: { url: '/' }
    });
  }
});
