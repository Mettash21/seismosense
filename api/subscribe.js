// api/subscribe.js
// Guarda token FCM + ubicación + preferencias del usuario en Upstash Redis
// Esto permite que el servidor mande alertas personalizadas por ubicación
// aunque la app esté completamente cerrada.

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisSet(key, value) {
  const res = await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
  return res.json();
}

async function redisSadd(setKey, member) {
  const res = await fetch(`${UPSTASH_URL}/sadd/${encodeURIComponent(setKey)}/${encodeURIComponent(member)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { fcmToken, lat, lng, notifType, notifMinMag, lang } = req.body;

    if (!fcmToken) {
      return res.status(400).json({ error: 'Se requiere fcmToken' });
    }

    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
      console.warn('[Subscribe] Upstash no configurado — guardando solo log');
      console.log('[Subscribe] Nueva suscripción (sin persistencia):', { fcmToken: fcmToken.substring(0,20), lat, lng, notifType, notifMinMag });
      return res.status(200).json({
        success: true,
        warning: 'Guardado sin persistencia — configura UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN para alertas server-side'
      });
    }

    // Guardar el perfil del suscriptor bajo su token
    const key = `sub:${fcmToken}`;
    const profile = {
      fcmToken,
      lat: lat ?? null,
      lng: lng ?? null,
      notifType: notifType || 'cercanos',
      notifMinMag: notifMinMag || 'auto',
      lang: lang || 'es',
      updated: Date.now()
    };

    await redisSet(key, JSON.stringify(profile));
    // Mantener un índice de todos los tokens registrados
    await redisSadd('subscribers:all', fcmToken);

    console.log(`[Subscribe] Guardado: ${fcmToken.substring(0,20)}... en (${lat}, ${lng}) tipo=${notifType}`);

    return res.status(200).json({
      success: true,
      message: 'Suscripción guardada — recibirás alertas server-side por tu ubicación'
    });

  } catch (error) {
    console.error('[Subscribe] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
