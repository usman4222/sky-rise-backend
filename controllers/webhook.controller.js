import crypto from 'crypto';
import Deposit from '../models/finance/deposit.model.js';
import Wallet from '../models/finance/wallet.model.js';
import WalletHistory from '../models/finance/wallet_history.model.js';
import PaymentWebhook from '../models/finance/payment_webhook.model.js';
import Notification from '../models/system/notification.model.js';

/**
 * @desc    Handle Instant Payment Notification (IPN) webhook from CoinPayments
 * @route   POST /api/webhooks/coinpayments
 * @access  Public
 */
const handleCoinPaymentsIPN = async (req, res) => {
  try {
    const ipnSecret = process.env.COINPAYMENTS_IPN_SECRET;
    if (!ipnSecret) {
      console.error('COINPAYMENTS_IPN_SECRET is not configured inside .env file.');
      return res.status(500).send('IPN Secret not configured');
    }

    const signature = req.headers.hmac || req.headers.hmac_signature || req.headers['hmac'];
    if (!signature) {
      console.warn('CoinPayments IPN warning: Missing HMAC signature header');
      return res.status(400).send('Missing HMAC signature');
    }

    const payloadString = req.rawBody ? req.rawBody.toString('utf8') : '';
    if (!payloadString) {
      console.warn('CoinPayments IPN warning: Empty body');
      return res.status(400).send('Empty request body');
    }

    const hmac = crypto.createHmac('sha512', ipnSecret);
    hmac.update(payloadString);
    const calculatedSignature = hmac.digest('hex');

    if (signature !== calculatedSignature) {
      console.error('CoinPayments IPN signature verification failed');
      return res.status(400).send('Invalid signature');
    }

    const payload = req.body;
    const { txn_id, status, status_text, merchant } = payload;

    // Optional validation of merchant ID
    if (process.env.COINPAYMENTS_MERCHANT_ID && merchant !== process.env.COINPAYMENTS_MERCHANT_ID) {
      console.error('CoinPayments IPN merchant mismatch:', merchant);
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
        remarks: `Received IPN status: ${status}`
      });
    }

    const statusCode = Number(status);

    // CoinPayments completed status is 100 or >= 100 (also status 2 is completed in some cases)
    if (statusCode >= 100 || statusCode === 2) {
      // Find the corresponding pending deposit record by transactionId (which matches txn_id)
      const deposit = await Deposit.findOne({ transactionId: txn_id });
      if (!deposit) {
        webhookRecord.status = 'error';
        webhookRecord.remarks = 'No matching deposit record found for transactionId: ' + txn_id;
        await webhookRecord.save();
        return res.status(200).send('IPN verified but no matching deposit record found');
      }

      if (deposit.status === 'approved') {
        webhookRecord.status = 'verified';
        webhookRecord.remarks = 'Deposit was already approved';
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
      webhookRecord.remarks = 'Successfully processed completed payment IPN';
      await webhookRecord.save();

      return res.status(200).send('IPN Processed and User Wallet Credited');
    } else if (statusCode < 0) {
      // Payment failed or cancelled
      const deposit = await Deposit.findOne({ transactionId: txn_id });
      if (deposit && deposit.status === 'pending') {
        deposit.status = 'rejected';
        deposit.remarks = `CoinPayments IPN cancelled/failed. Status text: ${status_text || 'Failed'}`;
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
      webhookRecord.remarks = `Payment failed/cancelled with status code ${statusCode}`;
      await webhookRecord.save();
      return res.status(200).send('IPN processed (payment failed)');
    } else {
      // Pending statuses (waiting for confirmations, etc.)
      webhookRecord.remarks = `IPN pending confirmations. Current status: ${statusCode}`;
      await webhookRecord.save();
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
