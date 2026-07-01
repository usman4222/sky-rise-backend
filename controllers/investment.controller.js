import mongoose from 'mongoose';

// Models with ESM suffix
import User from '../models/auth/user.model.js';
import Wallet from '../models/finance/wallet.model.js';
import WalletHistory from '../models/finance/wallet_history.model.js';
import InvestmentPackage from '../models/investment/investment_package.model.js';
import UserInvestment from '../models/investment/user_investment.model.js';
import InvestmentPayment from '../models/investment/investment_payment.model.js';
import CapitalWithdrawal from '../models/investment/capital_withdrawal.model.js';
import RoiHistory from '../models/investment/roi_history.model.js';
import Notification from '../models/system/notification.model.js';
import ReferralTree from '../models/network/referral_tree.model.js';
import UserRole from '../models/auth/user_role.model.js';

// Reward triggers
import rewardEngine from '../utils/rewardEngine.js';
const { payoutDirectReferral, checkAchievementRewards, payoutLeadershipRewards } = rewardEngine;

// Response helpers
import { sendError, successResponse } from '../utils/response.js';

// @desc    Get all investment packages
// @route   GET /api/investments/packages
// @access  Private
const getPackages = async (req, res) => {
  try {
    let isAdmin = false;
    if (req.user) {
      const userRoles = await UserRole.find({ user: req.user._id }).populate('role');
      const roleNames = userRoles.map(ur => ur.role?.name?.toUpperCase() || '');
      isAdmin = roleNames.includes('ADMIN') || roleNames.includes('SUPER_ADMIN');
    }

    // Non-admins see public packages. Admins can see hidden packages (Package E)
    const query = { isActive: true };
    if (!isAdmin) {
      query.isHidden = false;
      let showMarketer = false;
      if (req.user) {
        if (req.user.isAdminFunded) {
          showMarketer = true;
        } else {
          const wallet = await Wallet.findOne({ user: req.user._id });
          if (wallet && wallet.adminAllocated > 0) {
            showMarketer = true;
          }
        }
      }

      if (!showMarketer) {
        query.packageTarget = { $ne: 'marketer' };
      }
    }

    const packages = await InvestmentPackage.find(query).sort({ minAmount: 1 });
    return successResponse(res, 'Packages retrieved successfully', { packages });
  } catch (error) {
    console.error('getPackages error:', error.message);
    return sendError(res, 'Internal investments query error', 500);
  }
};

