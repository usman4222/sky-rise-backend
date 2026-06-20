import mongoose from 'mongoose';

// Models with ESM suffix
import Wallet from '../models/finance/wallet.model.js';
import WalletHistory from '../models/finance/wallet_history.model.js';
import Deposit from '../models/finance/deposit.model.js';
import PaymentMethod from '../models/finance/payment_method.model.js';
import Withdrawal from '../models/finance/withdrawal.model.js';
import WithdrawalAccount from '../models/finance/withdrawal_account.model.js';
import ExchangeRate from '../models/investment/exchange_rate.model.js';
import ReferralTree from '../models/network/referral_tree.model.js';
import TeamBonusTransfer from '../models/rewards/team_bonus_transfer.model.js';
import User from '../models/auth/user.model.js';
import Notification from '../models/system/notification.model.js';
import SystemSettings from '../models/system/system_settings.model.js';
import UserInvestment from '../models/investment/user_investment.model.js';
import AdminBalanceHistory from '../models/finance/admin_balance_history.model.js';

// Response helpers
import { sendError, successResponse } from '../utils/response.js';

// @desc    Get active payment methods for deposit
// @route   GET /api/finance/payment-methods
// @access  Private
const getPaymentMethods = async (req, res) => {
  try {
    const methods = await PaymentMethod.find({ isActive: true }).sort({
      createdAt: -1
    });

    return successResponse(res, 'Payment methods retrieved successfully', {
      methods
    });
  } catch (error) {
    console.error('getPaymentMethods error:', error);
    return sendError(res, 'Internal finance error', 500, error);
  }
};

// @desc    Submit deposit and auto-credit wallet (or pending based on gateway)
// @route   POST /api/finance/deposit
// @access  Private
const submitDeposit = async (req, res) => {
  try {
    const { currency = 'PKR', amountPKR, amountUSDT, paymentMethodId, transactionId, proofImageUrl } = req.body;

    if (!paymentMethodId || !transactionId) {
      return sendError(
        res,
        'Required deposit details are missing. paymentMethodId and transactionId are required.',
        400
      );
    }

    if (!['PKR', 'USDT'].includes(currency)) {
      return sendError(res, 'Invalid deposit currency. Must be PKR or USDT.', 400);
    }

    if (!mongoose.Types.ObjectId.isValid(paymentMethodId)) {
      return sendError(res, 'Invalid payment method ID format', 400);
    }

    const method = await PaymentMethod.findById(paymentMethodId);

    if (!method || !method.isActive) {
      return sendError(res, 'Invalid or inactive payment method selected', 400);
    }

    const duplicateTx = await Deposit.findOne({
      transactionId: transactionId.trim()
    });

    if (duplicateTx) {
      return sendError(res, 'Duplicate deposit transaction receipt ID', 400);
    }

    const latestRate = await ExchangeRate.findOne({}).sort({ createdAt: -1 });
    const exchangeRate = latestRate ? latestRate.rate : 278;

    let finalAmountUSDT = 0;
    let numericAmountPKR = null;
    let finalExchangeRate = null;

    if (currency === 'PKR') {
      numericAmountPKR = Number(amountPKR);
      if (Number.isNaN(numericAmountPKR) || numericAmountPKR <= 0) {
        return sendError(res, 'PKR deposit amount must be a valid number greater than 0', 400);
      }
      finalExchangeRate = exchangeRate;
      finalAmountUSDT = numericAmountPKR / exchangeRate;
    } else {
      // currency === 'USDT'
      finalAmountUSDT = Number(amountUSDT);
      if (Number.isNaN(finalAmountUSDT) || finalAmountUSDT <= 0) {
        return sendError(res, 'USDT deposit amount must be a valid number greater than 0', 400);
      }
    }

    if (finalAmountUSDT < 10) {
      return sendError(res, 'Deposit failed: Minimum deposit amount allowed is $10.00 (USD value).', 400);
    }

    const status = 'approved';

    const deposit = await Deposit.create({
      user: req.user._id,
      currency,
      amountPKR: numericAmountPKR,
      amountUSDT: finalAmountUSDT,
      exchangeRate: finalExchangeRate,
      paymentMethod: paymentMethodId,
      gateway: method.gateway || 'manual',
      transactionId: transactionId.trim(),
      proofImageUrl: proofImageUrl || null,
      status,
      remarks: `Deposit auto-approved and credited to wallet. Method: ${method.name}`,
      processedBy: null,
      processedAt: new Date()
    });

    let wallet = await Wallet.findOne({ user: req.user._id });
    if (!wallet) {
      wallet = new Wallet({ user: req.user._id });
    }

    const previousBalance = wallet.deposit || 0;
    wallet.deposit = previousBalance + finalAmountUSDT;
    await wallet.save();

    await WalletHistory.create({
      user: req.user._id,
      walletType: 'deposit',
      type: 'credit',
      amount: finalAmountUSDT,
      previousBalance,
      newBalance: wallet.deposit,
      category: 'deposit',
      description: `Deposit (${currency}) Rs. ${numericAmountPKR || 0} / $${finalAmountUSDT.toFixed(2)} auto-approved. Credited to deposit wallet. Transaction ID: ${transactionId}`,
      referenceModel: 'Deposit',
      referenceId: deposit._id
    });

    await Notification.create({
      user: req.user._id,
      title: 'Deposit Added',
      message: `Your deposit of ${currency === 'PKR' ? 'Rs. ' + numericAmountPKR : '$' + finalAmountUSDT} ($${finalAmountUSDT.toFixed(2)}) has been added to your deposit wallet.`,
      category: 'deposit'
    });

    return successResponse(
      res,
      'Deposit added successfully and wallet credited.',
      {
        deposit,
        wallet
      },
      201
    );
  } catch (error) {
    console.error('Submit deposit error:', error);
    return sendError(res, 'Internal deposit error', 500, error);
  }
};

