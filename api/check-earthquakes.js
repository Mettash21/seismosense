// api/check-earthquakes.js
// Detector de sismos — llamado por GitHub Actions cada 5 minutos
// Envía alertas PERSONALIZADAS por ubicación a cada suscriptor guardado en Redis,
// además de la alerta global M5.5+ vía topic.

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const GLOBAL_MAG_THRESHOLD = 5.5;
const CHECK_WINDOW = 8 * 60 * 1000; // 8 minutos — cubre el ciclo de 5 min + margen

const PROXIMITY_TIERS = [
  { maxDist: 50,  minMag: 3.0 },
  { maxDist: 150, minMag: 4.0 },
  { maxDist: 300, minMag: 5.0 },
  { maxDist: 700, minMag: 6.0 },
];

const NOTIF_TYPE_RADIUS = {
  cercanos: null,
  pais: 1200,
  continente: 4000,
  mundo: Infinity
};

const FEEDS = [
  {
    name: 'USGS',
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_hour.geojson',
    parse: data => data.features?.map(f => ({
      id: f.id, mag: f.properties.mag, place: f.properties.place, time: f.properties.time,
      lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], depth: f.geometry.coordinates[2],
      url: f.properties.url
    })) || []
  },
  {
    name: 'EMSC',
    url: 'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=100&minmag=2.5&orderby=time',
    parse: data => data.features?.map(f => ({
      id: `emsc-${f.id}`, mag: f.properties.mag, place: f.properties.flynn_region || f.properties.place,
      time: new Date(f.properties.time).getTime(),
      lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], depth: f.geometry.coordinates[2], url: ''
    })) || []
  }
];

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function fetchWithTimeout(url, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch(e) { clearTimeout(timer); throw e; }
}

