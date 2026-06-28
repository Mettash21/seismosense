// api/test-notification.js
// Endpoint de prueba — manda notificación simulada via FCM V1
// Solo usar para testing, no en producción

async function getFirebaseAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);

  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const payload = btoa(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const pemContents = serviceAccount.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signingInput}.${sig}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Solo permitir en desarrollo o con secret — en producción cualquiera puede probar
  // pero solo manda al topic earthquakes-global (usuarios suscritos)

  try {
    const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountStr) {
      return res.status(500).json({ error: 'FIREBASE_SERVICE_ACCOUNT no configurado' });
    }

    const serviceAccount = JSON.parse(serviceAccountStr);
    const accessToken = await getFirebaseAccessToken(serviceAccount);

    // Sismo de prueba simulado
    const testEq = {
      mag: 6.2,
      place: '45 km SW de Manizales, Colombia [PRUEBA]',
      depth: 15,
      url: 'https://seismosense.vercel.app/?tab=events'
    };

    const message = {
      message: {
        topic: 'earthquakes-global',
        notification: {
          title: '⚠️ Sismo M6.2 detectado [PRUEBA]',
          body: `${testEq.place} · Prof: ${testEq.depth}km`
        },
        webpush: {
          headers: { Urgency: 'high' },
          notification: {
            title: '⚠️ Sismo M6.2 detectado [PRUEBA]',
            body: `${testEq.place} · Prof: ${testEq.depth}km`,
            icon: 'https://seismosense.vercel.app/icons/icon-192.png',
            badge: 'https://seismosense.vercel.app/icons/badge-96.png',
            tag: 'test-earthquake',
            requireInteraction: false,
            vibrate: [200, 100, 200]
          },
          fcm_options: {
            link: testEq.url
          }
        },
        data: {
          magnitude: '6.2',
          place: testEq.place,
          url: testEq.url,
          tag: 'test-earthquake'
        }
      }
    };

    const fcmRes = await fetch(
      `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
      }
    );

    const result = await fcmRes.json();
    console.log('[TEST] FCM result:', JSON.stringify(result));

    return res.status(200).json({
      success: true,
      message: 'Notificación de prueba enviada',
      fcm: result,
      timestamp: new Date().toISOString()
    });

  } catch(error) {
    console.error('[TEST] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
