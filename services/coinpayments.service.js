import crypto from 'crypto';

/**
 * CoinPayments USDT.TRC20 Gateway Service - REST v2
 */

const getEnv = (key, fallback = '') => {
  return (process.env[key] || fallback).trim();
};

const CP_API_URL = getEnv('COINPAYMENTS_API_URL', 'https://a-api.coinpayments.net');
const CP_CLIENT_ID = getEnv('COINPAYMENTS_CLIENT_ID');
const CP_CLIENT_SECRET = getEnv('COINPAYMENTS_CLIENT_SECRET');
const CP_CURRENCY = getEnv('COINPAYMENTS_CURRENCY', 'USDT.TRC20');

export function getCoinPaymentsTimestamp() {
  return new Date().toISOString().split('.')[0];
}

export function createCoinPaymentsSignature({
  method,
  url,
  clientId,
  clientSecret,
  timestamp,
  rawBody
}) {
  const canonicalMessage = `\ufeff${method.toUpperCase()}${url}${clientId}${timestamp}${rawBody}`;

  return crypto
    .createHmac('sha256', clientSecret)
    .update(canonicalMessage, 'utf8')
    .digest('base64');
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const createInvoice = async (options = {}) => {
  const {
    amountUSDT,
    orderId,
    buyerEmail,
    webhookUrl,
    successUrl,
    cancelUrl
  } = options;

  if (!CP_CLIENT_ID || !CP_CLIENT_SECRET) {
    throw new Error(
      'CoinPayments credentials not configured. Set COINPAYMENTS_CLIENT_ID and COINPAYMENTS_CLIENT_SECRET in .env'
    );
  }

  const numericAmount = Number(amountUSDT);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('Invalid USDT amount for CoinPayments invoice');
  }

  if (!orderId) {
    throw new Error('orderId is required for CoinPayments invoice');
  }

  const backendUrl = getEnv('BACKEND_URL', 'http://localhost:5000');
  const appUrl = getEnv('APP_URL', 'http://localhost:3000');

  const notifyUrl = webhookUrl || `${backendUrl}/api/coinpayments/webhook`;
  const amountString = numericAmount.toFixed(2);

  const requestBody = {
    currency: 'USD',
    invoiceId: orderId,
    description: `SkyRise USDT Deposit - ${orderId}`,

    items: [
      {
        name: 'USDT Wallet Deposit',
        description: `SkyRise USDT Deposit - ${orderId}`,
        quantity: {
          value: 1,
          type: 'quantity'
        },
        amount: amountString
      }
    ],

    amount: {
      total: amountString,
      breakdown: {
        subtotal: amountString
      }
    },

    buyer: buyerEmail
      ? {
        emailAddress: buyerEmail
      }
      : undefined,

    webhooks: [
      {
        notificationsUrl: notifyUrl,
        notifications: [
          'invoiceCreated',
          'invoicePending',
          'invoicePaid',
          'invoiceCompleted',
          'invoiceCancelled',
          'invoiceTimedOut',
          'invoicePaymentCreated',
          'invoicePaymentTimedOut'
        ]
      }
    ],

    payment: {
      paymentCurrency: CP_CURRENCY,
      refundEmail: buyerEmail || 'support@skyrisefuture.com'
    },

    successUrl:
      successUrl ||
      `${appUrl}/dashboard/deposits?status=success&orderId=${encodeURIComponent(orderId)}`,

    cancelUrl:
      cancelUrl ||
      `${appUrl}/dashboard/deposits?status=cancelled&orderId=${encodeURIComponent(orderId)}`,

    requireBuyerNameAndEmail: false,
    hideShoppingCart: true,

    customData: {
      internalOrderId: orderId,
      source: 'skyrise-usdt-deposit'
    },

    metadata: {
      integration: 'skyrise-backend',
      hostname: backendUrl
    }
  };

  if (!requestBody.buyer) {
    delete requestBody.buyer;
  }

  const method = 'POST';
  const url = `${CP_API_URL}/api/v2/merchant/invoices`;
  const timestamp = getCoinPaymentsTimestamp();
  const rawBody = JSON.stringify(requestBody);

  const signature = createCoinPaymentsSignature({
    method,
    url,
    clientId: CP_CLIENT_ID,
    clientSecret: CP_CLIENT_SECRET,
    timestamp,
    rawBody
  });

  console.log('[CoinPayments createInvoice DEBUG] URL:', url);
  console.log('[CoinPayments createInvoice DEBUG] Timestamp:', timestamp);
  console.log('[CoinPayments createInvoice DEBUG] ClientID exists:', Boolean(CP_CLIENT_ID));
  console.log('[CoinPayments createInvoice DEBUG] ClientSecret exists:', Boolean(CP_CLIENT_SECRET));
  console.log('[CoinPayments createInvoice DEBUG] Currency:', CP_CURRENCY);
  console.log('[CoinPayments createInvoice DEBUG] Notify URL:', notifyUrl);
  console.log('[CoinPayments createInvoice DEBUG] Raw Body:', rawBody);

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-CoinPayments-Client': CP_CLIENT_ID,
      'X-CoinPayments-Timestamp': timestamp,
      'X-CoinPayments-Signature': signature
    },
    body: rawBody
  });

  const responseText = await response.text();

  console.log('[CoinPayments createInvoice DEBUG] Response Status:', response.status);
  console.log('[CoinPayments createInvoice DEBUG] Response Text:', responseText);

  const data = safeJsonParse(responseText);

  if (!response.ok) {
    const validationErrors = data?.errors ? JSON.stringify(data.errors) : '';
    const errorMessage =
      data?.message ||
      data?.error ||
      data?.title ||
      data?.detail ||
      responseText ||
      `CoinPayments API error (HTTP ${response.status})`;

    throw new Error(
      `CoinPayments API error (HTTP ${response.status}): ${errorMessage}${validationErrors ? ` | Errors: ${validationErrors}` : ''
      }`
    );
  }

  if (!data) {
    throw new Error(
      `CoinPayments API returned non-JSON response (HTTP ${response.status}): ${responseText || '(Empty Response)'
      }`
    );
  }

  const createdInvoice = Array.isArray(data.invoices) ? data.invoices[0] : data;

  if (!createdInvoice) {
    throw new Error(`CoinPayments invoice response missing invoice data: ${JSON.stringify(data)}`);
  }

  const invoiceId =
    createdInvoice.id ||
    createdInvoice.invoiceId ||
    createdInvoice.invoiceID ||
    orderId;

  const checkoutUrl =
    createdInvoice.checkoutLink ||
    createdInvoice.link ||
    createdInvoice.invoiceUrl ||
    createdInvoice.redirectUrl;

  if (!checkoutUrl) {
    throw new Error(
      `CoinPayments invoice created but no checkout URL returned: ${JSON.stringify(data)}`
    );
  }

  const paymentId = createdInvoice.payment?.paymentId || null;

  const expiresAt = createdInvoice.payment?.expires
    ? new Date(createdInvoice.payment.expires)
    : new Date(Date.now() + 60 * 60 * 1000);

  return {
    invoiceId,
    checkoutUrl,
    link: createdInvoice.link || checkoutUrl,
    paymentId,
    expiresAt,
    rawResponse: data
  };
};

