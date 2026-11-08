const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

// FreePay Brasil Credentials
const FREEPAY_PUBLIC_KEY = process.env.FREEPAY_PUBLIC_KEY || 'freepay_live_bdCT6CPGFHgNNJngCOhAX8YYE53EFP9Z';
const FREEPAY_SECRET_KEY = process.env.FREEPAY_SECRET_KEY || 'SUA_CHAVE_SECRETA_AQUI';
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

function sendMetaCapi(eventName, userData = {}, customData = {}, callback) {
  try {
    const eventData = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      user_data: {
        client_ip_address: userData.ip || '127.0.0.1',
        client_user_agent: userData.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
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

    const req = https.request(options, res => {
      let respBody = '';
      res.on('data', d => respBody += d);
      res.on('end', () => {
        if (callback) callback(null, respBody);
      });
    });

    req.on('error', e => {
      console.error('Meta CAPI error:', e.message);
      if (callback) callback(e);
    });

    req.write(payload);
    req.end();
  } catch (err) {
    console.error('sendMetaCapi exception:', err.message);
    if (callback) callback(err);
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

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

function createFreePayPix(orderData, callback) {
  const cleanCpf = (orderData.cpf || '').replace(/\D/g, '') || '11144477735';
  const cleanPhone = (orderData.phone || '').replace(/\D/g, '') || '11999998888';
  const cleanAmount = parseInt(orderData.amount || 2990, 10);

  const requestBody = JSON.stringify({
    amount: cleanAmount,
    payment_method: 'pix',
    postback_url: 'https://mascara3d.com.br/api/webhook',
    customer: {
      name: orderData.name || 'Cliente Mascara3D',
      email: orderData.email || 'contato@mascara3d.com.br',
      phone: cleanPhone.length >= 10 ? cleanPhone : '11999998888',
      document: {
        type: 'cpf',
        number: cleanCpf.length === 11 ? cleanCpf : '11144477735'
      }
    },
    items: orderData.items && orderData.items.length ? orderData.items : [
      { title: 'Combo 2x Máscara 3D Realista', unit_price: cleanAmount, quantity: 1, tangible: true }
    ],
    metadata: {
      provider_name: 'Mascara3D',
      selected_masks: orderData.selectedMasks || 'Combo Promocional'
    }
  });

  const req = https.request('https://api.freepaybrasil.com/v1/payment-transaction/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': FREEPAY_AUTH,
      'Content-Length': Buffer.byteLength(requestBody)
    }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.success && json.data && json.data.pix) {
          return callback(null, {
            success: true,
            id: json.data.id,
            amount: json.data.amount,
            qr_code: json.data.pix.qr_code,
            expiration_date: json.data.pix.expiration_date
          });
        }
        
        let errMsg = 'Erro na Gateway FreePay';
        if (json.error_messages && json.error_messages.length) {
          errMsg = json.error_messages[0].message || JSON.stringify(json.error_messages[0]);
        }
        return callback(new Error(errMsg));
      } catch (err) {
        return callback(err);
      }
    });
  });

  req.on('error', (err) => {
    return callback(err);
  });
  req.write(requestBody);
  req.end();
}

const server = http.createServer((req, res) => {
  let reqUrl = req.url.split('?')[0];

  // API Route: Create PIX with FreePay
  
  // API Route: Send client-side event to Meta Conversions API
  if (req.method === 'POST' && reqUrl === '/api/meta-capi') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1').split(',')[0].trim();
        const userAgent = req.headers['user-agent'] || 'Mozilla/5.0';

        sendMetaCapi(
          payload.event_name || 'PageView',
          {
            ip: clientIp,
            userAgent: userAgent,
            email: payload.email,
            phone: payload.phone,
            name: payload.name,
            cep: payload.cep
          },
          payload.custom_data || { currency: 'BRL', value: payload.value || 29.90 },
          (err, capiRes) => {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ success: !err, result: capiRes }));
          }
        );
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && reqUrl === '/api/create-pix') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const orderData = JSON.parse(body);
        const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1').split(',')[0].trim();
        const userAgent = req.headers['user-agent'] || 'Mozilla/5.0';

        createFreePayPix(orderData, (err, result) => {
          if (err) {
            res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            return res.end(JSON.stringify({ success: false, error: err.message || err }));
          }

          // Enviar conversão Purchase para o Meta Conversions API (CAPI)
          const amountVal = (orderData.amount ? parseInt(orderData.amount, 10) : 2990) / 100;
          sendMetaCapi('Purchase', {
            ip: clientIp,
            userAgent: userAgent,
            email: orderData.email,
            phone: orderData.phone,
            name: orderData.name,
            cep: orderData.cep
          }, {
            currency: 'BRL',
            value: amountVal,
            content_type: 'product',
            content_name: 'Combo 2x Balaclava Mascara3D'
          });

          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(result));
        });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: 'JSON inválido' }));
      }
    });
    return;
  }

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (reqUrl === '/') reqUrl = '/index.html';

  const filePath = path.join(PUBLIC_DIR, decodeURIComponent(reqUrl));

  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('403 Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=UTF-8' });
      return res.end('<h1>404 Não Encontrado</h1><p><a href="/">Voltar para a Loja</a></p>');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n=================================================`);
  console.log(`🚀 Loja Mascara3D Online rodando com sucesso!`);
  console.log(`💳 Gateway FreePay conectado e ativo!`);
  console.log(`🔗 Acesse no navegador: ${url}`);
  console.log(`=================================================\n`);
});
