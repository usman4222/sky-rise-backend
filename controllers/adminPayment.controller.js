import Withdrawal from '../models/finance/withdrawal.model.js';
import Deposit from '../models/finance/deposit.model.js';
import Wallet from '../models/finance/wallet.model.js';
import WalletHistory from '../models/finance/wallet_history.model.js';
import PaymentWebhook from '../models/finance/payment_webhook.model.js';
import AdminLog from '../models/system/admin_log.model.js';
import Notification from '../models/system/notification.model.js';

import { sendError, successResponse } from '../utils/response.js';

// ============================================================
// Admin: List all withdrawals
// ============================================================

/**
 * @desc    Get all withdrawal requests for admin
 * @route   GET /api/admin/payments/withdrawals
 * @access  Admin only
 */
const getWithdrawals = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.currency) filter.withdrawalCurrency = req.query.currency.toUpperCase();

    const withdrawals = await Withdrawal.find(filter)
      .populate('user', 'name email referralCode')
      .populate('withdrawalAccount')
      .sort({ createdAt: -1 });

    return successResponse(res, 'Admin withdrawals retrieved', {
      count: withdrawals.length,
      withdrawals
    });
  } catch (error) {
    return sendError(res, 'Failed to get withdrawals', 500, error);
  }
};

// ============================================================
// Admin: Approve withdrawal
// ============================================================

/**
 * @desc    Approve a pending withdrawal request
 * @route   PATCH /api/admin/payments/withdrawals/:id/approve
 * @access  Admin only
 */
const approveWithdrawal = async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id);

    if (!withdrawal) {
      return sendError(res, 'Withdrawal request not found', 404);
    }

    if (withdrawal.status !== 'pending') {
      return sendError(res, `Cannot approve withdrawal with status: ${withdrawal.status}`, 400);
    }

    withdrawal.status = 'approved';
    withdrawal.remarks = req.body.remarks || 'Approved by admin. Awaiting payout.';
    withdrawal.processedBy = req.user._id;
    withdrawal.processedAt = new Date();
    await withdrawal.save();

    await AdminLog.create({
      admin: req.user._id,
      action: 'APPROVE_WITHDRAWAL',
      targetModel: 'Withdrawal',
      targetId: withdrawal._id,
      newData: { status: 'approved' },
      ipAddress: req.ip || '127.0.0.1'
    });

    await Notification.create({
      user: withdrawal.user,
      title: 'Withdrawal Approved ✅',
      message: `Your ${withdrawal.withdrawalCurrency} withdrawal of $${withdrawal.payableAmountUSDT.toFixed(2)} has been approved and is being processed.`,
      category: 'withdrawal'
    });

    return successResponse(res, 'Withdrawal approved successfully');
  } catch (error) {
    return sendError(res, 'Failed to approve withdrawal', 500, error);
  }
};

// ============================================================
// Admin: Reject withdrawal (refund balance)
// ============================================================

/**
 * @desc    Reject a pending withdrawal and refund locked balance
 * @route   PATCH /api/admin/payments/withdrawals/:id/reject
 * @access  Admin only
 */
const rejectWithdrawal = async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id);

    if (!withdrawal) {
      return sendError(res, 'Withdrawal request not found', 404);
    }

    if (withdrawal.status !== 'pending' && withdrawal.status !== 'approved') {
      return sendError(res, `Cannot reject withdrawal with status: ${withdrawal.status}`, 400);
    }

    // Refund locked balance back to source wallet
    const wallet = await Wallet.findOne({ user: withdrawal.user });
    if (wallet) {
      const sourceWallet = withdrawal.sourceWallet;
      const prevBalance = wallet[sourceWallet] || 0;
      wallet[sourceWallet] = prevBalance + withdrawal.amountUSDT;
      wallet.withdrawal = Math.max(0, (wallet.withdrawal || 0) - withdrawal.amountUSDT);
      await wallet.save();

      await WalletHistory.create({
        user: withdrawal.user,
        walletType: sourceWallet,
        type: 'credit',
        amount: withdrawal.amountUSDT,
        previousBalance: prevBalance,
        newBalance: wallet[sourceWallet],
        category: 'withdrawal_reversal',
        description: `${withdrawal.withdrawalCurrency} withdrawal rejected by admin. $${withdrawal.amountUSDT} refunded to ${sourceWallet} wallet. Remarks: ${req.body.remarks || 'N/A'}`,
        referenceModel: 'Withdrawal',
        referenceId: withdrawal._id
      });
    }

    withdrawal.status = 'rejected';
    withdrawal.remarks = req.body.remarks || 'Rejected by admin';
    withdrawal.processedBy = req.user._id;
    withdrawal.processedAt = new Date();
    await withdrawal.save();

    await AdminLog.create({
      admin: req.user._id,
      action: 'REJECT_WITHDRAWAL',
      targetModel: 'Withdrawal',
      targetId: withdrawal._id,
      newData: { status: 'rejected', remarks: withdrawal.remarks },
      ipAddress: req.ip || '127.0.0.1'
    });

    await Notification.create({
      user: withdrawal.user,
      title: 'Withdrawal Rejected ❌',
      message: `Your ${withdrawal.withdrawalCurrency} withdrawal of $${withdrawal.amountUSDT} was rejected. Balance has been refunded. Remarks: ${withdrawal.remarks}`,
      category: 'withdrawal'
    });

    return successResponse(res, 'Withdrawal rejected and balance refunded');
  } catch (error) {
    return sendError(res, 'Failed to reject withdrawal', 500, error);
  }
};

