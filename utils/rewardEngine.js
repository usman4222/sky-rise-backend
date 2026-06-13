import mongoose from 'mongoose';

// Import Models with ES Module .js extension
import User from '../models/auth/user.model.js';
import ReferralTree from '../models/network/referral_tree.model.js';
import Wallet from '../models/finance/wallet.model.js';
import WalletHistory from '../models/finance/wallet_history.model.js';
import UserInvestment from '../models/investment/user_investment.model.js';
import InvestmentPackage from '../models/investment/investment_package.model.js';
import InvestmentPayment from '../models/investment/investment_payment.model.js';
import RoiHistory from '../models/investment/roi_history.model.js';
import DirectReferralIncome from '../models/rewards/direct_referral_income.model.js';
import TeamBonus from '../models/rewards/team_bonus.model.js';
import LevelUnlock from '../models/network/level_unlock.model.js';
import LevelIncome from '../models/rewards/level_income.model.js';
import VipRank from '../models/rewards/vip_rank.model.js';
import VipQualification from '../models/rewards/vip_qualification.model.js';
import VipSalary from '../models/rewards/vip_salary.model.js';
import AchievementRank from '../models/rewards/achievement_rank.model.js';
import AchievementReward from '../models/rewards/achievement_reward.model.js';
import EarningRule from '../models/rewards/earning_rule.model.js';
import BusinessReport from '../models/network/business_report.model.js';
import LegReport from '../models/network/leg_report.model.js';
import Notification from '../models/system/notification.model.js';
import BackgroundJob from '../models/system/background_job.model.js';
import LeadershipReward from '../models/rewards/leadership_reward.model.js';

/**
 * Helper to update/cache user business reports (5-level volume, total volume)
 */
async function updateBusinessReport(userId) {
  try {
    // 1. Get user own investment (exclude Admin Funded Packages)
    const activeInvestments = await UserInvestment.find({
      user: userId,
      status: 'active',
      packageType: { $ne: 'Admin Funded Package' }
    });
    const selfInvestment = activeInvestments.reduce((sum, inv) => sum + inv.amount, 0);

    // 2. Fetch all descendants in the referral tree
    const tree = await ReferralTree.find({ ancestors: userId });
    const descendantIds = tree.map(t => t.user);

    let fiveLevelBusiness = 0;
    let totalTeamBusiness = 0;
    let directBusiness = 0;

    // Fetch active investments of descendants (exclude Admin Funded Packages)
    const descendantInvestments = await UserInvestment.find({
      user: { $in: descendantIds },
      status: 'active',
      packageType: { $ne: 'Admin Funded Package' }
    }).populate('user');

    // Get immediate referrals
    const directs = await ReferralTree.find({ referredBy: userId });
    const directIds = directs.map(d => d.user.toString());

    descendantInvestments.forEach(inv => {
      const invUserId = inv.user._id.toString();

      // Calculate depth relative to user
      // Find referral tree entry to find ancestor array index
      const memberTree = tree.find(t => t.user.toString() === invUserId);
      if (memberTree) {
        const depth = memberTree.ancestors.indexOf(userId) + 1; // 1-indexed depth

        // Sum unlimited team business
        totalTeamBusiness += inv.amount;

        // Sum 5-level team business
        if (depth <= 5) {
          fiveLevelBusiness += inv.amount;
        }

        // Sum direct business
        if (directIds.includes(invUserId)) {
          directBusiness += inv.amount;
        }
      }
    });

    // Upsert Business Report
    await BusinessReport.findOneAndUpdate(
      { user: userId },
      { selfInvestment, directBusiness, fiveLevelBusiness, totalTeamBusiness },
      { upsert: true, returnDocument: 'after' }
    );
  } catch (error) {
    console.error(`Error updating business report for ${userId}:`, error.message);
  }
}

/**
 * Triggers Direct Referral Income (8% on cash portion only)
 */