// @desc    Purchase investment package
// @route   POST /api/investments/purchase
// @access  Private
const purchasePackage = async (req, res) => {
  try {
    const {
      packageId,
      amount,
      amountInvested: amountInvestedFromBody,
      useBonus: useBonusFromBody,
      useSignupBonus,
      useAdminAllocated,
      autoReinvest
    } = req.body;

    if (!packageId) {
      return sendError(res, 'Package ID is required', 400);
    }

    if (!mongoose.Types.ObjectId.isValid(packageId)) {
      return sendError(res, 'Invalid package ID format', 400);
    }

    const amountValue = amountInvestedFromBody !== undefined ? amountInvestedFromBody : amount;

    if (amountValue === undefined || amountValue === null || amountValue === '') {
      return sendError(res, 'Investment amount is required', 400);
    }

    const amountInvested = Number(amountValue);

    if (Number.isNaN(amountInvested) || amountInvested <= 0) {
      return sendError(res, 'Investment amount must be a valid number greater than 0', 400);
    }

    const useBonus =
      useBonusFromBody !== undefined
        ? useBonusFromBody === true || useBonusFromBody === 'true'
        : useSignupBonus === true || useSignupBonus === 'true';

    // Auto-reinvest settings: default to true if not specified
    const shouldAutoReinvest = autoReinvest === undefined ? true : (autoReinvest === true || autoReinvest === 'true');
    const claimMode = shouldAutoReinvest ? 'auto' : 'manual';

    // 1. Fetch package rules
    const pkg = await InvestmentPackage.findById(packageId);

    if (!pkg || !pkg.isActive) {
      return sendError(res, 'Selected package is inactive or invalid', 400);
    }

    // Better min amount message
    if (amountInvested < pkg.minAmount) {
      return sendError(
        res,
        `Minimum investment for ${pkg.name} package is $${pkg.minAmount}. You entered $${amountInvested}. Please invest at least $${pkg.minAmount}.`,
        400
      );
    }

    // Better max amount message
    if (pkg.maxAmount && amountInvested > pkg.maxAmount) {
      return sendError(
        res,
        `Maximum investment for ${pkg.name} package is $${pkg.maxAmount}. You entered $${amountInvested}. Please enter an amount between $${pkg.minAmount} and $${pkg.maxAmount}.`,
        400
      );
    }

    // Hidden/admin package check
    const userRoles = await UserRole.find({ user: req.user._id }).populate('role');
    const roleNames = userRoles.map(ur => ur.role?.name?.toUpperCase() || '');
    const isAdmin = roleNames.includes('ADMIN') || roleNames.includes('SUPER_ADMIN');
    if (pkg.isHidden && !isAdmin) {
      return sendError(res, 'This package is restricted and cannot be purchased by normal users', 403);
    }

    // 2. Fetch User wallet
    const wallet = await Wallet.findOne({ user: req.user._id });

    if (!wallet) {
      return sendError(res, 'User wallet balances not initialized', 400);
    }

    let realAmountPaid = amountInvested;
    let bonusAmountPaid = 0;
    let freeRegBonusPaid = 0;
    let teamBonusReceivedPaid = 0;
    const isAllocated = useAdminAllocated === true || useAdminAllocated === 'true';

    // Validate packageTarget vs useAdminAllocated restrictions
    const isMarketerPackage = pkg.packageTarget === 'marketer';
    if (isMarketerPackage && !isAllocated) {
      return sendError(res, 'Marketer packages can only be purchased using admin-allocated balance.', 400);
    }
    if (!isMarketerPackage && isAllocated) {
      return sendError(res, 'Admin-allocated balance can only be invested in marketer packages.', 400);
    }

    const userProfile = await User.findById(req.user._id);

    if (isAllocated) {
      // Validate wallet has enough allocated balance
      if (wallet.adminAllocated < amountInvested) {
        return sendError(
          res,
          `Insufficient admin allocated balance. You need $${amountInvested.toFixed(2)} allocated balance to buy ${pkg.name}. Your current admin allocated balance is $${Number(wallet.adminAllocated || 0).toFixed(2)}.`,
          400
        );
      }

      // Deduct from wallet
      const prevAllocBal = wallet.adminAllocated;
      wallet.adminAllocated -= amountInvested;
      await wallet.save();

      // Log in WalletHistory
      await WalletHistory.create({
        user: req.user._id,
        walletType: 'adminAllocated',
        type: 'debit',
        amount: amountInvested,
        previousBalance: prevAllocBal,
        newBalance: wallet.adminAllocated,
        category: 'investment_purchase',
        description: `Invested in ${pkg.name} using Admin Allocated Balance. Amount paid: $${amountInvested}`
      });

      // Create active investment tagged as Admin Funded
      const roiStartTime = new Date();
      const userInvestment = new UserInvestment({
        user: req.user._id,
        package: packageId,
        amount: amountInvested,
        status: 'active',
        currentRoi: pkg.startRoi,
        lastIncrementAt: roiStartTime,
        lastPayoutAt: roiStartTime,
        roiClaimMode: claimMode,
        autoReinvest: shouldAutoReinvest,
        packageType: 'Admin Funded Package'
      });

      await userInvestment.save();

      const paymentBreakdown = new InvestmentPayment({
        userInvestment: userInvestment._id,
        realAmountPaid: 0,
        freeRegBonusPaid: 0,
        teamBonusReceivedPaid: 0,
        totalAmount: amountInvested
      });

      await paymentBreakdown.save();

      await Notification.create({
        user: req.user._id,
        title: 'Investment Active (Admin Funded)',
        message: `Successfully invested $${amountInvested.toFixed(2)} in ${pkg.name} using Admin Allocated Balance.`,
        category: 'investment'
      });

      return successResponse(
        res,
        'Package purchased successfully using Admin Allocated Balance! Investment is now active.',
        {
          investment: userInvestment,
          payment: paymentBreakdown
        },
        201
      );
    }

    if (userProfile?.registrationBonusActive && wallet.freeRegBonus >= 5 && amountInvested >= 50) {
      freeRegBonusPaid = 5;
      bonusAmountPaid += 5;

      userProfile.registrationBonusActive = false;
      await userProfile.save();

      const prevRegBal = wallet.freeRegBonus;
      wallet.freeRegBonus -= 5;
      await wallet.save();

      await WalletHistory.create({
        user: req.user._id,
        walletType: 'freeRegBonus',
        type: 'debit',
        amount: 5,
        previousBalance: prevRegBal,
        newBalance: wallet.freeRegBonus,
        category: 'investment_purchase',
        description: 'Auto-merged $5 Free Registration Bonus with first eligible investment ($50+)'
      });
    }
    // NOTE: If investment < $50, bonus remains active for the next eligible investment

    // RULE 2: Bonus usage
    if (useBonus && wallet.bonusReceived > 0) {
      const maxBonusAllowed = amountInvested * 0.1;
      teamBonusReceivedPaid = Math.min(wallet.bonusReceived, maxBonusAllowed);

      if (teamBonusReceivedPaid > 0) {
        bonusAmountPaid += teamBonusReceivedPaid;
        realAmountPaid = amountInvested - teamBonusReceivedPaid;

        const prevRecBal = wallet.bonusReceived;
        wallet.bonusReceived -= teamBonusReceivedPaid;
        await wallet.save();

        await WalletHistory.create({
          user: req.user._id,
          walletType: 'bonusReceived',
          type: 'debit',
          amount: teamBonusReceivedPaid,
          previousBalance: prevRecBal,
          newBalance: wallet.bonusReceived,
          category: 'investment_purchase',
          description: `Applied $${teamBonusReceivedPaid} bonus balance for investment purchase`
        });
      }
    }

    // Combined available pool check (Deposit Wallet + Withdrawable Wallets)
    const availablePool = (wallet.deposit || 0) + (wallet.roi || 0) + (wallet.referral || 0) + (wallet.salary || 0) + (wallet.achievement || 0);

    if (availablePool < realAmountPaid) {
      if (freeRegBonusPaid > 0) {
        userProfile.registrationBonusActive = true;
        await userProfile.save();
        wallet.freeRegBonus += 5;
        await wallet.save();
      }

      if (teamBonusReceivedPaid > 0) {
        wallet.bonusReceived += teamBonusReceivedPaid;
        await wallet.save();
      }

      return sendError(
        res,
        `Insufficient balance. You need $${realAmountPaid.toFixed(2)} to buy ${pkg.name}. Your total available balance (including withdrawal earnings) is $${availablePool.toFixed(2)}.`,
        400
      );
    }

    // Deduct sequentially from Deposit and Withdrawable wallets
    let remainingToPay = realAmountPaid;
    const deductions = [];

    const walletsToDeduct = [
      { name: 'deposit', label: 'Deposit Wallet' },
      { name: 'roi', label: 'ROI Wallet' },
      { name: 'referral', label: 'Referral Wallet' },
      { name: 'salary', label: 'Salary Wallet' },
      { name: 'achievement', label: 'Achievement Wallet' }
    ];

    for (const wType of walletsToDeduct) {
      if (remainingToPay <= 0) break;

      const currentBal = wallet[wType.name] || 0;
      if (currentBal > 0) {
        const deductAmount = Math.min(currentBal, remainingToPay);
        const prevBal = currentBal;

        wallet[wType.name] -= deductAmount;
        remainingToPay -= deductAmount;

        deductions.push({
          walletType: wType.name,
          label: wType.label,
          amount: deductAmount,
          prevBal,
          newBal: wallet[wType.name]
        });
      }
    }

    await wallet.save();

    // Log WalletHistory for each wallet type deducted
    for (const d of deductions) {
      await WalletHistory.create({
        user: req.user._id,
        walletType: d.walletType,
        type: 'debit',
        amount: d.amount,
        previousBalance: d.prevBal,
        newBalance: d.newBal,
        category: 'investment_purchase',
        description: `Deducted $${d.amount.toFixed(2)} from ${d.label} for ${pkg.name} purchase.`
      });
    }

    // 3. Create active investment (Starts Instantly)
    const totalPrincipalSize = amountInvested + freeRegBonusPaid;
    const roiStartTime = new Date();

    const userInvestment = new UserInvestment({
      user: req.user._id,
      package: packageId,
      amount: totalPrincipalSize,
      status: 'active',
      currentRoi: pkg.startRoi,
      lastIncrementAt: roiStartTime,
      lastPayoutAt: roiStartTime,
      roiClaimMode: claimMode,
      autoReinvest: shouldAutoReinvest
    });

    await userInvestment.save();

    const paymentBreakdown = new InvestmentPayment({
      userInvestment: userInvestment._id,
      realAmountPaid,
      freeRegBonusPaid,
      teamBonusReceivedPaid,
      totalAmount: totalPrincipalSize
    });

    await paymentBreakdown.save();

    // 4. MLM commissions
    const treeNode = await ReferralTree.findOne({ user: req.user._id });

    if (treeNode && treeNode.referredBy) {
      await payoutDirectReferral(
        treeNode.referredBy,
        req.user._id,
        realAmountPaid,
        userInvestment._id
      );

      await payoutLeadershipRewards(
        req.user._id,
        realAmountPaid,
        userInvestment._id
      );

      for (const uplineId of treeNode.ancestors) {
        await checkAchievementRewards(uplineId);
      }
    }

    // Check the activating user's own achievements (in case of previously accumulated team business)
    await checkAchievementRewards(req.user._id);

    await Notification.create({
      user: req.user._id,
      title: 'Investment Active',
      message: `Successfully invested $${totalPrincipalSize.toFixed(2)} in ${pkg.name}.`,
      category: 'investment'
    });

    return successResponse(
      res,
      'Package purchased successfully! Investment is now active.',
      {
        investment: userInvestment,
        payment: paymentBreakdown
      },
      201
    );
  } catch (error) {
    console.error('Purchase package error:', error);
    return sendError(res, 'Internal purchase error', 500, error);
  }
};

