import mongoose from 'mongoose';

// Models with ESM suffix
import User from '../models/auth/user.model.js';
import ReferralTree from '../models/network/referral_tree.model.js';
import LevelUnlock from '../models/network/level_unlock.model.js';
import Wallet from '../models/finance/wallet.model.js';
import WalletHistory from '../models/finance/wallet_history.model.js';
import UserInvestment from '../models/investment/user_investment.model.js';
import Notification from '../models/system/notification.model.js';
import EarningRule from '../models/rewards/earning_rule.model.js';
import Withdrawal from '../models/finance/withdrawal.model.js';

// Standardized responses
import { sendError, successResponse } from '../utils/response.js';

// @desc    Get user's upline tree path
// @route   GET /api/network/uplines
// @access  Private
const getUplines = async (req, res) => {
  try {
    const treeNode = await ReferralTree.findOne({ user: req.user._id })
      .populate('referredBy')
      .populate('ancestors');
    
    return successResponse(res, 'Uplines retrieved successfully', {
      referredBy: treeNode ? treeNode.referredBy : null,
      uplinesPath: treeNode ? treeNode.ancestors : []
    });
  } catch (error) {
    console.error('getUplines error:', error.message);
    return sendError(res, 'Internal network tree error', 500);
  }
};

// @desc    Get user's downline (direct referrals and full team lists)
// @route   GET /api/network/downline
// @access  Private
const getDownline = async (req, res) => {
  try {
    // 1. Fetch immediate directs
    const directs = await ReferralTree.find({ referredBy: req.user._id })
      .populate('user');
    
    // Fetch total network tree details
    const node = await ReferralTree.findOne({ user: req.user._id });

    // Count how many directs have active investments dynamically
    const directUserIds = directs.map(d => d.user?._id).filter(Boolean);
    const activeDirects = await UserInvestment.distinct('user', {
      user: { $in: directUserIds },
      status: 'active',
      packageType: { $ne: 'Admin Funded Package' }
    });
    const activeDirectsCount = activeDirects.length;

    // 2. Fetch all downline tree nodes where user is in ancestors list
    const downlineTreeNodes = await ReferralTree.find({ ancestors: req.user._id })
      .populate('user');

    const downlineUserIds = downlineTreeNodes.map(d => d.user?._id).filter(Boolean);

    // Fetch active investments for all downline users
    const investments = await UserInvestment.find({
      user: { $in: downlineUserIds },
      status: 'active',
      packageType: { $ne: 'Admin Funded Package' }
    });

    // Fetch approved withdrawals for all downline users
    const withdrawals = await Withdrawal.find({
      user: { $in: downlineUserIds },
      status: 'approved'
    });

    // Group investments by user
    const investmentsByUser = {};
    investments.forEach(inv => {
      if (inv.user) {
        const uId = inv.user.toString();
        investmentsByUser[uId] = (investmentsByUser[uId] || 0) + inv.amount;
      }
    });

    // Group withdrawals by user
    const withdrawalsByUser = {};
    withdrawals.forEach(w => {
      if (w.user) {
        const uId = w.user.toString();
        withdrawalsByUser[uId] = (withdrawalsByUser[uId] || 0) + w.amountUSDT;
      }
    });

    // Construct level list mapping: levels 1 to 10
    const levelTeamData = {};
    for (let i = 1; i <= 10; i++) {
      levelTeamData[i] = [];
    }

    downlineTreeNodes.forEach(node => {
      if (!node.user) return;
      const idx = node.ancestors.indexOf(req.user._id);
      if (idx !== -1) {
        const level = idx + 1;
        if (level >= 1 && level <= 10) {
          const uId = node.user._id.toString();
          const totalInvestments = investmentsByUser[uId] || 0;
          const totalWithdrawals = withdrawalsByUser[uId] || 0;
          const isActiveUser = totalInvestments > 0;

          levelTeamData[level].push({
            id: node.user._id,
            name: node.user.name,
            email: node.user.email,
            status: node.user.status,
            isActiveUser,
            totalInvestments,
            totalWithdrawals,
            joinedAt: node.createdAt
          });
        }
      }
    });

    return successResponse(res, 'Downlines retrieved successfully', {
      directReferralsCount: node ? node.directReferralsCount : 0,
      activeDirectReferralsCount: activeDirectsCount,
      totalTeamSize: node ? node.teamSize : 0,
      levelTeamData,
      directReferralsList: directs.map(d => {
        if (!d.user) return null;
        const uId = d.user._id.toString();
        const totalInvestments = investmentsByUser[uId] || 0;
        const totalWithdrawals = withdrawalsByUser[uId] || 0;
        const isActiveUser = totalInvestments > 0;
        return {
          id: d.user._id,
          name: d.user.name,
          email: d.user.email,
          kycStatus: d.user.kycStatus,
          status: d.user.status,
          isActiveUser,
          totalInvestments,
          totalWithdrawals,
          joinedAt: d.createdAt
        };
      }).filter(Boolean)
    });
  } catch (error) {
    console.error('getDownline error:', error.message);
    return sendError(res, 'Internal network list error', 500);
  }
};