async function payoutDirectReferral(referredByUserId, referredUserId, realAmountPaid, userInvestmentId) {
  try {
    if (!referredByUserId) return;

    // Check if the investment is an Admin Funded Package
    const investment = await UserInvestment.findById(userInvestmentId);
    if (investment && investment.packageType === 'Admin Funded Package') {
      console.log(`💰 Direct Referral bypassed for Admin Funded Package: ${userInvestmentId}`);
      return;
    }

    // Fetch direct referral commission percent
    const rule = await EarningRule.findOne({ ruleName: 'direct_referral_percent' });
    const percent = rule ? Number(rule.value) : 8;

    const commissionAmount = realAmountPaid * (percent / 100);
    if (commissionAmount <= 0) return;

    // Fetch Sponsor's wallet
    let wallet = await Wallet.findOne({ user: referredByUserId });
    if (!wallet) {
      wallet = new Wallet({ user: referredByUserId });
    }

    const previousBalance = wallet.referral;
    wallet.referral += commissionAmount;
    await wallet.save();

    // Log in WalletHistory
    const history = new WalletHistory({
      user: referredByUserId,
      walletType: 'referral',
      type: 'credit',
      amount: commissionAmount,
      previousBalance,
      newBalance: wallet.referral,
      category: 'direct_referral_income',
      description: `${percent}% Direct Referral commission from downline purchase. Real Deposit: $${realAmountPaid}`,
      referenceModel: 'UserInvestment',
      referenceId: userInvestmentId
    });
    await history.save();

    // Log Direct Referral Income
    const referralIncome = new DirectReferralIncome({
      referrer: referredByUserId,
      referredUser: referredUserId,
      userInvestment: userInvestmentId,
      investmentAmountReal: realAmountPaid,
      commissionPercent: percent,
      commissionAmount
    });
    await referralIncome.save();

    // Send Notification
    await Notification.create({
      user: referredByUserId,
      title: 'Direct Referral Commission Credited',
      message: `You earned $${commissionAmount.toFixed(2)} from a direct referral investment of $${realAmountPaid.toFixed(2)}.`,
      category: 'commission'
    });

    console.log(`💰 Paid $${commissionAmount} direct referral to sponsor ${referredByUserId}`);
  } catch (error) {
    console.error('Error in payoutDirectReferral:', error.message);
  }
}

/**
 * Triggers $1 Signup Team Bonus payout for uplines up to 5 levels (joins within 10 days)
 */
async function payoutTeamBonusJoin(joiningUserId) {
  try {
    const joiningUser = await User.findById(joiningUserId);
    if (!joiningUser) return;

    // Get referral tree details to find uplines ancestors
    const treeNode = await ReferralTree.findOne({ user: joiningUserId });
    if (!treeNode || !treeNode.ancestors || treeNode.ancestors.length === 0) return;

    // Fetch team bonus rule settings
    const amountRule = await EarningRule.findOne({ ruleName: 'team_bonus_per_member' });
    const bonusAmount = amountRule ? Number(amountRule.value) : 1; // Default $1

    // Upline loop up to 5 levels deep
    const levelsToPayout = Math.min(treeNode.ancestors.length, 5);

    for (let depth = 1; depth <= levelsToPayout; depth++) {
      const uplineId = treeNode.ancestors[depth - 1]; // Order: 0 is direct referredBy parent
      const uplineUser = await User.findById(uplineId);

      if (!uplineUser || uplineUser.status === 'suspended') continue;

      // Check if joining is within 10 days of upline's registration deadline
      if (new Date() > uplineUser.teamBonusDeadline) {
        // Exceeded 10 days validity window, skip bonus
        continue;
      }

      // $1 Bonus split 50/50: 50% activation bonus ($0.50), 50% transferable bonus ($0.50)
      const activationAmt = bonusAmount * 0.5;
      const transferableAmt = bonusAmount * 0.5;

      let wallet = await Wallet.findOne({ user: uplineId });
      if (!wallet) {
        wallet = new Wallet({ user: uplineId });
      }

      // Credit wallet balances
      const prevActivation = wallet.bonusActivation;
      const prevTransferable = wallet.bonusTransferable;

      wallet.bonusActivation += activationAmt;
      wallet.bonusTransferable += transferableAmt;
      await wallet.save();

      // Log TeamBonus Audit Record
      const teamBonusLog = new TeamBonus({
        user: uplineId,
        joiningMember: joiningUserId,
        level: depth,
        amount: bonusAmount
      });
      await teamBonusLog.save();

      // Wallet history for activation wallet
      await WalletHistory.create({
        user: uplineId,
        walletType: 'bonusActivation',
        type: 'credit',
        amount: activationAmt,
        previousBalance: prevActivation,
        newBalance: wallet.bonusActivation,
        category: 'team_bonus_join',
        description: `50% Team Building Registration Bonus (Level Activation) from downline join at Level ${depth}`,
        referenceModel: 'User',
        referenceId: joiningUserId
      });

      // Wallet history for transferable wallet
      await WalletHistory.create({
        user: uplineId,
        walletType: 'bonusTransferable',
        type: 'credit',
        amount: transferableAmt,
        previousBalance: prevTransferable,
        newBalance: wallet.bonusTransferable,
        category: 'team_bonus_join',
        description: `50% Team Building Registration Bonus (Transferable) from downline join at Level ${depth}`,
        referenceModel: 'User',
        referenceId: joiningUserId
      });

      // Send Alert
      await Notification.create({
        user: uplineId,
        title: 'Team Join Bonus Earned',
        message: `You earned a $${bonusAmount.toFixed(2)} Team Building registration bonus from a new member joining at Level ${depth}.`,
        category: 'commission'
      });

      console.log(`👥 Paid $1 Team Join Bonus to upline ${uplineId} (Level ${depth})`);
    }
  } catch (error) {
    console.error('Error in payoutTeamBonusJoin:', error.message);
  }
}