// @desc    Get user's active/completed investments list
// @route   GET /api/investments/my-investments
// @access  Private
const getMyInvestments = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = { user: req.user._id };
    const totalItems = await UserInvestment.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / limit);

    const investments = await UserInvestment.find(filter)
      .populate('package')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const intervalMs = process.env.ROI_TEST_MODE === 'true'
      ? 60 * 1000 // 1 minute
      : 24 * 60 * 60 * 1000; // 24 hours

    const processedInvestments = await Promise.all(investments.map(async (inv) => {
      if (inv.status === 'active') {
        const now = new Date();
        // Check real-time expiration
        if (inv.pendingRoiClaim > 0 && inv.claimExpiresAt && now > new Date(inv.claimExpiresAt)) {
          const missedAmount = inv.pendingRoiClaim;
          await UserInvestment.updateOne(
            { _id: inv._id },
            { $set: { pendingRoiClaim: 0, claimExpiresAt: null } }
          );
          
          await Notification.create({
            user: req.user._id,
            title: 'Daily ROI Claim Expired ⚠️',
            message: `Your daily ROI claim of $${missedAmount.toFixed(2)} for package ${inv.package?.name || ''} expired because it was not claimed within the required time window.`,
            category: 'system'
          });

          inv.pendingRoiClaim = 0;
          inv.claimExpiresAt = null;
        }

        let nextRoiPayoutAt;
        if (process.env.ROI_TEST_MODE === 'true') {
          const lastPayout = inv.lastPayoutAt || inv.createdAt;
          nextRoiPayoutAt = new Date(new Date(lastPayout).getTime() + 60000);
        } else {
          // Production: next release is always the upcoming 12:00 AM midnight in PKT (UTC+5)
          const nowPkt = new Date(new Date().getTime() + 5 * 60 * 60 * 1000);
          nowPkt.setUTCHours(24, 0, 0, 0); // Roll over to 12:00 AM of the next PKT calendar date
          nextRoiPayoutAt = new Date(nowPkt.getTime() - 5 * 60 * 60 * 1000); // Convert back to UTC date
        }
        return {
          ...inv,
          nextRoiPayoutAt
        };
      }
      return inv;
    }));

    return successResponse(res, 'My investments retrieved successfully', {
      investments: processedInvestments,
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    console.error('getMyInvestments error:', error.message);
    return sendError(res, 'Internal investments listing error', 500);
  }
};

