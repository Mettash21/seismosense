// api/check-earthquakes.js
// Detector de sismos — llamado por GitHub Actions cada 5 minutos
// Usa Firebase Admin SDK V1 con Service Account

const MAG_THRESHOLD = 5.5;
const CHECK_WINDOW  = 6 * 60 * 1000; // 6 minutos

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
  } catch(e) { clearTimeout(timer); throw e; }
}

// Obtener access token OAuth2 para Firebase V1 API
async function getFirebaseAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  
  // Crear JWT manualmente (sin librerías externas)
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  const payload = btoa(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  // Importar clave privada
  const privateKeyPem = serviceAccount.private_key;
  const pemContents = privateKeyPem.replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '').replace(/\n/g, '');
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signingInput}.${sig}`;

  // Intercambiar JWT por access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// Enviar notificación FCM V1
async function sendFCMV1(accessToken, projectId, topic, payload) {
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  
  const message = {
    message: {
      topic: topic, // 'earthquakes-global' o 'earthquakes-{region}'
      notification: {
        title: payload.title,
        body: payload.body
      },
      webpush: {
        headers: { Urgency: 'high' },
        notification: {
          title: payload.title,
          body: payload.body,
          icon: 'https://seismosense.vercel.app/icons/icon-192.svg',
          badge: 'https://seismosense.vercel.app/icons/badge-96.svg',
          requireInteraction: payload.critical || false,
          vibrate: payload.critical ? [300, 100, 300, 100, 600] : [200, 100, 200],
          tag: payload.tag,
          data: {
            url: payload.url || 'https://seismosense.vercel.app/?tab=events',
            magnitude: String(payload.magnitude || ''),
            place: payload.place || ''
          }
        },
        fcm_options: {
          link: payload.url || 'https://seismosense.vercel.app/?tab=events'
        }
      },
      data: {
        magnitude: String(payload.magnitude || ''),
        place: payload.place || '',
        url: payload.url || 'https://seismosense.vercel.app/?tab=events',
        tag: payload.tag || 'earthquake'
      }
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(message)
  });

  const result = await res.json();
  console.log('[FCM V1] Resultado:', JSON.stringify(result));
  return result;
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
      if (events.length > 0) {
        allEvents.push(...events);
        console.log(`[${feed.name}] ${events.length} eventos nuevos M${MAG_THRESHOLD}+`);
        break;
      }
    } catch(e) {
      console.warn(`[${feed.name}] falló:`, e.message);
    }
  }

  // Deduplicar
  const seen = new Set();
  return allEvents.filter(e => {
    const key = `${(e.lat/0.5).toFixed(0)}_${(e.lng/0.5).toFixed(0)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default async function handler(req, res) {
  // Verificar autorización
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    console.log('[SeismoSense] Verificando sismos...', new Date().toISOString());

    const earthquakes = await getRecentEarthquakes();

    if (earthquakes.length === 0) {
      return res.status(200).json({
        message: `Sin sismos nuevos M${MAG_THRESHOLD}+`,
        checked: new Date().toISOString()
      });
    }

    console.log(`[SeismoSense] ${earthquakes.length} sismos nuevos detectados`);

    // Obtener service account
    const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountStr) {
      console.warn('[SeismoSense] FIREBASE_SERVICE_ACCOUNT no configurado');
      return res.status(200).json({
        earthquakesDetected: earthquakes.length,
        earthquakes: earthquakes.map(e => ({ mag: e.mag, place: e.place })),
        warning: 'Firebase no configurado — sismos detectados pero no notificados'
      });
    }

    const serviceAccount = JSON.parse(serviceAccountStr);
    const accessToken = await getFirebaseAccessToken(serviceAccount);

    const results = [];

    for (const eq of earthquakes) {
      const mag = eq.mag?.toFixed(1) || '?';
      const isLarge = eq.mag >= 7.0;
      const emoji = eq.mag >= 7.0 ? '🚨' : eq.mag >= 6.0 ? '⚠️' : '📳';

      const payload = {
        title: `${emoji} Sismo M${mag} detectado`,
        body: `${eq.place} · Prof: ${eq.depth?.toFixed(0) || '?'}km`,
        tag: `eq-${eq.id}`,
        magnitude: eq.mag,
        place: eq.place,
        url: eq.url || 'https://seismosense.vercel.app/?tab=events',
        critical: isLarge
      };

      // Enviar a topic global — todos los suscriptores reciben
      const result = await sendFCMV1(
        accessToken,
        serviceAccount.project_id,
        'earthquakes-global',
        payload
      );

      results.push({ id: eq.id, mag: eq.mag, place: eq.place, fcm: result });
    }

    return res.status(200).json({
      success: true,
      earthquakesDetected: earthquakes.length,
      results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[SeismoSense] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
