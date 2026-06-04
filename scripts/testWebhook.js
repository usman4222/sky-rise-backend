import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const testWebhook = async () => {
  const PORT = process.env.PORT || 5000;
  const CP_CLIENT_ID = (process.env.COINPAYMENTS_CLIENT_ID || 'mock_client_id').trim();
  const CP_CLIENT_SECRET = (process.env.COINPAYMENTS_CLIENT_SECRET || 'mock_client_secret').trim();

  const txnId = process.argv[2];
  if (!txnId) {
    console.error('❌ Please provide a deposit transaction ID to approve.');
    console.log('Usage: node scripts/testWebhook.js <transactionId>');
    process.exit(1);
  }

  // Construct mock CoinPayments REST JSON webhook payload
  const payload = {
    invoiceId: txnId, // Matches the deposit's transactionId (e.g. USDT-XXX)
    id: 'mock_cp_invoice_id_' + Math.random().toString(36).substring(2, 9),
    status: 'completed', // 'completed' status matches the REST API completion
    status_text: 'Paid & Verified',
    amount: {
      currencyId: 'USDT.TRC20',
      displayValue: '10.0'
    }
  };

  const bodyString = JSON.stringify(payload);
  const timestamp = new Date().toISOString().split(".")[0];
  const method = 'POST';
  const url = `http://localhost:${PORT}/api/webhooks/coinpayments`;

  // Calculate signature: \ufeff + method + url + clientId + timestamp + bodyString
  const message = `\ufeff${method}${url}${CP_CLIENT_ID}${timestamp}${bodyString}`;
  const signature = crypto
    .createHmac('sha256', CP_CLIENT_SECRET)
    .update(message, 'utf8')
    .digest('base64');

  console.log(`Sending webhook for TxID: ${txnId} to ${url}`);
  console.log(`X-CoinPayments-Client: ${CP_CLIENT_ID}`);
  console.log(`X-CoinPayments-Timestamp: ${timestamp}`);
  console.log(`X-CoinPayments-Signature: ${signature}`);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-CoinPayments-Client': CP_CLIENT_ID,
        'X-CoinPayments-Timestamp': timestamp,
        'X-CoinPayments-Signature': signature
      },
      body: bodyString
    });

    const responseText = await res.text();
    console.log(`\n📥 Server Response [Status ${res.status}]:`);
    console.log(responseText);
  } catch (error) {
    console.error('❌ Request failed:', error.message);
  }
};

testWebhook();
