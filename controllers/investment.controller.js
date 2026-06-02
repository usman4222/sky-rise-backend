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
const { payoutDirectReferral, checkAchievementRewards } = rewardEngine;

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
      useSignupBonus
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

    // RULE 1: First investment merge signup bonus check
    const userProfile = await User.findById(req.user._id);

    if (userProfile?.registrationBonusActive && wallet.freeRegBonus >= 5) {
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
        description: 'Merged $5 Free signup bonus with first package purchase'
      });
    }

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

    // Deposit balance check
    if (wallet.deposit < realAmountPaid) {
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
        `Insufficient deposit balance. You need $${realAmountPaid.toFixed(2)} real balance to buy ${pkg.name}. Your current deposit balance is $${Number(wallet.deposit || 0).toFixed(2)}.`,
        400
      );
    }

    // Deduct deposit wallet
    const prevDepBal = wallet.deposit;
    wallet.deposit -= realAmountPaid;
    await wallet.save();

    await WalletHistory.create({
      user: req.user._id,
      walletType: 'deposit',
      type: 'debit',
      amount: realAmountPaid,
      previousBalance: prevDepBal,
      newBalance: wallet.deposit,
      category: 'investment_purchase',
      description: `Invested in ${pkg.name}. Real amount paid: $${realAmountPaid}`
    });

    // 3. Create active investment (Starts at the End of the Day)
    const totalPrincipalSize = amountInvested + freeRegBonusPaid;
    
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const userInvestment = new UserInvestment({
      user: req.user._id,
      package: packageId,
      amount: totalPrincipalSize,
      status: 'active',
      currentRoi: pkg.startRoi,
      lastIncrementAt: endOfDay,
      lastPayoutAt: endOfDay
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

      for (const uplineId of treeNode.ancestors) {
        await checkAchievementRewards(uplineId);
      }
    }

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
    const investments = await UserInvestment.find({ user: req.user._id })
      .populate('package')
      .sort({ createdAt: -1 });

    return successResponse(res, 'My investments retrieved successfully', { investments });
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
    const roiHistory = await RoiHistory.find({ user: req.user._id })
      .populate({
        path: 'userInvestment',
        populate: { path: 'package' }
      })
      .sort({ createdAt: -1 });

    return successResponse(res, 'ROI payout history retrieved successfully', {
      roiHistory
    });
  } catch (error) {
    console.error('getRoiHistory error:', error);
    return sendError(res, 'Failed to fetch ROI history records', 500, error);
  }
};

export default {
  getPackages,
  purchasePackage,
  getMyInvestments,
  withdrawCapital,
  getRoiHistory
};
