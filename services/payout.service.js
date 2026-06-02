import crypto from 'crypto';

/**
 * Automated PKR Payout / Disbursement Service
 * 
 * Interacts with the configured PKR disbursement provider (e.g. PayFast payouts API, CashMaal, etc.)
 * 
 * If credentials are missing in .env, it throws an error which triggers the transaction refund logic.
 */
export const createPayout = async (options) => {
  const { amountPKR, channel, accountTitle, accountNumber, bankDetails } = options;

  const apiKey = process.env.PKR_PAYOUT_API_KEY;
  const merchantId = process.env.PKR_PAYOUT_MERCHANT_ID;

  if (!apiKey || !merchantId) {
    throw new Error('PKR payout provider is not configured.');
  }

  // Implementation stub for actual payout provider
  // In production, this would call fetch() to the provider's payout API.
  // 
  // e.g.:
  // const payload = { merchantId, amount: amountPKR, channel, accountTitle, accountNumber, bankDetails };
  // const response = await fetch('https://api.disbursementprovider.com/payout', {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'Authorization': `Bearer ${apiKey}`
  //   },
  //   body: JSON.stringify(payload)
  // });
  // const data = await response.json();
  // if (!response.ok || !data.success) throw new Error(data.message || 'Payout failed');
  // return { referenceId: data.transactionId };

  // For sandbox/development testing, return mock successful response
  const randHash = crypto.randomBytes(8).toString('hex').toUpperCase();
  const referenceId = `PKR-OUT-${Date.now().toString(36).toUpperCase()}-${randHash}`;

  return {
    success: true,
    referenceId,
    amountPKR,
    channel,
    status: 'success'
  };
};

export default {
  createPayout
};
