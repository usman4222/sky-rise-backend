import WeeklySalaryRequest from '../models/finance/weekly_salary_request.model.js';
import WithdrawalRequest from '../models/finance/withdrawal_request.model.js';
import Wallet from '../models/finance/wallet.model.js';
import WalletHistory from '../models/finance/wallet_history.model.js';
import Notification from '../models/system/notification.model.js';
import { successResponse, sendError } from '../utils/response.js';
import User from '../models/auth/user.model.js';
import AdminBalanceHistory from '../models/finance/admin_balance_history.model.js';
import SecurityLog from '../models/auth/security_log.model.js';

// ==========================================
// WEEKLY SALARY APPROVALS
// ==========================================

// @desc    List all weekly salary requests
// @route   GET /api/admin/weekly-salary/requests
// @access  Admin/SuperAdmin
export const listWeeklySalaryRequests = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = req.query.status ? { status: req.query.status } : {};
    const totalItems = await WeeklySalaryRequest.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / limit);

    const requests = await WeeklySalaryRequest.find(filter)
      .populate('user', 'name email')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return successResponse(res, 'Weekly salary requests retrieved successfully', {
      requests,
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    console.error('listWeeklySalaryRequests error:', error);
    return sendError(res, 'Failed to get weekly salary requests', 500, error);
  }
};

// @desc    Get weekly salary request details
// @route   GET /api/admin/weekly-salary/requests/:id
// @access  Admin/SuperAdmin
export const getWeeklySalaryRequest = async (req, res) => {
  try {
    const request = await WeeklySalaryRequest.findById(req.params.id)
      .populate('user', 'name email')
      .populate('reviewedBy', 'name email');

    if (!request) {
      return sendError(res, 'Weekly salary request not found', 404);
    }

    return successResponse(res, 'Weekly salary request details retrieved', { request });
  } catch (error) {
    console.error('getWeeklySalaryRequest error:', error);
    return sendError(res, 'Failed to get weekly salary request details', 500, error);
  }
};

// @desc    Approve weekly salary request
// @route   PATCH /api/admin/weekly-salary/requests/:id/approve
// @access  Admin/SuperAdmin
export const approveWeeklySalaryRequest = async (req, res) => {
  try {
    const request = await WeeklySalaryRequest.findOne({ _id: req.params.id, status: 'pending' });
    if (!request) {
      return sendError(res, 'Pending weekly salary request not found', 404);
    }

    const userId = request.user;
    const salaryAmount = request.salaryAmount;

    // Load and credit wallet
    let wallet = await Wallet.findOne({ user: userId });
    if (!wallet) {
      wallet = new Wallet({ user: userId });
    }

    const prevBal = wallet.salary;
    wallet.salary += salaryAmount;
    await wallet.save();

    // Create WalletHistory credit
    const history = await WalletHistory.create({
      user: userId,
      walletType: 'salary',
      type: 'credit',
      amount: salaryAmount,
      previousBalance: prevBal,
      newBalance: wallet.salary,
      category: 'weekly_salary_admin_approved',
      description: `Approved weekly VIP salary payout for Rank ${request.vipRank}`,
      referenceModel: 'WeeklySalaryRequest',
      referenceId: request._id
    });

    // Update request status
    request.status = 'approved';
    request.reviewedAt = new Date();
    request.reviewedBy = req.user._id;
    request.walletHistoryRef = history._id;
    await request.save();

    // Log admin action to SecurityLog
    await SecurityLog.create({
      user: req.user._id,
      event: 'ADMIN_APPROVE_SALARY',
      description: `Admin ${req.user.email} approved weekly VIP salary request of $${salaryAmount} for user ${userId}`,
      ipAddress: req.ip || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'unknown'
    });

    // Notify user
    await Notification.create({
      user: userId,
      title: '👑 Weekly Salary Approved',
      message: `Your weekly VIP salary request of $${salaryAmount} has been approved and credited.`,
      category: 'rank'
    });

    return successResponse(res, 'Weekly salary request approved and credited successfully', { request });
  } catch (error) {
    console.error('approveWeeklySalaryRequest error:', error);
    return sendError(res, 'Failed to approve weekly salary request', 500, error);
  }
};

