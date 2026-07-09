import mongoose from 'mongoose';
import Deposit from '../models/finance/deposit.model.js';
import Withdrawal from '../models/finance/withdrawal.model.js';
import Wallet from '../models/finance/wallet.model.js';

import WalletHistory from '../models/finance/wallet_history.model.js';
import AdminBalanceHistory from '../models/finance/admin_balance_history.model.js';
import PaymentMethod from '../models/finance/payment_method.model.js';
import WeeklySalaryRequest from '../models/finance/weekly_salary_request.model.js';
import WithdrawalRequest from '../models/finance/withdrawal_request.model.js';

import KycRecord from '../models/auth/kyc_record.model.js';
import User from '../models/auth/user.model.js';

import InvestmentPackage from '../models/investment/investment_package.model.js';
import ExchangeRate from '../models/investment/exchange_rate.model.js';
import BusinessReport from '../models/network/business_report.model.js';
import LegReport from '../models/network/leg_report.model.js';
import UserInvestment from '../models/investment/user_investment.model.js';

import AdminLog from '../models/system/admin_log.model.js';
import Notification from '../models/system/notification.model.js';

import { sendError, successResponse } from '../utils/response.js';

const normalizePackagePayload = (payload) => {
  return {
    name: payload.name?.trim(),
    minAmount: Number(payload.minAmount),
    maxAmount: Number(payload.maxAmount),
    startRoi: Number(payload.startRoi),
    maxRoi: Number(payload.maxRoi),
    roiIncrement:
      payload.roiIncrement !== undefined ? Number(payload.roiIncrement) : 0.1,
    roiIncrementDays:
      payload.roiIncrementDays !== undefined ? Number(payload.roiIncrementDays) : 10,
    autoReinvest:
      payload.autoReinvest !== undefined ? Boolean(payload.autoReinvest) : true,
    manualClaim:
      payload.manualClaim !== undefined ? Boolean(payload.manualClaim) : false,
    claimExpiryHours:
      payload.claimExpiryHours !== undefined ? Number(payload.claimExpiryHours) : 24,
    earlyWithdrawalPenaltyPercent:
      payload.earlyWithdrawalPenaltyPercent !== undefined
        ? Number(payload.earlyWithdrawalPenaltyPercent)
        : 15,
    earlyWithdrawalPenaltyMonths:
      payload.earlyWithdrawalPenaltyMonths !== undefined
        ? Number(payload.earlyWithdrawalPenaltyMonths)
        : 5,
    isHidden:
      payload.isHidden !== undefined ? Boolean(payload.isHidden) : false,
    isActive:
      payload.isActive !== undefined ? Boolean(payload.isActive) : true,
    packageTarget: payload.packageTarget || 'user'
  };
};

const validatePackagePayload = (pkg) => {
  if (!pkg.name) return 'Package name is required';
  if (Number.isNaN(pkg.minAmount)) return 'minAmount is required and must be a number';
  if (Number.isNaN(pkg.maxAmount)) return 'maxAmount is required and must be a number';
  if (Number.isNaN(pkg.startRoi)) return 'startRoi is required and must be a number';
  if (Number.isNaN(pkg.maxRoi)) return 'maxRoi is required and must be a number';

  if (pkg.minAmount <= 0) return 'minAmount must be greater than 0';
  if (pkg.maxAmount < pkg.minAmount) return 'maxAmount must be greater than or equal to minAmount';
  if (pkg.startRoi < 0) return 'startRoi cannot be negative';
  if (pkg.maxRoi < pkg.startRoi) return 'maxRoi must be greater than or equal to startRoi';

  if (pkg.packageTarget && !['user', 'marketer'].includes(pkg.packageTarget)) {
    return 'packageTarget must be either user or marketer';
  }

  return null;
};

// @desc    Approve or Reject deposit slip
// @route   POST /api/admin/deposits/:id/action
// @access  Admin only
const processDeposit = async (req, res) => {
  return sendError(
    res,
    'Manual deposit approval is disabled. Deposits are automatically processed via integrated payment gateway webhooks (PayFast / CoinPayments).',
    400
  );
};

