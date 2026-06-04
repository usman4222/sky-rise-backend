import crypto from 'crypto';

/**
 * CoinPayments USDT/LTCT Gateway Service - Legacy API (v1)
 */

const getEnv = (key, fallback = '') => {
  return (process.env[key] || fallback).trim();
};

const getLegacyConfig = () => {
  return {
    url: getEnv('COINPAYMENTS_LEGACY_API_URL', 'https://www.coinpayments.net/api.php'),
    publicKey: getEnv('COINPAYMENTS_PUBLIC_KEY'),
    privateKey: getEnv('COINPAYMENTS_PRIVATE_KEY'),
    currency: getEnv('COINPAYMENTS_CURRENCY', 'LTCT'),
    ipnSecret: getEnv('COINPAYMENTS_IPN_SECRET', 'skyrise_ipn_secret_2026'),
    backendUrl: getEnv('BACKEND_URL', 'https://sulphate-esteemed-blurry.ngrok-free.dev'),
    appUrl: getEnv('APP_URL', 'http://localhost:3000')
  };
};

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Create a transaction using Legacy CoinPayments API (cmd=create_transaction)
 */
export const createInvoice = async (options = {}) => {
  const { amountUSDT, orderId, buyerEmail, webhookUrl, successUrl, cancelUrl } = options;
  const config = getLegacyConfig();

  if (!config.publicKey || !config.privateKey) {
    throw new Error(
      'CoinPayments legacy credentials not configured. Set COINPAYMENTS_PUBLIC_KEY and COINPAYMENTS_PRIVATE_KEY in .env'
    );
  }

  const numericAmount = Number(amountUSDT);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('Invalid amount for CoinPayments invoice');
  }

  if (!orderId) {
    throw new Error('orderId is required for CoinPayments invoice');
  }

  const notifyUrl = webhookUrl || `${config.backendUrl}/api/coinpayments/webhook`;
  const returnUrl = successUrl || `${config.appUrl}/dashboard/deposits?status=success&orderId=${encodeURIComponent(orderId)}`;
  const abortUrl = cancelUrl || `${config.appUrl}/dashboard/deposits?status=cancelled&orderId=${encodeURIComponent(orderId)}`;

  // Prepare Legacy CoinPayments API fields
  const payload = {
    cmd: 'create_transaction',
    key: config.publicKey,
    version: '1',
    amount: numericAmount.toString(),
    currency1: config.currency,
    currency2: config.currency,
    buyer_email: buyerEmail || 'support@skyrisefuture.com',
    item_name: 'SkyRise Deposit',
    item_number: orderId,
    custom: orderId,
    ipn_url: notifyUrl,
    success_url: returnUrl,
    cancel_url: abortUrl
  };

  const params = new URLSearchParams(payload);
  const rawFormBody = params.toString();

  // Sign request body using HMAC-SHA512 with the private key
  const signature = crypto
    .createHmac('sha512', config.privateKey)
    .update(rawFormBody)
    .digest('hex');

  // Print helpful diagnostics logs (do NOT log private key)
  console.log('[CoinPayments Legacy API] URL:', config.url);
  console.log('[CoinPayments Legacy API] Public key exists:', Boolean(config.publicKey));
  console.log('[CoinPayments Legacy API] Private key exists:', Boolean(config.privateKey));
  console.log('[CoinPayments Legacy API] Currency:', config.currency);
  console.log('[CoinPayments Legacy API] Request body (unsigned):', payload);
  console.log('[CoinPayments Legacy API] Request body (raw encoded):', rawFormBody);
  console.log('[CoinPayments Legacy API] Calculated Signature:', signature);

  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'HMAC': signature
    },
    body: rawFormBody
  });

  const responseText = await response.text();
  console.log('[CoinPayments Legacy API] Response Status:', response.status);
  console.log('[CoinPayments Legacy API] Response Body:', responseText);

  const data = safeJsonParse(responseText);

  if (!response.ok) {
    throw new Error(
      `CoinPayments Legacy API returned HTTP ${response.status}: ${responseText}`
    );
  }

  if (!data) {
    throw new Error(
      `CoinPayments Legacy API returned non-JSON response: ${responseText}`
    );
  }

  if (data.error !== 'ok') {
    throw new Error(`CoinPayments Legacy API error: ${data.error}`);
  }

  const result = data.result;
  if (!result || !result.checkout_url) {
    throw new Error(`CoinPayments Legacy API missing checkout_url: ${JSON.stringify(data)}`);
  }

  return {
    invoiceId: result.txn_id, // Gateway transaction ID
    checkoutUrl: result.checkout_url,
    statusUrl: result.status_url,
    expiresAt: result.timeout ? new Date(Date.now() + result.timeout * 1000) : new Date(Date.now() + 60 * 60 * 1000),
    rawResponse: data
  };
};

/**
 * Verify HMAC signature on incoming IPN webhooks using COINPAYMENTS_IPN_SECRET
 */
export const verifyWebhookSignature = (rawBody, headers, req) => {
  const hmacHeader = headers['hmac'] || headers['HMAC'];
  if (!hmacHeader) {
    console.error('[CoinPayments Webhook] Missing HMAC header');
    return false;
  }

  const config = getLegacyConfig();
  if (!config.ipnSecret) {
    console.error('[CoinPayments Webhook] COINPAYMENTS_IPN_SECRET is not configured');
    return false;
  }

  const rawBodyStr = Buffer.isBuffer(rawBody)
    ? rawBody.toString('utf8')
    : String(rawBody || '');

  const calculatedSignature = crypto
    .createHmac('sha512', config.ipnSecret)
    .update(rawBodyStr)
    .digest('hex');

  const isValid = hmacHeader.toLowerCase() === calculatedSignature.toLowerCase();
  if (!isValid) {
    console.error('[CoinPayments Webhook] Signature verification failed!');
    console.error('  Received HMAC:', hmacHeader);
    console.error('  Calculated HMAC:', calculatedSignature);
  }

  return isValid;
};

export default {
  createInvoice,
  verifyWebhookSignature
};