import Deposit from '../models/finance/deposit.model.js';
import Wallet from '../models/finance/wallet.model.js';
import WalletHistory from '../models/finance/wallet_history.model.js';
import PaymentWebhook from '../models/finance/payment_webhook.model.js';
import Notification from '../models/system/notification.model.js';
import { verifyWebhookSignature } from '../services/coinpayments.service.js';

/**
 * @desc    Handle Instant Payment Notification (IPN) webhook from CoinPayments REST v2
 * @route   POST /api/webhooks/coinpayments
 * @access  Public
 */
const handleCoinPaymentsIPN = async (req, res) => {
  try {
    const rawBody = req.rawBody;
    const payload = req.body;

    console.log('[CoinPayments IPN] Received IPN request');
    console.log('[CoinPayments IPN] Headers:', req.headers);
    console.log('[CoinPayments IPN] Payload:', payload);

    if (!rawBody || rawBody.length === 0) {
      console.warn('[CoinPayments IPN] Warning: Empty body');
      return res.status(400).send('Empty request body');
    }

    // 1. Verify HMAC signature on incoming IPN using COINPAYMENTS_IPN_SECRET
    const isValid = verifyWebhookSignature(rawBody, req.headers, req);
    if (!isValid) {
      console.error('[CoinPayments IPN] Signature verification failed');
      return res.status(400).send('Invalid signature');
    }

    // 2. Verify merchant ID if available in env
    const merchantId = process.env.COINPAYMENTS_MERCHANT_ID;
    if (merchantId && payload.merchant && payload.merchant !== merchantId) {
      console.error('[CoinPayments IPN] Merchant ID mismatch. Received:', payload.merchant, 'Expected:', merchantId);
      return res.status(400).send('Merchant ID mismatch');
    }

    // 3. Verify IPN secret if sent in the payload
    const ipnSecret = process.env.COINPAYMENTS_IPN_SECRET;
    if (ipnSecret && payload.ipn_secret && payload.ipn_secret !== ipnSecret) {
      console.error('[CoinPayments IPN] IPN Secret mismatch in body. Received:', payload.ipn_secret);
      return res.status(400).send('IPN Secret mismatch');
    }

    // 4. Resolve deposit/order ID from custom or item_number
    const orderId = payload.custom || payload.item_number;
    const cpTxnId = payload.txn_id;

    if (!orderId) {
      console.error('[CoinPayments IPN] Missing order identifier in payload (custom/item_number)');
      return res.status(400).send('Missing order identifier');
    }

    if (!cpTxnId) {
      console.error('[CoinPayments IPN] Missing gateway transaction ID (txn_id)');
      return res.status(400).send('Missing transaction ID');
    }

    // Find the corresponding pending deposit record
    const deposit = await Deposit.findOne({
      $or: [
        { transactionId: orderId },
        { gatewayTransactionId: cpTxnId }
      ]
    });

    console.log('[CoinPayments IPN] Deposit matched:', Boolean(deposit));

    if (!deposit) {
      console.error(`[CoinPayments IPN] No matching deposit found for orderId: ${orderId} or cpTxnId: ${cpTxnId}`);
      // Save webhook with error status
      await PaymentWebhook.findOneAndUpdate(
        { transactionId: cpTxnId },
        {
          gateway: 'coinpayments',
          payload,
          status: 'error',
          remarks: `No matching deposit for orderId: ${orderId} or cpTxnId: ${cpTxnId}`
        },
        { upsert: true, new: true }
      );
      return res.status(200).send('IPN verified but no matching deposit found');
    }

    // Idempotency: If deposit is already completed/approved, do not process again
    if (deposit.status === 'completed' || deposit.status === 'approved') {
      console.log('[CoinPayments IPN] Deposit already processed/completed. Skipping duplicate credit.');
      await PaymentWebhook.findOneAndUpdate(
        { transactionId: cpTxnId },
        {
          gateway: 'coinpayments',
          payload,
          status: 'verified',
          remarks: 'Duplicate IPN: Deposit was already completed'
        },
        { upsert: true, new: true }
      );
      return res.status(200).send('IPN already processed');
    }

    const statusCode = Number(payload.status);
    const isCompleted = statusCode >= 100 || statusCode === 2;
    const isFailed = statusCode < 0;

    // Save webhook log for audit trail (idempotency support)
    const webhookRecord = await PaymentWebhook.findOneAndUpdate(
      { transactionId: cpTxnId },
      {
        gateway: 'coinpayments',
        payload,
        status: isCompleted ? 'verified' : isFailed ? 'error' : 'received',
        remarks: `Processed status: ${payload.status}. Message: ${payload.status_text || ''}`
      },
      { upsert: true, new: true }
    );

    if (isCompleted) {
      // Determine the actual amount received
      const actualReceivedAmount = payload.received_amount ? Number(payload.received_amount) : deposit.amountUSDT;

      // Update deposit with actual received amount
      deposit.amountUSDT = actualReceivedAmount;
      deposit.status = 'completed';
      deposit.gatewayTransactionId = cpTxnId;
      deposit.gatewayResponse = payload;
      deposit.remarks = `CoinPayments Legacy Auto-Approved. Status: ${payload.status_text || statusCode}`;
      deposit.processedAt = new Date();
      await deposit.save();

      // Credit the user's wallet
      let wallet = await Wallet.findOne({ user: deposit.user });
      if (!wallet) {
        wallet = new Wallet({ user: deposit.user });
      }

      const prevBal = wallet.deposit || 0;
      wallet.deposit = prevBal + actualReceivedAmount;
      await wallet.save();

      console.log('[CoinPayments IPN] Wallet credited: true');

      // Log wallet history
      await WalletHistory.create({
        user: deposit.user,
        walletType: 'deposit',
        type: 'credit',
        amount: actualReceivedAmount,
        previousBalance: prevBal,
        newBalance: wallet.deposit,
        category: 'deposit',
        description: `CoinPayments Legacy auto-approved deposit. Amount: $${actualReceivedAmount.toFixed(2)}. Gateway Tx: ${cpTxnId}`,
        referenceModel: 'Deposit',
        referenceId: deposit._id
      });

      // Send notification if notification model exists
      if (Notification) {
        await Notification.create({
          user: deposit.user,
          title: 'CoinPayments Deposit Approved! 💰',
          message: `Your deposit of $${actualReceivedAmount.toFixed(2)} (${process.env.COINPAYMENTS_CURRENCY || 'LTCT'}) has been automatically verified and credited to your deposit wallet.`,
          category: 'deposit'
        });
      }

      return res.status(200).send('IPN Processed and User Wallet Credited');
    } else if (isFailed) {
      // Payment failed or cancelled
      deposit.status = 'rejected';
      deposit.gatewayTransactionId = cpTxnId;
      deposit.gatewayResponse = payload;
      deposit.remarks = `CoinPayments Legacy rejected. Status: ${payload.status_text || statusCode}`;
      deposit.processedAt = new Date();
      await deposit.save();

      console.log('[CoinPayments IPN] Payment failed, deposit marked as rejected');

      if (Notification) {
        await Notification.create({
          user: deposit.user,
          title: 'CoinPayments Deposit Failed ❌',
          message: `Your deposit request of $${deposit.amountUSDT.toFixed(2)} (${process.env.COINPAYMENTS_CURRENCY || 'LTCT'}) was marked as failed or cancelled by CoinPayments.`,
          category: 'deposit'
        });
      }

      return res.status(200).send('IPN Processed (payment failed)');
    } else {
      // Pending statuses (waiting for confirmations, etc.)
      console.log(`[CoinPayments IPN] Payment pending confirmations. Status: ${statusCode}`);
      return res.status(200).send('IPN received but pending confirmations');
    }
  } catch (error) {
    console.error('handleCoinPaymentsIPN error:', error);
    return res.status(500).send('Internal Server Error');
  }
};

export default {
  handleCoinPaymentsIPN
};