// @desc    Approve or Reject withdrawal request
// @route   POST /api/admin/withdrawals/:id/action
// @access  Admin only
const processWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, txHash, remarks } = req.body;

    if (!action || !['approve', 'reject'].includes(action)) {
      return sendError(res, 'Invalid action. Must be approve or reject.', 400);
    }

    const withdrawal = await Withdrawal.findById(id);

    if (!withdrawal || withdrawal.status !== 'pending') {
      return sendError(res, 'Withdrawal request not found or already processed', 400);
    }

    const userId = withdrawal.user;
    const wallet = await Wallet.findOne({ user: userId });

    if (action === 'approve') {
      if (!txHash) {
        return sendError(res, 'Transaction ID or payout hash is required for approvals', 400);
      }

      withdrawal.status = 'approved';
      withdrawal.txHash = txHash.trim();
      withdrawal.remarks = remarks || 'Processed and transferred by system finance department';
      withdrawal.processedBy = req.user._id;
      withdrawal.processedAt = new Date();
      await withdrawal.save();

      if (wallet) {
        wallet.withdrawal -= withdrawal.amountUSDT;
        await wallet.save();
      }

      await AdminLog.create({
        admin: req.user._id,
        action: 'APPROVE_WITHDRAWAL',
        targetModel: 'Withdrawal',
        targetId: withdrawal._id,
        newData: { status: 'approved', txHash },
        ipAddress: req.ip || '127.0.0.1'
      });

      await Notification.create({
        user: userId,
        title: 'Withdrawal Approved! 💸',
        message: `Your withdrawal payout of $${withdrawal.payableAmountUSDT.toFixed(2)} has been successfully processed. Receipt: ${txHash}`,
        category: 'withdrawal'
      });

      return successResponse(res, 'Withdrawal request marked as processed and completed!');
    }

    withdrawal.status = 'rejected';
    withdrawal.remarks = remarks || 'Rejected: Mismatch in billing credentials or incorrect payment gateway address';
    withdrawal.processedBy = req.user._id;
    withdrawal.processedAt = new Date();
    await withdrawal.save();

    if (wallet) {
      wallet.withdrawal -= withdrawal.amountUSDT;

      const prevBal = wallet[withdrawal.sourceWallet] || 0;
      wallet[withdrawal.sourceWallet] = prevBal + withdrawal.amountUSDT;

      await wallet.save();

      await WalletHistory.create({
        user: userId,
        walletType: withdrawal.sourceWallet,
        type: 'credit',
        amount: withdrawal.amountUSDT,
        previousBalance: prevBal,
        newBalance: wallet[withdrawal.sourceWallet],
        category: 'withdrawal_reversal',
        description: `Withdrawal request rejected by admin. Reverted $${withdrawal.amountUSDT} capital back to source wallet.`,
        referenceModel: 'Withdrawal',
        referenceId: withdrawal._id
      });
    }

    await AdminLog.create({
      admin: req.user._id,
      action: 'REJECT_WITHDRAWAL',
      targetModel: 'Withdrawal',
      targetId: withdrawal._id,
      newData: { status: 'rejected', remarks: withdrawal.remarks },
      ipAddress: req.ip || '127.0.0.1'
    });

    await Notification.create({
      user: userId,
      title: 'Withdrawal Rejected ❌',
      message: `Your withdrawal of $${withdrawal.amountUSDT.toFixed(2)} was rejected. Reverted back to your ${withdrawal.sourceWallet} wallet.`,
      category: 'withdrawal'
    });

    return successResponse(res, 'Withdrawal rejected and wallets successfully reverted!');
  } catch (error) {
    console.error('processWithdrawal error:', error);
    return sendError(res, 'Internal admin withdrawal processing error', 500, error);
  }
};