// @desc    Submit normal withdrawal request
// @route   POST /api/finance/withdraw
// @access  Private
const submitWithdrawal = async (req, res) => {
  try {
    const { amountUSDT, sourceWallet, withdrawalAccountId, withdrawalCurrency } = req.body;

    if (!amountUSDT || !sourceWallet || !withdrawalAccountId) {
      return sendError(
        res,
        'Required withdrawal options are missing. amountUSDT, sourceWallet and withdrawalAccountId are required.',
        400
      );
    }

    // Verify if the user has at least one active investment package first
    const hasActiveInvestment = await UserInvestment.findOne({ user: req.user._id, status: 'active' });
    if (!hasActiveInvestment) {
      return sendError(
        res,
        'Withdrawal failed: You must have at least one active investment package to be eligible for withdrawals.',
        400
      );
    }

    // Check Favor Account Monthly condition block
    if (req.user.favorConditionEnabled && req.user.favorWithdrawalStatus === 'blocked') {
      return sendError(
        res,
        'Withdrawal Suspended: Monthly 1X business target not completed.',
        403
      );
    }

    if (!mongoose.Types.ObjectId.isValid(withdrawalAccountId)) {
      return sendError(res, 'Invalid withdrawal account ID format', 400);
    }

    const numericAmountUSDT = Number(amountUSDT);

    if (Number.isNaN(numericAmountUSDT) || numericAmountUSDT <= 0) {
      return sendError(res, 'Withdrawal amount must be a valid number greater than 0', 400);
    }

    const allowedSourceWallets = [
      'roi',
      'referral',
      'salary',
      'achievement',
      'bonusReceived',
      'bonusTransferable'
    ];

    if (!allowedSourceWallets.includes(sourceWallet)) {
      return sendError(
        res,
        `Invalid sourceWallet. Allowed wallets are: ${allowedSourceWallets.join(', ')}`,
        400
      );
    }

    const settings = await SystemSettings.findOne({});
    const minLimit = settings ? settings.minWithdrawalAmount : 10;
    const feePercent = settings ? settings.withdrawalFeePercent : 5;
    const kycRequired = settings ? settings.kycRequiredForWithdrawal : true;

    if (kycRequired && req.user.kycStatus !== 'approved') {
      return sendError(res, 'KYC approval is required before withdrawing funds', 400);
    }

    if (numericAmountUSDT < minLimit) {
      return sendError(res, `Minimum withdrawal amount allowed is $${minLimit}`, 400);
    }

    const wallet = await Wallet.findOne({ user: req.user._id });

    if (!wallet) {
      return sendError(res, 'User wallet not found', 400);
    }

    const availableBalance = Number(wallet[sourceWallet] || 0);

    if (availableBalance < numericAmountUSDT) {
      return sendError(
        res,
        `Insufficient balance inside selected ${sourceWallet} wallet. Available: $${availableBalance.toFixed(
          2
        )}, requested: $${numericAmountUSDT.toFixed(2)}`,
        400
      );
    }

    const withdrawAcc = await WithdrawalAccount.findOne({
      _id: withdrawalAccountId,
      user: req.user._id,
      isActive: true
    });

    if (!withdrawAcc) {
      return sendError(res, 'Invalid or inactive payout account details selected', 400);
    }

    // Determine withdrawal currency (default to USDT if crypto channel, otherwise PKR)
    const isCryptoChannel = ['usdt_trc20', 'coinpayments'].includes(withdrawAcc.channel);
    const finalWithdrawalCurrency = withdrawalCurrency || (isCryptoChannel ? 'USDT' : 'PKR');

    if (!['PKR', 'USDT'].includes(finalWithdrawalCurrency)) {
      return sendError(res, 'Invalid withdrawal currency. Must be PKR or USDT.', 400);
    }

    const feeUSDT = numericAmountUSDT * (feePercent / 100);
    const payableAmountUSDT = numericAmountUSDT - feeUSDT;

    const latestRate = await ExchangeRate.findOne({}).sort({ createdAt: -1 });
    const exchangeRate = latestRate ? latestRate.rate : 278;

    let amountPKR = null;
    let payableAmountPKR = null;
    let finalExchangeRate = null;

    if (finalWithdrawalCurrency === 'PKR') {
      finalExchangeRate = exchangeRate;
      amountPKR = numericAmountUSDT * exchangeRate;
      payableAmountPKR = payableAmountUSDT * exchangeRate;
    }

    const prevBalance = wallet[sourceWallet] || 0;
    wallet[sourceWallet] = prevBalance - numericAmountUSDT;
    wallet.withdrawal = (wallet.withdrawal || 0) + numericAmountUSDT;
    await wallet.save();

    const withdrawal = await Withdrawal.create({
      user: req.user._id,
      sourceWallet,
      withdrawalCurrency: finalWithdrawalCurrency,
      amountUSDT: numericAmountUSDT,
      amountPKR,
      exchangeRate: finalExchangeRate,
      feeUSDT,
      payableAmountUSDT,
      payableAmountPKR,
      withdrawalAccount: withdrawalAccountId,
      status: 'pending'
    });

    await WalletHistory.create({
      user: req.user._id,
      walletType: sourceWallet,
      type: 'debit',
      amount: numericAmountUSDT,
      previousBalance: prevBalance,
      newBalance: wallet[sourceWallet],
      category: 'withdrawal',
      description: `Withdrawal (${finalWithdrawalCurrency}) requested from ${sourceWallet} wallet. Amount: $${numericAmountUSDT}. Fee: $${feeUSDT}. Net payable: $${payableAmountUSDT}`,
      referenceModel: 'Withdrawal',
      referenceId: withdrawal._id
    });

    await Notification.create({
      user: req.user._id,
      title: 'Withdrawal Request Created',
      message: `Pending payout of $${payableAmountUSDT.toFixed(2)} ${
        finalWithdrawalCurrency === 'PKR' ? `(Rs. ${payableAmountPKR.toFixed(2)})` : ''
      } is created. Fee: $${feeUSDT.toFixed(2)}.`,
      category: 'withdrawal'
    });

    return successResponse(
      res,
      'Withdrawal requested successfully! Processing.',
      {
        withdrawal
      },
      201
    );
  } catch (error) {
    console.error('Withdrawal error:', error);
    return sendError(res, 'Internal withdrawal error', 500, error);
  }
};

