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
    const cleanCpf = (orderData.cpf || '').replace(/\D/g, '') || '11144477735';
    const rawPhone = (orderData.phone || '').replace(/\D/g, '');
    const cleanPhone = rawPhone.length >= 10 ? (rawPhone.startsWith('55') ? '+' + rawPhone : '+55' + rawPhone) : '+5511999998888';
    const clientIp = (event.headers['x-forwarded-for'] || event.headers['client-ip'] || '127.0.0.1').split(',')[0].trim();
    const userAgent = event.headers['user-agent'] || 'Mozilla/5.0';

    // Disparar Meta Conversions API (CAPI)
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

    // Enviar requisição real para a FreePay Brasil API
    const freePayPayload = JSON.stringify({
      amount: cleanAmount,
      payment_method: 'pix',
      postback_url: 'https://3dmascara.netlify.app/api/webhook',
      customer: {
        name: orderData.name || 'Cliente Mascara3D',
        email: orderData.email || 'contato@mascara3d.com.br',
        phone: cleanPhone,
        document: {
          type: 'cpf',
          number: cleanCpf
        }
      },
      items: [
        {
          title: 'Combo 2x Mascara 3D Realista',
          unit_price: cleanAmount,
          quantity: 1,
          tangible: true
        }
      ],
      pix: {
        expires_in_days: 1
      },
      metadata: {
        provider_name: 'Mascara3D',
        order_id: 'ORDER-' + Date.now()
      },
      ip: clientIp
    });

    const freePayResponse = await new Promise((resolve, reject) => {
      const fpReq = https.request('https://api.freepaybrasil.com/v1/payment-transaction/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': FREEPAY_AUTH,
          'Content-Length': Buffer.byteLength(freePayPayload)
        }
      }, res => {
        let respData = '';
        res.on('data', d => respData += d);
        res.on('end', () => resolve({ statusCode: res.statusCode, body: respData }));
      });

      fpReq.on('error', err => reject(err));
      fpReq.write(freePayPayload);
      fpReq.end();
    });

    let json = {};
    try {
      json = JSON.parse(freePayResponse.body);
    } catch (e) {
      json = { raw: freePayResponse.body };
    }

    // Se a FreePay gerou a transação com sucesso:
    if (json.success && json.data && json.data.pix) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          gateway: 'freepay',
          id: json.data.id,
          amount: json.data.amount,
          qr_code: json.data.pix.qr_code,
          qr_code_url: json.data.pix.url || `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(json.data.pix.qr_code)}`,
          expiration_date: json.data.pix.expiration_date
        })
      };
    }

    // Se a FreePay retornou erro de adquirente ou validação:
    let errorDetail = 'Erro ao processar na FreePay';
    if (json.error_messages && json.error_messages.length) {
      errorDetail = json.error_messages[0].message || JSON.stringify(json.error_messages[0]);
    } else if (json.errors) {
      errorDetail = JSON.stringify(json.errors);
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        success: false,
        gateway: 'freepay',
        error: errorDetail,
        raw: json
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: err.message
      })
    };
  }
};