// @desc    Approve or Reject KYC documents
// @route   POST /api/admin/kyc/:id/action
// @access  Admin only
const processKyc = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, remarks } = req.body;

    if (!action || !['approve', 'reject'].includes(action)) {
      return sendError(res, 'Invalid action. Must be approve or reject.', 400);
    }

    const kyc = await KycRecord.findById(id);

    if (!kyc || kyc.status !== 'pending') {
      return sendError(res, 'Pending KYC submission not found', 400);
    }

    const userId = kyc.user;

    if (action === 'approve') {
      kyc.status = 'approved';
      kyc.remarks = remarks || 'KYC Documents approved';
      kyc.verifiedBy = req.user._id;
      kyc.verifiedAt = new Date();
      await kyc.save();

      await User.findByIdAndUpdate(userId, { kycStatus: 'approved' });

      await AdminLog.create({
        admin: req.user._id,
        action: 'APPROVE_KYC',
        targetModel: 'KycRecord',
        targetId: kyc._id,
        newData: { status: 'approved' },
        ipAddress: req.ip || '127.0.0.1'
      });

      await Notification.create({
        user: userId,
        title: 'KYC Verified successfully! 🛡️',
        message: 'Your account KYC is approved. Withdrawal access is now unlocked.',
        category: 'system'
      });

      return successResponse(res, 'KYC records verified and approved successfully!');
    }

    kyc.status = 'rejected';
    kyc.remarks = remarks || 'Rejected: Documents were blurry or name mismatch with profile';
    kyc.verifiedBy = req.user._id;
    kyc.verifiedAt = new Date();
    await kyc.save();

    await User.findByIdAndUpdate(userId, { kycStatus: 'rejected' });

    await AdminLog.create({
      admin: req.user._id,
      action: 'REJECT_KYC',
      targetModel: 'KycRecord',
      targetId: kyc._id,
      newData: { status: 'rejected', remarks: kyc.remarks },
      ipAddress: req.ip || '127.0.0.1'
    });

    await Notification.create({
      user: userId,
      title: 'KYC Submission Rejected ❌',
      message: `Your KYC was rejected. Remarks: ${kyc.remarks}. Please resubmit clean documents.`,
      category: 'system'
    });

    return successResponse(res, 'KYC records rejected successfully.');
  } catch (error) {
    console.error('processKyc error:', error);
    return sendError(res, 'Internal admin KYC processing error', 500, error);
  }
};

// @desc    Create investment package or bulk packages
// @route   POST /api/admin/packages
// @route   POST /api/admin/packages/bulk
// @access  Admin only
const createPackage = async (req, res) => {
  try {
    const isBulk = Array.isArray(req.body.packages);
    const packagePayloads = isBulk ? req.body.packages : [req.body];

    if (!packagePayloads.length) {
      return sendError(res, 'Package payload is required', 400);
    }

    const created = [];
    const skipped = [];

    for (const rawPayload of packagePayloads) {
      const payload = normalizePackagePayload(rawPayload);
      const validationError = validatePackagePayload(payload);

      if (validationError) {
        if (!isBulk) {
          return sendError(res, validationError, 400);
        }

        skipped.push({
          name: rawPayload.name || 'Unknown',
          reason: validationError
        });
        continue;
      }

      const existingPackage = await InvestmentPackage.findOne({
        name: payload.name
      });

      if (existingPackage) {
        if (!isBulk) {
          return sendError(res, 'Package with this name already exists', 400);
        }

        skipped.push({
          name: payload.name,
          reason: 'Package with this name already exists'
        });
        continue;
      }

      const investmentPackage = await InvestmentPackage.create(payload);
      created.push(investmentPackage);

      await AdminLog.create({
        admin: req.user._id,
        action: 'CREATE_INVESTMENT_PACKAGE',
        targetModel: 'InvestmentPackage',
        targetId: investmentPackage._id,
        newData: investmentPackage.toObject(),
        ipAddress: req.ip || '127.0.0.1'
      });
    }

    if (isBulk) {
      return successResponse(
        res,
        'Bulk package creation completed',
        {
          createdCount: created.length,
          skippedCount: skipped.length,
          packages: created,
          skipped
        },
        201
      );
    }

    return successResponse(
      res,
      'Investment package created successfully',
      {
        package: created[0]
      },
      201
    );
  } catch (error) {
    console.error('createPackage error:', error);
    return sendError(res, 'Failed to create investment package', 500, error);
  }
};

