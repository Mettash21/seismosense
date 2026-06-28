// api/subscribe.js
// Recibe y guarda suscripciones push de usuarios
// Vercel Serverless Function — gratis en Hobby plan

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { subscription, zone, lang } = req.body;

    if (!subscription?.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }

    // Guardar en Vercel KV (gratis hasta 256MB)
    // Por ahora: log + respuesta OK
    // Cuando conectes KV, descomentar el bloque de abajo
    console.log('[Subscribe] Nueva suscripción:', {
      endpoint: subscription.endpoint.substring(0, 50) + '...',
      zone: zone || 'global',
      lang: lang || 'es',
      timestamp: new Date().toISOString()
    });

    /* 
    // TODO: Conectar Vercel KV
    const { kv } = await import('@vercel/kv');
    const key = `sub:${Buffer.from(subscription.endpoint).toString('base64').substring(0, 32)}`;
    await kv.set(key, JSON.stringify({ subscription, zone, lang, created: Date.now() }), { ex: 60 * 60 * 24 * 365 });
    */

    return res.status(200).json({ 
      success: true, 
      message: 'Suscripción registrada correctamente' 
    });

  } catch (error) {
    console.error('[Subscribe] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
