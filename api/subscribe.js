// api/subscribe.js
// Recibe token FCM y suscribe al topic earthquakes-global

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

  const data = await tokenRes.json();
  return data.access_token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { fcmToken, subscription, zone, lang } = req.body;

    console.log('[Subscribe] Nueva suscripción recibida', {
      hasFcmToken: !!fcmToken,
      hasSubscription: !!subscription,
      zone, lang
    });

    if (!fcmToken) {
      return res.status(400).json({ 
        error: 'Se requiere fcmToken',
        note: 'Sin token FCM no se puede suscribir al topic'
      });
    }

    // Obtener service account
    const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountStr) {
      return res.status(500).json({ error: 'FIREBASE_SERVICE_ACCOUNT no configurado' });
    }

    const serviceAccount = JSON.parse(serviceAccountStr);
    const accessToken = await getFirebaseAccessToken(serviceAccount);

    // Suscribir token al topic earthquakes-global
    const topicRes = await fetch(
      `https://iid.googleapis.com/iid/v1/${fcmToken}/rel/topics/earthquakes-global`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'access_token_auth': 'true'
        }
      }
    );

    const topicResult = await topicRes.json();
    console.log('[Subscribe] Topic subscription result:', JSON.stringify(topicResult));

    // Si falla con IID, intentar con batch subscribe
    if (!topicRes.ok) {
      console.log('[Subscribe] IID falló, intentando batch...');
      const batchRes = await fetch(
        'https://fcm.googleapis.com/fcm/send',
        {
          method: 'POST', 
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            registration_ids: [fcmToken],
            condition: "'earthquakes-global' in topics"
          })
        }
      );
      console.log('[Subscribe] Batch result:', batchRes.status);
    }

    return res.status(200).json({
      success: true,
      message: 'Suscrito al topic earthquakes-global',
      topic: 'earthquakes-global',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Subscribe] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