// @desc    Get all investment packages for admin
// @route   GET /api/admin/packages
// @access  Admin only
const getAdminPackages = async (req, res) => {
  try {
    const { status, search } = req.query;

    const filter = {};

    if (status === 'active') filter.isActive = true;
    if (status === 'inactive') filter.isActive = false;
    if (status === 'hidden') filter.isHidden = true;
    if (status === 'visible') filter.isHidden = false;

    if (search) {
      filter.name = { $regex: search.trim(), $options: 'i' };
    }

    const packages = await InvestmentPackage.find(filter).sort({
      minAmount: 1,
      createdAt: -1
    });

    return successResponse(res, 'Admin packages retrieved successfully', {
      count: packages.length,
      packages
    });
  } catch (error) {
    console.error('getAdminPackages error:', error);
    return sendError(res, 'Failed to retrieve admin packages', 500, error);
  }
};

// @desc    Edit/Update dynamic package rules
// @route   PUT /api/admin/packages/:id
// @route   PATCH /api/admin/packages/:id
// @access  Admin only
const updatePackage = async (req, res) => {
  try {
    const { id } = req.params;

    const pkg = await InvestmentPackage.findById(id);

    if (!pkg) {
      return sendError(res, 'Investment package not found', 404);
    }

    const oldData = pkg.toObject();

    const allowedFields = [
      'name',
      'minAmount',
      'maxAmount',
      'startRoi',
      'maxRoi',
      'roiIncrement',
      'roiIncrementDays',
      'autoReinvest',
      'manualClaim',
      'claimExpiryHours',
      'earlyWithdrawalPenaltyPercent',
      'earlyWithdrawalPenaltyMonths',
      'isHidden',
      'isActive',
      'packageTarget'
    ];

    const updateData = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    if (!Object.keys(updateData).length) {
      return sendError(res, 'No valid package fields provided for update', 400);
    }

    if (updateData.name) {
      updateData.name = updateData.name.trim();

      const duplicate = await InvestmentPackage.findOne({
        _id: { $ne: pkg._id },
        name: updateData.name
      });

      if (duplicate) {
        return sendError(res, 'Another package with this name already exists', 400);
      }
    }

    Object.assign(pkg, updateData);

    if (pkg.maxAmount < pkg.minAmount) {
      return sendError(res, 'maxAmount must be greater than or equal to minAmount', 400);
    }

    if (pkg.maxRoi < pkg.startRoi) {
      return sendError(res, 'maxRoi must be greater than or equal to startRoi', 400);
    }

    await pkg.save();

    await AdminLog.create({
      admin: req.user._id,
      action: 'EDIT_PACKAGE',
      targetModel: 'InvestmentPackage',
      targetId: pkg._id,
      oldData,
      newData: pkg.toObject(),
      ipAddress: req.ip || '127.0.0.1'
    });

    return successResponse(res, `Successfully updated package: ${pkg.name}`, {
      package: pkg
    });
  } catch (error) {
    console.error('updatePackage error:', error);
    return sendError(res, 'Internal package update error', 500, error);
  }
};

// @desc    Create payment method
// @route   POST /api/admin/payment-methods
// @access  Admin only
const createPaymentMethod = async (req, res) => {
  try {
    const {
      name,
      type,
      currency,
      accountDetails,
      minDeposit,
      maxDeposit,
      isActive
    } = req.body;

    if (!name || !type || !accountDetails) {
      return sendError(res, 'name, type and accountDetails are required', 400);
    }

    if (!['fiat', 'crypto'].includes(type)) {
      return sendError(res, 'type must be either fiat or crypto', 400);
    }

    const existing = await PaymentMethod.findOne({ name: name.trim() });

    if (existing) {
      return sendError(res, 'Payment method with this name already exists', 400);
    }

    const paymentMethod = await PaymentMethod.create({
      name: name.trim(),
      type,
      currency: currency || 'PKR',
      accountDetails,
      minDeposit: minDeposit !== undefined ? Number(minDeposit) : 10,
      maxDeposit: maxDeposit !== undefined ? Number(maxDeposit) : null,
      isActive: isActive !== undefined ? Boolean(isActive) : true
    });

    await AdminLog.create({
      admin: req.user._id,
      action: 'CREATE_PAYMENT_METHOD',
      targetModel: 'PaymentMethod',
      targetId: paymentMethod._id,
      newData: paymentMethod.toObject(),
      ipAddress: req.ip || '127.0.0.1'
    });

    return successResponse(
      res,
      'Payment method created successfully',
      { paymentMethod },
      201
    );
  } catch (error) {
    console.error('createPaymentMethod error:', error);
    return sendError(res, 'Failed to create payment method', 500, error);
  }
};

