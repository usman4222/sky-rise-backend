import crypto from 'crypto';

/**
 * PayFast PKR Payment Gateway Service
 *
 * Flow:
 * 1. Backend generates signed form data for PayFast checkout
 * 2. Frontend redirects user to PayFast payment page
 * 3. PayFast sends callback (IPN) to our notify URL after payment
 * 4. Backend verifies callback signature and credits wallet
 */

const PAYFAST_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID || '';
const PAYFAST_SECURED_KEY = process.env.PAYFAST_SECURED_KEY || '';
const PAYFAST_API_URL = process.env.PAYFAST_API_URL || 'https://ipg1.apps.net.pk';
const PAYFAST_RETURN_URL = process.env.PAYFAST_RETURN_URL || '';
const PAYFAST_CANCEL_URL = process.env.PAYFAST_CANCEL_URL || '';
const PAYFAST_NOTIFY_URL = process.env.PAYFAST_NOTIFY_URL || '';

/**
 * Create PayFast checkout form data and redirect URL
 *
 * @param {Object} options
 * @param {number} options.amountPKR - Amount in PKR
 * @param {string} options.orderId - Our internal deposit transaction ID
 * @param {string} options.customerEmail - Customer email
 * @param {string} options.customerName - Customer name
 * @param {string} options.description - Payment description
 * @returns {{ checkoutUrl: string, formData: Object }}
 */
export const createPayfastCheckout = (options) => {
  const { amountPKR, orderId, customerEmail, customerName, description } = options;

  if (!PAYFAST_MERCHANT_ID || !PAYFAST_SECURED_KEY) {
    throw new Error('PayFast credentials not configured. Set PAYFAST_MERCHANT_ID and PAYFAST_SECURED_KEY in .env');
  }

  // Build the form fields that PayFast expects
  const formData = {
    MERCHANT_ID: PAYFAST_MERCHANT_ID,
    MERCHANT_NAME: 'SkyRise Future',
    TOKEN: '', // For hosted checkout, token may not be required
    PROCCODE: '00', // Transaction type: purchase
    TXNAMT: amountPKR.toFixed(2),
    CUSTOMER_MOBILE_NO: '',
    CUSTOMER_EMAIL_ADDRESS: customerEmail || '',
    SIGNATURE: '', // Will be computed below
    VERSION: 'MERCHANT-CART-0.1',
    TXNDESC: description || `SkyRise PKR Deposit - ${orderId}`,
    SUCCESS_URL: PAYFAST_RETURN_URL || `${process.env.APP_URL || 'http://localhost:3000'}/dashboard/deposits?status=success&orderId=${orderId}`,
    FAILURE_URL: PAYFAST_CANCEL_URL || `${process.env.APP_URL || 'http://localhost:3000'}/dashboard/deposits?status=failed&orderId=${orderId}`,
    BASKET_ID: orderId,
    ORDER_DATE: new Date().toISOString().split('T')[0],
    CHECKOUT_URL: PAYFAST_NOTIFY_URL || `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/payments/pkr/deposit/callback`
  };

  // Generate signature: MD5(MERCHANT_ID + TXNAMT + BASKET_ID + SECURED_KEY)
  const signatureString = `${PAYFAST_MERCHANT_ID}${formData.TXNAMT}${orderId}${PAYFAST_SECURED_KEY}`;
  formData.SIGNATURE = crypto.createHash('md5').update(signatureString).digest('hex');

  const PAYFAST_CHECKOUT_URL = process.env.PAYFAST_CHECKOUT_URL || '';

  if (!PAYFAST_CHECKOUT_URL) {
    throw new Error(
      'PayFast hosted checkout URL is not configured. Ask PayFast for the correct checkout/form post URL or implement the API token/transaction flow.'
    );
  }

  const checkoutUrl = PAYFAST_CHECKOUT_URL;
  return {
    checkoutUrl,
    formData,
    redirectUrl: checkoutUrl
  };
};

/**
 * Verify PayFast callback/IPN signature
 *
 * PayFast sends a POST callback with transaction result.
 * We verify by recomputing the signature using the secured key.
 *
 * @param {Object} payload - Callback payload from PayFast
 * @returns {{ isValid: boolean, orderId: string, status: string, gatewayTxnId: string }}
 */
export const verifyPayfastCallback = (payload) => {
  if (!PAYFAST_SECURED_KEY) {
    throw new Error('PayFast SECURED_KEY not configured');
  }

  const {
    BASKET_ID,
    TXNAMT,
    SIGNATURE,
    TRANSACTION_ID,
    RESPONSE_CODE,
    RESPONSE_MESSAGE
  } = payload;

  // Recompute expected signature
  const expectedSignature = crypto
    .createHash('md5')
    .update(`${PAYFAST_MERCHANT_ID}${TXNAMT}${BASKET_ID}${PAYFAST_SECURED_KEY}`)
    .digest('hex');

  const isValid = expectedSignature === SIGNATURE;

  // PayFast RESPONSE_CODE '00' means successful payment
  const isSuccessful = RESPONSE_CODE === '00';

  return {
    isValid,
    isSuccessful,
    orderId: BASKET_ID,
    gatewayTxnId: TRANSACTION_ID || null,
    responseCode: RESPONSE_CODE,
    responseMessage: RESPONSE_MESSAGE || '',
    rawPayload: payload
  };
};

export default {
  createPayfastCheckout,
  verifyPayfastCallback
};