async function getAllEarthquakes(minMag) {
  const now = Date.now();
  const all = [];
  for (const feed of FEEDS) {
    try {
      const res = await fetchWithTimeout(feed.url, 7000);
      if (!res.ok) continue;
      const data = await res.json();
      const events = feed.parse(data).filter(e => e.mag >= minMag && (now - e.time) < CHECK_WINDOW);
      all.push(...events);
    } catch(e) { console.warn(`[${feed.name}] falló:`, e.message); }
  }
  const seen = new Set();
  return all.filter(e => {
    const key = `${(e.lat/0.5).toFixed(0)}_${(e.lng/0.5).toFixed(0)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Redis (Upstash REST API) ──
async function redisGet(key) {
  const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function redisSmembers(setKey) {
  const res = await fetch(`${UPSTASH_URL}/smembers/${encodeURIComponent(setKey)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  const data = await res.json();
  return data.result || [];
}

async function getAllSubscribers() {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return [];
  const tokens = await redisSmembers('subscribers:all');
  const profiles = await Promise.all(
    tokens.map(async token => await redisGet(`sub:${token}`))
  );
  return profiles.filter(Boolean);
}

// ── Firebase Auth (JWT → access token) ──
async function getFirebaseAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const payload = btoa(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');

  const pemContents = serviceAccount.private_key.replace(/-----BEGIN PRIVATE KEY-----/,'').replace(/-----END PRIVATE KEY-----/,'').replace(/\n/g,'');
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const jwt = `${signingInput}.${sig}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// ── Enviar push a un token específico (personalizado) ──
async function sendFCMToToken(accessToken, projectId, token, payload) {
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const message = {
    message: {
      token: token,
      notification: { title: payload.title, body: payload.body },
      webpush: {
        headers: { Urgency: 'high' },
        notification: {
          title: payload.title, body: payload.body,
          icon: 'https://seismosense.vercel.app/icons/icon-192.png',
          badge: 'https://seismosense.vercel.app/icons/badge-96.png',
          requireInteraction: payload.critical || false,
          vibrate: payload.critical ? [300,100,300,100,600] : [300,100,300,100,300,100,600],
          tag: payload.tag,
          data: { url: payload.url }
        },
        fcm_options: { link: payload.url }
      },
      data: { magnitude: String(payload.magnitude||''), place: payload.place||'', url: payload.url, tag: payload.tag||'earthquake' }
    }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });
  return res.json();
}

// ── Enviar a topic global (M5.5+) ──
async function sendFCMToTopic(accessToken, projectId, topic, payload) {
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const message = {
    message: {
      topic,
      notification: { title: payload.title, body: payload.body },
      webpush: {
        headers: { Urgency: 'high' },
        notification: {
          title: payload.title, body: payload.body,
          icon: 'https://seismosense.vercel.app/icons/icon-192.png',
          badge: 'https://seismosense.vercel.app/icons/badge-96.png',
          requireInteraction: payload.critical || false,
          vibrate: payload.critical ? [300,100,300,100,600] : [200,100,200],
          tag: payload.tag
        },
        fcm_options: { link: payload.url }
      },
      data: { magnitude: String(payload.magnitude||''), place: payload.place||'', url: payload.url, tag: payload.tag||'earthquake' }
    }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });
  return res.json();
}

function buildPayload(eq) {
  const mag = eq.mag.toFixed(1);
  const isLarge = eq.mag >= 7.0;
  const emoji = eq.mag >= 7.0 ? '🚨' : eq.mag >= 6.0 ? '⚠️' : '📳';
  return {
    title: `${emoji} Sismo M${mag} detectado`,
    body: `${eq.place} · Prof: ${eq.depth?.toFixed(0)||'?'}km`,
    tag: `eq-${eq.id}`, magnitude: eq.mag, place: eq.place,
    url: 'https://seismosense.vercel.app/?tab=events',
    critical: isLarge
  };
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    console.log('[SeismoSense] Verificando sismos...', new Date().toISOString());

    // Traer TODOS los sismos M2.5+ recientes — el filtro personalizado decide quién recibe qué
    const allEarthquakes = await getAllEarthquakes(2.5);

    if (allEarthquakes.length === 0) {
      return res.status(200).json({ message: 'Sin sismos nuevos', checked: new Date().toISOString() });
    }

    console.log(`[SeismoSense] ${allEarthquakes.length} sismos M2.5+ detectados en los últimos 8 min`);

    const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountStr) {
      return res.status(200).json({ earthquakesDetected: allEarthquakes.length, warning: 'Firebase no configurado' });
    }
    const serviceAccount = JSON.parse(serviceAccountStr);
    const accessToken = await getFirebaseAccessToken(serviceAccount);

    let globalNotified = 0;
    let personalizedNotified = 0;

    // 1. Alerta global M5.5+ vía topic (todos los suscritos al topic reciben esto)
    const globalEvents = allEarthquakes.filter(e => e.mag >= GLOBAL_MAG_THRESHOLD);
    for (const eq of globalEvents) {
      await sendFCMToTopic(accessToken, serviceAccount.project_id, 'earthquakes-global', buildPayload(eq));
      globalNotified++;
    }

    // 2. Alertas PERSONALIZADAS por ubicación — funcionan con la app cerrada
    const subscribers = await getAllSubscribers();
    console.log(`[SeismoSense] ${subscribers.length} suscriptores con ubicación registrada`);

    for (const sub of subscribers) {
      if (sub.lat == null || sub.lng == null) continue;

      for (const eq of allEarthquakes) {
        const dist = haversine(eq.lat, eq.lng, sub.lat, sub.lng);
        let passes = false;

        if (sub.notifType === 'cercanos' || !sub.notifType) {
          if (sub.notifMinMag && sub.notifMinMag !== 'auto') {
            const tier = PROXIMITY_TIERS.find(t => dist <= t.maxDist);
            passes = !!tier && eq.mag >= parseFloat(sub.notifMinMag);
          } else {
            const tier = PROXIMITY_TIERS.find(t => dist <= t.maxDist);
            passes = !!tier && eq.mag >= tier.minMag;
          }
        } else {
          const radius = NOTIF_TYPE_RADIUS[sub.notifType] ?? 1200;
          const minMag = (sub.notifMinMag && sub.notifMinMag !== 'auto') ? parseFloat(sub.notifMinMag) : 4.5;
          passes = dist <= radius && eq.mag >= minMag;
        }

        // No duplicar la alerta global si ya calificó ahí y también aquí
        if (passes && eq.mag < GLOBAL_MAG_THRESHOLD) {
          try {
            await sendFCMToToken(accessToken, serviceAccount.project_id, sub.fcmToken, buildPayload(eq));
            personalizedNotified++;
          } catch(e) {
            console.warn('[SeismoSense] Push individual falló:', e.message);
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      earthquakesChecked: allEarthquakes.length,
      globalAlertsSent: globalNotified,
      personalizedAlertsSent: personalizedNotified,
      subscribersChecked: subscribers.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[SeismoSense] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