// @desc    Get all payment methods for admin
// @route   GET /api/admin/payment-methods
// @access  Admin only
const getAdminPaymentMethods = async (req, res) => {
  try {
    const { status, search, type, currency } = req.query;

    const filter = {};

    if (status === 'active') filter.isActive = true;
    if (status === 'inactive') filter.isActive = false;

    if (type) filter.type = type;
    if (currency) filter.currency = currency;

    if (search) {
      filter.name = { $regex: search.trim(), $options: 'i' };
    }

    const methods = await PaymentMethod.find(filter).sort({
      createdAt: -1
    });

    return successResponse(res, 'Admin payment methods retrieved successfully', {
      count: methods.length,
      methods
    });
  } catch (error) {
    console.error('getAdminPaymentMethods error:', error);
    return sendError(res, 'Failed to retrieve payment methods', 500, error);
  }
};

// @desc    Update payment method
// @route   PUT /api/admin/payment-methods/:id
// @route   PATCH /api/admin/payment-methods/:id
// @access  Admin only
const updatePaymentMethod = async (req, res) => {
  try {
    const { id } = req.params;

    const method = await PaymentMethod.findById(id);

    if (!method) {
      return sendError(res, 'Payment method not found', 404);
    }

    const oldData = method.toObject();

    const allowedFields = [
      'name',
      'type',
      'currency',
      'accountDetails',
      'minDeposit',
      'maxDeposit',
      'isActive'
    ];

    const updateData = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    if (!Object.keys(updateData).length) {
      return sendError(res, 'No valid payment method fields provided for update', 400);
    }

    if (updateData.name) updateData.name = updateData.name.trim();

    if (updateData.type && !['fiat', 'crypto'].includes(updateData.type)) {
      return sendError(res, 'type must be either fiat or crypto', 400);
    }

    if (updateData.minDeposit !== undefined) {
      updateData.minDeposit = Number(updateData.minDeposit);
    }

    if (updateData.maxDeposit !== undefined && updateData.maxDeposit !== null) {
      updateData.maxDeposit = Number(updateData.maxDeposit);
    }

    Object.assign(method, updateData);

    await method.save();

    await AdminLog.create({
      admin: req.user._id,
      action: 'UPDATE_PAYMENT_METHOD',
      targetModel: 'PaymentMethod',
      targetId: method._id,
      oldData,
      newData: method.toObject(),
      ipAddress: req.ip || '127.0.0.1'
    });

    return successResponse(res, 'Payment method updated successfully', {
      paymentMethod: method
    });
  } catch (error) {
    console.error('updatePaymentMethod error:', error);
    return sendError(res, 'Failed to update payment method', 500, error);
  }
};

// @desc    Update live PKR/USDT exchange conversion rate
// @route   POST /api/admin/exchange-rate
// @access  Admin only
const updateExchangeRate = async (req, res) => {
  try {
    const { rate } = req.body;

    if (!rate || rate <= 0) {
      return sendError(res, 'Invalid exchange conversion rate', 400);
    }

    const exchangeRate = new ExchangeRate({
      rate,
      updatedBy: req.user._id
    });

    await exchangeRate.save();

    await AdminLog.create({
      admin: req.user._id,
      action: 'UPDATE_EXCHANGE_RATE',
      targetModel: 'ExchangeRate',
      targetId: exchangeRate._id,
      newData: { rate },
      ipAddress: req.ip || '127.0.0.1'
    });

    return successResponse(res, `Updated active exchange rate to Rs. ${rate}`, {
      rate
    });
  } catch (error) {
    console.error('updateExchangeRate error:', error);
    return sendError(res, 'Internal exchange rate update error', 500, error);
  }
};

