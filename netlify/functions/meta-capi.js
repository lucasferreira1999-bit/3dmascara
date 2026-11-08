const https = require('https');
const crypto = require('crypto');

const META_PIXEL_ID = process.env.META_PIXEL_ID || '738539432587340';
const META_ACCESS_TOKEN_B64 = 'RUFBVEdJaDh1SGtRQlN6a05YNXVpemJvOWhLNUdONGxRcnhmeEVObVZDWVFRZFpDdVpCS0VPZzE2TXpaQ1hiOGE4QXdIdHlIUHlJSjYwdkpybGJZVm84OWdMVzB2YlhwS0pHUEFueWlEOUhJeWtFRHg3SlBXMWR1WUIzbU54dGc2M0RnQnplT1lHUm55U2RLMFpDaVpCaXlBeFhGaWVkWkNMM2dRMHFyWEw1dDlDQlpBM3lkVHJpdURZQzdpN1doZHdaRFpE';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || Buffer.from(META_ACCESS_TOKEN_B64, 'base64').toString('utf8');

function hashMeta(val) {
  if (!val) return undefined;
  const clean = String(val).trim().toLowerCase();
  if (!clean) return undefined;
  return crypto.createHash('sha256').update(clean).digest('hex');
}

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const clientIp = (event.headers['x-forwarded-for'] || event.headers['client-ip'] || '127.0.0.1').split(',')[0].trim();
    const userAgent = event.headers['user-agent'] || 'Mozilla/5.0';

    const eventData = {
      event_name: payload.event_name || 'PageView',
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      user_data: {
        client_ip_address: clientIp,
        client_user_agent: userAgent,
        em: payload.email ? [hashMeta(payload.email)] : undefined,
        ph: payload.phone ? [hashMeta(payload.phone)] : undefined,
        fn: payload.name ? [hashMeta(payload.name.split(' ')[0])] : undefined,
        zp: payload.cep ? [hashMeta(payload.cep)] : undefined,
        country: [hashMeta('br')]
      },
      custom_data: payload.custom_data || { currency: 'BRL', value: payload.value || 29.90 }
    };

    const postData = JSON.stringify({ data: [eventData] });

    await new Promise((resolve) => {
      const req = https.request({
        hostname: 'graph.facebook.com',
        port: 443,
        path: `/v19.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        resolve();
      });
      req.on('error', () => resolve());
      req.write(postData);
      req.end();
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