/**
 * Triggers Daily ROI payouts & 10-level MLM team ROI splits
 * Simulates the daily cron execution
 */
/**
 * Helper to distribute 10-level upline MLM ROI commissions (total 31%)
 */
async function distributeLevelRoiCommissions(userId, payoutAmount, roiHistoryId) {
  try {
    // Check if the investment is an Admin Funded Package
    const roiHistory = await RoiHistory.findById(roiHistoryId).populate('userInvestment');
    if (roiHistory && roiHistory.userInvestment && roiHistory.userInvestment.packageType === 'Admin Funded Package') {
      console.log(`💰 Level ROI commissions bypassed for Admin Funded Package.`);
      return;
    }

    const distRule = await EarningRule.findOne({ ruleName: 'level_income_distribution' });
    const levelPercentages = distRule ? distRule.value : [8, 4, 4, 3, 2, 2, 2, 2, 2, 2];

    const treeNode = await ReferralTree.findOne({ user: userId });
    if (treeNode && treeNode.ancestors && treeNode.ancestors.length > 0) {
      const uplineCount = Math.min(treeNode.ancestors.length, 10);

      for (let levelIndex = 1; levelIndex <= uplineCount; levelIndex++) {
        const uplineId = treeNode.ancestors[levelIndex - 1];

        // Verify if upline unlocked this level
        const unlock = await LevelUnlock.findOne({ user: uplineId, level: levelIndex });
        if (levelIndex > 1 && !unlock) {
          // Upline has not paid $5 activation fee for this level depth, skips commissions!
          continue;
        }

        const percent = levelPercentages[levelIndex - 1];
        const commissionAmount = payoutAmount * (percent / 100);

        if (commissionAmount > 0) {
          const uplineWallet = await Wallet.findOne({ user: uplineId });
          if (uplineWallet) {
            const prevUplineBal = uplineWallet.roi;
            uplineWallet.roi += commissionAmount;
            await uplineWallet.save();

            // Ledger history
            await WalletHistory.create({
              user: uplineId,
              walletType: 'roi',
              type: 'credit',
              amount: commissionAmount,
              previousBalance: prevUplineBal,
              newBalance: uplineWallet.roi,
              category: 'level_roi_income',
              description: `${percent}% Level ROI team commission from downline Level ${levelIndex} member daily payout`,
              referenceModel: 'RoiHistory',
              referenceId: roiHistoryId
            });

            // Log Level Income record
            const levelLog = new LevelIncome({
              upline: uplineId,
              downline: userId,
              roiHistory: roiHistoryId,
              level: levelIndex,
              commissionPercent: percent,
              amount: commissionAmount
            });
            await levelLog.save();
          }
        }
      }
    }
  } catch (error) {
    console.error('Error distributing level ROI commissions:', error.message);
  }
}

