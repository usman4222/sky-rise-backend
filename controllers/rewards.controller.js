import User from '../models/auth/user.model.js';
import ReferralTree from '../models/network/referral_tree.model.js';
import VipRank from '../models/rewards/vip_rank.model.js';
import VipSalary from '../models/rewards/vip_salary.model.js';
import AchievementRank from '../models/rewards/achievement_rank.model.js';
import AchievementReward from '../models/rewards/achievement_reward.model.js';
import BusinessReport from '../models/network/business_report.model.js';
import LegReport from '../models/network/leg_report.model.js';
import UserInvestment from '../models/investment/user_investment.model.js';
import LeadershipReward from '../models/rewards/leadership_reward.model.js';
import Wallet from '../models/finance/wallet.model.js';
import WalletHistory from '../models/finance/wallet_history.model.js';
import rewardEngine from '../utils/rewardEngine.js';
import { sendError, successResponse } from '../utils/response.js';

// @desc    Get user's VIP Salary rank progress, leg business, and weekly salary history
// @route   GET /api/rewards/vip-status
// @access  Private
const getVipStatus = async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Refresh latest team volume statistics
    await rewardEngine.updateBusinessReport(userId);

    // 2. Fetch direct referrals representing distinct legs
    const directs = await ReferralTree.find({ referredBy: userId }).populate('user');
    
    const legs = [];
    for (const direct of directs) {
      if (!direct.user) continue;
      const directId = direct.user._id;

      // Sum active investments of direct referral
      const activeSelfInvestments = await UserInvestment.find({
        user: directId,
        status: 'active',
        packageType: { $ne: 'Admin Funded Package' }
      });
      const legOwnerInvestment = activeSelfInvestments.reduce((sum, inv) => sum + inv.amount, 0);

      // Fetch all descendants in this leg
      const descendantsNode = await ReferralTree.find({ ancestors: directId });
      const descendantIds = descendantsNode.map(t => t.user);

      // Sum active investments of descendants
      const downlineInvestments = await UserInvestment.find({
        user: { $in: descendantIds },
        status: 'active',
        packageType: { $ne: 'Admin Funded Package' }
      });

      const legDownlineVolume = downlineInvestments.reduce((sum, inv) => sum + inv.amount, 0);
      const legTotalBusiness = legOwnerInvestment + legDownlineVolume;

      legs.push({
        leg: legs.length + 1,
        legUser: {
          id: direct.user._id,
          name: direct.user.name,
          email: direct.user.email
        },
        volume: legTotalBusiness
      });

      // Upsert LegReport cache to keep consistent with background job
      await LegReport.findOneAndUpdate(
        { user: userId, legUser: directId },
        { legBusinessVolume: legTotalBusiness, isActive: legTotalBusiness > 0 },
        { upsert: true }
      );
    }

    // Sort legs by volume descending to match standard representation if desired
    legs.sort((a, b) => b.volume - a.volume);
    // Assign simple indices (1 to N) for UI presentation
    legs.forEach((l, idx) => {
      l.leg = idx + 1;
    });

    // 3. Fetch all VipRanks and Salary History
    const vipRanks = await VipRank.find({}).sort({ level: 1 });
    const salaryHistory = await VipSalary.find({ user: userId }).sort({ createdAt: -1 });

    // Fetch fresh user profile
    const user = await User.findById(userId);
    const currentVipRank = user.vipRank || 0;

    let weeklySalary = 0;
    const currentRankObj = vipRanks.find(r => r.level === currentVipRank);
    if (currentRankObj) {
      weeklySalary = currentRankObj.weeklySalary;
    }

    let nextRankTarget = null;
    if (currentVipRank < 5) {
      const nextRankObj = vipRanks.find(r => r.level === currentVipRank + 1);
      if (nextRankObj) {
        nextRankTarget = {
          name: nextRankObj.name,
          level: nextRankObj.level,
          requiredBusinessPerLeg: nextRankObj.requiredBusinessPerLeg,
          requiredActiveLegs: nextRankObj.requiredActiveLegs,
          weeklySalary: nextRankObj.weeklySalary
        };
      }
    }

    return successResponse(res, 'VIP status retrieved successfully', {
      currentVipRank,
      weeklySalary,
      activeLegsCount: directs.length,
      legs,
      vipRanks: vipRanks.map(v => ({
        rank: v.name,
        level: v.level,
        leg: v.requiredBusinessPerLeg,
        weekly: v.weeklySalary,
        monthly: v.weeklySalary * 4
      })),
      salaryHistory: salaryHistory.map((s, idx) => ({
        week: `Week ${salaryHistory.length - idx}`,
        rank: `VIP ${s.vipRank}`,
        amount: s.amount,
        status: 'Paid',
        date: s.createdAt
      })),
      nextRankTarget
    });
  } catch (error) {
    console.error('getVipStatus error:', error);
    return sendError(res, 'Failed to fetch VIP status details', 500, error);
  }
};