// @desc    Reject weekly salary request
// @route   PATCH /api/admin/weekly-salary/requests/:id/reject
// @access  Admin/SuperAdmin
export const rejectWeeklySalaryRequest = async (req, res) => {
  try {
    const { rejectionReason } = req.body;
    if (!rejectionReason) {
      return sendError(res, 'Rejection reason is required', 400);
    }

    const request = await WeeklySalaryRequest.findOne({ _id: req.params.id, status: 'pending' });
    if (!request) {
      return sendError(res, 'Pending weekly salary request not found', 404);
    }

    request.status = 'rejected';
    request.rejectionReason = rejectionReason;
    request.reviewedAt = new Date();
    request.reviewedBy = req.user._id;
    await request.save();

    // Log admin action to SecurityLog
    await SecurityLog.create({
      user: req.user._id,
      event: 'ADMIN_REJECT_SALARY',
      description: `Admin ${req.user.email} rejected weekly salary request (ID: ${request._id}) of $${request.salaryAmount} for user ${request.user}. Reason: ${rejectionReason}`,
      ipAddress: req.ip || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'unknown'
    });

    // Notify user
    await Notification.create({
      user: request.user,
      title: 'Weekly Salary Request Rejected',
      message: `Your weekly salary request has been rejected. Reason: ${rejectionReason}`,
      category: 'rank'
    });

    return successResponse(res, 'Weekly salary request rejected successfully', { request });
  } catch (error) {
    console.error('rejectWeeklySalaryRequest error:', error);
    return sendError(res, 'Failed to reject weekly salary request', 500, error);
  }
};


// ==========================================
// WITHDRAWALS APPROVALS
// ==========================================

// @desc    List all withdrawal requests
// @route   GET /api/admin/withdrawals
// @access  Admin/SuperAdmin
export const listWithdrawalRequests = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = req.query.status ? { status: req.query.status } : {};
    const totalItems = await WithdrawalRequest.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / limit);

    const withdrawals = await WithdrawalRequest.find(filter)
      .populate('user', 'name email')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return successResponse(res, 'Withdrawal requests retrieved successfully', {
      withdrawals,
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    console.error('listWithdrawalRequests error:', error);
    return sendError(res, 'Failed to get withdrawal requests', 500, error);
  }
};

// @desc    Get single withdrawal request details
// @route   GET /api/admin/withdrawals/:id
// @access  Admin/SuperAdmin
export const getWithdrawalRequest = async (req, res) => {
  try {
    const withdrawal = await WithdrawalRequest.findById(req.params.id)
      .populate('user', 'name email')
      .populate('reviewedBy', 'name email');

    if (!withdrawal) {
      return sendError(res, 'Withdrawal request not found', 404);
    }

    return successResponse(res, 'Withdrawal request details retrieved', { withdrawal });
  } catch (error) {
    console.error('getWithdrawalRequest error:', error);
    return sendError(res, 'Failed to get withdrawal details', 500, error);
  }
};

// @desc    Approve withdrawal request
// @route   PATCH /api/admin/withdrawals/:id/approve
// @access  Admin/SuperAdmin
export const approveWithdrawalRequest = async (req, res) => {
  try {
    const { adminNote } = req.body;
    const wr = await WithdrawalRequest.findOne({ _id: req.params.id, status: 'pending' });
    if (!wr) {
      return sendError(res, 'Pending withdrawal request not found', 404);
    }

    wr.status = 'approved';
    wr.reviewedAt = new Date();
    wr.reviewedBy = req.user._id;
    if (adminNote) wr.adminNote = adminNote;
    await wr.save();

    // Log admin action to SecurityLog
    await SecurityLog.create({
      user: req.user._id,
      event: 'ADMIN_APPROVE_WITHDRAWAL',
      description: `Admin ${req.user.email} approved withdrawal request (ID: ${wr._id}) of $${wr.amountRequested} for user ${wr.user}`,
      ipAddress: req.ip || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'unknown'
    });

    // Notify user
    await Notification.create({
      user: wr.user,
      title: 'Withdrawal Approved',
      message: `Your withdrawal request of $${wr.amountRequested} has been approved. Net payout: $${wr.netAmount}.`,
      category: 'withdrawal'
    });

    return successResponse(res, 'Withdrawal request approved successfully', { withdrawal: wr });
  } catch (error) {
    console.error('approveWithdrawalRequest error:', error);
    return sendError(res, 'Failed to approve withdrawal request', 500, error);
  }
};