// @desc    Unlock level (Levels 2 to 10 with condition & fee checks)
// @route   POST /api/network/unlock-level
// @access  Private
const unlockLevel = async (req, res) => {
  try {
    const { level } = req.body;

    if (!level || level < 2 || level > 10) {
      return sendError(res, 'Invalid level selection. Levels 2 to 10 only.', 400);
    }

    // 1. Check if level already unlocked
    if (req.user.unlockedLevels.includes(level)) {
      return sendError(res, `Level ${level} is already unlocked`, 400);
    }

    // Check if previous level is unlocked to ensure sequential unlocking
    if (!req.user.unlockedLevels.includes(level - 1)) {
      return sendError(res, `You must unlock Level ${level - 1} before unlocking Level ${level}`, 400);
    }

    // 2. CONDITION CHECK: Active Direct Referrals
    // Level L requires L-1 active direct referrals
    const requiredActiveDirects = level - 1;

    // Get all direct referrals
    const directs = await ReferralTree.find({ referredBy: req.user._id });
    const directIds = directs.map(d => d.user);

    // Count how many directs have active investments
    const activeDirectsCount = await UserInvestment.distinct('user', {
      user: { $in: directIds },
      status: 'active',
      packageType: { $ne: 'Admin Funded Package' }
    });

    if (activeDirectsCount.length < requiredActiveDirects) {
      return sendError(res, `Qualification failed: Unlocking Level ${level} requires at least ${requiredActiveDirects} active direct referrals. You currently have ${activeDirectsCount.length} active directs.`, 400);
    }

    // 3. FEE CHECK: $5 Activation Fee (Allows 50% split pay from bonusActivation wallet)
    const feeRule = await EarningRule.findOne({ ruleName: 'level_unlock_fee' });
    const standardFee = feeRule ? Number(feeRule.value) : 5; // $5

    const bonusPercentRule = await EarningRule.findOne({ ruleName: 'level_activation_bonus_usage_percent' });
    const maxBonusPercent = bonusPercentRule ? Number(bonusPercentRule.value) : 50; // 50%

    const maxBonusCap = standardFee * (maxBonusPercent / 100); // $2.50 max from bonus

    const wallet = await Wallet.findOne({ user: req.user._id });
    if (!wallet) {
      return sendError(res, 'User wallet balances not initialized', 400);
    }

    let bonusPaid = 0;
    let realPaid = standardFee;

    // Utilize activation bonus wallet up to 50% ($2.50) if available
    if (wallet.bonusActivation > 0) {
      bonusPaid = Math.min(wallet.bonusActivation, maxBonusCap);
      realPaid = standardFee - bonusPaid;
    }

    // Check if user has enough real deposit cash
    if (wallet.deposit < realPaid) {
      return sendError(res, `Insufficient deposit balance. Level activation requires $${realPaid.toFixed(2)} cash contribution. Available cash: $${wallet.deposit.toFixed(2)}`, 400);
    }

    // 4. Perform Wallet Debits & save
    if (bonusPaid > 0) {
      const prevBonusBal = wallet.bonusActivation;
      wallet.bonusActivation -= bonusPaid;
      await wallet.save();

      await WalletHistory.create({
        user: req.user._id,
        walletType: 'bonusActivation',
        type: 'debit',
        amount: bonusPaid,
        previousBalance: prevBonusBal,
        newBalance: wallet.bonusActivation,
        category: 'level_activation_fee',
        description: `Paid ${maxBonusPercent}% level unlock bonus contribution for Level ${level}`
      });
    }

    const prevCashBal = wallet.deposit;
    wallet.deposit -= realPaid;
    await wallet.save();

    await WalletHistory.create({
      user: req.user._id,
      walletType: 'deposit',
      type: 'debit',
      amount: realPaid,
      previousBalance: prevCashBal,
      newBalance: wallet.deposit,
      category: 'level_activation_fee',
      description: `Paid cash contribution for Level ${level} activation`
    });

    // 5. Create LevelUnlock Log & update profile levels array
    const levelUnlock = new LevelUnlock({
      user: req.user._id,
      level,
      feePaid: standardFee,
      realAmountPaid: realPaid,
      bonusAmountPaid: bonusPaid
    });
    await levelUnlock.save();

    // Push level to user's unlocked levels array
    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { unlockedLevels: level }
    });

    // Alert User
    await Notification.create({
      user: req.user._id,
      title: `🎉 Team Level ${level} Unlocked!`,
      message: `You unlocked daily ROI commissions from downline Level ${level} members. Paid fee: $${standardFee}.`,
      category: 'system'
    });

    return successResponse(res, `Successfully unlocked Team Level ${level}! Dynamic ROI team splits now active at this depth.`, {
      unlockedLevels: [...req.user.unlockedLevels, level]
    });
  } catch (error) {
    console.error('unlockLevel error:', error);
    return sendError(res, 'Internal level activation error', 500, error);
  }
};

export default {
  getUplines,
  getDownline,
  unlockLevel
};