/**
 * Triggers Daily ROI payouts & 10-level MLM team ROI splits
 * Simulates the daily cron execution
 */
async function runDailyRoiPayout() {
  const jobLog = new BackgroundJob({
    jobName: 'DAILY_ROI_PAYOUT',
    status: 'running'
  });
  await jobLog.save();

  try {
    console.log('📈 Starting Daily ROI Payout job...');

    // 1. Fetch all active user investments
    const activeInvestments = await UserInvestment.find({ status: 'active' }).populate('package');
    let processedCount = 0;

    const ROI_INTERVAL_MS = process.env.ROI_TEST_MODE === 'true'
      ? 60 * 1000 // 1 minute for testing
      : 24 * 60 * 60 * 1000; // 24 hours for production

    const claimWindowMs = process.env.ROI_TEST_MODE === 'true'
      ? 60 * 1000 // 1 minute for testing
      : 6 * 60 * 60 * 1000; // 6 hours for production

    const now = new Date();

    for (const investment of activeInvestments) {
      const pkg = investment.package;
      const user = investment.user;

      if (!pkg) {
        console.warn(`⚠️ User investment ${investment._id} has no valid package associated.`);
        continue;
      }

      // Check if previous pending manual claim has expired (missed ROI policy)
      if (investment.pendingRoiClaim > 0 && investment.claimExpiresAt && now > new Date(investment.claimExpiresAt)) {
        console.log(`⚠️ User investment ${investment._id} missed claiming daily ROI. Resetting pending claim.`);
        const missedAmount = investment.pendingRoiClaim;
        investment.pendingRoiClaim = 0;
        investment.claimExpiresAt = null;
        await investment.save();

        await Notification.create({
          user,
          title: 'Daily ROI Claim Expired ⚠️',
          message: `Your daily ROI claim of $${missedAmount.toFixed(2)} for package ${pkg.name} expired because it was not claimed within the required time window.`,
          category: 'system'
        });
      }

      const lastPayoutAt = investment.lastPayoutAt || investment.createdAt;
      const msSinceLastPayout = now.getTime() - new Date(lastPayoutAt).getTime();
      const tolerance = process.env.ROI_TEST_MODE === 'true' ? 3000 : 30000;
      if (msSinceLastPayout < ROI_INTERVAL_MS - tolerance) {
        continue;
      }

      // Calculate days passed since purchase
      const msPassed = now - investment.createdAt;
      const daysPassed = Math.floor(msPassed / (1000 * 60 * 60 * 24));

      // Calculate current ROI growth: starting +0.1% every 10 days up to maxRoi
      const incrementSteps = Math.floor(daysPassed / pkg.roiIncrementDays);
      let calculatedRoi = pkg.startRoi + (incrementSteps * pkg.roiIncrement);
      if (calculatedRoi > pkg.maxRoi) {
        calculatedRoi = pkg.maxRoi;
      }

      // Update investment ROI tracking
      investment.currentRoi = calculatedRoi;

      // Payout amount = principal * dailyRoi%
      const payoutAmount = investment.amount * (calculatedRoi / 100);
      if (payoutAmount <= 0) continue;

      let isCompounded = false;

      if (investment.autoReinvest) {
        // Principal compounding: add payout back into active principal amount
        investment.amount += payoutAmount;
        isCompounded = true;

        // ROI resets on reinvestment compounding as per requirements
        investment.currentRoi = pkg.startRoi;
        investment.createdAt = now;
        investment.lastIncrementAt = now;

        investment.totalRoiEarned += payoutAmount;
        investment.lastPayoutAt = now;
        await investment.save();

        // Log ROI Payout History
        const roiHistory = new RoiHistory({
          user,
          userInvestment: investment._id,
          amount: payoutAmount,
          roiPercent: calculatedRoi,
          isCompounded
        });
        await roiHistory.save();

        // Distribute 10-level Team ROI commissions immediately
        await distributeLevelRoiCommissions(user, payoutAmount, roiHistory._id);

      } else {
        // Manual claim option: store as pending claim with 6-hour expiration window (1 minute in test mode)
        investment.pendingRoiClaim = payoutAmount;
        investment.claimExpiresAt = new Date(now.getTime() + claimWindowMs);
        investment.roiClaimMode = 'manual'; // Sync logic
        investment.lastPayoutAt = now;
        await investment.save();

        // Notify user that ROI is ready to claim
        await Notification.create({
          user,
          title: 'Daily ROI Ready to Claim 💰',
          message: `Your daily ROI payout of $${payoutAmount.toFixed(2)} for ${pkg.name} is ready. Please claim it within the next ${process.env.ROI_TEST_MODE === 'true' ? '1 minute' : '6 hours'}.`,
          category: 'commission'
        });
      }


      processedCount++;
    }

    jobLog.status = 'completed';
    jobLog.completedAt = new Date();
    jobLog.affectedRecords = processedCount;
    await jobLog.save();

    console.log(`📈 Daily ROI job finished. Processed ${processedCount} investments.`);
  } catch (error) {
    console.error('❌ Daily ROI payout error:', error);
    jobLog.status = 'failed';
    jobLog.completedAt = new Date();
    jobLog.errorDetails = error.message;
    await jobLog.save();
  }
}

