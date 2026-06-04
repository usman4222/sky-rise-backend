import WithdrawalRequest from '../models/finance/withdrawal_request.model.js';
import UserPaymentMethod from '../models/finance/user_payment_method.model.js';
import Wallet from '../models/finance/wallet.model.js';
import WalletHistory from '../models/finance/wallet_history.model.js';
import Notification from '../models/system/notification.model.js';
import { successResponse, sendError } from '../utils/response.js';

// @desc    Submit a withdrawal request
// @route   POST /api/withdrawals/request
// @access  Private
export const requestWithdrawal = async (req, res) => {
  try {
    const { amount, walletType, paymentMethodId } = req.body;
    const userId = req.user._id;

    if (!amount || isNaN(amount) || amount < 10) {
      return sendError(res, 'Minimum withdrawal amount is $10', 400);
    }

    if (!['roi', 'referral', 'salary', 'achievement'].includes(walletType)) {
      return sendError(res, 'Direct withdrawal from the selected wallet is not allowed', 400);
    }

    // Verify payment method exists and belongs to user
    const pm = await UserPaymentMethod.findOne({
      _id: paymentMethodId,
      user: userId,
      status: 'active'
    });
    if (!pm) {
      return sendError(res, 'Selected payment method is invalid or inactive', 404);
    }

    // Get user wallet and verify balance
    const wallet = await Wallet.findOne({ user: userId });
    if (!wallet || wallet[walletType] < amount) {
      return sendError(res, `Insufficient balance in your ${walletType} wallet.`, 400);
    }

    // Deduct immediately (hold placement)
    const prevBal = wallet[walletType];
    wallet[walletType] -= amount;
    await wallet.save();

    // Create WalletHistory debit
    const historyDebit = await WalletHistory.create({
      user: userId,
      walletType,
      type: 'debit',
      amount,
      previousBalance: prevBal,
      newBalance: wallet[walletType],
      category: 'withdrawal_request_hold',
      description: `Pending withdrawal of $${amount} from ${walletType} wallet placed on hold`,
      referenceModel: 'WithdrawalRequest'
    });

    // Calculate fees
    const fee = amount * 0.05;
    const netAmount = amount - fee;

    // Snapshot payment method to decouple from subsequent edits
    const snapshot = pm.toObject();

    const wr = await WithdrawalRequest.create({
      user: userId,
      walletType,
      amountRequested: amount,
      withdrawalFee: fee,
      netAmount,
      paymentMethod: paymentMethodId,
      paymentMethodSnapshot: snapshot,
      walletHistoryDebitRef: historyDebit._id,
      status: 'pending'
    });

    // Link reference ID
    historyDebit.referenceId = wr._id;
    await historyDebit.save();

    // Notify user
    await Notification.create({
      user: userId,
      title: 'Withdrawal Requested',
      message: `Your request to withdraw $${amount} has been submitted. Net amount: $${netAmount} (5% fee applied).`,
      category: 'withdrawal'
    });

    return successResponse(res, 'Withdrawal request submitted successfully', { withdrawal: wr }, 201);
  } catch (error) {
    console.error('requestWithdrawal error:', error);
    return sendError(res, 'Failed to submit withdrawal request', 500, error);
  }
};

// @desc    Get user withdrawal requests
// @route   GET /api/withdrawals/my
// @access  Private
export const getMyWithdrawals = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = { user: req.user._id };
    const totalItems = await WithdrawalRequest.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / limit);

    const withdrawals = await WithdrawalRequest.find(filter)
      .populate('paymentMethod')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return successResponse(res, 'Withdrawal history retrieved successfully', {
      withdrawals,
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    console.error('getMyWithdrawals error:', error);
    return sendError(res, 'Failed to retrieve withdrawal history', 500, error);
  }
};

// @desc    Get single withdrawal detail
// @route   GET /api/withdrawals/:id
// @access  Private
export const getWithdrawalDetails = async (req, res) => {
  try {
    const withdrawal = await WithdrawalRequest.findOne({
      _id: req.params.id,
      user: req.user._id
    }).populate('paymentMethod');

    if (!withdrawal) {
      return sendError(res, 'Withdrawal request not found', 404);
    }

    return successResponse(res, 'Withdrawal details retrieved successfully', { withdrawal });
  } catch (error) {
    console.error('getWithdrawalDetails error:', error);
    return sendError(res, 'Failed to retrieve withdrawal details', 500, error);
  }
};

// @desc    Cancel a pending withdrawal request
// @route   PATCH /api/withdrawals/:id/cancel
// @access  Private
export const cancelWithdrawal = async (req, res) => {
  try {
    const userId = req.user._id;
    const wr = await WithdrawalRequest.findOne({
      _id: req.params.id,
      user: userId,
      status: 'pending'
    });

    if (!wr) {
      return sendError(res, 'Pending withdrawal request not found or cannot be cancelled', 404);
    }

    // Refund wallet
    const wallet = await Wallet.findOne({ user: userId });
    const walletType = wr.walletType;
    const prevBal = wallet[walletType];
    wallet[walletType] += wr.amountRequested;
    await wallet.save();

    // Create WalletHistory credit
    const historyRefund = await WalletHistory.create({
      user: userId,
      walletType,
      type: 'credit',
      amount: wr.amountRequested,
      previousBalance: prevBal,
      newBalance: wallet[walletType],
      category: 'withdrawal_cancelled_refund',
      description: `Refund of $${wr.amountRequested} due to cancelled withdrawal request`,
      referenceModel: 'WithdrawalRequest',
      referenceId: wr._id
    });

    wr.status = 'cancelled';
    wr.walletHistoryRefundRef = historyRefund._id;
    await wr.save();

    // Notify user
    await Notification.create({
      user: userId,
      title: 'Withdrawal Request Cancelled',
      message: `Your withdrawal request for $${wr.amountRequested} has been cancelled, and your balance has been refunded.`,
      category: 'withdrawal'
    });

    return successResponse(res, 'Withdrawal request cancelled and refunded successfully', { withdrawal: wr });
  } catch (error) {
    console.error('cancelWithdrawal error:', error);
    return sendError(res, 'Failed to cancel withdrawal request', 500, error);
  }
};