// @desc    Reject withdrawal request and refund
// @route   PATCH /api/admin/withdrawals/:id/reject
// @access  Admin/SuperAdmin
export const rejectWithdrawalRequest = async (req, res) => {
  try {
    const { rejectionReason, adminNote } = req.body;
    if (!rejectionReason) {
      return sendError(res, 'Rejection reason is required', 400);
    }

    const wr = await WithdrawalRequest.findOne({ _id: req.params.id, status: 'pending' });
    if (!wr) {
      return sendError(res, 'Pending withdrawal request not found', 404);
    }

    const userId = wr.user;
    const amount = wr.amountRequested;

    // Refund user wallet
    const wallet = await Wallet.findOne({ user: userId });
    if (!wallet) {
      return sendError(res, 'User wallet not found for refund', 400);
    }

    const debits = await WalletHistory.find({ referenceId: wr._id, type: 'debit' });
    let primaryRefundId = null;

    if (debits.length > 0) {
      for (const d of debits) {
        const prevBal = wallet[d.walletType] || 0;
        wallet[d.walletType] += d.amount;

        const historyRefund = await WalletHistory.create({
          user: userId,
          walletType: d.walletType,
          type: 'credit',
          amount: d.amount,
          previousBalance: prevBal,
          newBalance: wallet[d.walletType],
          category: 'withdrawal_rejected_refund',
          description: `Refund of $${d.amount.toFixed(2)} to ${d.walletType.toUpperCase()} Wallet due to rejected withdrawal request`,
          referenceModel: 'WithdrawalRequest',
          referenceId: wr._id
        });

        if (!primaryRefundId) {
          primaryRefundId = historyRefund._id;
        }
      }
      await wallet.save();
    } else {
      const walletType = wr.walletType === 'all' ? 'roi' : wr.walletType;
      const prevBal = wallet[walletType] || 0;
      wallet[walletType] += amount;
      await wallet.save();

      const historyRefund = await WalletHistory.create({
        user: userId,
        walletType,
        type: 'credit',
        amount,
        previousBalance: prevBal,
        newBalance: wallet[walletType],
        category: 'withdrawal_rejected_refund',
        description: `Refund of $${amount} due to rejected withdrawal request`,
        referenceModel: 'WithdrawalRequest',
        referenceId: wr._id
      });

      primaryRefundId = historyRefund._id;
    }

    wr.status = 'rejected';
    wr.rejectionReason = rejectionReason;
    if (adminNote) wr.adminNote = adminNote;
    wr.reviewedAt = new Date();
    wr.reviewedBy = req.user._id;
    wr.walletHistoryRefundRef = primaryRefundId;
    await wr.save();

    // Log admin action to SecurityLog
    await SecurityLog.create({
      user: req.user._id,
      event: 'ADMIN_REJECT_WITHDRAWAL',
      description: `Admin ${req.user.email} rejected withdrawal request (ID: ${wr._id}) of $${amount} for user ${userId}. Reason: ${rejectionReason}`,
      ipAddress: req.ip || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'unknown'
    });

    // Notify user
    await Notification.create({
      user: userId,
      title: 'Withdrawal Rejected & Refunded',
      message: `Your withdrawal request of $${amount} has been rejected. Reason: ${rejectionReason}. Balance refunded to ${walletType} wallet.`,
      category: 'withdrawal'
    });

    return successResponse(res, 'Withdrawal request rejected and refunded successfully', { withdrawal: wr });
  } catch (error) {
    console.error('rejectWithdrawalRequest error:', error);
    return sendError(res, 'Failed to reject withdrawal request', 500, error);
  }
};

// @desc    Mark approved withdrawal request as paid
// @route   PATCH /api/admin/withdrawals/:id/mark-paid
// @access  Admin/SuperAdmin
export const markPaidWithdrawalRequest = async (req, res) => {
  try {
    const { transactionId, adminNote } = req.body;
    if (!transactionId) {
      return sendError(res, 'Transaction/Blockchain reference ID is required', 400);
    }

    // Can mark paid from either pending or approved status to support direct mark-paid if processed manually
    const wr = await WithdrawalRequest.findOne({
      _id: req.params.id,
      status: { $in: ['pending', 'approved'] }
    });
    if (!wr) {
      return sendError(res, 'Eligible withdrawal request not found', 404);
    }

    wr.status = 'paid';
    wr.transactionId = transactionId;
    if (adminNote) wr.adminNote = adminNote;
    if (!wr.reviewedAt) {
      wr.reviewedAt = new Date();
      wr.reviewedBy = req.user._id;
    }
    await wr.save();

    // Log admin action to SecurityLog
    await SecurityLog.create({
      user: req.user._id,
      event: 'ADMIN_MARK_PAID_WITHDRAWAL',
      description: `Admin ${req.user.email} marked withdrawal request (ID: ${wr._id}) as paid. Tx ID: ${transactionId}`,
      ipAddress: req.ip || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'unknown'
    });

    // Notify user
    await Notification.create({
      user: wr.user,
      title: 'Withdrawal Paid',
      message: `Your withdrawal net payout of $${wr.netAmount} has been paid. Transaction ID: ${transactionId}.`,
      category: 'withdrawal'
    });

    return successResponse(res, 'Withdrawal marked as paid successfully', { withdrawal: wr });
  } catch (error) {
    console.error('markPaidWithdrawalRequest error:', error);
    return sendError(res, 'Failed to mark withdrawal as paid', 500, error);
  }
};