/**
 * Triggers 5-Level team volume rank achievement checks
 */
async function checkAchievementRewards(userId) {
  try {
    // 1. Cache user business volumes
    await updateBusinessReport(userId);
    const report = await BusinessReport.findOne({ user: userId });
    if (!report) return;

    const fiveLevelVolume = report.fiveLevelBusiness;

    // 2. Fetch all achievement ranks criteria
    const ranks = await AchievementRank.find({}).sort({ stage: 1 });
    let maxStageUnlocked = 0;

    for (const rank of ranks) {
      if (fiveLevelVolume >= rank.requiredTeamBusiness) {
        // User meets target volume. Check if already rewarded
        const isRewarded = await AchievementReward.findOne({ user: userId, achievementRank: rank._id });
        if (!isRewarded) {
          // Process Reward Payout!
          let wallet = await Wallet.findOne({ user: userId });
          if (!wallet) {
            wallet = new Wallet({ user: userId });
          }

          const prevBal = wallet.achievement;
          wallet.achievement += rank.reward;
          await wallet.save();

          // Ledger audit
          const history = new WalletHistory({
            user: userId,
            walletType: 'achievement',
            type: 'credit',
            amount: rank.reward,
            previousBalance: prevBal,
            newBalance: wallet.achievement,
            category: 'achievement_reward',
            description: `One-time Rank Achievement Reward for unlocking ${rank.name}! 5-level team volume: $${fiveLevelVolume}`,
            referenceModel: 'AchievementRank',
            referenceId: rank._id
          });
          await history.save();

          // Payout log
          const rewardPayout = new AchievementReward({
            user: userId,
            achievementRank: rank._id,
            rewardAmount: rank.reward
          });
          await rewardPayout.save();

          // Update profile rank field
          await User.findByIdAndUpdate(userId, { achievementRank: rank.stage });

          // Notify user
          await Notification.create({
            user: userId,
            title: `🏆 New Achievement Unlocked: ${rank.name}`,
            message: `Congratulations! You unlocked the ${rank.name} rank. A cash bonus of $${rank.reward} has been credited!`,
            category: 'rank'
          });

          console.log(`🏆 Awarded Spark Rank ${rank.name} ($${rank.reward}) to user ${userId}`);
        }

        maxStageUnlocked = rank.stage;
      }
    }
  } catch (error) {
    console.error('Error in checkAchievementRewards:', error.message);
  }
}

