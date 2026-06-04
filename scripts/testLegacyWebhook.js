import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const testLegacyWebhook = async () => {
  const PORT = process.env.PORT || 5000;
  const IPN_SECRET = (process.env.COINPAYMENTS_IPN_SECRET || 'skyrise_ipn_secret_2026').trim();

  const txnId = process.argv[2];
  if (!txnId) {
    console.error('❌ Please provide a deposit transaction ID (e.g. USDT-xxxx) to approve.');
    console.log('Usage: node scripts/testLegacyWebhook.js <transactionId>');
    process.exit(1);
  }

  // Construct mock CoinPayments Legacy form-urlencoded webhook payload
  const payload = {
    status: '100',
    status_text: 'Completed',
    custom: txnId,
    txn_id: 'CP_MOCK_TXN_' + Math.random().toString(36).substring(2, 9).toUpperCase(),
    ipn_secret: IPN_SECRET,
    merchant: 'mock_merchant_id'
  };

  const params = new URLSearchParams(payload);
  const rawFormBody = params.toString();

  // Sign using HMAC-SHA512 of the raw body with the IPN Secret
  const signature = crypto
    .createHmac('sha512', IPN_SECRET)
    .update(rawFormBody)
    .digest('hex');

  const url = `http://localhost:${PORT}/api/coinpayments/webhook`;

  console.log(`\n--- Sending Legacy Webhook to ${url} ---`);
  console.log(`Payload:`, payload);
  console.log(`Raw Form Body:`, rawFormBody);
  console.log(`HMAC:`, signature);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'HMAC': signature
      },
      body: rawFormBody
    });

    const responseText = await res.text();
    console.log(`\n📥 Server Response [Status ${res.status}]:`);
    console.log(responseText);
  } catch (error) {
    console.error('❌ Request failed:', error.message);
  }
};

testLegacyWebhook();