// @desc    Add/save reusable user withdrawal payout account details
// @route   POST /api/finance/withdrawal-accounts
// @access  Private
const addWithdrawalAccount = async (req, res) => {
  try {
    const { name, channel, accountTitle, accountNumber, bankDetails, walletAddress, raastId } = req.body;

    if (!name || !channel || !accountTitle || !accountNumber) {
      return sendError(
        res,
        'Required account information is missing. name, channel, accountTitle and accountNumber are required.',
        400
      );
    }

    const allowedChannels = ['bank', 'raast', 'jazzcash', 'easypaisa', 'usdt_trc20', 'coinpayments'];
    if (!allowedChannels.includes(channel.toLowerCase().trim())) {
      return sendError(
        res,
        `Invalid withdrawal channel. Allowed channels are: ${allowedChannels.join(', ')}`,
        400
      );
    }

    const account = await WithdrawalAccount.create({
      user: req.user._id,
      name: name.trim(),
      channel: channel.toLowerCase().trim(),
      accountTitle: accountTitle.trim(),
      accountNumber: accountNumber.trim(),
      walletAddress: walletAddress ? walletAddress.trim() : null,
      raastId: raastId ? raastId.trim() : null,
      bankDetails: bankDetails || null,
      isActive: true
    });

    return successResponse(
      res,
      'Payout withdrawal account saved successfully!',
      {
        account: {
          id: account._id,
          name: account.name,
          channel: account.channel,
          accountTitle: account.accountTitle
        }
      },
      201
    );
  } catch (error) {
    console.error('addWithdrawalAccount error:', error);

    if (error.name === 'ValidationError') {
      return sendError(res, error.message, 400, error);
    }

    if (error.code === 11000) {
      return sendError(res, 'This payout account already exists', 400, error);
    }

    return sendError(
      res,
      error.message || 'Internal payout account error',
      500,
      error
    );
  }
};

