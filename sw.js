// SeismoSense Service Worker v1.0
// Maneja: cache offline, notificaciones push, background sync

const CACHE_NAME = 'seismosense-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
];

// Umbrales para notificaciones automáticas
const ALERT_THRESHOLDS = {
  magnitude: 5.5,      // Notificar sismos M >= 5.5
  probability: 0.60,   // Notificar zonas con prob >= 60%
  checkInterval: 300   // Segundos entre chequeos (5 min)
};

// ── Install: cachear assets estáticos ──
self.addEventListener('install', event => {
  console.log('[SW] Instalando SeismoSense...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS.filter(url => !url.startsWith('http')));
    }).then(() => {
      console.log('[SW] Cache inicial listo');
      return self.skipWaiting();
    })
  );
});

// ── Activate: limpiar caches viejos ──
self.addEventListener('activate', event => {
  console.log('[SW] Activando...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// ── Fetch: estrategia Network-First con fallback a cache ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // USGS API: siempre red (datos en tiempo real)
  if (url.hostname.includes('earthquake.usgs.gov')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ features: [], error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Tiles de mapa: cache primero
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Resto: network-first
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── Push Notifications (Firebase) ──
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: '⚠ SeismoSense',
      body: event.data.text(),
      risk: 'moderate'
    };
  }

  const riskColors = {
    low: '#2ecc71',
    moderate: '#f39c12',
    high: '#e67e22',
    critical: '#e74c3c',
    extreme: '#9b59b6'
  };

  const options = {
    body: payload.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: payload.tag || 'seismosense-alert',
    renotify: true,
    requireInteraction: payload.risk === 'critical' || payload.risk === 'extreme',
    vibrate: payload.risk === 'critical' ? [200, 100, 200, 100, 400] : [200, 100, 200],
    data: {
      url: payload.url || '/',
      zone: payload.zone,
      probability: payload.probability,
      magnitude: payload.magnitude,
      timestamp: Date.now()
    },
    actions: [
      { action: 'view', title: '🗺 Ver mapa' },
      { action: 'dismiss', title: 'Cerrar' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || '⚠ Alerta Sísmica', options)
  );
});

// ── Notification click ──
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Si ya hay una ventana abierta, enfocarla
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'NAVIGATE', url, data: event.notification.data });
          return client.focus();
        }
      }
      // Si no, abrir nueva ventana
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Background Sync: chequeo periódico de alertas ──
self.addEventListener('periodicsync', event => {
  if (event.tag === 'seismosense-check') {
    event.waitUntil(checkForAlerts());
  }
});

async function checkForAlerts() {
  try {
    const res = await fetch(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_hour.geojson'
    );
    const data = await res.json();
    const significant = data.features.filter(eq =>
      (eq.properties.mag || 0) >= ALERT_THRESHOLDS.magnitude
    );

    for (const eq of significant) {
      const mag = eq.properties.mag;
      const place = eq.properties.place || 'Ubicación desconocida';
      const isLarge = mag >= 6.5;

      await self.registration.showNotification(
        isLarge ? `🚨 SISMO M${mag.toFixed(1)} DETECTADO` : `⚠ Sismo M${mag.toFixed(1)}`,
        {
          body: place,
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-96.png',
          tag: `eq-${eq.id}`,
          vibrate: isLarge ? [300, 100, 300, 100, 600] : [200, 100, 200],
          requireInteraction: isLarge,
          data: { url: '/?tab=events', magnitude: mag }
        }
      );
    }
  } catch(e) {
    console.log('[SW] Background check failed:', e.message);
  }
}

// ── Mensaje desde la app principal ──
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data?.type === 'SEND_TEST_NOTIFICATION') {
    self.registration.showNotification('🧪 SeismoSense — Prueba', {
      body: 'Las notificaciones están funcionando correctamente.',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      vibrate: [200, 100, 200]
    });
  }
});