/**
 * Triggers Weekly VIP Salary Payouts based on 5 Active Legs leg-business volume
 */
async function runWeeklyVipSalaryPayout() {
  const jobLog = new BackgroundJob({
    jobName: 'WEEKLY_VIP_SALARY',
    status: 'running'
  });
  await jobLog.save();

  try {
    console.log('👑 Starting Weekly VIP Salary payout job...');
    let processedCount = 0;

    // Fetch all active users
    const users = await User.find({ status: 'active' });
    const vipCriteria = await VipRank.find({}).sort({ level: -1 }); // Check highest ranks first

    for (const user of users) {
      const userId = user._id;

      // 1. Get all immediate direct referrals representing distinct legs
      const directReferrals = await ReferralTree.find({ referredBy: userId });
      if (directReferrals.length < 5) {
        // Doesn't maintain 5 legs, skip salary check
        continue;
      }

      // 2. Fetch business reports for all legs (descendants)
      const legDetails = [];
      let activeLegsCount = 0;

      for (const direct of directReferrals) {
        const directId = direct.user;

        // Calculate total business generated inside this leg (direct member + all their descendants) (exclude Admin Funded Packages)
        const activeSelfInvestments = await UserInvestment.find({
          user: directId,
          status: 'active',
          packageType: { $ne: 'Admin Funded Package' }
        });
        const legOwnerInvestment = activeSelfInvestments.reduce((sum, inv) => sum + inv.amount, 0);

        // Fetch all descendants inside this leg sponsor branch
        const legDescendantsNode = await ReferralTree.find({ ancestors: directId });
        const descendantIds = legDescendantsNode.map(t => t.user);

        const downlineInvestments = await UserInvestment.find({
          user: { $in: descendantIds },
          status: 'active',
          packageType: { $ne: 'Admin Funded Package' }
        });

        const legDownlineVolume = downlineInvestments.reduce((sum, inv) => sum + inv.amount, 0);
        const legTotalBusiness = legOwnerInvestment + legDownlineVolume;

        legDetails.push({
          legUser: directId,
          volume: legTotalBusiness
        });

        // Save / update LegReport cache
        await LegReport.findOneAndUpdate(
          { user: userId, legUser: directId },
          { legBusinessVolume: legTotalBusiness, isActive: legTotalBusiness > 0 },
          { upsert: true }
        );
      }

      // Check ranks from highest level (5 down to 1)
      let qualifiedRank = 0;
      let salaryAmount = 0;

      for (const rank of vipCriteria) {
        // Count legs satisfying required business per leg
        const passingLegs = legDetails.filter(l => l.volume >= rank.requiredBusinessPerLeg);

        if (passingLegs.length >= 5) {
          // Qualified for this rank!
          qualifiedRank = rank.level;
          salaryAmount = rank.weeklySalary;
          break; // Qualified for the highest, stop check
        }
      }

      // 3. Process qualification updates & weekly payout
      await VipQualification.findOneAndUpdate(
        { user: userId },
        {
          currentRank: qualifiedRank,
          activeLegsCount: directReferrals.length,
          qualifiedLegsDetails: legDetails,
          status: qualifiedRank > 0 ? 'active' : 'none',
          qualifiedAt: qualifiedRank > 0 ? new Date() : null
        },
        { upsert: true }
      );

      // Update user's vipRank status based on qualification, do not auto-credit wallet (Option A)
      if (qualifiedRank > 0) {
        await User.findByIdAndUpdate(userId, { vipRank: qualifiedRank });
        processedCount++;
      } else {
        await User.findByIdAndUpdate(userId, { vipRank: 0 });
      }
    }

    jobLog.status = 'completed';
    jobLog.completedAt = new Date();
    jobLog.affectedRecords = processedCount;
    await jobLog.save();

    console.log(`👑 VIP Weekly Salary job finished. Distributed salaries to ${processedCount} users.`);
  } catch (error) {
    console.error('❌ VIP Salary payout error:', error);
    jobLog.status = 'failed';
    jobLog.completedAt = new Date();
    jobLog.errorDetails = error.message;
    await jobLog.save();
  }
}