// @desc    Get dashboard metrics summary
// @route   GET /api/admin/dashboard
// @access  Admin only
const getAdminDashboard = async (req, res) => {
  try {
    const usersCount = await User.countDocuments({});

    const depositsApproved = await Deposit.aggregate([
      { $match: { status: { $in: ['approved', 'completed'] } } },
      { $group: { _id: null, total: { $sum: '$amountUSDT' } } }
    ]);

    const totalDeposited = depositsApproved[0] ? depositsApproved[0].total : 0;

    // Legacy withdrawal stat
    const withdrawalsApproved = await Withdrawal.aggregate([
      { $match: { status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$payableAmountUSDT' } } }
    ]);
    const legacyWithdrawn = withdrawalsApproved[0] ? withdrawalsApproved[0].total : 0;

    // New withdrawal requests stats
    const paidWithdrawalsAgg = await WithdrawalRequest.aggregate([
      { $match: { status: { $in: ['approved', 'paid'] } } },
      { $group: { _id: null, total: { $sum: '$amountRequested' } } }
    ]);
    const totalPaidWithdrawals = paidWithdrawalsAgg[0] ? paidWithdrawalsAgg[0].total : 0;

    const strictlyPaidAgg = await WithdrawalRequest.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amountRequested' } } }
    ]);
    const totalStrictlyPaid = strictlyPaidAgg[0] ? strictlyPaidAgg[0].total : 0;

    const pendingWithdrawalsAgg = await WithdrawalRequest.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: null, total: { $sum: '$amountRequested' } } }
    ]);
    const totalPendingWithdrawalAmount = pendingWithdrawalsAgg[0] ? pendingWithdrawalsAgg[0].total : 0;

    // Salary requests stats
    const salaryRequestsAgg = await WeeklySalaryRequest.aggregate([
      { $match: { status: { $in: ['approved', 'credited'] } } },
      { $group: { _id: null, total: { $sum: '$salaryAmount' } } }
    ]);
    const totalApprovedSalaryAmount = salaryRequestsAgg[0] ? salaryRequestsAgg[0].total : 0;

    const pendingDeposits = await Deposit.countDocuments({ status: 'pending' });
    const pendingWithdrawals = await WithdrawalRequest.countDocuments({ status: 'pending' });
    const pendingWeeklySalaryRequests = await WeeklySalaryRequest.countDocuments({ status: 'pending' });
    const pendingKyc = await KycRecord.countDocuments({ status: 'pending' });

    const packagesCount = await InvestmentPackage.countDocuments({});
    const activePackagesCount = await InvestmentPackage.countDocuments({ isActive: true });

    const paymentMethodsCount = await PaymentMethod.countDocuments({});
    const activePaymentMethodsCount = await PaymentMethod.countDocuments({
      isActive: true
    });

    // Total admin manual deposit & allocated funds
    const totalAdminDepositAgg = await AdminBalanceHistory.aggregate([
      { $match: { balanceType: 'deposit', amountAdded: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$amountAdded' } } }
    ]);
    const totalAdminDeposit = totalAdminDepositAgg[0] ? totalAdminDepositAgg[0].total : 0;

    const totalAdminAllocatedAgg = await AdminBalanceHistory.aggregate([
      { $match: { balanceType: 'adminAllocated', amountAdded: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$amountAdded' } } }
    ]);
    const totalAdminAllocated = totalAdminAllocatedAgg[0] ? totalAdminAllocatedAgg[0].total : 0;

    return successResponse(res, 'Admin dashboard metrics retrieved successfully', {
      stats: {
        usersCount,
        totalDeposited,
        totalWithdrawn: legacyWithdrawn + totalPaidWithdrawals,
        totalPaidWithdrawalAmount: legacyWithdrawn + totalStrictlyPaid,
        totalPendingWithdrawalAmount,
        totalApprovedSalaryAmount,
        totalAdminDeposit,
        totalAdminAllocated,
        pendingDeposits,
        pendingWithdrawals,
        pendingWeeklySalaryRequests,
        pendingKyc,
        packagesCount,
        activePackagesCount,
        paymentMethodsCount,
        activePaymentMethodsCount
      }
    });
  } catch (error) {
    console.error('getAdminDashboard error:', error);
    return sendError(res, 'Failed to retrieve dashboard metrics', 500, error);
  }
};

// @desc    Get all deposits for admin
// @route   GET /api/admin/deposits
// @access  Admin only
const getAdminDeposits = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = req.query.status ? { status: req.query.status } : {};
    const totalItems = await Deposit.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / limit);

    const deposits = await Deposit.find(filter)
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return successResponse(res, 'Deposits retrieved', {
      deposits,
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    return sendError(res, 'Failed to get deposits', 500, error);
  }
};

// @desc    Get all withdrawals for admin
// @route   GET /api/admin/withdrawals
// @access  Admin only
const getAdminWithdrawals = async (req, res) => {
  try {
    const filter = req.query.status ? { status: req.query.status } : {};
    const withdrawals = await Withdrawal.find(filter).populate('user', 'name email').populate('withdrawalAccount').sort({ createdAt: -1 });
    return successResponse(res, 'Withdrawals retrieved', { withdrawals });
  } catch (error) {
    return sendError(res, 'Failed to get withdrawals', 500, error);
  }
};

// @desc    Get all KYC records for admin
// @route   GET /api/admin/kyc
// @access  Admin only
const getAdminKyc = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = req.query.status ? { status: req.query.status } : {};
    const totalItems = await KycRecord.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / limit);

    const kycRecords = await KycRecord.find(filter)
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return successResponse(res, 'KYC records retrieved', {
      kycRecords,
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    return sendError(res, 'Failed to get KYC records', 500, error);
  }
};

const listUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';

    let filter = {};
    if (search) {
      if (mongoose.Types.ObjectId.isValid(search)) {
        // Search by Wallet ID first, then by User ID
        const walletDoc = await Wallet.findById(search);
        if (walletDoc) {
          filter = { _id: walletDoc.user };
        } else {
          filter = { _id: search };
        }
      } else {
        filter = {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { referralCode: { $regex: search, $options: 'i' } }
          ]
        };
      }
    }

    if (req.query.favorActive === 'true') {
      filter = { ...filter, favorConditionEnabled: true };
    }

    const totalItems = await User.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / limit);

    const users = await User.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-firebaseUid');

    return successResponse(res, 'Users retrieved successfully', {
      users,
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    return sendError(res, 'Failed to retrieve users', 500, error);
  }
};

const getUserDetail = async (req, res) => {
  try {
    const { id } = req.params;

    let userObj = await User.findById(id).populate('sponsor', 'name email referralCode');
    if (!userObj) {
      return sendError(res, 'User not found', 404);
    }

    // Sync favor condition status
    const { syncFavorConditionStatus } = await import('../services/favor.service.js');
    userObj = await syncFavorConditionStatus(userObj);

    const wallet = await Wallet.findOne({ user: id });
    const businessReport = await BusinessReport.findOne({ user: id }) || {};
    const legs = await LegReport.find({ user: id }).populate('legUser', 'name email referralCode');
    const investments = await UserInvestment.find({ user: id }).populate('package', 'name');
    const deposits = await Deposit.find({ user: id }).sort({ createdAt: -1 }).limit(5);
    const withdrawals = await WithdrawalRequest.find({ user: id }).sort({ createdAt: -1 }).limit(5);

    // Calculate actual hold and paid totals dynamically
    const allWithdrawalRequests = await WithdrawalRequest.find({ user: id });
    const newWithdrawalHold = allWithdrawalRequests
      .filter(w => ['pending'].includes(w.status))
      .reduce((sum, w) => sum + w.amountRequested, 0);
    const newWithdrawalPaid = allWithdrawalRequests
      .filter(w => ['approved', 'paid'].includes(w.status))
      .reduce((sum, w) => sum + w.amountRequested, 0);

    const legacyWithdrawals = await Withdrawal.find({ user: id });
    const legacyWithdrawalHold = legacyWithdrawals
      .filter(w => w.status === 'pending')
      .reduce((sum, w) => sum + w.amountUSDT, 0);
    const legacyWithdrawalPaid = legacyWithdrawals
      .filter(w => w.status === 'approved')
      .reduce((sum, w) => sum + w.payableAmountUSDT, 0);

    const withdrawalHold = newWithdrawalHold + legacyWithdrawalHold;
    const withdrawalPaid = newWithdrawalPaid + legacyWithdrawalPaid;

    const walletData = wallet ? wallet.toObject() : {
      deposit: 0,
      freeRegBonus: 0,
      roi: 0,
      referral: 0,
      bonusActivation: 0,
      bonusTransferable: 0,
      bonusReceived: 0,
      salary: 0,
      achievement: 0,
      adminAllocated: 0,
      withdrawal: 0
    };
    walletData.withdrawalHold = withdrawalHold;
    walletData.withdrawalPaid = withdrawalPaid;

    return successResponse(res, 'User details retrieved successfully', {
      user: userObj,
      wallet: walletData,
      businessReport,
      legs,
      investments,
      recentDeposits: deposits,
      recentWithdrawals: withdrawals
    });
  } catch (error) {
    return sendError(res, 'Failed to retrieve user details', 500, error);
  }
};