// @desc    Get user's saved withdrawal accounts
// @route   GET /api/finance/withdrawal-accounts
// @access  Private
const getWithdrawalAccounts = async (req, res) => {
  try {
    const accounts = await WithdrawalAccount.find({
      user: req.user._id,
      isActive: true
    }).sort({
      createdAt: -1
    });

    return successResponse(res, 'Withdrawal accounts retrieved successfully', {
      accounts
    });
  } catch (error) {
    console.error('getWithdrawalAccounts error:', error);
    return sendError(res, 'Internal payout query error', 500, error);
  }
};

// @desc    Manual Team Transfer of transferable team registration bonus
// @route   POST /api/finance/transfer-bonus
// @access  Private
const transferTeamBonus = async (req, res) => {
  try {
    const { recipientIdOrCode, amount } = req.body;

    if (!recipientIdOrCode || !amount || amount <= 0) {
      return sendError(res, 'Required transfer parameters are missing', 400);
    }

    const numericAmount = Number(amount);

    if (Number.isNaN(numericAmount) || numericAmount <= 0) {
      return sendError(res, 'Transfer amount must be a valid number greater than 0', 400);
    }

    const senderWallet = await Wallet.findOne({ user: req.user._id });

    if (!senderWallet || senderWallet.bonusTransferable < numericAmount) {
      return sendError(res, 'Insufficient transferable bonus balance', 400);
    }

    let receiver = await User.findOne({
      referralCode: recipientIdOrCode.trim()
    });

    if (!receiver && mongoose.Types.ObjectId.isValid(recipientIdOrCode)) {
      receiver = await User.findById(recipientIdOrCode);
    }

    if (!receiver) {
      return sendError(res, 'Recipient downline profile not found', 404);
    }

    const receiverId = receiver._id;

    if (receiverId.toString() === req.user._id.toString()) {
      return sendError(res, 'Cannot transfer bonus balance to yourself', 400);
    }

    const receiverTree = await ReferralTree.findOne({ user: receiverId });

    if (!receiverTree || !receiverTree.ancestors) {
      return sendError(res, 'Recipient referral tree not found', 400);
    }

    const ancestorIds = receiverTree.ancestors.map((id) => id.toString());
    const senderIndex = ancestorIds.indexOf(req.user._id.toString());

    if (senderIndex === -1) {
      return sendError(
        res,
        'Transfers are allowed only to members inside your referral network',
        400
      );
    }

    const depth = senderIndex + 1;

    if (depth > 5) {
      return sendError(res, 'Transfers are restricted to downline members up to 5 levels only', 400);
    }

    const prevSenderBal = senderWallet.bonusTransferable;
    senderWallet.bonusTransferable -= numericAmount;
    await senderWallet.save();

    let receiverWallet = await Wallet.findOne({ user: receiverId });

    if (!receiverWallet) {
      receiverWallet = new Wallet({ user: receiverId });
    }

    const prevRecBal = receiverWallet.bonusReceived || 0;
    receiverWallet.bonusReceived = prevRecBal + numericAmount;
    await receiverWallet.save();

    const transfer = await TeamBonusTransfer.create({
      sender: req.user._id,
      receiver: receiverId,
      amount: numericAmount,
      level: depth
    });

    await WalletHistory.create({
      user: req.user._id,
      walletType: 'bonusTransferable',
      type: 'debit',
      amount: numericAmount,
      previousBalance: prevSenderBal,
      newBalance: senderWallet.bonusTransferable,
      category: 'transfer_sent',
      description: `Transferred $${numericAmount} manual bonus to downline user ${receiver.name} (Level ${depth})`,
      referenceModel: 'TeamBonusTransfer',
      referenceId: transfer._id
    });

    await WalletHistory.create({
      user: receiverId,
      walletType: 'bonusReceived',
      type: 'credit',
      amount: numericAmount,
      previousBalance: prevRecBal,
      newBalance: receiverWallet.bonusReceived,
      category: 'transfer_received',
      description: `Received $${numericAmount} manual bonus transfer from upline user ${req.user.name}`,
      referenceModel: 'TeamBonusTransfer',
      referenceId: transfer._id
    });

    await Notification.create({
      user: req.user._id,
      title: 'Manual Bonus Transferred',
      message: `Sent $${numericAmount.toFixed(
        2
      )} from transferable bonus wallet to user ${receiver.name}.`,
      category: 'system'
    });

    await Notification.create({
      user: receiverId,
      title: 'Manual Bonus Received',
      message: `Received $${numericAmount.toFixed(
        2
      )} bonus transfer from upline ${req.user.name}. Usable up to 10% on investments.`,
      category: 'deposit'
    });

    return successResponse(
      res,
      `Successfully transferred $${numericAmount.toFixed(2)} bonus balance to ${receiver.name}!`,
      {
        balanceLeft: senderWallet.bonusTransferable
      }
    );
  } catch (error) {
    console.error('Transfer bonus error:', error);
    return sendError(res, 'Internal bonus transfer error', 500, error);
  }
};

