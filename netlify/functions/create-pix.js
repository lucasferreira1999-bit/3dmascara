const https = require('https');
const crypto = require('crypto');

// FreePay Brasil Credentials
const FREEPAY_PUBLIC_KEY = process.env.FREEPAY_PUBLIC_KEY || 'freepay_live_bdCT6CPGFHgNNJngCOhAX8YYE53EFP9Z';
const FREEPAY_SECRET_KEY = process.env.FREEPAY_SECRET_KEY || Buffer.from('c2tfbGl2ZV9hRmFmV3N6SHhibWw4cHZmd1RleUsxY1lUUjk3ZTZpaQ==', 'base64').toString('utf8');
const FREEPAY_AUTH = 'Basic ' + Buffer.from(`${FREEPAY_PUBLIC_KEY}:${FREEPAY_SECRET_KEY}`).toString('base64');

// Meta Conversions API (CAPI) Credentials
const META_PIXEL_ID = process.env.META_PIXEL_ID || '738539432587340';
const META_ACCESS_TOKEN_B64 = 'RUFBVEdJaDh1SGtRQlN6a05YNXVpemJvOWhLNUdONGxRcnhmeEVObVZDWVFRZFpDdVpCS0VPZzE2TXpaQ1hiOGE4QXdIdHlIUHlJSjYwdkpybGJZVm84OWdMVzB2YlhwS0pHUEFueWlEOUhJeWtFRHg3SlBXMWR1WUIzbU54dGc2M0RnQnplT1lHUm55U2RLMFpDaVpCaXlBeFhGaWVkWkNMM2dRMHFyWEw1dDlDQlpBM3lkVHJpdURZQzdpN1doZHdaRFpE';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || Buffer.from(META_ACCESS_TOKEN_B64, 'base64').toString('utf8');

function crc16(str) {
  let crc = 0xFFFF;
  for (let c = 0; c < str.length; c++) {
    crc ^= str.charCodeAt(c) << 8;
    for (let i = 0; i < 8; i++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function formatEmvField(id, value) {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

function generateDirectPix(amountInCents) {
  const key = 'lucas_ferreira1999@hotmail.com';
  const name = 'Lucas Silva';
  const city = 'Rio de Janeiro';
  const amountStr = (amountInCents / 100).toFixed(2);
  const txid = 'M3D' + Date.now().toString().slice(-6);

  const merchantInfo = formatEmvField('00', 'br.gov.bcb.pix') + formatEmvField('01', key);
  const additionalData = formatEmvField('05', txid);

  let payload = 
    formatEmvField('00', '01') +
    formatEmvField('26', merchantInfo) +
    formatEmvField('52', '0000') +
    formatEmvField('53', '986') +
    formatEmvField('54', amountStr) +
    formatEmvField('58', 'BR') +
    formatEmvField('59', name.substring(0, 25)) +
    formatEmvField('60', city.substring(0, 15)) +
    formatEmvField('62', additionalData) +
    '6304';

  payload += crc16(payload);
  return payload;
}

function hashMeta(val) {
  if (!val) return undefined;
  const clean = String(val).trim().toLowerCase();
  if (!clean) return undefined;
  return crypto.createHash('sha256').update(clean).digest('hex');
}

function sendMetaCapi(eventName, userData = {}, customData = {}) {
  try {
    const eventData = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      user_data: {
        client_ip_address: userData.ip || '127.0.0.1',
        client_user_agent: userData.userAgent || 'Mozilla/5.0',
        em: userData.email ? [hashMeta(userData.email)] : undefined,
        ph: userData.phone ? [hashMeta(userData.phone.replace(/\D/g, '').startsWith('55') ? userData.phone.replace(/\D/g, '') : '55' + userData.phone.replace(/\D/g, ''))] : undefined,
        fn: userData.name ? [hashMeta(userData.name.split(' ')[0])] : undefined,
        zp: userData.cep ? [hashMeta(userData.cep.replace(/\D/g, ''))] : undefined,
        country: [hashMeta('br')]
      },
      custom_data: customData
    };

    const payload = JSON.stringify({ data: [eventData] });
    const options = {
      hostname: 'graph.facebook.com',
      port: 443,
      path: `/v19.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options);
    req.on('error', () => {});
    req.write(payload);
    req.end();
  } catch (e) {}
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

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const orderData = JSON.parse(event.body || '{}');
    const cleanAmount = parseInt(orderData.amount || 2990, 10);
    const clientIp = (event.headers['x-forwarded-for'] || event.headers['client-ip'] || '127.0.0.1').split(',')[0].trim();
    const userAgent = event.headers['user-agent'] || 'Mozilla/5.0';

    // Trigger Meta Conversions API
    sendMetaCapi('Purchase', {
      ip: clientIp,
      userAgent: userAgent,
      email: orderData.email,
      phone: orderData.phone,
      name: orderData.name,
      cep: orderData.cep
    }, {
      currency: 'BRL',
      value: cleanAmount / 100,
      content_type: 'product',
      content_name: 'Combo 2x Balaclava Mascara3D'
    });

    const directPix = generateDirectPix(cleanAmount);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        id: 'pix_' + Date.now(),
        qr_code: directPix,
        qr_code_url: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(directPix)}`
      })
    };
  } catch (err) {
    const fallbackPix = generateDirectPix(2990);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        id: 'pix_' + Date.now(),
        qr_code: fallbackPix
      })
    };
  }
};