// @desc    Adjust user wallet balance (deposit or adminAllocated)
// @route   POST /api/admin/users/:id/balance/adjust
// @access  Admin/SuperAdmin
export const adjustUserBalance = async (req, res) => {
  try {
    const { balanceType, action, amount, remarks } = req.body;
    const userId = req.params.id;

    if (!['deposit', 'adminAllocated'].includes(balanceType)) {
      return sendError(res, 'Invalid balance type. Must be deposit or adminAllocated', 400);
    }

    if (!['add', 'deduct'].includes(action)) {
      return sendError(res, 'Invalid action. Must be add or deduct', 400);
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return sendError(res, 'Amount must be a positive number', 400);
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return sendError(res, 'User not found', 404);
    }

    let wallet = await Wallet.findOne({ user: userId });
    if (!wallet) {
      wallet = new Wallet({ user: userId });
    }

    const balanceBefore = wallet[balanceType] || 0;
    let balanceAfter = balanceBefore;

    if (action === 'add') {
      balanceAfter = balanceBefore + numAmount;
    } else {
      if (balanceBefore < numAmount) {
        return sendError(res, `Insufficient balance. Current ${balanceType} balance is $${balanceBefore}`, 400);
      }
      balanceAfter = balanceBefore - numAmount;
    }

    // Update wallet balance
    wallet[balanceType] = balanceAfter;
    await wallet.save();

    // If adding to adminAllocated balance, flag the target user as admin-funded
    if (balanceType === 'adminAllocated' && action === 'add') {
      targetUser.isAdminFunded = true;
      await targetUser.save();
    }

    // Generate unique reference number
    const referenceNumber = `REF-ADJ-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Get admin details
    const adminUser = await User.findById(req.user._id);
    const adminName = adminUser ? adminUser.name : 'Admin';

    // Create AdminBalanceHistory record
    const adminHistory = new AdminBalanceHistory({
      user: targetUser._id,
      username: targetUser.email, // email acts as username since username is not in User model
      fullName: targetUser.name,
      amountAdded: action === 'add' ? numAmount : 0,
      amountDeducted: action === 'deduct' ? numAmount : 0,
      balanceType,
      balanceBefore,
      balanceAfter,
      admin: req.user._id,
      adminName,
      remarks: remarks || '',
      referenceNumber
    });
    await adminHistory.save();

    // Create WalletHistory entry
    await WalletHistory.create({
      user: targetUser._id,
      walletType: balanceType,
      type: action === 'add' ? 'credit' : 'debit',
      amount: numAmount,
      previousBalance: balanceBefore,
      newBalance: balanceAfter,
      category: `admin_adjustment_${action}`,
      description: `Admin ${action} of $${numAmount} to ${balanceType} wallet. Remarks: ${remarks || 'None'}`,
      referenceModel: 'AdminBalanceHistory',
      referenceId: adminHistory._id
    });

    // Log admin action to SecurityLog
    await SecurityLog.create({
      user: req.user._id,
      event: 'ADMIN_BALANCE_ADJUST',
      description: `Admin ${req.user.email} adjusted user ${targetUser.email} ${balanceType} balance (${action} $${numAmount}). Remarks: ${remarks || 'N/A'}`,
      ipAddress: req.ip || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'unknown'
    });

    // Send Notification
    await Notification.create({
      user: targetUser._id,
      title: `Wallet Adjusted by Admin`,
      message: `Your ${balanceType === 'adminAllocated' ? 'Admin Allocated' : 'Deposit'} wallet balance was adjusted by Admin. Action: ${action.toUpperCase()}, Amount: $${numAmount.toFixed(2)}.`,
      category: 'system'
    });

    return successResponse(res, `Balance adjusted successfully. Reference: ${referenceNumber}`, {
      wallet,
      historyRecord: adminHistory
    });
  } catch (error) {
    console.error('adjustUserBalance error:', error);
    return sendError(res, 'Failed to adjust user balance', 500, error);
  }
};

// @desc    Get admin balance adjustments history
// @route   GET /api/admin/balance/history
// @access  Admin/SuperAdmin
export const getAdminBalanceHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const query = {};

    // Support search by user email/username or full name
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      query.$or = [
        { username: searchRegex },
        { fullName: searchRegex },
        { referenceNumber: searchRegex }
      ];
    }

    const totalItems = await AdminBalanceHistory.countDocuments(query);
    const totalPages = Math.ceil(totalItems / limit);

    const history = await AdminBalanceHistory.find(query)
      .populate('user', 'name email')
      .populate('admin', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return successResponse(res, 'Admin balance history retrieved successfully', {
      history,
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    console.error('getAdminBalanceHistory error:', error);
    return sendError(res, 'Failed to get admin balance history', 500, error);
  }
};