// ============================================================
// Admin: Mark withdrawal as paid
// ============================================================

/**
 * @desc    Mark an approved withdrawal as paid with transaction hash/ref
 * @route   PATCH /api/admin/payments/withdrawals/:id/mark-paid
 * @access  Admin only
 */
const markWithdrawalPaid = async (req, res) => {
  try {
    const { txHash, remarks } = req.body;

    if (!txHash) {
      return sendError(res, 'Transaction hash / payout reference is required', 400);
    }

    const withdrawal = await Withdrawal.findById(req.params.id);

    if (!withdrawal) {
      return sendError(res, 'Withdrawal request not found', 404);
    }

    if (withdrawal.status !== 'approved' && withdrawal.status !== 'pending') {
      return sendError(res, `Cannot mark as paid. Current status: ${withdrawal.status}`, 400);
    }

    // Finalize: deduct from withdrawal tracker
    const wallet = await Wallet.findOne({ user: withdrawal.user });
    if (wallet) {
      wallet.withdrawal = Math.max(0, (wallet.withdrawal || 0) - withdrawal.amountUSDT);
      await wallet.save();
    }

    withdrawal.status = 'approved'; // Keep as approved (means completed/paid)
    withdrawal.txHash = txHash.trim();
    withdrawal.remarks = remarks || `Payout completed. Ref: ${txHash}`;
    withdrawal.processedBy = req.user._id;
    withdrawal.processedAt = new Date();
    await withdrawal.save();

    await AdminLog.create({
      admin: req.user._id,
      action: 'MARK_WITHDRAWAL_PAID',
      targetModel: 'Withdrawal',
      targetId: withdrawal._id,
      newData: { status: 'approved', txHash },
      ipAddress: req.ip || '127.0.0.1'
    });

    await Notification.create({
      user: withdrawal.user,
      title: 'Withdrawal Paid! 💸',
      message: `Your ${withdrawal.withdrawalCurrency} payout of $${withdrawal.payableAmountUSDT.toFixed(2)} has been sent. Reference: ${txHash}`,
      category: 'withdrawal'
    });

    return successResponse(res, 'Withdrawal marked as paid');
  } catch (error) {
    return sendError(res, 'Failed to mark withdrawal as paid', 500, error);
  }
};

// ============================================================
// Admin: View deposits
// ============================================================

/**
 * @desc    Get all deposit records for admin
 * @route   GET /api/admin/payments/deposits
 * @access  Admin only
 */
const getDeposits = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.currency) filter.currency = req.query.currency.toUpperCase();
    if (req.query.gateway) filter.gateway = req.query.gateway;

    const deposits = await Deposit.find(filter)
      .populate('user', 'name email referralCode')
      .populate('paymentMethod', 'name gateway currency')
      .sort({ createdAt: -1 });

    return successResponse(res, 'Admin deposits retrieved', {
      count: deposits.length,
      deposits
    });
  } catch (error) {
    return sendError(res, 'Failed to get deposits', 500, error);
  }
};

// ============================================================
// Admin: View webhook/gateway logs
// ============================================================

/**
 * @desc    Get payment webhook logs for admin
 * @route   GET /api/admin/payments/webhook-logs
 * @access  Admin only
 */
const getWebhookLogs = async (req, res) => {
  try {
    const filter = {};
    if (req.query.gateway) filter.gateway = req.query.gateway;
    if (req.query.status) filter.status = req.query.status;

    const logs = await PaymentWebhook.find(filter).sort({ createdAt: -1 }).limit(100);

    return successResponse(res, 'Webhook logs retrieved', {
      count: logs.length,
      logs
    });
  } catch (error) {
    return sendError(res, 'Failed to get webhook logs', 500, error);
  }
};

export default {
  getWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  markWithdrawalPaid,
  getDeposits,
  getWebhookLogs
};