export const verifyWebhookSignature = (rawBody, headers, req) => {
  const client =
    headers['x-coinpayments-client'] ||
    headers['X-CoinPayments-Client'];

  const timestamp =
    headers['x-coinpayments-timestamp'] ||
    headers['X-CoinPayments-Timestamp'];

  const signature =
    headers['x-coinpayments-signature'] ||
    headers['X-CoinPayments-Signature'];

  if (!client || !timestamp || !signature) {
    console.error('[CoinPayments webhook] Missing required signature headers');
    return false;
  }

  if (!CP_CLIENT_SECRET) {
    console.error('[CoinPayments webhook] COINPAYMENTS_CLIENT_SECRET not configured');
    return false;
  }

  const rawBodyStr = Buffer.isBuffer(rawBody)
    ? rawBody.toString('utf8')
    : String(rawBody || '');

  const method = req?.method ? req.method.toUpperCase() : 'POST';

  const urlsToTry = [];

  if (req) {
    const host = req.get?.('host');
    const originalUrl = req.originalUrl || req.url;

    if (host && originalUrl) {
      const forwardedProto = req.get?.('x-forwarded-proto');
      const protocol = forwardedProto || req.protocol || 'https';

      urlsToTry.push(`${protocol}://${host}${originalUrl}`);

      if (protocol === 'http') {
        urlsToTry.push(`https://${host}${originalUrl}`);
      }

      if (protocol === 'https') {
        urlsToTry.push(`http://${host}${originalUrl}`);
      }
    }
  }

  const backendUrl = getEnv('BACKEND_URL', 'http://localhost:5000');

  urlsToTry.push(`${backendUrl}/api/coinpayments/webhook`);

  if (backendUrl.startsWith('http://')) {
    urlsToTry.push(`${backendUrl.replace('http://', 'https://')}/api/coinpayments/webhook`);
  }

  if (backendUrl.startsWith('https://')) {
    urlsToTry.push(`${backendUrl.replace('https://', 'http://')}/api/coinpayments/webhook`);
  }

  const uniqueUrls = [...new Set(urlsToTry.filter(Boolean))];

  for (const url of uniqueUrls) {
    const calculatedSignature = createCoinPaymentsSignature({
      method,
      url,
      clientId: client,
      clientSecret: CP_CLIENT_SECRET,
      timestamp,
      rawBody: rawBodyStr
    });

    const receivedBuffer = Buffer.from(signature);
    const calculatedBuffer = Buffer.from(calculatedSignature);

    if (
      receivedBuffer.length === calculatedBuffer.length &&
      crypto.timingSafeEqual(receivedBuffer, calculatedBuffer)
    ) {
      return true;
    }
  }

  console.error('[CoinPayments webhook] Signature validation failed. Tried URLs:', uniqueUrls);
  return false;
};

export default {
  getCoinPaymentsTimestamp,
  createCoinPaymentsSignature,
  createInvoice,
  verifyWebhookSignature
};