// @desc    Get user's Achievement Spark Milestones and volume progress
// @route   GET /api/rewards/achievements
// @access  Private
const getAchievements = async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Refresh latest team volume statistics
    await rewardEngine.updateBusinessReport(userId);

    // 2. Fetch business report details
    const report = await BusinessReport.findOne({ user: userId });
    const currentBusiness = report ? report.fiveLevelBusiness : 0;

    // 3. Fetch achievement ranks criteria
    const achievementRanks = await AchievementRank.find({}).sort({ stage: 1 });

    // 4. Fetch user rank status
    const user = await User.findById(userId);
    const currentStageNum = user.achievementRank || 0;

    let currentRankName = 'None';
    if (currentStageNum > 0) {
      const currentRankObj = achievementRanks.find(r => r.stage === currentStageNum);
      if (currentRankObj) {
        currentRankName = currentRankObj.name;
      }
    }

    let foundNext = false;
    const achievementsList = achievementRanks.map(rank => {
      const achieved = currentBusiness >= rank.requiredTeamBusiness;
      let status = 'locked';
      if (achieved) {
        status = 'achieved';
      } else if (!foundNext) {
        status = 'progress';
        foundNext = true;
      }

      return {
        name: rank.name,
        stage: rank.stage,
        business: rank.requiredTeamBusiness,
        reward: rank.reward,
        status
      };
    });

    const nextTarget = achievementsList.find(a => a.status === 'progress') || null;

    return successResponse(res, 'Achievements retrieved successfully', {
      currentBusiness,
      currentRank: currentRankName,
      currentRankStage: currentStageNum,
      achievements: achievementsList,
      nextTarget
    });
  } catch (error) {
    console.error('getAchievements error:', error);
    return sendError(res, 'Failed to fetch achievement details', 500, error);
  }
};

