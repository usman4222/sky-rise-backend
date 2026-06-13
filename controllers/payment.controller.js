import crypto from 'crypto';
import mongoose from 'mongoose';

import Deposit from '../models/finance/deposit.model.js';
import Withdrawal from '../models/finance/withdrawal.model.js';
import Wallet from '../models/finance/wallet.model.js';
import WalletHistory from '../models/finance/wallet_history.model.js';
import PaymentMethod from '../models/finance/payment_method.model.js';
import PaymentWebhook from '../models/finance/payment_webhook.model.js';
import WithdrawalAccount from '../models/finance/withdrawal_account.model.js';
import ExchangeRate from '../models/investment/exchange_rate.model.js';
import SystemSettings from '../models/system/system_settings.model.js';
import Notification from '../models/system/notification.model.js';

import { sendError, successResponse } from '../utils/response.js';
import { createPayfastCheckout, verifyPayfastCallback } from '../services/payfast.service.js';
import { createInvoice as createCPInvoice } from '../services/coinpayments.service.js';
import payoutService from '../services/payout.service.js';

// ============================================================
// Helper: Generate unique order/transaction ID
// ============================================================
const generateOrderId = (prefix = 'DEP') => {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${ts}-${rand}`;
};

// ============================================================
// PKR DEPOSIT — via PayFast
// ============================================================

/**
 * @desc    Create a PKR deposit request and get PayFast checkout URL
 * @route   POST /api/payments/pkr/deposit/create
 * @access  Private
 */
const createPkrDeposit = async (req, res) => {
  try {
    const { amountPKR } = req.body;

    if (!amountPKR || Number(amountPKR) <= 0) {
      return sendError(res, 'PKR deposit amount must be a valid number greater than 0', 400);
    }

    const numericPKR = Number(amountPKR);

    // Get exchange rate
    const latestRate = await ExchangeRate.findOne({}).sort({ createdAt: -1 });
    const exchangeRate = latestRate ? latestRate.rate : 278;
    const amountUSDT = numericPKR / exchangeRate;

    // Validate minimum deposit ($10)
    if (amountUSDT < 10) {
      return sendError(
        res,
        `Minimum deposit allowed is $10.00 (equivalent to Rs. ${(10 * exchangeRate).toFixed(2)} at the current rate of Rs. ${exchangeRate}/USDT). You entered Rs. ${numericPKR} ($${amountUSDT.toFixed(2)})`,
        400
      );
    }

    // Find active PayFast payment method
    const method = await PaymentMethod.findOne({
      gateway: 'payfast',
      currency: 'PKR',
      isActive: true
    });

    if (!method) {
      return sendError(res, 'PayFast PKR deposit method is not currently available', 400);
    }

    // Generate unique order ID
    const orderId = generateOrderId('PKR');

    // Create pending deposit record
    const deposit = await Deposit.create({
      user: req.user._id,
      currency: 'PKR',
      amountPKR: numericPKR,
      amountUSDT,
      exchangeRate,
      paymentMethod: method._id,
      gateway: 'payfast',
      transactionId: orderId,
      status: 'pending',
      remarks: 'Awaiting PayFast payment verification'
    });

    // Create PayFast checkout
    try {
      const checkout = createPayfastCheckout({
        amountPKR: numericPKR,
        orderId,
        customerEmail: req.user.email,
        customerName: req.user.name,
        description: `SkyRise PKR Deposit - Rs. ${numericPKR}`
      });

      deposit.checkoutUrl = checkout.checkoutUrl;
      await deposit.save();

      return successResponse(res, 'PKR deposit initiated. Redirect to PayFast to complete payment.', {
        deposit: {
          id: deposit._id,
          transactionId: orderId,
          amountPKR: numericPKR,
          amountUSDT: amountUSDT.toFixed(4),
          exchangeRate,
          status: deposit.status,
          checkoutUrl: checkout.checkoutUrl,
          formData: checkout.formData
        }
      }, 201);
    } catch (payFastError) {
      // If PayFast fails, mark deposit as rejected
      deposit.status = 'rejected';
      deposit.remarks = `PayFast checkout creation failed: ${payFastError.message}`;
      await deposit.save();
      return sendError(res, `PayFast checkout failed: ${payFastError.message}`, 500);
    }
  } catch (error) {
    console.error('createPkrDeposit error:', error);
    return sendError(res, 'Failed to create PKR deposit', 500, error);
  }
};

/**
 * @desc    Handle PayFast callback/IPN after payment
 * @route   POST /api/payments/pkr/deposit/callback
 * @access  Public (verified via PayFast signature)
 */
const handlePayfastCallback = async (req, res) => {
  try {
    const payload = req.body;

    // Log raw webhook
    const orderId = payload.BASKET_ID || payload.basket_id || '';
    let webhookRecord;
    try {
      webhookRecord = await PaymentWebhook.create({
        gateway: 'payfast',
        transactionId: orderId || `payfast_${Date.now()}`,
        payload,
        status: 'received',
        remarks: 'PayFast callback received'
      });
    } catch (dupErr) {
      // Duplicate webhook — already processed (idempotency)
      if (dupErr.code === 11000) {
        const existing = await PaymentWebhook.findOne({ transactionId: orderId });
        if (existing && existing.status === 'verified') {
          return res.status(200).send('Callback already processed');
        }
        webhookRecord = existing;
      } else {
        throw dupErr;
      }
    }

    // Verify PayFast signature
    const verification = verifyPayfastCallback(payload);

    if (!verification.isValid) {
      if (webhookRecord) {
        webhookRecord.status = 'error';
        webhookRecord.remarks = 'PayFast signature verification failed';
        await webhookRecord.save();
      }
      console.error('PayFast callback signature mismatch');
      return res.status(400).send('Invalid signature');
    }

    // Find the deposit
    const deposit = await Deposit.findOne({ transactionId: verification.orderId });

    if (!deposit) {
      if (webhookRecord) {
        webhookRecord.status = 'error';
        webhookRecord.remarks = `No matching deposit for orderId: ${verification.orderId}`;
        await webhookRecord.save();
      }
      return res.status(200).send('No matching deposit found');
    }

    // Idempotency: Already completed?
    if (deposit.status === 'completed' || deposit.status === 'approved') {
      if (webhookRecord) {
        webhookRecord.status = 'verified';
        webhookRecord.remarks = 'Deposit already completed';
        await webhookRecord.save();
      }
      return res.status(200).send('Deposit already completed');
    }

    // Store gateway response
    deposit.gatewayResponse = verification.rawPayload;
    deposit.gatewayTransactionId = verification.gatewayTxnId;

    if (verification.isSuccessful) {
      // ✅ Payment successful — Auto-credit wallet
      deposit.status = 'completed';
      deposit.remarks = `PayFast auto-verified. Response: ${verification.responseMessage}`;
      deposit.processedAt = new Date();
      await deposit.save();

      // Credit wallet
      let wallet = await Wallet.findOne({ user: deposit.user });
      if (!wallet) {
        wallet = new Wallet({ user: deposit.user });
      }

      const prevBal = wallet.deposit || 0;
      wallet.deposit = prevBal + deposit.amountUSDT;
      await wallet.save();

      await WalletHistory.create({
        user: deposit.user,
        walletType: 'deposit',
        type: 'credit',
        amount: deposit.amountUSDT,
        previousBalance: prevBal,
        newBalance: wallet.deposit,
        category: 'deposit',
        description: `PKR deposit Rs. ${deposit.amountPKR} auto-verified via PayFast. $${deposit.amountUSDT.toFixed(2)} credited. Ref: ${verification.gatewayTxnId || deposit.transactionId}`,
        referenceModel: 'Deposit',
        referenceId: deposit._id
      });

      await Notification.create({
        user: deposit.user,
        title: 'PKR Deposit Successful! 💰',
        message: `Your PayFast deposit of Rs. ${deposit.amountPKR} ($${deposit.amountUSDT.toFixed(2)}) has been verified and credited.`,
        category: 'deposit'
      });

      if (webhookRecord) {
        webhookRecord.status = 'verified';
        webhookRecord.remarks = 'PayFast payment verified, wallet credited';
        await webhookRecord.save();
      }

      return res.status(200).send('Payment verified and wallet credited');
    } else {
      // ❌ Payment failed
      deposit.status = 'rejected';
      deposit.remarks = `PayFast payment failed. Code: ${verification.responseCode}. ${verification.responseMessage}`;
      deposit.processedAt = new Date();
      await deposit.save();

      await Notification.create({
        user: deposit.user,
        title: 'PKR Deposit Failed ❌',
        message: `Your PayFast deposit of Rs. ${deposit.amountPKR} failed. Please try again.`,
        category: 'deposit'
      });

      if (webhookRecord) {
        webhookRecord.status = 'error';
        webhookRecord.remarks = `PayFast payment failed with code ${verification.responseCode}`;
        await webhookRecord.save();
      }

      return res.status(200).send('Payment failed, deposit rejected');
    }
  } catch (error) {
    console.error('handlePayfastCallback error:', error);
    return res.status(500).send('Internal server error');
  }
};

/**
 * @desc    Get PKR deposit status
 * @route   GET /api/payments/pkr/deposit/status/:depositId
 * @access  Private
 */
const getPkrDepositStatus = async (req, res) => {
  try {
    const deposit = await Deposit.findOne({
      _id: req.params.depositId,
      user: req.user._id,
      currency: 'PKR'
    });

    if (!deposit) {
      return sendError(res, 'PKR deposit not found', 404);
    }

    return successResponse(res, 'PKR deposit status retrieved', { deposit });
  } catch (error) {
    return sendError(res, 'Failed to get deposit status', 500, error);
  }
};

// ============================================================
// USDT DEPOSIT — via CoinPayments
// ============================================================

/**
 * @desc    Create USDT deposit request and get CoinPayments checkout URL
 * @route   POST /api/payments/usdt/deposit/create
 * @access  Private
 */
const createUsdtDeposit = async (req, res) => {
  try {
    const { amountUSDT } = req.body;

    if (!amountUSDT || Number(amountUSDT) <= 0) {
      return sendError(res, 'USDT deposit amount must be a valid number greater than 0', 400);
    }

    const numericUSDT = Number(amountUSDT);

    // Minimum deposit
    if (numericUSDT < 10) {
      return sendError(res, 'Minimum USDT deposit amount is $10', 400);
    }

    // Find active CoinPayments method or fallback/create one for robust testing
    let method = await PaymentMethod.findOne({
      gateway: 'coinpayments',
      currency: 'USDT',
      isActive: true
    });

    if (!method) {
      method = await PaymentMethod.findOne({ gateway: 'coinpayments' });
      if (!method) {
        method = await PaymentMethod.create({
          name: 'CoinPayment USDT Deposit',
          type: 'crypto',
          currency: 'USDT',
          gateway: 'coinpayments',
          direction: 'deposit',
          instructions: 'Send USDT (TRC20) via CoinPayments.',
          accountDetails: {
            currency: process.env.COINPAYMENTS_CURRENCY || 'LTCT'
          },
          minDeposit: 10,
          isActive: true
        });
      }
    }

    // Generate unique order ID
    const orderId = generateOrderId('USDT');

    // Check if Sandbox Mode is active for instant auto-approval
    if (process.env.COINPAYMENTS_MODE === 'sandbox') {
      const mockTx = 'MOCK_TX_' + crypto.randomBytes(4).toString('hex').toUpperCase();
      const deposit = await Deposit.create({
        user: req.user._id,
        currency: 'USDT',
        amountPKR: null,
        amountUSDT: numericUSDT,
        exchangeRate: null,
        paymentMethod: method._id,
        gateway: 'coinpayments',
        transactionId: orderId,
        gatewayTransactionId: mockTx,
        status: 'completed',
        remarks: 'MOCK Sandbox Auto-Approved'
      });

      // Credit wallet
      let wallet = await Wallet.findOne({ user: req.user._id });
      if (!wallet) {
        wallet = new Wallet({ user: req.user._id });
      }
      const prevBal = wallet.deposit || 0;
      wallet.deposit = prevBal + numericUSDT;
      await wallet.save();

      // Log wallet history
      await WalletHistory.create({
        user: req.user._id,
        walletType: 'deposit',
        type: 'credit',
        amount: numericUSDT,
        previousBalance: prevBal,
        newBalance: wallet.deposit,
        category: 'deposit',
        description: `MOCK Sandbox auto-approved deposit. Amount: $${numericUSDT.toFixed(2)}. Gateway Tx: ${mockTx}`,
        referenceModel: 'Deposit',
        referenceId: deposit._id
      });

      // Create notification
      await Notification.create({
        user: req.user._id,
        title: 'MOCK Deposit Approved! 💰',
        message: `Your mock sandbox deposit of $${numericUSDT.toFixed(2)} has been instantly approved and credited.`,
        category: 'deposit'
      });

      const successUrl = `${process.env.APP_URL || 'http://localhost:3000'}/dashboard/deposits?status=success&orderId=${orderId}`;

      return successResponse(res, 'MOCK Sandbox deposit auto-approved.', {
        deposit: {
          id: deposit._id,
          transactionId: orderId,
          amountUSDT: numericUSDT,
          status: deposit.status,
          checkoutUrl: successUrl,
          invoiceId: mockTx
        }
      }, 201);
    }

    // Live mode: Create real CoinPayments invoice
    try {
      const cpInvoice = await createCPInvoice({
        amountUSDT: numericUSDT,
        orderId,
        buyerEmail: req.user.email
      });

      const deposit = await Deposit.create({
        user: req.user._id,
        currency: 'USDT',
        amountPKR: null,
        amountUSDT: numericUSDT,
        exchangeRate: null,
        paymentMethod: method._id,
        gateway: 'coinpayments',
        transactionId: orderId,
        gatewayTransactionId: cpInvoice.invoiceId,
        status: 'pending',
        checkoutUrl: cpInvoice.checkoutUrl,
        expiresAt: cpInvoice.expiresAt,
        cryptoAddress: cpInvoice.address || null,
        cryptoAmount: cpInvoice.amount ? Number(cpInvoice.amount) : numericUSDT,
        cryptoQrCodeUrl: cpInvoice.qrcodeUrl || null,
        gatewayResponse: cpInvoice.rawResponse,
        remarks: 'Awaiting CoinPayments USDT payment (Real/Live Transaction)'
      });

      return successResponse(res, 'USDT deposit initiated. Complete your crypto checkout.', {
        deposit: {
          id: deposit._id,
          transactionId: orderId,
          amountUSDT: numericUSDT,
          status: deposit.status,
          checkoutUrl: cpInvoice.checkoutUrl,
          invoiceId: cpInvoice.invoiceId,
          expiresAt: cpInvoice.expiresAt,
          cryptoAddress: cpInvoice.address || null,
          cryptoAmount: cpInvoice.amount ? Number(cpInvoice.amount) : numericUSDT,
          cryptoQrCodeUrl: cpInvoice.qrcodeUrl || null
        }
      }, 201);
    } catch (cpError) {
      console.error('CoinPayments Live Invoice Creation Error:', cpError);
      return sendError(res, `Failed to initialize CoinPayments invoice: ${cpError.message}`, 500);
    }
  } catch (error) {
    console.error('createUsdtDeposit error:', error);
    return sendError(res, 'Failed to create USDT deposit', 500, error);
  }
};

/**
 * @desc    Get USDT deposit status
 * @route   GET /api/payments/usdt/deposit/status/:depositId
 * @access  Private
 */
const getUsdtDepositStatus = async (req, res) => {
  try {
    const deposit = await Deposit.findOne({
      _id: req.params.depositId,
      user: req.user._id,
      currency: 'USDT'
    });

    if (!deposit) {
      return sendError(res, 'USDT deposit not found', 404);
    }

    return successResponse(res, 'USDT deposit status retrieved', { deposit });
  } catch (error) {
    return sendError(res, 'Failed to get deposit status', 500, error);
  }
};

// ============================================================
// PKR WITHDRAWAL — Auto-payout
// ============================================================

/**
 * @desc    Auto-payout PKR withdrawal (bank / raast / jazzcash / easypaisa) via payout provider API
 * @route   POST /api/payments/pkr/withdraw
 * @access  Private
 */
const withdrawPkr = async (req, res) => {
  let prevBalance = 0;
  let wallet = null;
  let sourceWallet = '';
  let numericUSDT = 0;

  try {
    const { amountUSDT, sourceWallet: requestedWallet, withdrawalAccountId } = req.body;
    sourceWallet = requestedWallet;

    if (!amountUSDT || !sourceWallet || !withdrawalAccountId) {
      return sendError(res, 'amountUSDT, sourceWallet and withdrawalAccountId are required', 400);
    }

    numericUSDT = Number(amountUSDT);
    if (Number.isNaN(numericUSDT) || numericUSDT <= 0) {
      return sendError(res, 'Withdrawal amount must be greater than 0', 400);
    }

    // Validate sourceWallet
    const allowedWallets = ['deposit', 'roi', 'referral', 'salary', 'achievement', 'bonusReceived', 'bonusTransferable'];
    if (!allowedWallets.includes(sourceWallet)) {
      return sendError(res, `Invalid source wallet. Allowed: ${allowedWallets.join(', ')}`, 400);
    }

    // System settings
    const settings = await SystemSettings.findOne({});
    const minLimit = settings?.minWithdrawalAmount || 10;
    const feePercent = settings?.withdrawalFeePercent || 5;
    const kycRequired = settings?.kycRequiredForWithdrawal ?? true;

    if (kycRequired && req.user.kycStatus !== 'approved') {
      return sendError(res, 'KYC approval is required before withdrawing funds', 400);
    }

    if (numericUSDT < minLimit) {
      return sendError(res, `Minimum withdrawal amount is $${minLimit}`, 400);
    }

    // Verify withdrawal account
    const withdrawAcc = await WithdrawalAccount.findOne({
      _id: withdrawalAccountId,
      user: req.user._id,
      isActive: true
    });

    if (!withdrawAcc) {
      return sendError(res, 'Invalid or inactive withdrawal account', 400);
    }

    const pkrChannels = ['bank', 'raast', 'jazzcash', 'easypaisa'];
    if (!pkrChannels.includes(withdrawAcc.channel)) {
      return sendError(res, `PKR withdrawals require a PKR payout channel (bank/raast/jazzcash/easypaisa). Selected: ${withdrawAcc.channel}`, 400);
    }

    // Check balance
    wallet = await Wallet.findOne({ user: req.user._id });
    if (!wallet) {
      return sendError(res, 'User wallet not found', 400);
    }

    const availableBalance = Number(wallet[sourceWallet] || 0);
    if (availableBalance < numericUSDT) {
      return sendError(res, `Insufficient ${sourceWallet} balance. Available: $${availableBalance.toFixed(2)}, requested: $${numericUSDT.toFixed(2)}`, 400);
    }

    // Calculate fees
    const feeUSDT = numericUSDT * (feePercent / 100);
    const payableAmountUSDT = numericUSDT - feeUSDT;

    // Get exchange rate
    const latestRate = await ExchangeRate.findOne({}).sort({ createdAt: -1 });
    const exchangeRate = latestRate ? latestRate.rate : 278;
    const amountPKR = numericUSDT * exchangeRate;
    const payableAmountPKR = payableAmountUSDT * exchangeRate;

    // Lock/deduct the amount from source wallet first (prevent double-spend)
    prevBalance = wallet[sourceWallet] || 0;
    wallet[sourceWallet] = prevBalance - numericUSDT;
    await wallet.save();

    // Check if Sandbox Mode is active for instant auto-approval
    if (process.env.COINPAYMENTS_MODE === 'sandbox') {
      const mockTxHash = 'MOCK_PKR_HASH_' + crypto.randomBytes(16).toString('hex').toUpperCase();
      const withdrawal = await Withdrawal.create({
        user: req.user._id,
        sourceWallet,
        withdrawalCurrency: 'PKR',
        amountUSDT: numericUSDT,
        amountPKR,
        exchangeRate,
        feeUSDT,
        payableAmountUSDT,
        payableAmountPKR,
        withdrawalAccount: withdrawalAccountId,
        txHash: mockTxHash,
        status: 'approved',
        remarks: 'MOCK Sandbox PKR withdrawal processed instantly'
      });

      await WalletHistory.create({
        user: req.user._id,
        walletType: sourceWallet,
        type: 'debit',
        amount: numericUSDT,
        previousBalance: prevBalance,
        newBalance: wallet[sourceWallet],
        category: 'withdrawal',
        description: `MOCK Sandbox PKR withdrawal completed. Amount: $${numericUSDT}. Fee: $${feeUSDT.toFixed(2)}. Payout hash: ${mockTxHash}`,
        referenceModel: 'Withdrawal',
        referenceId: withdrawal._id
      });

      await Notification.create({
        user: req.user._id,
        title: 'PKR Payout Completed! ✅',
        message: `Your mock PKR payout of Rs. ${payableAmountPKR.toFixed(0)} ($${payableAmountUSDT.toFixed(2)}) has been successfully completed. Hash: ${mockTxHash}`,
        category: 'withdrawal'
      });

      return successResponse(res, 'MOCK Sandbox PKR payout completed successfully', { withdrawal }, 200);
    }

    // Call payout provider API
    let payoutResult;
    try {
      payoutResult = await payoutService.createPayout({
        amountPKR: payableAmountPKR,
        channel: withdrawAcc.channel,
        accountTitle: withdrawAcc.accountTitle,
        accountNumber: withdrawAcc.accountNumber,
        bankDetails: withdrawAcc.bankDetails
      });
    } catch (payoutErr) {
      // ❌ Payout API call failed — Rollback/Refund wallet immediately
      wallet[sourceWallet] = prevBalance;
      await wallet.save();
      return sendError(res, `PKR automated payout failed: ${payoutErr.message}`, 400);
    }

    // Create completed withdrawal request
    const withdrawal = await Withdrawal.create({
      user: req.user._id,
      sourceWallet,
      withdrawalCurrency: 'PKR',
      amountUSDT: numericUSDT,
      amountPKR,
      exchangeRate,
      feeUSDT,
      payableAmountUSDT,
      payableAmountPKR,
      withdrawalAccount: withdrawalAccountId,
      txHash: payoutResult.referenceId,
      status: 'approved', // Approved (completed) immediately since payout succeeded
      remarks: `Payout processed automatically via provider API. Reference: ${payoutResult.referenceId}`
    });

    // Log wallet history
    await WalletHistory.create({
      user: req.user._id,
      walletType: sourceWallet,
      type: 'debit',
      amount: numericUSDT,
      previousBalance: prevBalance,
      newBalance: wallet[sourceWallet],
      category: 'withdrawal',
      description: `PKR withdrawal completed automatically. Amount: $${numericUSDT}. Fee: $${feeUSDT.toFixed(2)}. Payout reference: ${payoutResult.referenceId}`,
      referenceModel: 'Withdrawal',
      referenceId: withdrawal._id
    });

    await Notification.create({
      user: req.user._id,
      title: 'PKR Payout Completed! ✅',
      message: `Your payout of Rs. ${payableAmountPKR.toFixed(0)} ($${payableAmountUSDT.toFixed(2)}) has been transferred. Ref: ${payoutResult.referenceId}`,
      category: 'withdrawal'
    });

    return successResponse(res, 'PKR payout completed successfully', { withdrawal }, 200);
  } catch (error) {
    console.error('withdrawPkr error:', error);
    // Safety check: rollback if database fails but we already deducted
    if (wallet && sourceWallet && prevBalance > 0 && wallet[sourceWallet] !== prevBalance) {
      try {
        wallet[sourceWallet] = prevBalance;
        await wallet.save();
      } catch (dbErr) {
        console.error('CRITICAL: Wallet refund rollback failed in catch block:', dbErr);
      }
    }
    return sendError(res, 'Failed to process PKR withdrawal payout', 500, error);
  }
};

/**
 * @desc    Auto-payout USDT withdrawal (TRC20 wallet address) via CoinPayments Classic API
 * @route   POST /api/payments/usdt/withdraw
 * @access  Private
 */
const withdrawUsdt = async (req, res) => {
  let prevBalance = 0;
  let wallet = null;
  let sourceWallet = '';
  let numericUSDT = 0;

  try {
    const { amountUSDT, sourceWallet: requestedWallet, withdrawalAccountId } = req.body;
    sourceWallet = requestedWallet;

    if (!amountUSDT || !sourceWallet || !withdrawalAccountId) {
      return sendError(res, 'amountUSDT, sourceWallet and withdrawalAccountId are required', 400);
    }

    numericUSDT = Number(amountUSDT);
    if (Number.isNaN(numericUSDT) || numericUSDT <= 0) {
      return sendError(res, 'Withdrawal amount must be greater than 0', 400);
    }

    // Validate sourceWallet
    const allowedWallets = ['deposit', 'roi', 'referral', 'salary', 'achievement', 'bonusReceived', 'bonusTransferable'];
    if (!allowedWallets.includes(sourceWallet)) {
      return sendError(res, `Invalid source wallet. Allowed: ${allowedWallets.join(', ')}`, 400);
    }

    // System settings
    const settings = await SystemSettings.findOne({});
    const minLimit = settings?.minWithdrawalAmount || 10;
    const feePercent = settings?.withdrawalFeePercent || 5;
    const kycRequired = settings?.kycRequiredForWithdrawal ?? true;

    if (kycRequired && req.user.kycStatus !== 'approved') {
      return sendError(res, 'KYC approval is required before withdrawing funds', 400);
    }

    if (numericUSDT < minLimit) {
      return sendError(res, `Minimum withdrawal amount is $${minLimit}`, 400);
    }

    // Verify withdrawal account
    const withdrawAcc = await WithdrawalAccount.findOne({
      _id: withdrawalAccountId,
      user: req.user._id,
      isActive: true
    });

    if (!withdrawAcc) {
      return sendError(res, 'Invalid or inactive withdrawal account', 400);
    }

    const usdtChannels = ['usdt_trc20', 'coinpayments'];
    if (!usdtChannels.includes(withdrawAcc.channel)) {
      return sendError(res, `USDT withdrawals require a crypto payout channel (usdt_trc20/coinpayments). Selected: ${withdrawAcc.channel}`, 400);
    }

    // Validate TRC20 address
    const walletAddress = withdrawAcc.walletAddress || withdrawAcc.accountNumber;
    if (!walletAddress || !walletAddress.startsWith('T') || walletAddress.length !== 34) {
      return sendError(res, 'Invalid TRC20 wallet address format. Must start with T and be 34 characters.', 400);
    }

    // Check balance
    wallet = await Wallet.findOne({ user: req.user._id });
    if (!wallet) {
      return sendError(res, 'User wallet not found', 400);
    }

    const availableBalance = Number(wallet[sourceWallet] || 0);
    if (availableBalance < numericUSDT) {
      return sendError(res, `Insufficient ${sourceWallet} balance. Available: $${availableBalance.toFixed(2)}, requested: $${numericUSDT.toFixed(2)}`, 400);
    }

    // Calculate fees
    const feeUSDT = numericUSDT * (feePercent / 100);
    const payableAmountUSDT = numericUSDT - feeUSDT;

    // Lock/deduct the amount from source wallet first (prevent double-spend)
    prevBalance = wallet[sourceWallet] || 0;
    wallet[sourceWallet] = prevBalance - numericUSDT;
    await wallet.save();

    // Check if Sandbox Mode is active for instant auto-approval
    if (process.env.COINPAYMENTS_MODE === 'sandbox') {
      const mockTxHash = 'MOCK_HASH_' + crypto.randomBytes(16).toString('hex').toUpperCase();
      const withdrawal = await Withdrawal.create({
        user: req.user._id,
        sourceWallet,
        withdrawalCurrency: 'USDT',
        amountUSDT: numericUSDT,
        amountPKR: null,
        exchangeRate: null,
        feeUSDT,
        payableAmountUSDT,
        payableAmountPKR: null,
        withdrawalAccount: withdrawalAccountId,
        txHash: mockTxHash,
        status: 'approved',
        remarks: 'MOCK Sandbox USDT withdrawal processed instantly'
      });

      await WalletHistory.create({
        user: req.user._id,
        walletType: sourceWallet,
        type: 'debit',
        amount: numericUSDT,
        previousBalance: prevBalance,
        newBalance: wallet[sourceWallet],
        category: 'withdrawal',
        description: `MOCK Sandbox USDT withdrawal completed. Amount: $${numericUSDT}. Fee: $${feeUSDT.toFixed(2)}. Payout hash: ${mockTxHash}`,
        referenceModel: 'Withdrawal',
        referenceId: withdrawal._id
      });

      await Notification.create({
        user: req.user._id,
        title: 'USDT Payout Completed! ✅',
        message: `Your mock payout of $${payableAmountUSDT.toFixed(2)} has been successfully completed. Hash: ${mockTxHash}`,
        category: 'withdrawal'
      });

      return successResponse(res, 'MOCK Sandbox payout completed successfully', { withdrawal }, 200);
    }

    // We do not support automatic USDT payouts via the REST API.
    // Create a rejected withdrawal request for record/auditing purposes
    const errorMsg = 'USDT automatic payout provider is not configured or supported.';
    const withdrawal = await Withdrawal.create({
      user: req.user._id,
      sourceWallet,
      withdrawalCurrency: 'USDT',
      amountUSDT: numericUSDT,
      amountPKR: null,
      exchangeRate: null,
      feeUSDT,
      payableAmountUSDT,
      payableAmountPKR: null,
      withdrawalAccount: withdrawalAccountId,
      txHash: null,
      status: 'rejected',
      remarks: errorMsg
    });

    // Rollback/Refund wallet immediately
    wallet[sourceWallet] = prevBalance;
    await wallet.save();

    return sendError(res, errorMsg, 400);
  } catch (error) {
    console.error('withdrawUsdt error:', error);
    // Safety check: rollback if database fails but we already deducted
    if (wallet && sourceWallet && prevBalance > 0 && wallet[sourceWallet] !== prevBalance) {
      try {
        wallet[sourceWallet] = prevBalance;
        await wallet.save();
      } catch (dbErr) {
        console.error('CRITICAL: Wallet refund rollback failed in catch block:', dbErr);
      }
    }
    return sendError(res, 'Failed to process USDT withdrawal payout', 500, error);
  }
};

// ============================================================
// SHARED: User's withdrawal history
// ============================================================

/**
 * @desc    Get user's withdrawal requests
 * @route   GET /api/payments/withdrawals/my
 * @access  Private
 */
const getMyWithdrawals = async (req, res) => {
  try {
    const filter = { user: req.user._id };
    if (req.query.currency) filter.withdrawalCurrency = req.query.currency.toUpperCase();
    if (req.query.status) filter.status = req.query.status;

    const withdrawals = await Withdrawal.find(filter)
      .populate('withdrawalAccount')
      .sort({ createdAt: -1 });

    return successResponse(res, 'Withdrawal history retrieved', { withdrawals });
  } catch (error) {
    return sendError(res, 'Failed to get withdrawal history', 500, error);
  }
};

/**
 * @desc    Get user's deposit history
 * @route   GET /api/payments/deposits/my
 * @access  Private
 */
const getMyDeposits = async (req, res) => {
  try {
    const filter = { user: req.user._id };
    if (req.query.currency) filter.currency = req.query.currency.toUpperCase();
    if (req.query.status) filter.status = req.query.status;

    const deposits = await Deposit.find(filter)
      .populate('paymentMethod', 'name gateway currency')
      .sort({ createdAt: -1 });

    return successResponse(res, 'Deposit history retrieved', { deposits });
  } catch (error) {
    return sendError(res, 'Failed to get deposit history', 500, error);
  }
};

export default {
  createPkrDeposit,
  handlePayfastCallback,
  getPkrDepositStatus,
  createUsdtDeposit,
  getUsdtDepositStatus,
  withdrawPkr,
  withdrawUsdt,
  getMyWithdrawals,
  getMyDeposits
};