/**
 * Calculates the qualified leadership tier (0 to 5) for a given upline user.
 */
async function getQualifiedLeadershipTier(uplineId) {
  try {
    // Exclude Admin Funded Packages from leadership tier calculations
    const activeInvestments = await UserInvestment.find({
      user: uplineId,
      status: 'active',
      packageType: { $ne: 'Admin Funded Package' }
    });
    if (activeInvestments.length === 0) return 0;

    // Check if Auto Reinvest must remain ON (all active investments must have autoReinvest = true)
    const allAutoReinvestOn = activeInvestments.every(inv => inv.autoReinvest === true);
    if (!allAutoReinvestOn) return 0;

    // Sum active self-investments
    const totalSelfInvestment = activeInvestments.reduce((sum, inv) => sum + inv.amount, 0);

    // Count active direct referrals
    const directs = await ReferralTree.find({ referredBy: uplineId });
    const directIds = directs.map(d => d.user);
    const activeDirectIds = await UserInvestment.distinct('user', {
      user: { $in: directIds },
      status: 'active',
      packageType: { $ne: 'Admin Funded Package' }
    });
    const activeDirectsCount = activeDirectIds.length;

    // Get upline user ranks
    const user = await User.findById(uplineId);
    if (!user) return 0;
    const vipRank = user.vipRank || 0;
    const achievementRank = user.achievementRank || 0;

    // Tier 5: Global Investor
    if (
      totalSelfInvestment >= 4000 &&
      activeDirectsCount >= 20 &&
      vipRank >= 3 &&
      achievementRank >= 2
    ) {
      return 5;
    }

    // Tier 4: Elite Leadership
    if (
      totalSelfInvestment >= 3000 &&
      activeDirectsCount >= 15 &&
      vipRank >= 2 &&
      achievementRank >= 2
    ) {
      return 4;
    }

    // Tier 3: Achievement Leadership
    if (
      totalSelfInvestment >= 3000 &&
      activeDirectsCount >= 10 &&
      vipRank >= 2 &&
      achievementRank >= 1
    ) {
      return 3;
    }

    // Tier 2: Growth Leadership
    if (
      totalSelfInvestment >= 1000 &&
      activeDirectsCount >= 6 &&
      vipRank >= 1
    ) {
      return 2;
    }

    // Tier 1: Starter Leadership
    if (
      totalSelfInvestment >= 500 &&
      activeDirectsCount >= 3
    ) {
      return 1;
    }

    return 0;
  } catch (error) {
    console.error(`Error calculating leadership tier for ${uplineId}:`, error.message);
    return 0;
  }
}

/**
 * Payouts Five Upline Team Leadership Rewards on investment package purchase.
 * Level 1: Starter Leadership Reward (5%)
 * Level 2: Growth Leadership Reward (3%)
 * Level 3: Achievement Leadership Reward (2%)
 * Level 4: Elite Leadership Reward (1.5%)
 * Level 5: Global Investor Reward (1.0%)
 */
