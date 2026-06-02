const urls = [
  'https://a-api.coinpayments.net/api/v1/merchant/withdraw',
  'https://a-api.coinpayments.net/api/v1/merchant/withdrawal',
  'https://a-api.coinpayments.net/api/v1/merchant/payout',
  'https://a-api.coinpayments.net/api/v1/merchant/disbursement',
  'https://a-api.coinpayments.net/api/v1/merchant/disbursements',
  'https://a-api.coinpayments.net/api/v1/merchant/transfer'
];

async function check() {
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'POST' });
      console.log(`POST: ${url} -> Status: ${res.status}`);
      const resGet = await fetch(url, { method: 'GET' });
      console.log(`GET: ${url} -> Status: ${resGet.status}`);
    } catch (err) {
      console.log(`URL: ${url} -> Error: ${err.message}`);
    }
  }
}

check();