const suspendUser = async (req, res) => {
  try {
    const { id } = req.params;
    const userObj = await User.findByIdAndUpdate(id, { status: 'suspended' }, { new: true });
    if (!userObj) {
      return sendError(res, 'User not found', 404);
    }
    return successResponse(res, 'User suspended successfully', { user: userObj });
  } catch (error) {
    return sendError(res, 'Failed to suspend user', 500, error);
  }
};

const activateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const userObj = await User.findByIdAndUpdate(id, { status: 'active' }, { new: true });
    if (!userObj) {
      return sendError(res, 'User not found', 404);
    }
    return successResponse(res, 'User activated successfully', { user: userObj });
  } catch (error) {
    return sendError(res, 'Failed to activate user', 500, error);
  }
};

const listUnverifiedUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = {
      $or: [
        { emailVerified: false },
        { status: 'pending_verification' }
      ]
    };

    const totalItems = await User.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / limit);

    const users = await User.find(filter)
      .populate('sponsor', 'name email referralCode')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return successResponse(res, 'Unverified users retrieved successfully', {
      users,
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    console.error('listUnverifiedUsers error:', error);
    return sendError(res, 'Failed to retrieve unverified users', 500, error);
  }
};

const cleanupUnverifiedUsers = async (req, res) => {
  try {
    const hours = parseInt(req.body.hours) || 48; // default to 48 hours
    const thresholdDate = new Date(Date.now() - hours * 60 * 60 * 1000);

    const filter = {
      $or: [
        { emailVerified: false },
        { status: 'pending_verification' }
      ],
      createdAt: { $lt: thresholdDate }
    };

    // Find matching users first to log what was deleted
    const usersToDelete = await User.find(filter).select('_id name email').lean();
    const userIds = usersToDelete.map(u => u._id);

    if (userIds.length > 0) {
      await User.deleteMany({ _id: { $in: userIds } });
      
      await AdminLog.create({
        admin: req.user._id,
        action: 'CLEANUP_UNVERIFIED_USERS',
        targetModel: 'User',
        newData: { deletedCount: userIds.length, hoursThreshold: hours, deletedUsers: usersToDelete },
        ipAddress: req.ip || '127.0.0.1'
      });
    }

    return successResponse(res, `Cleaned up ${userIds.length} unverified users successfully.`, {
      deletedCount: userIds.length,
      deletedUsers: usersToDelete
    });
  } catch (error) {
    console.error('cleanupUnverifiedUsers error:', error);
    return sendError(res, 'Failed to cleanup unverified users', 500, error);
  }
};

export default {
  processDeposit,
  processWithdrawal,
  processKyc,

  createPackage,
  getAdminPackages,
  updatePackage,

  createPaymentMethod,
  getAdminPaymentMethods,
  updatePaymentMethod,
  updateExchangeRate,
  getAdminDashboard,
  getAdminDeposits,
  getAdminWithdrawals,
  getAdminKyc,

  listUsers,
  getUserDetail,
  suspendUser,
  activateUser,

  listUnverifiedUsers,
  cleanupUnverifiedUsers
};