async function payoutLeadershipRewards(userId, realAmountPaid, userInvestmentId) {
  try {
    if (realAmountPaid <= 0) return;

    // Check if it's Admin Funded Package
    const investment = await UserInvestment.findById(userInvestmentId);
    if (investment && investment.packageType === 'Admin Funded Package') {
      console.log(`🎁 Leadership Rewards bypassed for Admin Funded Package: ${userInvestmentId}`);
      return;
    }

    // Get referral tree details for the investing user
    const treeNode = await ReferralTree.findOne({ user: userId });
    if (!treeNode || !treeNode.ancestors || treeNode.ancestors.length === 0) return;

    const rewardSpecs = [
      { name: 'Starter Leadership Reward', percent: 5 },
      { name: 'Growth Leadership Reward', percent: 3 },
      { name: 'Achievement Leadership Reward', percent: 2 },
      { name: 'Elite Leadership Reward', percent: 1.5 },
      { name: 'Global Investor Reward', percent: 1 }
    ];

    const levelsToPayout = Math.min(treeNode.ancestors.length, 5);

    for (let depth = 1; depth <= levelsToPayout; depth++) {
      const uplineId = treeNode.ancestors[depth - 1];
      const spec = rewardSpecs[depth - 1];

      // Verify upline user exists and is active
      const uplineUser = await User.findById(uplineId);
      if (!uplineUser || uplineUser.status !== 'active') continue;

      const rewardAmount = realAmountPaid * (spec.percent / 100);
      if (rewardAmount <= 0) continue;

      // Determine the target tier for this reward amount
      let targetTier = 1;
      if (rewardAmount <= 10) targetTier = 1;
      else if (rewardAmount <= 20) targetTier = 2;
      else if (rewardAmount <= 30) targetTier = 3;
      else if (rewardAmount <= 40) targetTier = 4;
      else targetTier = 5;

      // Calculate upline's qualified leadership tier
      const qualifiedTier = await getQualifiedLeadershipTier(uplineId);

      if (qualifiedTier >= targetTier) {
        // QUALIFIED: Payout immediately
        let wallet = await Wallet.findOne({ user: uplineId });
        if (!wallet) {
          wallet = new Wallet({ user: uplineId });
        }

        // Credit to referral wallet
        const prevBal = wallet.referral;
        wallet.referral += rewardAmount;
        await wallet.save();

        // Log in WalletHistory
        const history = new WalletHistory({
          user: uplineId,
          walletType: 'referral',
          type: 'credit',
          amount: rewardAmount,
          previousBalance: prevBal,
          newBalance: wallet.referral,
          category: 'referral',
          description: `MLM Level ${depth} ${spec.name} from downline investment. Real amount paid: $${realAmountPaid}`,
          referenceModel: 'LeadershipReward',
          referenceId: null
        });
        await history.save();

        // Save Leadership Reward record
        const leadershipReward = new LeadershipReward({
          user: uplineId,
          downlineUser: userId,
          userInvestment: userInvestmentId,
          rewardName: spec.name,
          amount: rewardAmount,
          status: 'paid',
          targetTier: targetTier
        });
        await leadershipReward.save();

        // Update reference ID in history
        history.referenceId = leadershipReward._id;
        await history.save();

        // Send notification
        await Notification.create({
          user: uplineId,
          title: `🏆 ${spec.name} Payout`,
          message: `You have received $${rewardAmount.toFixed(2)} (${spec.percent}%) as ${spec.name} from your level ${depth} downline.`,
          category: 'commission'
        });

        console.log(`🎁 Paid $${rewardAmount} ${spec.name} to upline ${uplineId} (Level ${depth})`);
      } else {
        // NOT QUALIFIED: Log as missed reward
        const leadershipReward = new LeadershipReward({
          user: uplineId,
          downlineUser: userId,
          userInvestment: userInvestmentId,
          rewardName: spec.name,
          amount: rewardAmount,
          status: 'missed',
          targetTier: targetTier
        });
        await leadershipReward.save();

        // Send warning/missed notification
        await Notification.create({
          user: uplineId,
          title: `⚠️ Missed Leadership Reward`,
          message: `You missed a $${rewardAmount.toFixed(2)} (${spec.percent}%) ${spec.name} from your level ${depth} downline because you do not meet the Tier ${targetTier} eligibility requirements. You can recover this once you qualify.`,
          category: 'system'
        });

        console.log(`⚠️ Missed $${rewardAmount} ${spec.name} for upline ${uplineId} (Level ${depth}) due to insufficient eligibility.`);
      }
    }
  } catch (error) {
    console.error('Error in payoutLeadershipRewards:', error.message);
  }
}

export default {
  updateBusinessReport,
  payoutDirectReferral,
  payoutTeamBonusJoin,
  runDailyRoiPayout,
  checkAchievementRewards,
  runWeeklyVipSalaryPayout,
  payoutLeadershipRewards,
  getQualifiedLeadershipTier,
  distributeLevelRoiCommissions
};
