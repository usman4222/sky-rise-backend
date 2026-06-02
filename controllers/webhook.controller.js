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
    const signature = req.headers['x-coinpayments-signature'];
    if (!signature) {
      console.warn('CoinPayments IPN warning: Missing X-CoinPayments-Signature header');
      return res.status(400).send('Missing signature header');
    }

    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      console.warn('CoinPayments IPN warning: Empty body');
      return res.status(400).send('Empty request body');
    }

    // Webhook verification using rawBody and headers via clientSecret
    const isValid = verifyWebhookSignature(rawBody, req.headers, req);
    if (!isValid) {
      console.error('CoinPayments IPN signature verification failed');
      return res.status(400).send('Invalid signature');
    }

    const payload = req.body;
    // Resolve transaction ID: invoiceId represents our internal orderId, txn_id/id represents CP id.
    const txn_id = payload.invoiceId || payload.txn_id || payload.id;
    if (!txn_id) {
      console.error('CoinPayments IPN warning: Missing transaction/invoice identifier in body', payload);
      return res.status(400).send('Missing transaction/invoice identifier');
    }

    const status = payload.status;
    const status_text = payload.status_text || (status === 100 || status === 'completed' || status === 'success' || status === 'Paid' ? 'Completed' : `Status: ${status}`);

    // Optional validation of merchant ID (if sent in REST webhook body)
    if (payload.merchant && process.env.COINPAYMENTS_MERCHANT_ID && payload.merchant !== process.env.COINPAYMENTS_MERCHANT_ID) {
      console.error('CoinPayments IPN merchant mismatch:', payload.merchant);
      return res.status(400).send('Merchant mismatch');
    }

    // Save webhook log for audit trail (idempotency support)
    const existingWebhook = await PaymentWebhook.findOne({ transactionId: txn_id });
    if (existingWebhook && existingWebhook.status === 'verified') {
      return res.status(200).send('IPN already processed');
    }

    // Upsert or log receipt of the webhook
    let webhookRecord = existingWebhook;
    if (!webhookRecord) {
      webhookRecord = await PaymentWebhook.create({
        gateway: 'coinpayments',
        transactionId: txn_id,
        payload,
        status: 'received',
        remarks: `Received webhook status: ${status}`
      });
    }

    const statusCode = Number(status);
    const isCompleted = statusCode >= 100 || statusCode === 2 || status === 'completed' || status === 'success' || status === 'Paid';
    const isFailed = statusCode < 0 || status === 'failed' || status === 'cancelled';

    if (isCompleted) {
      // Find the corresponding pending deposit record by transactionId (internal) or gatewayTransactionId (external)
      const deposit = await Deposit.findOne({
        $or: [
          { transactionId: txn_id },
          { gatewayTransactionId: txn_id }
        ]
      });

      if (!deposit) {
        webhookRecord.status = 'error';
        webhookRecord.remarks = 'No matching deposit record found for transactionId/invoiceId: ' + txn_id;
        await webhookRecord.save();
        return res.status(200).send('IPN verified but no matching deposit record found');
      }

      if (deposit.status === 'approved' || deposit.status === 'completed') {
        webhookRecord.status = 'verified';
        webhookRecord.remarks = 'Deposit was already completed/approved';
        await webhookRecord.save();
        return res.status(200).send('Deposit already approved');
      }

      // Mark deposit as approved
      deposit.status = 'approved';
      deposit.remarks = `CoinPayments Auto-Approved. Details: ${status_text || 'Completed'}`;
      deposit.processedAt = new Date();
      await deposit.save();

      // Credit the user's wallet
      let wallet = await Wallet.findOne({ user: deposit.user });
      if (!wallet) {
        wallet = new Wallet({ user: deposit.user });
      }

      const prevBal = wallet.deposit || 0;
      wallet.deposit = prevBal + deposit.amountUSDT;
      await wallet.save();

      // Log wallet history
      await WalletHistory.create({
        user: deposit.user,
        walletType: 'deposit',
        type: 'credit',
        amount: deposit.amountUSDT,
        previousBalance: prevBal,
        newBalance: wallet.deposit,
        category: 'deposit',
        description: `CoinPayments auto-approved deposit. amountUSDT: $${deposit.amountUSDT.toFixed(2)}. Transaction ID: ${txn_id}`,
        referenceModel: 'Deposit',
        referenceId: deposit._id
      });

      // Create system notification
      await Notification.create({
        user: deposit.user,
        title: 'CoinPayments Deposit Approved! 💰',
        message: `Your USDT deposit of $${deposit.amountUSDT.toFixed(2)} has been automatically verified and credited to your deposit wallet.`,
        category: 'deposit'
      });

      webhookRecord.status = 'verified';
      webhookRecord.remarks = 'Successfully processed completed payment webhook';
      await webhookRecord.save();

      return res.status(200).send('Webhook Processed and User Wallet Credited');
    } else if (isFailed) {
      // Payment failed or cancelled
      const deposit = await Deposit.findOne({
        $or: [
          { transactionId: txn_id },
          { gatewayTransactionId: txn_id }
        ]
      });

      if (deposit && deposit.status === 'pending') {
        deposit.status = 'rejected';
        deposit.remarks = `CoinPayments webhook cancelled/failed. Status: ${status_text || 'Failed'}`;
        deposit.processedAt = new Date();
        await deposit.save();

        await Notification.create({
          user: deposit.user,
          title: 'CoinPayments Deposit Failed ❌',
          message: `Your USDT deposit of $${deposit.amountUSDT.toFixed(2)} failed or was cancelled by CoinPayments.`,
          category: 'deposit'
        });
      }

      webhookRecord.status = 'error';
      webhookRecord.remarks = `Payment failed/cancelled with status ${status}`;
      await webhookRecord.save();
      return res.status(200).send('Webhook processed (payment failed)');
    } else {
      // Pending statuses (waiting for confirmations, etc.)
      webhookRecord.remarks = `Webhook pending confirmations. Current status: ${status}`;
      await webhookRecord.save();
      return res.status(200).send('Webhook received but pending confirmations');
    }
  } catch (error) {
    console.error('handleCoinPaymentsIPN error:', error);
    return res.status(500).send('Internal Server Error');
  }
};

export default {
  handleCoinPaymentsIPN
};
