import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const testWebhook = async () => {
  const PORT = process.env.PORT || 5000;
  const IPN_SECRET = process.env.COINPAYMENTS_IPN_SECRET || 'your_ipn_secret';
  
  const txnId = process.argv[2];
  if (!txnId) {
    console.error('❌ Please provide a deposit transaction ID to approve.');
    console.log('Usage: node scripts/testWebhook.js <transactionId>');
    process.exit(1);
  }

  // Construct mock CoinPayments IPN payload parameters
  const payloadParams = new URLSearchParams({
    ipn_version: '1.0',
    ipn_type: 'api',
    ipn_mode: 'hmac',
    ipn_id: 'mock_ipn_id_' + Math.random().toString(36).substring(2, 9),
    merchant: process.env.COINPAYMENTS_MERCHANT_ID || 'mock_cp_merchant_999',
    status: '100', // 100 = Completed / Success
    status_text: 'Verified payment of USDT',
    txn_id: txnId,
    amount1: '10.0',
    currency1: 'USDT'
  });

  const payloadString = payloadParams.toString();

  // Create HMAC signature using SHA512
  const hmac = crypto.createHmac('sha512', IPN_SECRET);
  hmac.update(payloadString);
  const signature = hmac.digest('hex');

  console.log(`Sending webhook for TxID: ${txnId} to http://localhost:${PORT}/api/webhooks/coinpayments`);
  console.log(`HMAC Signature: ${signature}`);

  try {
    const res = await fetch(`http://localhost:${PORT}/api/webhooks/coinpayments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'HMAC': signature
      },
      body: payloadString
    });

    const responseText = await res.text();
    console.log(`\n📥 Server Response [Status ${res.status}]:`);
    console.log(responseText);
  } catch (error) {
    console.error('❌ Request failed:', error.message);
  }
};

testWebhook();