// @desc    Withdraw capital early (With exit penalties check)
// @route   POST /api/investments/withdraw-capital
// @access  Private
const withdrawCapital = async (req, res) => {
  try {
    const { investmentId } = req.body;

    if (!investmentId) {
      return sendError(res, 'Investment ID is required', 400);
    }

    // 1. Fetch UserInvestment
    const investment = await UserInvestment.findOne({ _id: investmentId, user: req.user._id, status: 'active' })
      .populate('package');

    if (!investment) {
      return sendError(res, 'Active investment contract not found', 404);
    }

    if (investment.packageType === 'Admin Funded Package') {
      return sendError(res, 'Capital withdrawal is disabled for Admin Funded Packages. The principal is permanently locked.', 400);
    }

    const payment = await InvestmentPayment.findOne({ userInvestment: investmentId });
    if (!payment) {
      return sendError(res, 'Payment funding logs missing', 404);
    }

    const pkg = investment.package;
    const realCapital = payment.realAmountPaid; // exit penalty applies strictly to the cash portion

    // Calculate duration in months
    const msPassed = new Date() - investment.createdAt;
    const monthsPassed = msPassed / (1000 * 60 * 60 * 24 * 30.44); // average month size

    let penaltyDeduction = 0;
    let roiDeduction = 0;
    let finalPayableAmount = realCapital;

    // Check early exit penalty window
    if (monthsPassed < pkg.earlyWithdrawalPenaltyMonths) {
      // Exit BEFORE penalty limit:
      // A) 15% deduction from real capital
      penaltyDeduction = realCapital * (pkg.earlyWithdrawalPenaltyPercent / 100);

      // B) ALL ROI profit earned from this investment must be completely removed!
      roiDeduction = investment.totalRoiEarned;

      // Net cash payout
      finalPayableAmount = realCapital - penaltyDeduction - roiDeduction;
    }

    if (finalPayableAmount < 0) {
      // If ROI clawback exceeds capital balance
      finalPayableAmount = 0;
    }

    // 2. Terminate investment contract
    investment.status = 'withdrawn';
    investment.closeDate = new Date();
    await investment.save();

    // 3. Credit remaining payable capital back to user's deposit wallet
    const wallet = await Wallet.findOne({ user: req.user._id });
    if (wallet) {
      const prevDepBal = wallet.deposit;
      wallet.deposit += finalPayableAmount;
      await wallet.save();

      // Log exit transactions
      const capitalLog = new CapitalWithdrawal({
        user: req.user._id,
        userInvestment: investmentId,
        originalCapital: realCapital,
        penaltyDeduction,
        roiDeduction,
        finalPayableAmount
      });
      await capitalLog.save();

      // Wallet history
      await WalletHistory.create({
        user: req.user._id,
        walletType: 'deposit',
        type: 'credit',
        amount: finalPayableAmount,
        previousBalance: prevDepBal,
        newBalance: wallet.deposit,
        category: 'capital_withdrawal',
        description: `Exited capital early. Real: $${realCapital}. Exit Penalty (15%): $${penaltyDeduction}. ROI Clawback: $${roiDeduction}. Net payout credited: $${finalPayableAmount}`,
        referenceModel: 'CapitalWithdrawal',
        referenceId: capitalLog._id
      });
    }

    // Alert User
    await Notification.create({
      user: req.user._id,
      title: 'Capital Exited',
      message: `Capital withdrawn. Principal: $${realCapital.toFixed(2)}. Net credited: $${finalPayableAmount.toFixed(2)} after exit charges.`,
      category: 'withdrawal'
    });

    return successResponse(res, monthsPassed < pkg.earlyWithdrawalPenaltyMonths
      ? `Capital exited early. Net payable $${finalPayableAmount.toFixed(2)} credited after 15% penalty and ROI clawbacks.`
      : `Capital exited successfully! Real capital of $${realCapital.toFixed(2)} credited back.`, {
      netPayable: finalPayableAmount
    });
  } catch (error) {
    console.error('Withdraw capital error:', error);
    return sendError(res, 'Internal capital exit error', 500, error);
  }
};

const getRoiHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = { user: req.user._id };
    const totalItems = await RoiHistory.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / limit);

    const roiHistory = await RoiHistory.find(filter)
      .populate({
        path: 'userInvestment',
        populate: { path: 'package' }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return successResponse(res, 'ROI payout history retrieved successfully', {
      roiHistory,
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    console.error('getRoiHistory error:', error);
    return sendError(res, 'Failed to fetch ROI history records', 500, error);
  }
};

const toggleAutoReinvest = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 'Invalid investment ID format', 400);
    }
    const investment = await UserInvestment.findOne({ _id: id, user: req.user._id, status: 'active' });
    if (!investment) {
      return sendError(res, 'Active investment not found', 404);
    }
    investment.autoReinvest = !investment.autoReinvest;
    investment.roiClaimMode = investment.autoReinvest ? 'auto' : 'manual';
    await investment.save();
    return successResponse(res, `Auto-reinvestment has been successfully turned ${investment.autoReinvest ? 'ON' : 'OFF'}.`, {
      investment
    });
  } catch (error) {
    console.error('toggleAutoReinvest error:', error);
    return sendError(res, 'Failed to toggle auto-reinvest setting', 500, error);
  }
};

const claimDailyRoi = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 'Invalid investment ID format', 400);
    }
    const investment = await UserInvestment.findOne({ _id: id, user: req.user._id, status: 'active' });
    if (!investment) {
      return sendError(res, 'Active investment not found', 404);
    }
    if (investment.pendingRoiClaim <= 0) {
      return sendError(res, 'No pending ROI available to claim for this investment.', 400);
    }
    // Check if the claim window has expired
    if (investment.claimExpiresAt && new Date() > investment.claimExpiresAt) {
      // Missed ROI reset logic: clean it up
      investment.pendingRoiClaim = 0;
      investment.claimExpiresAt = null;
      await investment.save();
      return sendError(res, 'This daily ROI claim window has expired (12 hours missed ROI policy).', 400);
    }

    const payoutAmount = investment.pendingRoiClaim;

    // Credit to user's ROI wallet
    const wallet = await Wallet.findOne({ user: req.user._id });
    if (!wallet) {
      return sendError(res, 'User wallet balances not initialized', 400);
    }

    const prevBalance = wallet.roi;
    wallet.roi += payoutAmount;
    await wallet.save();

    // Log to WalletHistory
    await WalletHistory.create({
      user: req.user._id,
      walletType: 'roi',
      type: 'credit',
      amount: payoutAmount,
      previousBalance: prevBalance,
      newBalance: wallet.roi,
      category: 'daily_roi_income',
      description: `Manually claimed daily ROI interest payout on investment principal of $${investment.amount}`,
      referenceModel: 'UserInvestment',
      referenceId: investment._id
    });

    // Increment total ROI earned
    investment.totalRoiEarned += payoutAmount;

    // Reset pending claim
    investment.pendingRoiClaim = 0;
    investment.claimExpiresAt = null;
    await investment.save();

    // Log ROI Payout History
    const roiHistory = new RoiHistory({
      user: req.user._id,
      userInvestment: investment._id,
      amount: payoutAmount,
      roiPercent: investment.currentRoi,
      isCompounded: false
    });
    await roiHistory.save();

    // Distribute MLM level commissions (total 31% over 10 levels)
    await rewardEngine.distributeLevelRoiCommissions(req.user._id, payoutAmount, roiHistory._id);

    return successResponse(res, `Successfully claimed $${payoutAmount.toFixed(2)} ROI into your ROI wallet!`, {
      wallet,
      investment
    });
  } catch (error) {
    console.error('claimDailyRoi error:', error);
    return sendError(res, 'Failed to claim daily ROI', 500, error);
  }
};

export default {
  getPackages,
  purchasePackage,
  getMyInvestments,
  withdrawCapital,
  getRoiHistory,
  toggleAutoReinvest,
  claimDailyRoi
};