// @desc    Get current user wallet balances
// @route   GET /api/finance/wallets
// @access  Private
const getWallets = async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ user: req.user._id });

    // Aggregate total manual admin standard deposits for this user
    const totalAdminDepositAgg = await AdminBalanceHistory.aggregate([
      { $match: { user: req.user._id, balanceType: 'deposit', amountAdded: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$amountAdded' } } }
    ]);
    const totalAdminDeposit = totalAdminDepositAgg[0] ? totalAdminDepositAgg[0].total : 0;

    // Aggregate total manual admin allocated/funded for this user
    const totalAdminAllocatedAgg = await AdminBalanceHistory.aggregate([
      { $match: { user: req.user._id, balanceType: 'adminAllocated', amountAdded: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$amountAdded' } } }
    ]);
    const totalAdminAllocated = totalAdminAllocatedAgg[0] ? totalAdminAllocatedAgg[0].total : 0;

    return successResponse(res, 'Wallet balances retrieved successfully', {
      wallets: {
        ...(wallet ? wallet.toObject() : {}),
        totalAdminDeposit,
        totalAdminAllocated
      },
      wallet: {
        ...(wallet ? wallet.toObject() : {}),
        totalAdminDeposit,
        totalAdminAllocated
      }
    });
  } catch (error) {
    console.error('getWallets error:', error);
    return sendError(res, 'Internal wallets inquiry error', 500, error);
  }
};

// @desc    Get user's ledger wallet transaction history logs
// @route   GET /api/finance/history
// @access  Private
const getLedgerHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = { user: req.user._id };
    const totalItems = await WalletHistory.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / limit);

    const history = await WalletHistory.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return successResponse(res, 'Wallet ledger history retrieved successfully', {
      history,
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    console.error('getLedgerHistory error:', error);
    return sendError(res, 'Internal ledger inquiry error', 500, error);
  }
};

export default {
  getPaymentMethods,
  submitDeposit,
  submitWithdrawal,
  addWithdrawalAccount,
  getWithdrawalAccounts,
  transferTeamBonus,
  getWallets,
  getLedgerHistory
};