// @desc    Get user's qualified leadership tier progress, criteria, and rewards history
// @route   GET /api/rewards/leadership-status
// @access  Private
const getLeadershipStatus = async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Fetch active investments of the user
    const activeInvestments = await UserInvestment.find({
      user: userId,
      status: 'active',
      packageType: { $ne: 'Admin Funded Package' }
    });
    const autoReinvestOn = activeInvestments.length > 0 && activeInvestments.every(inv => inv.autoReinvest === true);
    const totalSelfInvestment = activeInvestments.reduce((sum, inv) => sum + inv.amount, 0);

    // 2. Count active direct referrals
    const directs = await ReferralTree.find({ referredBy: userId });
    const directIds = directs.map(d => d.user);
    const activeDirectIds = await UserInvestment.distinct('user', {
      user: { $in: directIds },
      status: 'active',
      packageType: { $ne: 'Admin Funded Package' }
    });
    const activeDirectsCount = activeDirectIds.length;

    // 3. Fetch user ranks
    const user = await User.findById(userId);
    const vipRank = user.vipRank || 0;
    const achievementRank = user.achievementRank || 0;

    // Calculate current qualified leadership tier
    const qualifiedTier = await rewardEngine.getQualifiedLeadershipTier(userId);

    // 4. Fetch leadership rewards history, populating the downlineUser's basic info
    const history = await LeadershipReward.find({ user: userId })
      .populate('downlineUser', 'name email')
      .sort({ createdAt: -1 });

    // Calculate pending missed rewards amount
    const pendingRecoveryTotal = history
      .filter(r => r.status === 'missed' && r.targetTier <= qualifiedTier)
      .reduce((sum, r) => sum + r.amount, 0);

    return successResponse(res, 'Leadership status retrieved successfully', {
      qualifiedTier,
      autoReinvestOn,
      totalSelfInvestment,
      activeDirectsCount,
      vipRank,
      achievementRank,
      history: history.map(h => ({
        _id: h._id,
        createdAt: h.createdAt,
        downlineUser: h.downlineUser ? {
          id: h.downlineUser._id,
          name: h.downlineUser.name,
          email: h.downlineUser.email
        } : null,
        rewardName: h.rewardName,
        amount: h.amount,
        targetTier: h.targetTier,
        status: h.status,
        recoveredAt: h.recoveredAt
      })),
      pendingRecoveryTotal
    });
  } catch (error) {
    console.error('getLeadershipStatus error:', error);
    return sendError(res, 'Failed to fetch leadership reward status details', 500, error);
  }
};

// @desc    Recover missed leadership rewards that the user is now qualified to claim
// @route   POST /api/rewards/recover-leadership-rewards
// @access  Private
const recoverLeadershipRewards = async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Calculate current qualified leadership tier
    const qualifiedTier = await rewardEngine.getQualifiedLeadershipTier(userId);
    if (qualifiedTier === 0) {
      return sendError(res, 'You do not qualify for any leadership reward tiers. Make sure your Auto-Reinvest is ON and you meet self-investment and direct active members requirements.', 400);
    }

    // 2. Find missed rewards that target a tier <= qualifiedTier
    const missedRewards = await LeadershipReward.find({
      user: userId,
      status: 'missed',
      targetTier: { $lte: qualifiedTier }
    });

    if (missedRewards.length === 0) {
      return sendError(res, 'No pending missed rewards are currently available for recovery.', 400);
    }

    const totalRecoveredAmount = missedRewards.reduce((sum, r) => sum + r.amount, 0);

    // 3. Credit to user's wallet
    let wallet = await Wallet.findOne({ user: userId });
    if (!wallet) {
      wallet = new Wallet({ user: userId });
    }

    const prevBal = wallet.referral || 0;
    wallet.referral = prevBal + totalRecoveredAmount;
    await wallet.save();

    // 4. Record in WalletHistory
    const recoveryLogIds = missedRewards.map(r => r._id);
    await WalletHistory.create({
      user: userId,
      walletType: 'referral',
      type: 'credit',
      amount: totalRecoveredAmount,
      previousBalance: prevBal,
      newBalance: wallet.referral,
      category: 'referral',
      description: `Recovered ${missedRewards.length} missed leadership rewards. New qualified tier: Tier ${qualifiedTier}`,
      referenceModel: 'LeadershipReward',
      referenceId: missedRewards[0]._id
    });

    // 5. Mark rewards as recovered
    await LeadershipReward.updateMany(
      { _id: { $in: recoveryLogIds } },
      { $set: { status: 'recovered', recoveredAt: new Date() } }
    );

    return successResponse(res, `Successfully recovered $${totalRecoveredAmount.toFixed(2)} missed leadership rewards!`, {
      recoveredAmount: totalRecoveredAmount
    });
  } catch (error) {
    console.error('recoverLeadershipRewards error:', error);
    return sendError(res, 'Failed to recover missed leadership rewards', 500, error);
  }
};

export default {
  getVipStatus,
  getAchievements,
  getLeadershipStatus,
  recoverLeadershipRewards
};
