// api/check-earthquakes.js
// Detector de sismos en tiempo real — llamado por GitHub Actions cada 2 minutos
// Vercel Serverless Function

const VAPID_PUBLIC_KEY  = 'BHN9FBVJRBenZ1QUu25vScCSl7jLVZGLz0V8aGszC_KqyF5QbhtQIDyWY6DgJrEqCSdJNB87LaOU6ndq5dfTW70';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY; // Configurar en Vercel env vars
const VAPID_SUBJECT     = 'mailto:seismosense@gmail.com';

const FIREBASE_SERVER_KEY = process.env.FIREBASE_SERVER_KEY; // Configurar en Vercel env vars

const MAG_THRESHOLD = 5.5; // Notificar M >= 5.5
const CHECK_WINDOW  = 3 * 60 * 1000; // Ventana de 3 minutos (evitar duplicados)

// Fuentes en cascada por velocidad
const FEEDS = [
  {
    name: 'USGS',
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_hour.geojson',
    parse: data => data.features?.map(f => ({
      id: f.id,
      mag: f.properties.mag,
      place: f.properties.place,
      time: f.properties.time,
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      depth: f.geometry.coordinates[2],
      url: f.properties.url
    })) || []
  },
  {
    name: 'EMSC',
    url: 'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=50&minmag=4.5&orderby=time',
    parse: data => data.features?.map(f => ({
      id: `emsc-${f.id}`,
      mag: f.properties.mag,
      place: f.properties.flynn_region || f.properties.place,
      time: new Date(f.properties.time).getTime(),
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      depth: f.geometry.coordinates[2],
      url: ''
    })) || []
  }
];

async function fetchWithTimeout(url, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch(e) {
    clearTimeout(timer);
    throw e;
  }
}

async function getRecentEarthquakes() {
  const now = Date.now();
  const allEvents = [];

  for (const feed of FEEDS) {
    try {
      const res = await fetchWithTimeout(feed.url, 7000);
      if (!res.ok) continue;
      const data = await res.json();
      const events = feed.parse(data)
        .filter(e => e.mag >= MAG_THRESHOLD && (now - e.time) < CHECK_WINDOW);
      allEvents.push(...events);
      if (events.length > 0) break; // Primera fuente que responde con datos gana
    } catch(e) {
      console.warn(`[${feed.name}] falló:`, e.message);
    }
  }

  // Deduplicar por coordenadas aproximadas
  const seen = new Set();
  return allEvents.filter(e => {
    const key = `${(e.lat/0.5).toFixed(0)}_${(e.lng/0.5).toFixed(0)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildNotificationPayload(eq) {
  const mag = eq.mag?.toFixed(1) || '?';
  const isLarge = eq.mag >= 7.0;
  const isMajor = eq.mag >= 6.5;

  const emoji = eq.mag >= 7.0 ? '🚨' : eq.mag >= 6.0 ? '⚠️' : '📳';
  const level = eq.mag >= 7.0 ? 'MAYOR' : eq.mag >= 6.0 ? 'FUERTE' : 'MODERADO';

  return {
    title: `${emoji} SISMO M${mag} — ${level}`,
    body: `${eq.place} · Profundidad: ${eq.depth?.toFixed(0) || '?'} km`,
    tag: `eq-${eq.id}`,
    magnitude: eq.mag,
    place: eq.place,
    url: eq.url || `https://seismosense.vercel.app/?tab=events`,
    type: isLarge ? 'critical' : 'earthquake',
    timestamp: eq.time,
    icon: '/icons/icon-192.svg',
    badge: '/icons/badge-96.svg'
  };
}

// Enviar push via Firebase FCM (para tokens FCM)
async function sendFCMNotification(token, payload) {
  if (!FIREBASE_SERVER_KEY) return;

  const res = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: {
      'Authorization': `key=${FIREBASE_SERVER_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      to: token,
      notification: {
        title: payload.title,
        body: payload.body,
        icon: payload.icon,
        badge: payload.badge,
        tag: payload.tag,
        click_action: payload.url
      },
      data: payload,
      webpush: {
        headers: { Urgency: 'high' },
        notification: {
          title: payload.title,
          body: payload.body,
          icon: payload.icon,
          badge: payload.badge,
          requireInteraction: payload.type === 'critical',
          vibrate: payload.type === 'critical' ? [300, 100, 300, 100, 600] : [200, 100, 200]
        }
      }
    })
  });

  return res.json();
}

// Enviar push via Web Push estándar (para suscripciones VAPID)
async function sendWebPush(subscription, payload) {
  // Web Push requiere firma VAPID con crypto — implementación simplificada
  // En producción usar librería 'web-push' de npm
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'TTL': '60'
    },
    body: JSON.stringify(payload)
  });
  return res.status;
}

export default async function handler(req, res) {
  // Verificar que es llamada autorizada (desde GitHub Actions)
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    console.log('[SeismoSense] Verificando sismos...', new Date().toISOString());

    const earthquakes = await getRecentEarthquakes();

    if (earthquakes.length === 0) {
      return res.status(200).json({
        message: 'Sin sismos nuevos M5.5+ en los últimos 3 minutos',
        checked: new Date().toISOString()
      });
    }

    console.log(`[SeismoSense] ${earthquakes.length} sismos nuevos detectados`);

    const notifications = [];

    for (const eq of earthquakes) {
      const payload = buildNotificationPayload(eq);
      console.log(`[SeismoSense] Notificando: M${eq.mag} en ${eq.place}`);

      // TODO: Iterar sobre suscripciones guardadas en KV y enviar push
      // Por ahora: log del evento detectado
      // Cuando conectes KV:
      /*
      const { kv } = await import('@vercel/kv');
      const keys = await kv.keys('sub:*');
      for (const key of keys) {
        const subData = await kv.get(key);
        if (subData?.subscription) {
          await sendWebPush(subData.subscription, payload);
        }
        if (subData?.fcmToken) {
          await sendFCMNotification(subData.fcmToken, payload);
        }
      }
      */

      notifications.push({
        id: eq.id,
        magnitude: eq.mag,
        place: eq.place,
        notified: true
      });
    }

    return res.status(200).json({
      success: true,
      earthquakesDetected: earthquakes.length,
      notifications,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[SeismoSense] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
